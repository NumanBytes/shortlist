import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { job } from '../../../test/fixtures';
import type { JobDetail } from '../../../lib/types';
import { mockFetch, renderWithProviders } from '../../../test/render';
import { JobDetailPage } from './JobDetailPage';

const detail: JobDetail = {
  ...job,
  rawJD: 'Build MERN apps.',
  seniority: 'MID',
  yearsRequired: 3,
  analyzedAt: new Date().toISOString(),
  requirements: [],
  match: {
    overallScore: 86,
    commercialScore: 80,
    verdict: 'APPLY',
    strengths: ['React.js — React (commercial production, CloudCard Inc.)', 'Node.js — Node.js (personal working)'],
    risks: ['Asks for 3+ years; you have about 2.4 commercial', 'Missing: GraphQL'],
    computedAt: new Date().toISOString(),
    gaps: [{ skillName: 'GraphQL', severity: 'MODERATE', note: 'related experience: REST APIs' }],
  },
};

const open = (d: JobDetail) => {
  // The resume card asks for the job's resume; everything else gets the job.
  const noResume = {
    status: 'NONE',
    error: null,
    reused: false,
    overlap: null,
    canTailor: true,
    variant: null,
    sources: {},
    reuse: [],
  };
  const fetchMock = mockFetch(d, (url) => (url.endsWith('/resume') ? noResume : d));
  renderWithProviders(<JobDetailPage />, { path: '/jobs/:jobId', route: '/jobs/j1' });
  return fetchMock;
};

describe('JobDetailPage', () => {
  it('shows the score, why it fits, the gaps and risks, with the description collapsed', async () => {
    open(detail);
    expect(await screen.findByText('A strong fit for your verified experience.')).toBeInTheDocument();
    expect(screen.getByText('React.js')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument(); // the verified skill it maps to
    expect(screen.getByText('commercial production, CloudCard Inc.')).toBeInTheDocument();
    expect(screen.getByText('GraphQL')).toBeInTheDocument();
    expect(screen.getByText('related experience: REST APIs')).toBeInTheDocument();
    expect(screen.getByText(/Asks for 3\+ years/)).toBeInTheDocument();
    expect(screen.getByText('Build MERN apps.')).toHaveClass('line-clamp-4');
  });

  // UI audit D6: a bad link reads as a missing job, not the API's validator message.
  it('says a job that does not exist was removed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'Validation failed (uuid is expected)' }), { status: 400 }),
        ),
      ),
    );
    renderWithProviders(<JobDetailPage />, { path: '/jobs/:jobId', route: '/jobs/nope' });
    expect(await screen.findByText("This job doesn't exist or was removed")).toBeInTheDocument();
    expect(screen.queryByText(/uuid/)).not.toBeInTheDocument();
  });

  it('records Applied for an interested job — the user applies themselves', async () => {
    const fetchMock = open({ ...detail, status: 'INTERESTED' });
    await userEvent.click(await screen.findByRole('button', { name: /Change status/ }));
    expect(screen.getByRole('dialog', { name: 'Set status' })).toHaveTextContent("Logs today's date");
    await userEvent.click(screen.getByRole('button', { name: /^Applied/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ status: 'APPLIED' });
  });

  it('explains a deferred score and lets the user retry', async () => {
    const fetchMock = open({
      ...detail,
      match: null,
      analysisStatus: 'DEFERRED',
      analysisError: 'Daily analysis cap reached (40 of 40)',
    });
    expect(await screen.findByText('Daily analysis cap reached (40 of 40)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/v1/jobs/j1/analyze')).toBe(true));
  });

  it('the ··· menu can skip the job, with Undo', async () => {
    const fetchMock = open(detail);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('button', { name: /Skip this job/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true));
    const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ status: 'SKIPPED' });
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('warns about a possible scam before anything else', async () => {
    open({ ...detail, redFlags: ['asks for a registration fee'] });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Possible scam.*registration fee/);
  });
});
