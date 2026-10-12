import { createTestApp, type TestApp, type TestUser } from './helpers.js';

describe('Never-claim list (e2e)', () => {
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

  it('requires authentication', async () => {
    await t.http().get('/api/v1/never-claim').expect(401);
  });

  it('adds, lists and removes entries; one entry per term and scope, any case', async () => {
    const azure = await t
      .http()
      .post('/api/v1/never-claim')
      .set(me.auth)
      .send({ term: 'Azure', note: 'Never used it' })
      .expect(201);
    expect(azure.body).toMatchObject({ term: 'Azure', scope: 'ANYWHERE', note: 'Never used it' });
    await t.http().post('/api/v1/never-claim').set(me.auth).send({ term: 'azure' }).expect(409);
    await t.http().post('/api/v1/never-claim').set(me.auth).send({ term: 'Azure', scope: 'PAID_WORK' }).expect(201);

    const list = await t.http().get('/api/v1/never-claim').set(me.auth).expect(200);
    expect(list.body).toHaveLength(2);

    await t.http().delete(`/api/v1/never-claim/${azure.body.id}`).set(me.auth).expect(204);
    expect((await t.http().get('/api/v1/never-claim').set(me.auth).expect(200)).body).toHaveLength(1);
  });

  it('rejects unknown fields and empty terms', async () => {
    await t.http().post('/api/v1/never-claim').set(me.auth).send({ term: '  ' }).expect(400);
    await t.http().post('/api/v1/never-claim').set(me.auth).send({ term: 'Go', userId: other.user.id }).expect(400);
  });

  it("can't see or remove another user's entries", async () => {
    const theirs = await t.http().post('/api/v1/never-claim').set(other.auth).send({ term: 'Kubernetes' }).expect(201);
    const mine = await t.http().get('/api/v1/never-claim').set(me.auth).expect(200);
    expect(mine.body.map((c: { id: string }) => c.id)).not.toContain(theirs.body.id);
    await t.http().delete(`/api/v1/never-claim/${theirs.body.id}`).set(me.auth).expect(404);
  });
});
