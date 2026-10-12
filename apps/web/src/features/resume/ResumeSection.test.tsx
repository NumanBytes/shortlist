import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JobDetail, JobResume } from '../../lib/types';
import { mockFetch, renderWithProviders } from '../../test/render';
import { job as listJob } from '../../test/fixtures';
import { ResumeSection } from './ResumeSection';

const job: JobDetail = {
  ...listJob,
  status: 'INTERESTED',
  rawJD: '',
  seniority: null,
  yearsRequired: null,
  analyzedAt: null,
  requirements: [],
  match: null,
};

const none: JobResume = {
  status: 'NONE',
  error: null,
  queuedAt: null,
  workerOnline: null,
  reused: false,
  overlap: null,
  canTailor: true,
  needsDescription: false,
  variant: null,
  sources: {},
  reuse: [],
};
const ready = (over: Partial<NonNullable<JobResume['variant']>> = {}): JobResume => ({
  ...none,
  status: 'READY',
  variant: {
    id: 'v1',
    status: 'DRAFT',
    model: 'claude-sonnet-5-5',
    generatedAt: '2026-10-02T00:00:00Z',
    approvedAt: null,
    stale: [],
    content: {
      experience: [
        {
          workExperienceId: 'r',
          title: 'Software Engineer',
          company: 'CloudCard',
          location: null,
          startDate: '2024-05-01',
          endDate: null,
          isCurrent: true,
          bullets: [{ label: null, text: 'Used React.', evidenceIds: ['e1'] }],
        },
      ],
      projects: [],
      skillGroups: [],
      dropped: [{ where: 'CloudCard', text: 'Led 12 people.', reason: 'adds "12"' }],
    },
    ...over,
  },
});

const bodyOf = (fetch: ReturnType<typeof mockFetch>, method: string) =>
  JSON.parse(fetch.mock.calls.find(([, init]) => init?.method === method)![1]!.body as string);

describe('ResumeSection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks to mark a new job Interested first — tailoring never starts on its own', () => {
    const fetch = mockFetch(none);
    renderWithProviders(<ResumeSection job={{ ...job, status: 'DISCOVERED' }} />);
    expect(screen.getByText(/Mark it Interested/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tailors on request', async () => {
    const fetch = mockFetch(none);
    renderWithProviders(<ResumeSection job={job} />);
    await userEvent.click(await screen.findByRole('button', { name: /Tailor a resume/ }));
    await waitFor(() => expect(bodyOf(fetch, 'POST')).toEqual({ mode: 'tailor' }));
  });

  it('offers an approved resume for reuse', async () => {
    const fetch = mockFetch({
      ...none,
      reuse: [{ variantId: 'v9', overlap: 0.92, approvedAt: null, usedFor: ['Frontend Engineer at Kwanso'] }],
    });
    renderWithProviders(<ResumeSection job={job} />);
    expect(await screen.findByText(/Covers 92% of this job's requirements/)).toBeInTheDocument();
    expect(screen.getByText(/Used for Frontend Engineer at Kwanso/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reuse resume' }));
    await waitFor(() => expect(bodyOf(fetch, 'POST')).toEqual({ mode: 'reuse', variantId: 'v9' }));
  });

  it("can't tailor before the job is scored", async () => {
    mockFetch({ ...none, canTailor: false });
    renderWithProviders(<ResumeSection job={job} />);
    expect(await screen.findByText(/once scoring finishes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tailor/ })).not.toBeInTheDocument();
  });

  it('shows a ready draft with what the checks removed', async () => {
    mockFetch(ready());
    renderWithProviders(<ResumeSection job={job} />);
    expect(await screen.findByText('Draft — review it')).toBeInTheDocument();
    expect(screen.getByText(/1 removed by the truthfulness checks/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review/ })).toHaveAttribute('href', '/jobs/j1/resume');
  });

  it('flags an out-of-date resume and says why', async () => {
    mockFetch(ready({ status: 'APPROVED', stale: ['React: no longer verified'] }));
    renderWithProviders(<ResumeSection job={job} />);
    expect(await screen.findByText('Out of date')).toBeInTheDocument();
    expect(screen.getByText(/React: no longer verified/)).toBeInTheDocument();
  });

  // Code review: a failed, deferred or running "Tailor again" hid the job's existing
  // resume, because the card only linked to it when the status was READY.
  it.each([
    ['FAILED', /Tailoring failed: Couldn't reach Claude/],
    ['DEFERRED', /Tailoring deferred: Monthly AI budget reached/],
    ['PENDING', /Tailoring from your verified evidence/],
  ] as const)('keeps the existing resume reachable when a new attempt is %s', async (status, message) => {
    const error =
      status === 'FAILED' ? "Couldn't reach Claude" : status === 'DEFERRED' ? 'Monthly AI budget reached' : null;
    mockFetch({ ...ready({ status: 'APPROVED' }), status, error });
    renderWithProviders(<ResumeSection job={job} />);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open & save PDF/ })).toHaveAttribute('href', '/jobs/j1/resume');
    expect(screen.getByText(/Your current resume for this job is still below/)).toBeInTheDocument();
  });

  // Code review: one click re-tailored (and billed) even an approved, current resume.
  it('asks before re-tailoring a resume that is still current', async () => {
    const fetch = mockFetch(ready({ status: 'APPROVED' }));
    renderWithProviders(<ResumeSection job={job} />);
    await userEvent.click(await screen.findByRole('button', { name: /Tailor again/ }));
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Tailor again?' })).toHaveTextContent(/needs a fresh review/);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: /Tailor again/ }));
    await userEvent.click(screen.getByRole('button', { name: /Yes, tailor/ }));
    await waitFor(() => expect(bodyOf(fetch, 'POST')).toEqual({ mode: 'tailor' }));
  });

  it('re-tailors an out-of-date resume in one click — it has to be redone anyway', async () => {
    const fetch = mockFetch(ready({ status: 'APPROVED', stale: ['React: changed since'] }));
    renderWithProviders(<ResumeSection job={job} />);
    await userEvent.click(await screen.findByRole('button', { name: /Tailor again/ }));
    await waitFor(() => expect(bodyOf(fetch, 'POST')).toEqual({ mode: 'tailor' }));
  });
});

describe('ResumeSection while tailoring — never an endless spinner', () => {
  const pending = (over: Partial<JobResume> = {}): JobResume => ({
    ...none,
    status: 'PENDING',
    queuedAt: new Date(Date.now() - 42_000).toISOString(),
    workerOnline: true,
    ...over,
  });

  it('shows how long it has been tailoring, and that leaving the page is fine', async () => {
    mockFetch(pending());
    renderWithProviders(<ResumeSection job={job} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/Tailoring from your verified evidence.*0:42/);
    expect(screen.getByText(/you can leave this page/i)).toBeInTheDocument();
  });

  it('says plainly when no worker is running, and that nothing was charged', async () => {
    mockFetch(pending({ workerOnline: false }));
    renderWithProviders(<ResumeSection job={job} />);
    expect(await screen.findByRole('status')).toHaveTextContent(
      /background worker isn't running.*Nothing has been charged/,
    );
  });

  it('gives up waiting after far too long and offers to check again', async () => {
    mockFetch(pending({ queuedAt: new Date(Date.now() - 20 * 60_000).toISOString() }));
    renderWithProviders(<ResumeSection job={job} />);
    expect(await screen.findByText(/Something is stuck/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check again/ })).toBeInTheDocument();
  });
});
