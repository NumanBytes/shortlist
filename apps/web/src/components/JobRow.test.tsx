import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JobListItem } from '../lib/types';
import { job } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { JobRow } from './JobRow';


const row = (j: JobListItem = job) => renderWithProviders(<ul><JobRow job={j} selected={false} /></ul>);

describe('JobRow', () => {
  it('leads with the match score and links to the job detail', () => {
    row();
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Full Stack Software Engineer/ })).toHaveAttribute('href', '/jobs/j1');
  });

  it('links to the original posting to apply — never applies itself', () => {
    row();
    const link = screen.getByRole('link', { name: 'Open posting' });
    expect(link).toHaveAttribute('href', job.sourceUrl);
    expect(link).toHaveAttribute('target', '_blank');
    // noopener for safety; not noreferrer/nofollow — aggregators ask for referral traffic.
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(screen.queryByRole('button', { name: /^apply/i })).not.toBeInTheDocument();
  });

  it("formats the location and hides a company board's stale publish date", () => {
    row();
    expect(screen.getByText(/Lahore, Punjab, PK/)).toBeInTheDocument();
    expect(screen.queryByText(/posted/)).not.toBeInTheDocument(); // company board: a listed job is open
  });

  it('says when Shortlist found the job', () => {
    row({ ...job, discoveredAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    expect(screen.getByText('Found 2d ago')).toHaveAttribute('dateTime');
  });

  it('credits an aggregator by name, and shows only when the job was found — not its posting age', () => {
    row({ ...job, source: 'remoteok', postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    expect(screen.getByText(/via Remote OK/)).toBeInTheDocument();
    expect(screen.queryByText(/posted/)).not.toBeInTheDocument();
  });

  it('marks a job interested, and skips it', async () => {
    const fetchMock = mockFetch({ ...job, status: 'INTERESTED' });
    row();
    await userEvent.click(screen.getByRole('button', { name: 'Mark interested' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/jobs/j1');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ status: 'INTERESTED' });

    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ status: 'SKIPPED' });
  });

  it('confirms a move with a toast, and Undo restores the previous status', async () => {
    const fetchMock = mockFetch({ ...job, status: 'INTERESTED' });
    row();
    await userEvent.click(screen.getByRole('button', { name: 'Mark interested' }));
    expect(await screen.findByText('Moved to Interested')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ status: 'DISCOVERED' });
  });

  it("names a company board as 'company site' rather than repeating the company", () => {
    row();
    expect(screen.getByText(/· company site/)).toBeInTheDocument();
    expect(screen.getAllByText(/Septem Systems/)).toHaveLength(1);
  });

  it('shows why a job has no score yet', () => {
    row({ ...job, match: null, analysisStatus: 'DEFERRED', analysisError: 'Daily analysis cap reached' });
    expect(screen.getByText('Scoring deferred')).toBeInTheDocument();
  });

  it('flags a suspected scam on the row', () => {
    row({ ...job, redFlags: ['asks for a registration fee'] });
    expect(screen.getByText('Possible scam')).toBeInTheDocument();
  });
});
