import { DEFAULT_NOTIFICATION_SETTINGS } from '@shortlist/shared';
import { ENV } from '../src/config/config.module.js';
import { loadEnv } from '../src/config/env.js';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';

const keys = { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') };
const endpoint = () => `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
// A valid P-256 public key (VAPID): the API only hands it to browsers.
const PUBLIC_KEY = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';

describe('Notifications (e2e)', () => {
  let t: TestApp;
  let me: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(ENV).useValue({ ...loadEnv(), VAPID_PUBLIC_KEY: PUBLIC_KEY }));
    me = await t.register();
    other = await t.register();
  });

  afterAll(async () => {
    await t.close();
  });

  it('requires authentication', async () => {
    await t.http().get('/api/v1/notifications/settings').expect(401);
  });

  it('hands out the public key the browser subscribes with', async () => {
    const res = await t.http().get('/api/v1/notifications/config').set(me.auth).expect(200);
    expect(res.body).toEqual({ configured: true, publicKey: PUBLIC_KEY });
  });

  it('subscribes a device, lists it, and unsubscribes only the caller’s own', async () => {
    const ep = endpoint();
    await t
      .http()
      .post('/api/v1/notifications/subscriptions')
      .set(me.auth)
      .send({ endpoint: ep, keys, userAgent: 'Chrome on Android' })
      .expect(201);
    const devices = await t.http().get('/api/v1/notifications/devices').set(me.auth).expect(200);
    expect(devices.body).toEqual([expect.objectContaining({ userAgent: 'Chrome on Android' })]);
    expect(devices.body[0]).not.toHaveProperty('endpoint'); // nor the keys

    await t.http().post('/api/v1/notifications/unsubscribe').set(other.auth).send({ endpoint: ep }).expect(204);
    expect(await t.prisma.pushSubscription.count({ where: { endpoint: ep } })).toBe(1); // not theirs
    await t.http().post('/api/v1/notifications/unsubscribe').set(me.auth).send({ endpoint: ep }).expect(204);
    expect(await t.prisma.pushSubscription.count({ where: { endpoint: ep } })).toBe(0);
  });

  it('refuses an endpoint that is not a push service (the worker would POST to it)', async () => {
    await t
      .http()
      .post('/api/v1/notifications/subscriptions')
      .set(me.auth)
      .send({ endpoint: 'https://169.254.169.254/latest/meta-data', keys })
      .expect(400);
  });

  it("can't remove another user's device", async () => {
    await t.http().post('/api/v1/notifications/subscriptions').set(other.auth).send({ endpoint: endpoint(), keys });
    const [theirs] = (await t.http().get('/api/v1/notifications/devices').set(other.auth)).body as { id: string }[];
    await t.http().delete(`/api/v1/notifications/devices/${theirs!.id}`).set(me.auth).expect(404);
    await t.http().delete(`/api/v1/notifications/devices/${theirs!.id}`).set(other.auth).expect(204);
  });

  it('starts from the defaults and saves the whole settings form', async () => {
    const res = await t.http().get('/api/v1/notifications/settings').set(me.auth).expect(200);
    expect(res.body).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    const quiet = { ...DEFAULT_NOTIFICATION_SETTINGS, digest: false, quietStart: null, quietEnd: null };
    expect((await t.http().put('/api/v1/notifications/settings').set(me.auth).send(quiet).expect(200)).body).toEqual(
      quiet,
    );
    await t
      .http()
      .put('/api/v1/notifications/settings')
      .set(me.auth)
      .send({ ...quiet, quietStart: 22 })
      .expect(400);
  });

  it('queues a test notification, lists it, and marks everything read', async () => {
    await t.http().post('/api/v1/notifications/test').set(me.auth).expect(202);
    const list = await t.http().get('/api/v1/notifications').set(me.auth).expect(200);
    expect(list.body[0]).toMatchObject({ kind: 'TEST', readAt: null });
    await t.http().post('/api/v1/notifications/read-all').set(me.auth).expect(204);
    expect(await t.prisma.notification.count({ where: { userId: me.user.id, readAt: null } })).toBe(0);
  });
});

describe('Notifications without VAPID keys (e2e)', () => {
  it('says push is not set up, and refuses a test', async () => {
    const t = await createTestApp((b) =>
      b.overrideProvider(ENV).useValue({ ...loadEnv(), VAPID_PUBLIC_KEY: undefined }),
    );
    const me = await t.register();
    expect((await t.http().get('/api/v1/notifications/config').set(me.auth).expect(200)).body).toEqual({
      configured: false,
      publicKey: null,
    });
    await t.http().post('/api/v1/notifications/test').set(me.auth).expect(503);
    await t.close();
  });
});
