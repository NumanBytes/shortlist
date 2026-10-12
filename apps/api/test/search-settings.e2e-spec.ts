import { DEFAULT_DISCOVERY_PREFERENCES, REMOTE_BOARDS, STARTER_DISCOVERY_PREFERENCES } from '@shortlist/shared';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';

describe('Search settings and onboarding (e2e)', () => {
  let t: TestApp;
  let me: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    me = await t.register();
  });

  afterAll(async () => {
    await t.close();
  });

  it('a new account needs onboarding and searches with the defaults until it saves its own', async () => {
    expect((await t.http().get('/api/v1/onboarding').set(me.auth).expect(200)).body).toMatchObject({ needed: true });
    const before = await t.http().get('/api/v1/discovery/preferences').set(me.auth).expect(200);
    expect(before.body).toEqual({ preferences: DEFAULT_DISCOVERY_PREFERENCES, isDefault: true });

    const mine = { ...STARTER_DISCOVERY_PREFERENCES, titleInclude: ['backend'], stackKeywords: ['go'] };
    const saved = await t.http().put('/api/v1/discovery/preferences').set(me.auth).send(mine).expect(200);
    expect(saved.body).toEqual({ preferences: mine, isDefault: false });
    expect((await t.http().get('/api/v1/onboarding').set(me.auth).expect(200)).body).toMatchObject({
      needed: false,
      hasPreferences: true,
    });
  });

  it('rejects a partial or unknown preferences body', async () => {
    await t
      .http()
      .put('/api/v1/discovery/preferences')
      .set(me.auth)
      .send({ titleInclude: ['x'] })
      .expect(400);
    await t
      .http()
      .put('/api/v1/discovery/preferences')
      .set(me.auth)
      .send({ ...STARTER_DISCOVERY_PREFERENCES, isVerified: true })
      .expect(400);
  });

  it('adds the remote boards once', async () => {
    const first = await t.http().post('/api/v1/discovery/sources/remote-boards').set(me.auth).expect(201);
    expect(first.body).toEqual({ added: REMOTE_BOARDS.length });
    const again = await t.http().post('/api/v1/discovery/sources/remote-boards').set(me.auth).expect(201);
    expect(again.body).toEqual({ added: 0 });
  });
});
