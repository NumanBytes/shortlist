import { createTestApp, type TestApp, type TestUser } from './helpers.js';

describe('Projects (e2e)', () => {
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

  const shortlist = {
    name: 'Shortlist',
    description: 'Job-hunt assistant with truthful resume tailoring',
    repoUrl: 'https://github.com/NumanBytes/shortlist',
    startDate: '2026-09-01',
  };

  async function newProject(body: Record<string, unknown> = shortlist, who: TestUser = me) {
    const res = await t.http().post('/api/v1/projects').set(who.auth).send(body).expect(201);
    return res.body as { id: string; isShipped: boolean };
  }

  async function verifiedEvidenceFor(projectId: string) {
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
        context: 'PERSONAL',
        depth: 'WORKING',
        whatIDid: 'Built the NestJS API',
        lastUsed: '2026-09-01',
        projectId,
      })
      .expect(201);
    await t.http().post(`/api/v1/evidence/${ev.body.id}/verify`).set(me.auth).expect(200);
    return ev.body.id as string;
  }

  const isVerified = async (evidenceId: string) =>
    (await t.prisma.skillEvidence.findUniqueOrThrow({ where: { id: evidenceId } })).isVerified;

  it('requires authentication', async () => {
    await t.http().get('/api/v1/projects').expect(401);
  });

  it('creates with defaults, reads, lists, updates, and deletes', async () => {
    const project = await newProject({ name: 'Minimal' });
    expect(project.isShipped).toBe(false);

    await t.http().get(`/api/v1/projects/${project.id}`).set(me.auth).expect(200);
    const list = await t.http().get('/api/v1/projects').set(me.auth).expect(200);
    expect(list.body.map((p: { id: string }) => p.id)).toContain(project.id);

    const updated = await t
      .http()
      .patch(`/api/v1/projects/${project.id}`)
      .set(me.auth)
      .send({ liveUrl: 'https://getshortlist.com' })
      .expect(200);
    expect(updated.body.liveUrl).toBe('https://getshortlist.com');

    await t.http().patch(`/api/v1/projects/${project.id}`).set(me.auth).send({ liveUrl: null }).expect(200);
    await t.http().delete(`/api/v1/projects/${project.id}`).set(me.auth).expect(204);
    await t.http().get(`/api/v1/projects/${project.id}`).set(me.auth).expect(404);
  });

  it("returns 404 for another user's project", async () => {
    const project = await newProject();
    await t.http().get(`/api/v1/projects/${project.id}`).set(other.auth).expect(404);
    await t.http().patch(`/api/v1/projects/${project.id}`).set(other.auth).send({ name: 'Mine now' }).expect(404);
    await t.http().delete(`/api/v1/projects/${project.id}`).set(other.auth).expect(404);
  });

  describe('validation', () => {
    it('only accepts http(s) URLs — no javascript: links', async () => {
      await t
        .http()
        .post('/api/v1/projects')
        .set(me.auth)
        .send({ name: 'XSS', liveUrl: 'javascript:alert(1)' })
        .expect(400);
      await t.http().post('/api/v1/projects').set(me.auth).send({ name: 'FTP', repoUrl: 'ftp://x.com' }).expect(400);
    });

    it('rejects an end date before the start date, including across a patch', async () => {
      await t
        .http()
        .post('/api/v1/projects')
        .set(me.auth)
        .send({ name: 'Backwards', startDate: '2025-06-01', endDate: '2025-01-01' })
        .expect(400);
      const project = await newProject({ name: 'Dated', startDate: '2025-06-01' });
      await t.http().patch(`/api/v1/projects/${project.id}`).set(me.auth).send({ endDate: '2025-01-01' }).expect(400);
    });
  });

  describe('linked evidence stays truthful', () => {
    it('marking a project as shipped un-verifies linked evidence', async () => {
      const project = await newProject();
      const ev = await verifiedEvidenceFor(project.id);
      await t.http().patch(`/api/v1/projects/${project.id}`).set(me.auth).send({ isShipped: true }).expect(200);
      expect(await isVerified(ev)).toBe(false);
    });

    it('renaming a project un-verifies linked evidence', async () => {
      const project = await newProject();
      const ev = await verifiedEvidenceFor(project.id);
      await t.http().patch(`/api/v1/projects/${project.id}`).set(me.auth).send({ name: 'Something else' }).expect(200);
      expect(await isVerified(ev)).toBe(false);
    });

    it('changing only a URL keeps it verified', async () => {
      const project = await newProject();
      const ev = await verifiedEvidenceFor(project.id);
      await t
        .http()
        .patch(`/api/v1/projects/${project.id}`)
        .set(me.auth)
        .send({ repoUrl: 'https://github.com/NumanBytes/shortlist-v2' })
        .expect(200);
      expect(await isVerified(ev)).toBe(true);
    });

    it('deleting the project keeps the evidence but unlinks and un-verifies it', async () => {
      const project = await newProject();
      const ev = await verifiedEvidenceFor(project.id);
      await t.http().delete(`/api/v1/projects/${project.id}`).set(me.auth).expect(204);
      const after = await t.prisma.skillEvidence.findUniqueOrThrow({ where: { id: ev } });
      expect(after).toMatchObject({ projectId: null, isVerified: false, verifiedAt: null });
    });
  });
});
