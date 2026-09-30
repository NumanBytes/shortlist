import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Evidence } from '../lib/types';
import { EvidenceItem } from './EvidenceItem';

const evidence: Evidence = {
  id: 'e1',
  skillId: 's1',
  context: 'COMMERCIAL',
  depth: 'PRODUCTION',
  whatIDid: 'Built RBAC screens',
  lastUsed: '2026-06-01T00:00:00.000Z',
  workExperienceId: 'w1',
  projectId: null,
  isVerified: false,
  verifiedAt: null,
};

function renderItem(e: Evidence = evidence) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EvidenceItem evidence={e} source="Frontend Developer, CloudCard Inc." />
    </QueryClientProvider>,
  );
}

function mockFetch(body: unknown) {
  const fn = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('EvidenceItem', () => {
  it('shows the claim, its source, and that it is not verified', () => {
    renderItem();
    expect(screen.getByText('Built RBAC screens')).toBeInTheDocument();
    expect(screen.getByText('Frontend Developer, CloudCard Inc.')).toBeInTheDocument();
    expect(screen.getByText('Not verified')).toBeInTheDocument();
  });

  it('verify calls the dedicated verify endpoint — never a PATCH with isVerified', async () => {
    const fetchMock = mockFetch({ ...evidence, isVerified: true });
    renderItem();
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/evidence/e1/verify');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('rewording sends only the new text, and warns that it un-verifies', async () => {
    const fetchMock = mockFetch({ ...evidence, whatIDid: 'Built and designed RBAC screens' });
    renderItem({ ...evidence, isVerified: true });
    await userEvent.click(screen.getByRole('button', { name: 'Reword' }));
    expect(screen.getByText(/un-verifies this item/)).toBeInTheDocument();

    const box = screen.getByLabelText('What you did');
    await userEvent.clear(box);
    await userEvent.type(box, 'Built and designed RBAC screens');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/evidence/e1');
    expect(JSON.parse(init.body as string)).toEqual({ whatIDid: 'Built and designed RBAC screens' });
  });

  it('validates with the shared schema before sending', async () => {
    const fetchMock = mockFetch({});
    renderItem();
    await userEvent.click(screen.getByRole('button', { name: 'Reword' }));
    await userEvent.clear(screen.getByLabelText('What you did'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/too small|at least|required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
