import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JobDetail } from '../lib/types';
import { job as listJob } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { PartialJobNotice } from './PartialJobNotice';

const job: JobDetail = {
  ...listJob,
  source: 'indeed',
  jobSource: { id: 's', name: 'Indeed', type: 'EMAIL_INBOX' },
  isPartial: true,
  salary: 'From Rs 70,000 a month',
  status: 'INTERESTED',
  rawJD: 'From the Indeed alert: hiring a Full Stack Developer.',
  seniority: null,
  yearsRequired: null,
  analyzedAt: null,
  requirements: [],
  match: null,
};
const FULL = 'We are hiring a Full Stack Developer with React and Node.js experience. '.repeat(4);

describe('PartialJobNotice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('explains the score is rough and offers the paste form on an Interested job', async () => {
    const fetch = mockFetch({ ...job, isPartial: false, rawJD: FULL });
    renderWithProviders(<PartialJobNotice job={job} />);
    expect(screen.getByText(/From your Indeed alert — only a summary so far/)).toBeInTheDocument();
    expect(screen.getByText(/treat it as rough/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Full job description'), 'too short');
    await userEvent.click(screen.getByRole('button', { name: /Save and score again/ }));
    expect(screen.getByText(/at least 200 characters/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled(); // validated before a round trip

    await userEvent.clear(screen.getByLabelText('Full job description'));
    await userEvent.click(screen.getByLabelText('Full job description'));
    await userEvent.paste(FULL);
    await userEvent.click(screen.getByRole('button', { name: /Save and score again/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/\/jobs\/j1\/description$/);
    expect(JSON.parse(init!.body as string)).toEqual({ description: FULL.trim() });
  });

  it('asks to mark a new job Interested before pasting', () => {
    mockFetch({});
    renderWithProviders(<PartialJobNotice job={{ ...job, status: 'DISCOVERED' }} />);
    expect(screen.getByText(/Mark it Interested to paste the full description/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Full job description')).not.toBeInTheDocument();
  });
});
