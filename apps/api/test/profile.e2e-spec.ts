import { createTestApp, type TestApp, type TestUser } from './helpers.js';

describe('Profile, education, and role projects (e2e)', () => {
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

  describe('profile', () => {
    it('returns and updates the resume header, never the password hash', async () => {
      const res = await t
        .http()
        .patch('/api/v1/profile')
        .set(me.auth)
        .send({
          phone: '+92 300 1234567',
          linkedinUrl: 'https://linkedin.com/in/someone',
          githubUrl: 'https://github.com/someone',
          location: 'Lahore, Pakistan',
        })
        .expect(200);
      expect(res.body).toMatchObject({ phone: '+92 300 1234567', location: 'Lahore, Pakistan' });
      expect(res.body).not.toHaveProperty('passwordHash');
      const got = await t.http().get('/api/v1/profile').set(me.auth).expect(200);
      expect(got.body.githubUrl).toBe('https://github.com/someone');
    });

    it('clears a field with null and validates the rest', async () => {
      await t.http().patch('/api/v1/profile').set(me.auth).send({ phone: null }).expect(200);
      await t.http().patch('/api/v1/profile').set(me.auth).send({ phone: 'call me maybe' }).expect(400);
      await t.http().patch('/api/v1/profile').set(me.auth).send({ linkedinUrl: 'javascript:alert(1)' }).expect(400);
      await t.http().patch('/api/v1/profile').set(me.auth).send({ email: 'new@example.com' }).expect(400); // not editable here
      await t.http().patch('/api/v1/profile').set(me.auth).send({}).expect(400);
    });
  });

  describe('education', () => {
    it('creates, lists, updates and deletes; 404 for others', async () => {
      const created = await t
        .http()
        .post('/api/v1/education')
        .set(me.auth)
        .send({
          degree: 'BS Information Technology',
          institution: 'University of the Punjab',
          startYear: 2019,
          endYear: 2023,
        })
        .expect(201);
      const list = await t.http().get('/api/v1/education').set(me.auth).expect(200);
      expect(list.body.map((e: { id: string }) => e.id)).toContain(created.body.id);
      await t.http().patch(`/api/v1/education/${created.body.id}`).set(other.auth).send({ degree: 'x' }).expect(404);
      await t
        .http()
        .patch(`/api/v1/education/${created.body.id}`)
        .set(me.auth)
        .send({ location: 'Lahore' })
        .expect(200);
      await t.http().delete(`/api/v1/education/${created.body.id}`).set(me.auth).expect(204);
    });

    it('rejects years out of order, including across a patch', async () => {
      await t
        .http()
        .post('/api/v1/education')
        .set(me.auth)
        .send({ degree: 'BS', institution: 'PU', startYear: 2023, endYear: 2019 })
        .expect(400);
      const e = await t
        .http()
        .post('/api/v1/education')
        .set(me.auth)
        .send({ degree: 'BS', institution: 'PU', startYear: 2019 })
        .expect(201);
      await t.http().patch(`/api/v1/education/${e.body.id}`).set(me.auth).send({ endYear: 2018 }).expect(400);
    });
  });

  describe('projects done as part of a role', () => {
    const role = (who: TestUser) =>
      t
        .http()
        .post('/api/v1/work-experiences')
        .set(who.auth)
        .send({ company: 'CloudCard Inc.', title: 'Software Engineer', startDate: '2024-05-01', isCurrent: true })
        .expect(201);

    it("links a project to one of my roles, never to someone else's", async () => {
      const mine = await role(me);
      const theirs = await role(other);
      const ok = await t
        .http()
        .post('/api/v1/projects')
        .set(me.auth)
        .send({ name: 'Bank Portal', workExperienceId: mine.body.id })
        .expect(201);
      expect(ok.body.workExperienceId).toBe(mine.body.id);
      await t
        .http()
        .post('/api/v1/projects')
        .set(me.auth)
        .send({ name: 'X', workExperienceId: theirs.body.id })
        .expect(400);
      await t
        .http()
        .patch(`/api/v1/projects/${ok.body.id}`)
        .set(me.auth)
        .send({ workExperienceId: theirs.body.id })
        .expect(400);
    });

    it("linking or unlinking a role un-verifies the project's evidence (it changes what is commercial)", async () => {
      const mine = await role(me);
      const project = await t.http().post('/api/v1/projects').set(me.auth).send({ name: 'Side thing' }).expect(201);
      const skill = await t
        .http()
        .post('/api/v1/skills')
        .set(me.auth)
        .send({ name: `S ${crypto.randomUUID()}`, category: 'TOOL' })
        .expect(201);
      const ev = await t
        .http()
        .post('/api/v1/evidence')
        .set(me.auth)
        .send({
          skillId: skill.body.id,
          context: 'PERSONAL',
          depth: 'WORKING',
          whatIDid: 'Built it',
          lastUsed: '2026-09-01',
          projectId: project.body.id,
        })
        .expect(201);
      await t.http().post(`/api/v1/evidence/${ev.body.id}/verify`).set(me.auth).expect(200);
      await t
        .http()
        .patch(`/api/v1/projects/${project.body.id}`)
        .set(me.auth)
        .send({ workExperienceId: mine.body.id })
        .expect(200);
      expect((await t.prisma.skillEvidence.findUniqueOrThrow({ where: { id: ev.body.id } })).isVerified).toBe(false);
    });
  });
});
