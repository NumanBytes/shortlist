import { RESUME_QUEUE } from '@shortlist/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createTestApp, TEST_REDIS_URL, type TestApp, type TestUser } from './helpers.js';

// The worker writes resumes; here the variants are inserted directly, as the worker would.
describe('Resumes (e2e)', () => {
  let t: TestApp;
  let me: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    me = await t.register();
    other = await t.register();
  });

  afterAll(async () => {
    await t.close();
  });

  async function evidence(user: TestUser, name: string) {
    const skill = await t.prisma.skill.create({
      data: { userId: user.user.id, name: `${name}-${crypto.randomUUID()}`, category: 'LIBRARY' },
    });
    return t.prisma.skillEvidence.create({
      data: {
        skillId: skill.id,
        context: 'COMMERCIAL',
        depth: 'PRODUCTION',
        whatIDid: `Used ${name}.`,
        lastUsed: new Date(),
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
  }

  const reqs = (names: string[]) =>
    names.map((skillName) => ({ skillName, importance: 'REQUIRED' as const, isCore: false }));

  async function job(user: TestUser, requirements: string[], analysed = true) {
    return t.prisma.job.create({
      data: {
        userId: user.user.id,
        title: 'Frontend Engineer',
        company: 'Kwanso',
        rawJD: 'React',
        dedupeHash: crypto.randomUUID(),
        status: 'INTERESTED',
        analysisStatus: analysed ? 'DONE' : 'PENDING',
        requirements: { create: reqs(requirements) },
      },
    });
  }

  // One bullet is enough to be a resume.
  const content = (evidenceId: string) => ({
    experience: [
      {
        workExperienceId: 'r',
        title: 'Software Engineer',
        company: 'CloudCard',
        location: null,
        startDate: '2024-05-01T00:00:00.000Z',
        endDate: null,
        isCurrent: true,
        bullets: [{ label: null, text: 'Used React.', evidenceIds: [evidenceId] }],
      },
    ],
    projects: [],
    skillGroups: [],
    dropped: [],
  });

  async function variant(
    user: TestUser,
    evidenceId: string,
    profile: string[],
    status: 'DRAFT' | 'APPROVED' = 'DRAFT',
  ) {
    return t.prisma.resumeVariant.create({
      data: {
        userId: user.user.id,
        content: content(evidenceId),
        evidenceIds: [evidenceId],
        requirementProfile: profile,
        model: 'claude-sonnet-5-5',
        status,
        approvedAt: status === 'APPROVED' ? new Date() : null,
      },
    });
  }

  it("says since when a resume has waited, and lists every one being tailored — only the caller's", async () => {
    const user = await t.register();
    const j = await job(user, ['React']);
    await t.prisma.jobResume.create({ data: { jobId: j.id, status: 'PENDING' } });
    const res = await t.http().get(`/api/v1/jobs/${j.id}/resume`).set(user.auth).expect(200);
    expect(res.body).toMatchObject({ status: 'PENDING', queuedAt: expect.any(String) });
    expect(typeof res.body.workerOnline).toBe('boolean');

    const active = await t.http().get('/api/v1/resumes/active').set(user.auth).expect(200);
    expect(active.body).toEqual([
      { jobId: j.id, title: 'Frontend Engineer', company: 'Kwanso', queuedAt: res.body.queuedAt },
    ]);
    expect((await t.http().get('/api/v1/resumes/active').set(other.auth).expect(200)).body).toEqual([]);
  });

  it('cancels a tailoring run that has not started — nothing queued, nothing charged, the old resume kept', async () => {
    const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(RESUME_QUEUE, { connection: redis });
    try {
      const user = await t.register();
      const e = await evidence(user, 'React');
      const fresh = await job(user, ['React']);
      await t.http().post(`/api/v1/jobs/${fresh.id}/resume`).set(user.auth).send({ mode: 'tailor' }).expect(202);
      const res = await t.http().post(`/api/v1/jobs/${fresh.id}/resume/cancel`).set(user.auth).expect(200);
      expect(res.body.status).toBe('NONE');
      const waiting = (await queue.getJobs(['waiting', 'delayed', 'active'])).filter((j) => j.data.jobId === fresh.id);
      expect(waiting).toHaveLength(0);
      await t.http().post(`/api/v1/jobs/${fresh.id}/resume/cancel`).set(user.auth).expect(409); // nothing left to cancel
      await t.http().post(`/api/v1/jobs/${fresh.id}/resume/cancel`).set(other.auth).expect(404);

      // A job that already had a resume keeps it.
      const had = await job(user, ['React']);
      const v = await variant(user, e.id, ['react']);
      await t.prisma.jobResume.create({ data: { jobId: had.id, status: 'READY', variantId: v.id } });
      await t.http().post(`/api/v1/jobs/${had.id}/resume`).set(user.auth).send({ mode: 'tailor' }).expect(202);
      const kept = await t.http().post(`/api/v1/jobs/${had.id}/resume/cancel`).set(user.auth).expect(200);
      expect(kept.body).toMatchObject({ status: 'READY', variant: { id: v.id } });
    } finally {
      await queue.close();
      await redis.quit();
    }
  });

  it('reports NONE for a job without a resume, and 404 for someone else’s job', async () => {
    const j = await job(me, ['React']);
    const res = await t.http().get(`/api/v1/jobs/${j.id}/resume`).set(me.auth).expect(200);
    expect(res.body).toMatchObject({ status: 'NONE', canTailor: true, variant: null, reuse: [] });
    await t.http().get(`/api/v1/jobs/${j.id}/resume`).set(other.auth).expect(404);
  });

  it('queues tailoring (idempotently) only for a scored job', async () => {
    const unscored = await job(me, [], false);
    await t.http().post(`/api/v1/jobs/${unscored.id}/resume`).set(me.auth).send({ mode: 'tailor' }).expect(409);

    const j = await job(me, ['React']);
    const first = await t.http().post(`/api/v1/jobs/${j.id}/resume`).set(me.auth).send({ mode: 'tailor' }).expect(202);
    expect(first.body.status).toBe('PENDING');
    const again = await t.http().post(`/api/v1/jobs/${j.id}/resume`).set(me.auth).send({ mode: 'tailor' }).expect(202);
    expect(again.body.status).toBe('PENDING');
    await t.http().post(`/api/v1/jobs/${j.id}/resume`).set(other.auth).send({ mode: 'tailor' }).expect(404);
  });

  it('rejects unknown modes and fields', async () => {
    const j = await job(me, ['React']);
    await t.http().post(`/api/v1/jobs/${j.id}/resume`).set(me.auth).send({ mode: 'write-anything' }).expect(400);
    await t
      .http()
      .post(`/api/v1/jobs/${j.id}/resume`)
      .set(me.auth)
      .send({ mode: 'tailor', status: 'APPROVED' })
      .expect(400);
  });

  it('shows a ready resume with the sources behind each bullet', async () => {
    const e = await evidence(me, 'React');
    const v = await variant(me, e.id, ['react']);
    const j = await job(me, ['React']);
    await t.prisma.jobResume.create({ data: { jobId: j.id, status: 'READY', variantId: v.id } });

    const res = await t.http().get(`/api/v1/jobs/${j.id}/resume`).set(me.auth).expect(200);
    expect(res.body).toMatchObject({ status: 'READY', variant: { id: v.id, status: 'DRAFT', stale: [] } });
    expect(res.body.sources[e.id]).toMatchObject({
      whatIDid: 'Used React.',
      isVerified: true,
      context: 'COMMERCIAL',
      depth: 'PRODUCTION',
      lastUsed: expect.any(String),
    });
  });

  it('approves only an up-to-date resume; editing or un-verifying its evidence makes it stale', async () => {
    const e = await evidence(me, 'React');
    const v = await variant(me, e.id, ['react']);
    await t.http().post(`/api/v1/resumes/${v.id}/approve`).set(other.auth).expect(404);

    // Editing the claim (through the real endpoint) un-verifies it → stale.
    await t
      .http()
      .patch(`/api/v1/evidence/${e.id}`)
      .set(me.auth)
      .send({ whatIDid: 'Used React a little.' })
      .expect(200);
    await t.http().post(`/api/v1/resumes/${v.id}/approve`).set(me.auth).expect(409);

    // Re-verifying doesn't make the old wording true again: still stale (changed since).
    await t.http().post(`/api/v1/evidence/${e.id}/verify`).set(me.auth).expect(200);
    const j = await job(me, ['React']);
    await t.prisma.jobResume.create({ data: { jobId: j.id, status: 'READY', variantId: v.id } });
    const res = await t.http().get(`/api/v1/jobs/${j.id}/resume`).set(me.auth).expect(200);
    expect(res.body.variant.stale).toEqual([expect.stringMatching(/changed since/)]);

    const fresh = await variant(me, (await evidence(me, 'TypeScript')).id, ['typescript']);
    const ok = await t.http().post(`/api/v1/resumes/${fresh.id}/approve`).set(me.auth).expect(200);
    expect(ok.body).toMatchObject({ status: 'APPROVED', approvedAt: expect.any(String) });
  });

  it('offers an approved, up-to-date resume for reuse when the requirements match', async () => {
    const e = await evidence(me, 'Angular');
    const approved = await variant(me, e.id, ['angular', 'rxj', 'typescript'], 'APPROVED');
    const draft = await variant(me, e.id, ['angular', 'rxj', 'typescript']);

    const close = await job(me, ['Angular', 'RxJS', 'TypeScript']);
    const res = await t.http().get(`/api/v1/jobs/${close.id}/resume`).set(me.auth).expect(200);
    expect(res.body.reuse.map((r: { variantId: string }) => r.variantId)).toContain(approved.id);
    expect(res.body.reuse.map((r: { variantId: string }) => r.variantId)).not.toContain(draft.id);

    // A narrow job is fully covered, but asks for too little of what the resume was built
    // for to be "the same kind of job" (the production "100% match", 2026-10-12).
    const narrow = await job(me, ['Angular']);
    const off = await t.http().get(`/api/v1/jobs/${narrow.id}/resume`).set(me.auth).expect(200);
    expect(off.body.reuse.map((r: { variantId: string }) => r.variantId)).not.toContain(approved.id);

    // A REQUIRED skill the variant wasn't built for rules it out.
    const far = await job(me, ['Angular', 'RxJS', 'TypeScript', 'Go']);
    const none = await t.http().get(`/api/v1/jobs/${far.id}/resume`).set(me.auth).expect(200);
    expect(none.body.reuse.map((r: { variantId: string }) => r.variantId)).not.toContain(approved.id);

    const reused = await t
      .http()
      .post(`/api/v1/jobs/${close.id}/resume`)
      .set(me.auth)
      .send({ mode: 'reuse', variantId: approved.id })
      .expect(202);
    expect(reused.body).toMatchObject({ status: 'READY', reused: true, overlap: 1, variant: { id: approved.id } });

    // Only approved resumes can be reused, and only your own.
    await t
      .http()
      .post(`/api/v1/jobs/${far.id}/resume`)
      .set(me.auth)
      .send({ mode: 'reuse', variantId: draft.id })
      .expect(409);
    const theirs = await job(other, ['Angular']);
    await t
      .http()
      .post(`/api/v1/jobs/${theirs.id}/resume`)
      .set(other.auth)
      .send({ mode: 'reuse', variantId: approved.id })
      .expect(404);
  });
});
