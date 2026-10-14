import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { NeverClaimList } from './NeverClaimList';

const azure = { id: 'n1', term: 'Azure', scope: 'ANYWHERE', note: 'Never used it' };
const node = { id: 'n2', term: 'Node.js', scope: 'PAID_WORK', note: null };

describe('NeverClaimList', () => {
  it('lists terms with their scope, and removes one', async () => {
    const fetchMock = mockFetch([azure, node]);
    renderWithProviders(<NeverClaimList />);
    expect(await screen.findByText('Azure')).toBeInTheDocument();
    expect(screen.getByText('Anywhere · Never used it')).toBeInTheDocument();
    expect(screen.getByText('Not in paid work')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Node.js' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/v1/never-claim/n2' && i?.method === 'DELETE')).toBe(
        true,
      ),
    );
  });

  // UI audit G14: a truthfulness safeguard comes back with one tap.
  it('offers Undo after removing a term, which adds it back', async () => {
    const fetchMock = mockFetch([azure, node]);
    renderWithProviders(<NeverClaimList />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Node.js' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
      expect(JSON.parse(post![1]!.body as string)).toEqual({ term: 'Node.js', scope: 'PAID_WORK', note: null });
    });
  });

  it('adds a paid-work-only term', async () => {
    const fetchMock = mockFetch([]);
    renderWithProviders(<NeverClaimList />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a term' }));
    await userEvent.type(screen.getByLabelText('Term'), 'Express');
    await userEvent.click(screen.getByRole('switch', { name: 'Only in paid work' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
      expect(JSON.parse(post![1]!.body as string)).toEqual({ term: 'Express', scope: 'PAID_WORK', note: null });
    });
  });
});
