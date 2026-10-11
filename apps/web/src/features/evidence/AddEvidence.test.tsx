import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Evidence, Skill } from '../../lib/types';
import { mockFetch, renderWithProviders } from '../../test/render';
import { EvidenceSheet, type EvidenceSheetMode } from './AddEvidence';

const react: Skill = { id: '11111111-1111-4111-8111-111111111111', name: 'React', category: 'FRAMEWORK', evidence: [] };
const created = { id: '22222222-2222-4222-8222-222222222222', name: 'Docker', category: 'TOOL', evidence: [] };
const item: Evidence = {
  id: 'e1',
  skillId: react.id,
  context: 'COMMERCIAL',
  depth: 'PRODUCTION',
  whatIDid: 'Built RBAC screens',
  lastUsed: '2026-06-01T00:00:00.000Z',
  workExperienceId: null,
  projectId: null,
  isVerified: true,
  verifiedAt: '2026-06-02T00:00:00.000Z',
};

function api() {
  const fetchMock = mockFetch();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const body =
      url === '/api/v1/skills'
        ? init?.method === 'POST'
          ? created
          : [react]
        : url.startsWith('/api/v1/evidence')
          ? { id: 'e-new' }
          : [];
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  return fetchMock;
}
const sent = (fetchMock: ReturnType<typeof mockFetch>, method: string) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([url, init]) => ({ url, body: JSON.parse(init!.body as string) }));
const sheet = (mode: EvidenceSheetMode, onSaved = vi.fn()) => {
  renderWithProviders(<EvidenceSheet mode={mode} onClose={vi.fn()} onSaved={onSaved} />);
  return onSaved;
};

// These type into several fields key by key, which is slow when every package's tests run
// at once — give them room rather than flake.
describe('EvidenceSheet', { timeout: 20_000 }, () => {
  it('adds a skill, then its first evidence — never marked verified', async () => {
    const fetchMock = api();
    const saved = sheet({ kind: 'new-skill' });
    await userEvent.type(screen.getByLabelText('Skill'), 'Docker');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'TOOL');
    await userEvent.type(screen.getByLabelText(/What did you do/), 'Wrote Dockerfiles.');
    await userEvent.click(screen.getByRole('button', { name: 'Personal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save evidence' }));

    await waitFor(() => expect(saved).toHaveBeenCalled());
    const [skill, evidence] = sent(fetchMock, 'POST');
    expect(skill).toEqual({ url: '/api/v1/skills', body: { name: 'Docker', category: 'TOOL' } });
    expect(evidence!.body).toMatchObject({ skillId: created.id, whatIDid: 'Wrote Dockerfiles.', context: 'PERSONAL' });
    expect(evidence!.body).not.toHaveProperty('isVerified');
  });

  it('adds evidence to a skill you already have instead of failing on the duplicate', async () => {
    const fetchMock = api();
    sheet({ kind: 'new-skill' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/skills', expect.anything()));
    await userEvent.type(screen.getByLabelText('Skill'), 'react');
    expect(await screen.findByText(/You already have React/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/What did you do/), 'Built the dashboard.');
    await userEvent.click(screen.getByRole('button', { name: 'Save evidence' }));
    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1));
    expect(sent(fetchMock, 'POST')[0]).toMatchObject({ url: '/api/v1/evidence', body: { skillId: react.id } });
  });

  it("checks the evidence before creating anything, so a mistake doesn't leave an empty skill", async () => {
    const fetchMock = api();
    sheet({ kind: 'new-skill' });
    await userEvent.type(screen.getByLabelText('Skill'), 'Docker');
    await userEvent.click(screen.getByRole('button', { name: 'Save evidence' }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(sent(fetchMock, 'POST')).toHaveLength(0);
  });

  it('edits only what changed, and warns that it un-verifies the item', async () => {
    const fetchMock = api();
    const saved = sheet({ kind: 'edit', evidence: item, skillName: 'React' });
    expect(screen.getByText(/Saving changes makes it/)).toHaveTextContent(/Unverified again/);
    await userEvent.click(screen.getByRole('button', { name: 'Working' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(sent(fetchMock, 'PATCH')).toEqual([{ url: '/api/v1/evidence/e1', body: { depth: 'WORKING' } }]);
  });

  it('closes without a request when nothing changed', async () => {
    const fetchMock = api();
    sheet({ kind: 'edit', evidence: item, skillName: 'React' });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(sent(fetchMock, 'PATCH')).toHaveLength(0);
  });

  it('validates an edit with the shared schema before sending', async () => {
    const fetchMock = api();
    sheet({ kind: 'edit', evidence: item, skillName: 'React' });
    await userEvent.clear(screen.getByLabelText(/What did you do/));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/too small|at least|required/i)).toBeInTheDocument();
    expect(sent(fetchMock, 'PATCH')).toHaveLength(0);
  });
});
