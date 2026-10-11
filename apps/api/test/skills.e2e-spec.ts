import { createTestApp, type TestApp, type TestUser } from './helpers.js';

describe('Skills (e2e)', () => {
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

  const createSkill = (who: TestUser, name: string, category = 'FRAMEWORK') =>
    t.http().post('/api/v1/skills').set(who.auth).send({ name, category });

  it('requires authentication', async () => {
    await t.http().get('/api/v1/skills').expect(401);
    await t.http().post('/api/v1/skills').send({ name: 'TypeScript', category: 'LANGUAGE' }).expect(401);
  });

  it('creates, reads, lists, updates, and deletes a skill', async () => {
    const created = await createSkill(me, 'Svelte').expect(201);
    const id = created.body.id;

    await t.http().get(`/api/v1/skills/${id}`).set(me.auth).expect(200);
    const list = await t.http().get('/api/v1/skills').set(me.auth).expect(200);
    expect(list.body.map((s: { name: string }) => s.name)).toContain('Svelte');

    const updated = await t.http().patch(`/api/v1/skills/${id}`).set(me.auth).send({ category: 'LIBRARY' }).expect(200);
    expect(updated.body.category).toBe('LIBRARY');

    await t.http().delete(`/api/v1/skills/${id}`).set(me.auth).expect(204);
    await t.http().get(`/api/v1/skills/${id}`).set(me.auth).expect(404);
  });

  it('rejects duplicate names case-insensitively', async () => {
    await createSkill(me, 'Vue').expect(201);
    await createSkill(me, 'vue').expect(409);
    await createSkill(me, ' VUE ').expect(409); // trimmed by the schema, then collides
  });

  it('rejects renaming into an existing name', async () => {
    await createSkill(me, 'Angular').expect(201);
    const solid = await createSkill(me, 'SolidJS').expect(201);
    await t.http().patch(`/api/v1/skills/${solid.body.id}`).set(me.auth).send({ name: 'angular' }).expect(409);
  });

  it('lets two different users own a skill with the same name', async () => {
    await createSkill(me, 'Remix').expect(201);
    await createSkill(other, 'Remix').expect(201);
  });

  it("returns 404 (not 403) for another user's skill on every route", async () => {
    const { body: skill } = await createSkill(me, 'Qwik').expect(201);
    await t.http().get(`/api/v1/skills/${skill.id}`).set(other.auth).expect(404);
    await t.http().patch(`/api/v1/skills/${skill.id}`).set(other.auth).send({ name: 'Hijacked' }).expect(404);
    await t.http().delete(`/api/v1/skills/${skill.id}`).set(other.auth).expect(404);
    const list = await t.http().get('/api/v1/skills').set(other.auth).expect(200);
    expect(list.body.map((s: { id: string }) => s.id)).not.toContain(skill.id);
  });

  it('validates input and route params', async () => {
    const res = await createSkill(me, '', 'nope').expect(400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(['name', 'category']);
    await t.http().get('/api/v1/skills/not-a-uuid').set(me.auth).expect(400);
    const { body: skill } = await createSkill(me, 'Lit').expect(201);
    await t.http().patch(`/api/v1/skills/${skill.id}`).set(me.auth).send({}).expect(400);
  });
});
