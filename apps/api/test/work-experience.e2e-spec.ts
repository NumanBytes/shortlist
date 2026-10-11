import { createTestApp, type TestApp, type TestUser } from './helpers.js';

describe('Work experience (e2e)', () => {
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

  const cloudCard = {
    company: 'CloudCard Inc.',
    title: 'Frontend Developer',
    startDate: '2024-05-01',
    isCurrent: true,
  };

  async function newJob(body: Record<string, unknown> = cloudCard, who: TestUser = me) {
    const res = await t.http().post('/api/v1/work-experiences').set(who.auth).send(body).expect(201);
    return res.body as { id: string };
  }

  // Creates a skill + evidence linked to the job, verified.
  async function verifiedEvidenceFor(workExperienceId: string) {
    const skill = await t
      .http()
      .post('/api/v1/skills')
      .set(me.auth)
      .send({ name: `Skill ${crypto.randomUUID()}`, category: 'FRAMEWORK' })
      .expect(201);
    const ev = await t
      .http()
      .post('/api/v1/evidence')
      .set(me.auth)
      .send({
        skillId: skill.body.id,
        context: 'COMMERCIAL',
        depth: 'PRODUCTION',
        whatIDid: 'Built the RBAC screens',
        lastUsed: '2026-06-01',
        workExperienceId,
      })
      .expect(201);
    await t.http().post(`/api/v1/evidence/${ev.body.id}/verify`).set(me.auth).expect(200);
    return ev.body.id as string;
  }

  const isVerified = async (evidenceId: string) =>
    (await t.prisma.skillEvidence.findUniqueOrThrow({ where: { id: evidenceId } })).isVerified;

  it('requires authentication', async () => {
    await t.http().get('/api/v1/work-experiences').expect(401);
  });

  it('creates, reads, lists, updates, and deletes', async () => {
    const job = await newJob();
    const got = await t.http().get(`/api/v1/work-experiences/${job.id}`).set(me.auth).expect(200);
    expect(got.body).toMatchObject({ company: 'CloudCard Inc.', isCurrent: true, endDate: null, evidence: [] });

    const list = await t.http().get('/api/v1/work-experiences').set(me.auth).expect(200);
    expect(list.body.map((w: { id: string }) => w.id)).toContain(job.id);

    await t.http().patch(`/api/v1/work-experiences/${job.id}`).set(me.auth).send({ location: 'Lahore' }).expect(200);
    await t.http().delete(`/api/v1/work-experiences/${job.id}`).set(me.auth).expect(204);
    await t.http().get(`/api/v1/work-experiences/${job.id}`).set(me.auth).expect(404);
  });

  it("returns 404 for another user's work experience", async () => {
    const job = await newJob();
    await t.http().get(`/api/v1/work-experiences/${job.id}`).set(other.auth).expect(404);
    await t.http().patch(`/api/v1/work-experiences/${job.id}`).set(other.auth).send({ title: 'CTO' }).expect(404);
    await t.http().delete(`/api/v1/work-experiences/${job.id}`).set(other.auth).expect(404);
  });

  describe('date rules', () => {
    it('requires an end date unless the role is current', async () => {
      const { isCurrent: _, ...past } = cloudCard;
      await t.http().post('/api/v1/work-experiences').set(me.auth).send(past).expect(400);
    });

    it('rejects an end date on a current role', async () => {
      await t
        .http()
        .post('/api/v1/work-experiences')
        .set(me.auth)
        .send({ ...cloudCard, endDate: '2025-01-01' })
        .expect(400);
    });

    it('rejects an end date before the start date', async () => {
      await t
        .http()
        .post('/api/v1/work-experiences')
        .set(me.auth)
        .send({ ...cloudCard, isCurrent: false, endDate: '2023-01-01' })
        .expect(400);
    });

    it('rejects a start date in the future', async () => {
      await t
        .http()
        .post('/api/v1/work-experiences')
        .set(me.auth)
        .send({ ...cloudCard, startDate: '2999-01-01' })
        .expect(400);
    });

    it('checks the merged result on update, not just the patch', async () => {
      const job = await newJob({ ...cloudCard, isCurrent: false, endDate: '2025-06-01' });
      // Marking it current while the stored end date remains is inconsistent...
      await t.http().patch(`/api/v1/work-experiences/${job.id}`).set(me.auth).send({ isCurrent: true }).expect(400);
      // ...but doing both in one patch is fine.
      await t
        .http()
        .patch(`/api/v1/work-experiences/${job.id}`)
        .set(me.auth)
        .send({ isCurrent: true, endDate: null })
        .expect(200);
    });
  });

  describe('linked evidence stays truthful', () => {
    it('changing the company un-verifies linked evidence', async () => {
      const job = await newJob();
      const ev = await verifiedEvidenceFor(job.id);
      await t.http().patch(`/api/v1/work-experiences/${job.id}`).set(me.auth).send({ company: 'Google' }).expect(200);
      expect(await isVerified(ev)).toBe(false);
    });

    it('changing the dates un-verifies linked evidence', async () => {
      const job = await newJob();
      const ev = await verifiedEvidenceFor(job.id);
      await t
        .http()
        .patch(`/api/v1/work-experiences/${job.id}`)
        .set(me.auth)
        .send({ startDate: '2020-01-01' })
        .expect(200);
      expect(await isVerified(ev)).toBe(false);
    });

    it('changing only the location keeps it verified', async () => {
      const job = await newJob();
      const ev = await verifiedEvidenceFor(job.id);
      await t.http().patch(`/api/v1/work-experiences/${job.id}`).set(me.auth).send({ location: 'Remote' }).expect(200);
      expect(await isVerified(ev)).toBe(true);
    });

    it('resending unchanged values keeps it verified', async () => {
      const job = await newJob();
      const ev = await verifiedEvidenceFor(job.id);
      await t.http().patch(`/api/v1/work-experiences/${job.id}`).set(me.auth).send(cloudCard).expect(200);
      expect(await isVerified(ev)).toBe(true);
    });

    it('deleting the role keeps the evidence but unlinks and un-verifies it', async () => {
      const job = await newJob();
      const ev = await verifiedEvidenceFor(job.id);
      await t.http().delete(`/api/v1/work-experiences/${job.id}`).set(me.auth).expect(204);
      const after = await t.prisma.skillEvidence.findUniqueOrThrow({ where: { id: ev } });
      expect(after).toMatchObject({ workExperienceId: null, isVerified: false, verifiedAt: null });
    });

    it('lists linked evidence with its skill name', async () => {
      const job = await newJob();
      await verifiedEvidenceFor(job.id);
      const got = await t.http().get(`/api/v1/work-experiences/${job.id}`).set(me.auth).expect(200);
      expect(got.body.evidence[0].skill.name).toEqual(expect.stringMatching(/^Skill /));
    });
  });
});
