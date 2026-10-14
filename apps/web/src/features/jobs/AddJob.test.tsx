import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderWithProviders } from '../../test/render';
import { AddJobButton } from './AddJob';

const JD = 'We are hiring a React engineer to build our dashboard. '.repeat(5);

function setup(response: () => Response) {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal('fetch', fetchMock);
  renderWithProviders(
    <Routes>
      <Route path="/" element={<AddJobButton />} />
      <Route path="/jobs/:id" element={<p>Job page</p>} />
    </Routes>,
    { path: '*' },
  );
  return fetchMock;
}

async function fill() {
  await userEvent.click(screen.getByRole('button', { name: /Add job/ }));
  await userEvent.type(screen.getByLabelText('Job title'), 'Senior Frontend Engineer');
  await userEvent.type(screen.getByLabelText('Company'), 'Conrad Labs');
  await userEvent.click(screen.getByLabelText('Full job description'));
  await userEvent.paste(JD);
}

// docs/discovery.md §11: a pasted posting becomes a job, then its page offers tailoring.
describe('AddJobButton', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('checks the fields first, then adds the job and opens it', async () => {
    const fetchMock = setup(() => new Response(JSON.stringify({ id: 'j9', merged: false }), { status: 201 }));
    await userEvent.click(screen.getByRole('button', { name: /Add job/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add and score' }));
    expect(screen.getByText('Add the job title')).toBeInTheDocument();
    expect(screen.getByText(/at least 200 characters/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Job title'), 'Senior Frontend Engineer');
    await userEvent.type(screen.getByLabelText('Company'), 'Conrad Labs');
    await userEvent.click(screen.getByLabelText('Full job description'));
    await userEvent.paste(JD);
    await userEvent.click(screen.getByRole('button', { name: 'Add and score' }));
    expect(await screen.findByText('Job page')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/jobs');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Senior Frontend Engineer',
      company: 'Conrad Labs',
      location: null,
      sourceUrl: null,
      description: JD.trim(),
    });
  });

  it('opens the existing job when it is already in Shortlist', async () => {
    setup(
      () => new Response(JSON.stringify({ message: 'This job is already in Shortlist', jobId: 'j1' }), { status: 409 }),
    );
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Add and score' }));
    await waitFor(() => expect(screen.getByText('Job page')).toBeInTheDocument());
  });
});
