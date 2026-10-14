import { dedupeHash } from '@shortlist/shared/node';
import { createTestApp, type TestApp, type TestUser } from './helpers.js';

// "Add a job" (docs/discovery.md §11): a pasted posting becomes a regular Job, scored at once.
describe('Add a job (e2e)', () => {
  let t: TestApp;
  let me: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    me = await t.register();
  });

  afterAll(async () => {
    await t.close();
  });

  const JD = 'We are hiring a React engineer. '.repeat(10);
  const add = (body: Record<string, unknown>) => t.http().post('/api/v1/jobs').set(me.auth).send(body);

  it('creates an Interested job from a pasted description, queued for scoring', async () => {
    const res = await add({
      title: 'Senior Frontend Engineer',
      company: 'Conrad Labs',
      location: 'Lahore',
      sourceUrl: 'https://www.linkedin.com/jobs/view/123',
      description: JD,
    }).expect(201);
    expect(res.body).toMatchObject({ merged: false });
    const job = await t.prisma.job.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(job).toMatchObject({
      userId: me.user.id,
      status: 'INTERESTED',
      source: 'manual',
      isPartial: false,
      analysisStatus: 'PENDING',
      rawJD: JD.trim(),
    });
  });

  it('opens the job instead of duplicating it', async () => {
    const res = await add({ title: 'Senior Frontend Engineer', company: 'Conrad Labs Ltd.', description: JD }).expect(
      409,
    );
    expect(res.body.jobId).toEqual(expect.any(String));
  });

  it("fills in an alert job's description instead of adding a second one", async () => {
    const alert = await t.prisma.job.create({
      data: {
        userId: me.user.id,
        title: 'Full Stack Engineer',
        company: '5CREST',
        rawJD: 'A few lines from the alert.',
        isPartial: true,
        source: 'linkedin',
        dedupeHash: dedupeHash('5CREST', 'Full Stack Engineer'),
        analysisStatus: 'FAILED',
        analysisError: 'boom',
      },
    });
    const res = await add({ title: 'Full Stack Engineer', company: '5CREST', description: JD }).expect(201);
    expect(res.body).toEqual({ id: alert.id, merged: true });
    expect(await t.prisma.job.findUniqueOrThrow({ where: { id: alert.id } })).toMatchObject({
      isPartial: false,
      status: 'INTERESTED',
      analysisStatus: 'PENDING',
      analysisError: null,
    });
  });

  it('refuses a short description, a bad link and unknown fields', async () => {
    await add({ title: 'X', company: 'Y', description: 'too short' }).expect(400);
    await add({ title: 'X', company: 'Y', description: JD, sourceUrl: 'javascript:alert(1)' }).expect(400);
    await add({ title: 'X', company: 'Y', description: JD, status: 'OFFER' }).expect(400);
  });
});
