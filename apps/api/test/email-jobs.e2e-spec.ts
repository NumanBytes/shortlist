import { createTestApp, type TestApp, type TestUser } from './helpers.js';

// Jobs that came from alert emails (docs/email-alerts.md §10.5). The worker creates them; here they're
// inserted directly, as the worker would.
describe('Alert-email jobs (e2e)', () => {
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

  const partialJob = (user: TestUser, over: Record<string, unknown> = {}) =>
    t.prisma.job.create({
      data: {
        userId: user.user.id,
        title: 'Full Stack Developer',
        company: 'WSL Consultants',
        location: 'Lahore',
        source: 'indeed',
        sourceUrl: 'https://pk.indeed.com/viewjob?jk=70863ace132f8e01',
        rawJD: 'From the Indeed alert: WSL Consultants is hiring an experienced Full Stack Developer.',
        isPartial: true,
        salary: 'From Rs 70,000 a month',
        status: 'INTERESTED',
        analysisStatus: 'DONE',
        dedupeHash: crypto.randomUUID(),
        ...over,
      },
    });
  const FULL = 'We are hiring a Full Stack Developer. '.repeat(10);

  it('lists partial jobs with their salary', async () => {
    const j = await partialJob(me);
    const res = await t.http().get(`/api/v1/jobs/${j.id}`).set(me.auth).expect(200);
    expect(res.body).toMatchObject({ isPartial: true, salary: 'From Rs 70,000 a month', source: 'indeed' });
  });

  it('pasting the full description completes the job and queues it for scoring again', async () => {
    const j = await partialJob(me);
    await t.http().post(`/api/v1/jobs/${j.id}/description`).set(me.auth).send({ description: 'too short' }).expect(400);
    await t.http().post(`/api/v1/jobs/${j.id}/description`).set(other.auth).send({ description: FULL }).expect(404);
    const res = await t.http().post(`/api/v1/jobs/${j.id}/description`).set(me.auth).send({ description: FULL }).expect(200);
    expect(res.body).toMatchObject({ isPartial: false, analysisStatus: 'PENDING', rawJD: FULL.trim() });
    // A job that already has its description can't be overwritten this way.
    await t.http().post(`/api/v1/jobs/${j.id}/description`).set(me.auth).send({ description: FULL }).expect(409);
  });

  it("won't tailor a resume from an alert summary", async () => {
    const j = await partialJob(me);
    const res = await t.http().get(`/api/v1/jobs/${j.id}/resume`).set(me.auth).expect(200);
    expect(res.body).toMatchObject({ canTailor: false, needsDescription: true });
    const r = await t.http().post(`/api/v1/jobs/${j.id}/resume`).set(me.auth).send({ mode: 'tailor' }).expect(409);
    expect(r.body.message).toMatch(/Paste the full job description/);
  });

  it('keeps email-alert sources out of the board list and "Run now", and reports them on the Gmail card', async () => {
    const src = await t.prisma.jobSource.create({
      data: { userId: me.user.id, key: 'email_alerts:indeed', name: 'Indeed', type: 'EMAIL_INBOX', config: { provider: 'email_alerts' }, isEnabled: true, lastRunAt: new Date(), lastRunStatus: 'SUCCESS' },
    });
    await t.prisma.discoveryRun.create({ data: { jobSourceId: src.id, status: 'SUCCESS', jobsFound: 6, jobsNew: 4, finishedAt: new Date() } });
    await t.prisma.emailMessage.createMany({
      data: [
        { userId: me.user.id, gmailMessageId: 'a', sender: 'donotreply@jobalert.indeed.com', portal: 'indeed', receivedAt: new Date(), status: 'PARSED', parser: 'indeed', jobsFound: 6 },
        { userId: me.user.id, gmailMessageId: 'b', sender: 'donotreply@jobalert.indeed.com', portal: 'indeed', receivedAt: new Date(), status: 'PARSED', parser: 'ai', jobsFound: 2, note: 'Indeed parser found no jobs — read by AI instead; the parser may be out of date', parserFailed: true },
        { userId: me.user.id, gmailMessageId: 'c', sender: 'jobs-noreply@linkedin.com', portal: 'linkedin', receivedAt: new Date(), status: 'NOT_ALERT', note: 'not a job alert (subject)' },
      ],
    });

    const sources = await t.http().get('/api/v1/discovery/sources').set(me.auth).expect(200);
    expect(sources.body.map((s: { key: string }) => s.key)).not.toContain('email_alerts:indeed');
    const run = await t.http().post('/api/v1/discovery/run').set(me.auth).expect((r) => expect([202, 200, 201]).toContain(r.status));
    expect(run.body.queued).not.toContain('Indeed');

    const gmail = await t.http().get('/api/v1/gmail').set(me.auth).expect(200);
    expect(gmail.body.last30Days).toEqual({
      alerts: 2,
      notAlerts: 1,
      deferred: 0,
      failed: 0,
      portals: [{ portal: 'indeed', sourceId: src.id, label: 'Indeed', emails: 2, jobsFound: 8, parserWarnings: 1, lastRun: expect.objectContaining({ status: 'SUCCESS', jobsNew: 4 }) }],
    });
  });
});
