import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JobListItem } from '../lib/types';
import { JobCard } from './JobCard';

const job: JobListItem = {
  id: 'j1',
  title: 'Full Stack Software Engineer (MERN)',
  company: 'Septem Systems',
  location: 'Lahore, Punjab, pk',
  workMode: 'ONSITE',
  source: 'smartrecruiters',
  sourceUrl: 'https://jobs.smartrecruiters.com/SeptemSystems/744000094846166',
  status: 'DISCOVERED',
  postedAt: '2025-11-21T13:29:11.629Z',
  discoveredAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  appliedAt: null,
  jobSource: { id: 's1', name: 'Septem Systems' },
};

function renderCard(j: JobListItem = job) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ul>
        <JobCard job={j} />
      </ul>
    </QueryClientProvider>,
  );
}

function mockFetch(body: unknown = {}) {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('JobCard', () => {
  it('links to the original posting to apply — never applies itself', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /open posting/i });
    expect(link).toHaveAttribute('href', job.sourceUrl);
    expect(link).toHaveAttribute('target', '_blank');
    // noopener for safety; not noreferrer/nofollow — aggregators ask for referral traffic.
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(screen.queryByRole('button', { name: /^apply/i })).not.toBeInTheDocument();
  });

  it('credits an aggregator by name', () => {
    renderCard({ ...job, source: 'remoteok', jobSource: { id: 's2', name: 'Remote OK' } });
    expect(screen.getByText(/via Remote OK/)).toBeInTheDocument();
  });

  it("credits a company board as the company's careers page", () => {
    renderCard();
    expect(screen.getByText(/Septem Systems careers/)).toBeInTheDocument();
  });

  it('moves a new job to Interested', async () => {
    const fetchMock = mockFetch({ ...job, status: 'INTERESTED' });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Interested' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/jobs/j1');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'INTERESTED' });
  });

  it('"I applied" records what the user did', async () => {
    const fetchMock = mockFetch({ ...job, status: 'APPLIED' });
    renderCard({ ...job, status: 'INTERESTED' });
    await userEvent.click(screen.getByRole('button', { name: 'I applied' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      status: 'APPLIED',
    });
  });

  it('loads the full description only when details are opened', async () => {
    const fetchMock = mockFetch({ ...job, rawJD: 'Build MERN apps.' });
    renderCard();
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(await screen.findByText('Build MERN apps.')).toBeInTheDocument();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/v1/jobs/j1');
  });
});
