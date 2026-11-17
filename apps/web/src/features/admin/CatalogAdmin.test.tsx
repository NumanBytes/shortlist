import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { CatalogAdmin } from './CatalogAdmin';

const entry = {
  id: 'c1',
  key: 'careers_page:acme',
  name: 'Acme',
  type: 'MANUAL',
  provider: 'careers_page',
  link: 'https://acme.example.com/careers',
  regions: ['lahore'],
  isListed: true,
  followers: 3,
  createdAt: '2026-11-16T00:00:00Z',
  updatedAt: '2026-11-16T00:00:00Z',
};

const setup = () =>
  mockFetch(undefined, (_url, init) =>
    init?.method && init.method !== 'GET' ? { ...entry, name: 'Globex' } : [entry],
  );
const sent = (fetchMock: ReturnType<typeof setup>, method: string) =>
  fetchMock.mock.calls
    .filter(([, i]) => i?.method === method)
    .map(([url, i]) => ({ url, body: i?.body ? JSON.parse(i.body as string) : undefined }));

describe('CatalogAdmin', () => {
  it('shows each entry with its places and followers', async () => {
    setup();
    renderWithProviders(<CatalogAdmin />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText(/lahore · 3 followers/)).toBeInTheDocument();
  });

  it('adds an entry from a name, a link and its places', async () => {
    const fetchMock = setup();
    renderWithProviders(<CatalogAdmin />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add to the catalog' }));
    await userEvent.type(screen.getByLabelText('Company or board'), 'Globex');
    await userEvent.type(screen.getByLabelText('Jobs page link'), 'https://globex.example.com/careers');
    await userEvent.type(screen.getByLabelText('Places it hires in'), 'Berlin, Germany');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(sent(fetchMock, 'POST')).toEqual([
        {
          url: '/api/v1/admin/catalog',
          body: { name: 'Globex', link: 'https://globex.example.com/careers', regions: ['berlin', 'germany'] },
        },
      ]),
    );
  });

  it('sends only what changed when editing', async () => {
    const fetchMock = setup();
    renderWithProviders(<CatalogAdmin />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Acme' }));
    await userEvent.click(screen.getByRole('switch', { name: 'List Acme for users' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(sent(fetchMock, 'PATCH')).toEqual([{ url: '/api/v1/admin/catalog/c1', body: { isListed: false } }]),
    );
  });

  it('asks once more before removing an entry', async () => {
    const fetchMock = setup();
    renderWithProviders(<CatalogAdmin />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Acme' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from the catalog' }));
    expect(sent(fetchMock, 'DELETE')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: /followers keep their own copy/ }));
    await waitFor(() =>
      expect(sent(fetchMock, 'DELETE')).toEqual([{ url: '/api/v1/admin/catalog/c1', body: undefined }]),
    );
  });
});
