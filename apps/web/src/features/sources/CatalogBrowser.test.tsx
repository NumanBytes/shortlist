import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { CatalogBrowser } from './CatalogBrowser';

const entries = [
  {
    id: 'e1',
    name: 'Acme',
    type: 'MANUAL',
    provider: 'careers_page',
    regions: ['lahore', 'pakistan'],
    following: true,
  },
  { id: 'e2', name: 'Globex', type: 'ATS_BOARD', provider: 'greenhouse', regions: ['berlin'], following: false },
  { id: 'e3', name: 'Remote OK', type: 'AGGREGATOR_API', provider: 'remoteok', regions: ['remote'], following: false },
];

const setup = () =>
  mockFetch(undefined, (url) =>
    url.endsWith('/follow')
      ? { status: 'followed', name: 'Globex' }
      : url.includes('/discovery/catalog')
        ? entries
        : null,
  );

describe('CatalogBrowser', () => {
  it('lists the catalog, marking what the user follows', async () => {
    setup();
    renderWithProviders(<CatalogBrowser />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Following')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow Globex' })).toBeInTheDocument();
  });

  it('narrows by name and by place', async () => {
    setup();
    renderWithProviders(<CatalogBrowser />);
    await userEvent.type(await screen.findByLabelText('Search companies and job boards'), 'glo');
    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search companies and job boards'));
    await userEvent.click(screen.getByRole('button', { name: 'Remote' }));
    expect(screen.getByText('Remote OK')).toBeInTheDocument();
    expect(screen.queryByText('Globex')).not.toBeInTheDocument();
  });

  it('follows an entry', async () => {
    const fetchMock = setup();
    renderWithProviders(<CatalogBrowser />);
    await userEvent.click(await screen.findByRole('button', { name: 'Follow Globex' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u, i]) => u === '/api/v1/discovery/catalog/e2/follow' && i?.method === 'POST'),
      ).toBe(true),
    );
  });
});
