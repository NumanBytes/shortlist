import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Evidence } from '../../lib/types';
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

function renderItem(e: Evidence = evidence, onEdit = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ul>
        <EvidenceItem evidence={e} source="Frontend Developer, CloudCard Inc." onEdit={onEdit} />
      </ul>
    </QueryClientProvider>,
  );
  return onEdit;
}

function mockFetch(body: unknown) {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('EvidenceItem', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the claim in your words, where and how deeply, its source, and that it is not verified', () => {
    renderItem();
    expect(screen.getByText('“Built RBAC screens”')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText(/Frontend Developer, CloudCard Inc\./)).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('verify calls the dedicated verify endpoint — never a PATCH with isVerified', async () => {
    const fetch = mockFetch({ ...evidence, isVerified: true });
    renderItem();
    await userEvent.click(screen.getByRole('button', { name: /Verify/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/evidence/e1/verify');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('a verified item offers Unverify; Edit opens the editor', async () => {
    const onEdit = renderItem({ ...evidence, isVerified: true });
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unverify' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalled();
  });
});
