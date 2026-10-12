import { createTestApp, type TestApp, type TestUser } from './helpers.js';

const RESUME = `Jane Doe — Software Engineer\n${'• Built React dashboards used by the operations team.\n'.repeat(8)}`;

describe('Resume import (e2e)', () => {
  let t: TestApp;
  let me: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    me = await t.register();
  });

  afterAll(async () => {
    await t.close();
  });

  it('requires authentication', async () => {
    await t.http().post('/api/v1/career-import').send({ text: RESUME }).expect(401);
  });

  it('rejects text too short to be a resume, and unknown fields', async () => {
    await t.http().post('/api/v1/career-import').set(me.auth).send({ text: 'React' }).expect(400);
    await t.http().post('/api/v1/career-import').set(me.auth).send({ text: RESUME, isVerified: true }).expect(400);
  });

  it('queues one import at a time and never returns the text', async () => {
    const res = await t.http().post('/api/v1/career-import').set(me.auth).send({ text: RESUME }).expect(201);
    expect(res.body).toMatchObject({ status: 'PENDING' });
    expect(res.body).not.toHaveProperty('text');
    await t.http().post('/api/v1/career-import').set(me.auth).send({ text: RESUME }).expect(409);

    const latest = await t.http().get('/api/v1/career-import/latest').set(me.auth).expect(200);
    expect(latest.body).toMatchObject({ id: res.body.id, status: 'PENDING' });
    expect(latest.body).not.toHaveProperty('text');
  });
});
