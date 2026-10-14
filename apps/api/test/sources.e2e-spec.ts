import { createTestApp, type TestApp, type TestUser } from './helpers.js';

// "Add a source" (docs/discovery.md §9.15): company jobs pages are rows the user adds, edits
// and removes from the app — never code.
describe('Job sources (e2e)', () => {
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

  const list = async (u: TestUser) =>
    (await t.http().get('/api/v1/discovery/sources').set(u.auth).expect(200)).body as {
      id: string;
      name: string;
      provider: string;
      board: string | null;
      link: string | null;
    }[];

  it('adds a board, a careers page, and refuses a duplicate', async () => {
    await t
      .http()
      .post('/api/v1/discovery/sources')
      .set(me.auth)
      .send({ name: 'Motive', link: 'https://job-boards.greenhouse.io/gomotive' })
      .expect(201);
    await t
      .http()
      .post('/api/v1/discovery/sources')
      .set(me.auth)
      .send({ name: 'BrainX', link: 'careers.brainxtech.com' })
      .expect(201);
    const mine = await list(me);
    expect(mine).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Motive', provider: 'greenhouse', board: 'gomotive' }),
        expect.objectContaining({ name: 'BrainX', provider: 'careers_page', link: 'https://careers.brainxtech.com/' }),
      ]),
    );
    const dupe = await t
      .http()
      .post('/api/v1/discovery/sources')
      .set(me.auth)
      .send({ name: 'Motive again', link: 'https://boards.greenhouse.io/gomotive' })
      .expect(409);
    expect(dupe.body.message).toMatch(/already follow/);
  });

  it('refuses an internal address (SSRF) and unknown fields', async () => {
    await t
      .http()
      .post('/api/v1/discovery/sources')
      .set(me.auth)
      .send({ name: 'Meta', link: 'http://169.254.169.254/latest/meta-data/' })
      .expect(400);
    await t
      .http()
      .post('/api/v1/discovery/sources')
      .set(me.auth)
      .send({ name: 'X', link: 'https://example.com/jobs', isEnabled: false })
      .expect(400);
  });

  it("edits a careers page's link, and removes it; another user's source is a 404", async () => {
    const page = (await list(me)).find((s) => s.name === 'BrainX')!;
    await t
      .http()
      .patch(`/api/v1/discovery/sources/${page.id}/address`)
      .set(me.auth)
      .send({ address: 'https://brainxtech.com/careers' })
      .expect(200);
    expect((await list(me)).find((s) => s.id === page.id)!.link).toBe('https://brainxtech.com/careers');

    await t.http().delete(`/api/v1/discovery/sources/${page.id}`).set(other.auth).expect(404);
    await t.http().delete(`/api/v1/discovery/sources/${page.id}`).set(me.auth).expect(204);
    expect((await list(me)).some((s) => s.id === page.id)).toBe(false);
  });
});
