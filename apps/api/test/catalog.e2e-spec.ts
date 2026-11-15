import { createTestApp, type TestApp, type TestUser } from './helpers.js';

// The shared source catalog (docs/discovery.md §9.16). Runs against the real database, which
// has real entries, so every entry here has a unique name and is deleted afterwards.
describe('Source catalog (e2e)', () => {
  let t: TestApp;
  let admin: TestUser;
  let user: TestUser;
  const entryIds: string[] = [];
  const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;
  const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  async function addEntry(name: string, link: string, regions: string[]) {
    const res = await t.http().post('/api/v1/admin/catalog').set(admin.auth).send({ name, link, regions }).expect(201);
    entryIds.push(res.body.id);
    return res.body as { id: string; key: string };
  }
  const sourcesOf = (u: TestUser) =>
    t.prisma.jobSource.findMany({ where: { userId: u.user.id }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.register();
    user = await t.register();
    await t.prisma.user.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });
  });

  afterAll(async () => {
    await t.prisma.sourceCatalogEntry.deleteMany({ where: { id: { in: entryIds } } });
    await t.close();
  });

  it('is managed by admins only', async () => {
    await t.http().get('/api/v1/admin/catalog').set(user.auth).expect(404);
    await t
      .http()
      .post('/api/v1/admin/catalog')
      .set(user.auth)
      .send({ name: 'X', link: 'https://x.example.com/careers', regions: [] })
      .expect(404);
    await t.http().get('/api/v1/discovery/catalog').expect(401);
  });

  it('adds an entry from a link, refusing a second one with the same key', async () => {
    const name = unique('Acme');
    const entry = await addEntry(name, 'https://acme.example.com/careers', ['Berlin', 'germany']);
    expect(entry).toMatchObject({ key: `careers_page:${slug(name)}`, type: 'MANUAL', regions: ['berlin', 'germany'] });
    await t
      .http()
      .post('/api/v1/admin/catalog')
      .set(admin.auth)
      .send({ name, link: 'https://acme.example.com/jobs', regions: [] })
      .expect(409);
    await t
      .http()
      .post('/api/v1/admin/catalog')
      .set(admin.auth)
      .send({ name: unique('Local'), link: 'http://127.0.0.1/careers', regions: [] })
      .expect(400);
  });

  it('lets a user browse by name and place, follow, and follow again without duplicates', async () => {
    const name = unique('Globex');
    const entry = await addEntry(name, 'https://globex.example.com/careers', ['lahore']);
    const found = await t
      .http()
      .get('/api/v1/discovery/catalog')
      .query({ q: name.slice(0, 12), region: 'Lahore' })
      .set(user.auth)
      .expect(200);
    expect(found.body).toEqual([
      { id: entry.id, name, type: 'MANUAL', provider: 'careers_page', regions: ['lahore'], following: false },
    ]);

    const first = await t.http().post(`/api/v1/discovery/catalog/${entry.id}/follow`).set(user.auth).expect(201);
    expect(first.body).toMatchObject({ status: 'followed', name });
    const again = await t.http().post(`/api/v1/discovery/catalog/${entry.id}/follow`).set(user.auth).expect(201);
    expect(again.body.status).toBe('already');
    const mine = (await sourcesOf(user)).filter((s) => s.catalogEntryId === entry.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name, isEnabled: true, key: entry.key });

    // A paused follow shows as not followed, and Follow turns it back on.
    await t.prisma.jobSource.update({ where: { id: mine[0]!.id }, data: { isEnabled: false } });
    const browsed = await t.http().get('/api/v1/discovery/catalog').query({ q: name }).set(user.auth).expect(200);
    expect(browsed.body[0].following).toBe(false);
    const resumed = await t.http().post(`/api/v1/discovery/catalog/${entry.id}/follow`).set(user.auth).expect(201);
    expect(resumed.body.status).toBe('resumed');
  });

  it('hides unlisted entries from browsing and following, but followers keep theirs', async () => {
    const name = unique('Initech');
    const entry = await addEntry(name, 'https://initech.example.com/careers', []);
    await t.http().post(`/api/v1/discovery/catalog/${entry.id}/follow`).set(user.auth).expect(201);
    await t.http().patch(`/api/v1/admin/catalog/${entry.id}`).set(admin.auth).send({ isListed: false }).expect(200);
    const browsed = await t.http().get('/api/v1/discovery/catalog').query({ q: name }).set(user.auth).expect(200);
    expect(browsed.body).toEqual([]);
    const other = await t.register();
    await t.http().post(`/api/v1/discovery/catalog/${entry.id}/follow`).set(other.auth).expect(404);
    expect((await sourcesOf(user)).some((s) => s.catalogEntryId === entry.id)).toBe(true);
  });

  it("copies an admin's new name and address to linked followers, not to detached ones", async () => {
    const name = unique('Umbrella');
    const entry = await addEntry(name, 'https://umbrella.example.com/careers', []);
    const linked = await t.register();
    const detached = await t.register();
    for (const u of [linked, detached])
      await t.http().post(`/api/v1/discovery/catalog/${entry.id}/follow`).set(u.auth).expect(201);
    const [mine] = await sourcesOf(detached);
    await t.prisma.jobSource.update({ where: { id: mine!.id }, data: { lastRunAt: new Date() } });
    // The user's own address detaches it from the catalog.
    await t
      .http()
      .patch(`/api/v1/discovery/sources/${mine!.id}/address`)
      .set(detached.auth)
      .send({ address: 'https://umbrella.example.com/jobs' })
      .expect(200);

    await t
      .http()
      .patch(`/api/v1/admin/catalog/${entry.id}`)
      .set(admin.auth)
      .send({ name: `${name} Corp`, address: 'https://boards.greenhouse.io/umbrella' })
      .expect(200);
    const [l] = await sourcesOf(linked);
    expect(l).toMatchObject({
      name: `${name} Corp`,
      type: 'ATS_BOARD',
      config: { provider: 'greenhouse', board: 'umbrella' },
      key: entry.key,
      lastRunAt: null,
    });
    const [d] = await sourcesOf(detached);
    expect(d).toMatchObject({ name, catalogEntryId: null, config: { url: 'https://umbrella.example.com/jobs' } });
  });

  it('turns "Add a source" with a catalog link into a follow, and keeps other links the user’s own', async () => {
    const name = unique('Hooli');
    const entry = await addEntry(name, 'https://jobs.lever.co/hooli-' + slug(name).slice(-8), []);
    const u = await t.register();
    const link = (await t.prisma.sourceCatalogEntry.findUniqueOrThrow({ where: { id: entry.id } })).config as {
      site: string;
    };
    await t
      .http()
      .post('/api/v1/discovery/sources')
      .set(u.auth)
      .send({ name: 'whatever I call it', link: `https://jobs.lever.co/${link.site}` })
      .expect(201);
    await t
      .http()
      .post('/api/v1/discovery/sources')
      .set(u.auth)
      .send({ name: unique('Own'), link: 'https://own.example.com/careers' })
      .expect(201);
    const [followed, own] = await sourcesOf(u);
    expect(followed).toMatchObject({ catalogEntryId: entry.id, name });
    expect(own!.catalogEntryId).toBeNull();
    const listed = await t.http().get('/api/v1/discovery/sources').set(u.auth).expect(200);
    expect(listed.body.map((s: { fromCatalog: boolean }) => s.fromCatalog)).toEqual(
      expect.arrayContaining([false, true]),
    );
  });

  it('refuses to follow over the user’s own source with the same key at another address', async () => {
    const name = unique('Stark');
    const u = await t.register();
    await t
      .http()
      .post('/api/v1/discovery/sources')
      .set(u.auth)
      .send({ name, link: 'https://stark.example.com/mine' })
      .expect(201);
    const entry = await addEntry(name, 'https://stark.example.com/careers', []);
    await t.http().post(`/api/v1/discovery/catalog/${entry.id}/follow`).set(u.auth).expect(409);
  });

  it('follows every listed company in the user’s places in one tap, skipping remote boards', async () => {
    const place = `town-${crypto.randomUUID().slice(0, 8)}`;
    const a = await addEntry(unique('Wayne'), 'https://wayne.example.com/careers', [place]);
    const b = await addEntry(unique('Tyrell'), 'https://tyrell.example.com/careers', [place, 'elsewhere']);
    await addEntry(unique('Cyberdyne'), 'https://cyberdyne.example.com/careers', ['nowhere']);
    const u = await t.register();
    const res = await t
      .http()
      .post('/api/v1/discovery/catalog/follow-places')
      .set(u.auth)
      .send({ regions: [place] })
      .expect(201);
    expect(res.body).toEqual({ followed: 2 });
    expect((await sourcesOf(u)).map((s) => s.catalogEntryId)).toEqual(expect.arrayContaining([a.id, b.id]));
    await t.http().post('/api/v1/discovery/catalog/follow-places').set(u.auth).send({ regions: [] }).expect(400);
  });

  it('removes an entry: followers keep their source, unlinked', async () => {
    const entry = await addEntry(unique('Soylent'), 'https://soylent.example.com/careers', []);
    const u = await t.register();
    await t.http().post(`/api/v1/discovery/catalog/${entry.id}/follow`).set(u.auth).expect(201);
    await t.http().delete(`/api/v1/admin/catalog/${entry.id}`).set(admin.auth).expect(204);
    await t.http().delete(`/api/v1/admin/catalog/${entry.id}`).set(admin.auth).expect(404);
    const [mine] = await sourcesOf(u);
    expect(mine).toMatchObject({ catalogEntryId: null, isEnabled: true });
  });

  it('lists every entry for the admin with its followers', async () => {
    const entry = await addEntry(unique('Vandelay'), 'https://vandelay.example.com/careers', ['remote']);
    await t.http().post(`/api/v1/discovery/catalog/${entry.id}/follow`).set(user.auth).expect(201);
    const res = await t.http().get('/api/v1/admin/catalog').set(admin.auth).expect(200);
    expect(res.body.find((e: { id: string }) => e.id === entry.id)).toMatchObject({
      followers: 1,
      provider: 'careers_page',
      link: 'https://vandelay.example.com/careers',
    });
  });
});
