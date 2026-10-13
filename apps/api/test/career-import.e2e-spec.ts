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

  it('two imports started at once: one runs, the other is refused', async () => {
    const user = await t.register();
    const send = () => t.http().post('/api/v1/career-import').set(user.auth).send({ text: RESUME });
    const codes = (await Promise.all([send(), send()])).map((r) => r.status).sort((a, b) => a - b);
    expect(codes).toEqual([201, 409]);
  });

  it('a pending import that never finished does not block the next one', async () => {
    const user = await t.register();
    const stuck = await t.prisma.careerImport.create({
      data: { userId: user.user.id, text: RESUME, createdAt: new Date(Date.now() - 2 * 3600_000) },
    });
    await t.http().post('/api/v1/career-import').set(user.auth).send({ text: RESUME }).expect(201);
    expect(await t.prisma.careerImport.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({
      status: 'FAILED',
      text: null,
    });
  });

  it('retries a deferred import with its kept text, and only a deferred one', async () => {
    const user = await t.register();
    const deferred = await t.prisma.careerImport.create({
      data: { userId: user.user.id, text: RESUME, status: 'DEFERRED', error: 'Monthly AI budget reached' },
    });
    const res = await t.http().post(`/api/v1/career-import/${deferred.id}/retry`).set(user.auth).expect(201);
    expect(res.body).toMatchObject({ id: deferred.id, status: 'PENDING', error: null });
    await t.http().post(`/api/v1/career-import/${deferred.id}/retry`).set(user.auth).expect(404);
    await t.http().post(`/api/v1/career-import/${deferred.id}/retry`).set(me.auth).expect(404); // not yours
  });
});
