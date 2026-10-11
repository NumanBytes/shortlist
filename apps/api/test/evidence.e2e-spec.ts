import { createTestApp, type TestApp, type TestUser } from './helpers.js';

// These tests encode the truthfulness rules from Agents.md §6. If one fails, the
// product can put an unconfirmed claim on a real resume — treat as a release blocker.
describe('Skill evidence (e2e)', () => {
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

  let skillCounter = 0;
  async function newSkill(who: TestUser = me) {
    const res = await t
      .http()
      .post('/api/v1/skills')
      .set(who.auth)
      .send({ name: `Skill ${++skillCounter}`, category: 'TOOL' })
      .expect(201);
    return res.body.id as string;
  }

  const evidenceBody = (skillId: string, extra: Record<string, unknown> = {}) => ({
    skillId,
    context: 'COMMERCIAL',
    depth: 'PRODUCTION',
    whatIDid: 'Built the role-based access control screens',
    lastUsed: '2026-06-01',
    ...extra,
  });

  async function newEvidence(skillId: string, extra: Record<string, unknown> = {}) {
    const res = await t.http().post('/api/v1/evidence').set(me.auth).send(evidenceBody(skillId, extra)).expect(201);
    return res.body as { id: string; isVerified: boolean; verifiedAt: string | null };
  }

  const verify = (id: string, who: TestUser = me) => t.http().post(`/api/v1/evidence/${id}/verify`).set(who.auth);

  describe('verification', () => {
    it('creates evidence unverified', async () => {
      const ev = await newEvidence(await newSkill());
      expect(ev.isVerified).toBe(false);
      expect(ev.verifiedAt).toBeNull();
    });

    it('never accepts isVerified from a request body — create or update', async () => {
      const skillId = await newSkill();
      await t
        .http()
        .post('/api/v1/evidence')
        .set(me.auth)
        .send(evidenceBody(skillId, { isVerified: true }))
        .expect(400);

      const ev = await newEvidence(skillId);
      await t.http().patch(`/api/v1/evidence/${ev.id}`).set(me.auth).send({ isVerified: true }).expect(400);
      await t.http().patch(`/api/v1/evidence/${ev.id}`).set(me.auth).send({ verifiedAt: new Date() }).expect(400);
    });

    it('verify is the explicit action that sets isVerified, and is idempotent', async () => {
      const ev = await newEvidence(await newSkill());
      const first = await verify(ev.id).expect(200);
      expect(first.body.isVerified).toBe(true);
      expect(first.body.verifiedAt).toEqual(expect.any(String));

      const again = await verify(ev.id).expect(200);
      expect(again.body.verifiedAt).toBe(first.body.verifiedAt);
    });

    it('unverify clears verification', async () => {
      const ev = await newEvidence(await newSkill());
      await verify(ev.id).expect(200);
      const res = await t.http().post(`/api/v1/evidence/${ev.id}/unverify`).set(me.auth).expect(200);
      expect(res.body).toMatchObject({ isVerified: false, verifiedAt: null });
    });

    it('editing verified evidence un-verifies it', async () => {
      const ev = await newEvidence(await newSkill());
      await verify(ev.id).expect(200);
      const res = await t
        .http()
        .patch(`/api/v1/evidence/${ev.id}`)
        .set(me.auth)
        .send({ whatIDid: 'Built and also designed the RBAC screens' })
        .expect(200);
      expect(res.body).toMatchObject({ isVerified: false, verifiedAt: null });
    });

    it('renaming a skill un-verifies all its evidence (the Azure B2C scenario)', async () => {
      const skillId = await newSkill();
      const a = await newEvidence(skillId);
      const b = await newEvidence(skillId, { context: 'PERSONAL', depth: 'WORKING' });
      await verify(a.id).expect(200);
      await verify(b.id).expect(200);

      await t.http().patch(`/api/v1/skills/${skillId}`).set(me.auth).send({ name: 'Azure B2C' }).expect(200);

      const skill = await t.http().get(`/api/v1/skills/${skillId}`).set(me.auth).expect(200);
      expect(skill.body.evidence.every((e: { isVerified: boolean }) => !e.isVerified)).toBe(true);
    });

    it('changing only the category keeps evidence verified', async () => {
      const skillId = await newSkill();
      const ev = await newEvidence(skillId);
      await verify(ev.id).expect(200);
      await t.http().patch(`/api/v1/skills/${skillId}`).set(me.auth).send({ category: 'PLATFORM' }).expect(200);
      const skill = await t.http().get(`/api/v1/skills/${skillId}`).set(me.auth).expect(200);
      expect(skill.body.evidence[0].isVerified).toBe(true);
    });
  });

  describe('ownership', () => {
    it("cannot attach evidence to another user's skill", async () => {
      const theirSkill = await newSkill(other);
      await t.http().post('/api/v1/evidence').set(me.auth).send(evidenceBody(theirSkill)).expect(404);
    });

    it("returns 404 for another user's evidence on every route — including verify", async () => {
      const ev = await newEvidence(await newSkill());
      await verify(ev.id, other).expect(404);
      await t.http().post(`/api/v1/evidence/${ev.id}/unverify`).set(other.auth).expect(404);
      await t.http().patch(`/api/v1/evidence/${ev.id}`).set(other.auth).send({ whatIDid: 'x' }).expect(404);
      await t.http().delete(`/api/v1/evidence/${ev.id}`).set(other.auth).expect(404);
    });

    it("cannot link evidence to another user's project or work experience", async () => {
      const theirProject = await t.prisma.project.create({ data: { userId: other.user.id, name: 'Theirs' } });
      const theirJob = await t.prisma.workExperience.create({
        data: { userId: other.user.id, company: 'Elsewhere', title: 'Dev', startDate: new Date('2024-01-01') },
      });
      const skillId = await newSkill();
      await t
        .http()
        .post('/api/v1/evidence')
        .set(me.auth)
        .send(evidenceBody(skillId, { projectId: theirProject.id }))
        .expect(400);
      await t
        .http()
        .post('/api/v1/evidence')
        .set(me.auth)
        .send(evidenceBody(skillId, { workExperienceId: theirJob.id }))
        .expect(400);
    });
  });

  describe('links and validation', () => {
    it('links to one of my own projects', async () => {
      const project = await t.prisma.project.create({ data: { userId: me.user.id, name: 'Shortlist' } });
      const ev = await newEvidence(await newSkill(), { projectId: project.id });
      expect(ev).toMatchObject({ projectId: project.id });
    });

    it('rejects linking both a work experience and a project — in one request or across two', async () => {
      const project = await t.prisma.project.create({ data: { userId: me.user.id, name: 'Side project' } });
      const job = await t.prisma.workExperience.create({
        data: { userId: me.user.id, company: 'CloudCard', title: 'Frontend Dev', startDate: new Date('2024-05-01') },
      });
      const skillId = await newSkill();
      await t
        .http()
        .post('/api/v1/evidence')
        .set(me.auth)
        .send(evidenceBody(skillId, { projectId: project.id, workExperienceId: job.id }))
        .expect(400);

      const ev = await newEvidence(skillId, { workExperienceId: job.id });
      await t.http().patch(`/api/v1/evidence/${ev.id}`).set(me.auth).send({ projectId: project.id }).expect(400);
      // Clearing one link while setting the other is allowed.
      await t
        .http()
        .patch(`/api/v1/evidence/${ev.id}`)
        .set(me.auth)
        .send({ workExperienceId: null, projectId: project.id })
        .expect(200);
    });

    it('rejects a lastUsed date in the future', async () => {
      const skillId = await newSkill();
      await t
        .http()
        .post('/api/v1/evidence')
        .set(me.auth)
        .send(evidenceBody(skillId, { lastUsed: '2999-01-01' }))
        .expect(400);
    });

    it('deletes evidence, and deleting a skill cascades to its evidence', async () => {
      const skillId = await newSkill();
      const a = await newEvidence(skillId);
      const b = await newEvidence(skillId);
      await t.http().delete(`/api/v1/evidence/${a.id}`).set(me.auth).expect(204);
      await t.http().delete(`/api/v1/skills/${skillId}`).set(me.auth).expect(204);
      expect(await t.prisma.skillEvidence.count({ where: { id: { in: [a.id, b.id] } } })).toBe(0);
    });
  });
});
