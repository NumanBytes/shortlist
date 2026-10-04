import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Skill } from '../lib/types';
import { mockFetch, renderWithProviders } from '../test/render';
import { AddSkillCard } from './AddEvidence';

const react: Skill = { id: '11111111-1111-4111-8111-111111111111', name: 'React', category: 'FRAMEWORK', evidence: [] };
const created = { id: '22222222-2222-4222-8222-222222222222', name: 'Docker', category: 'TOOL', evidence: [] };

function api(skills: Skill[] = [react]) {
  return mockFetch(undefined, (url) => (url === '/api/v1/skills' ? skills : url === '/api/v1/evidence' ? { id: 'e-new' } : []));
}
const posts = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => ({ url, body: JSON.parse(init!.body as string) }));

// These type into several fields key by key, which is slow when every package's tests run
// at once — give them room rather than flake.
describe('AddSkillCard', { timeout: 20_000 }, () => {
  it('creates the skill, then its first evidence — never marked verified', async () => {
    const fetchMock = api();
    // POST /skills answers with the new skill; GET /skills with the list.
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const body = url === '/api/v1/skills' ? (init?.method === 'POST' ? created : [react]) : { id: 'e-new' };
      return Promise.resolve(new Response(JSON.stringify(body)));
    });
    const done = vi.fn();
    renderWithProviders(<AddSkillCard onDone={done} />);
    await userEvent.type(screen.getByLabelText('Skill'), 'Docker');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'TOOL');
    await userEvent.type(screen.getByLabelText('What you did with it'), 'Wrote Dockerfiles.');
    await userEvent.click(screen.getByRole('button', { name: 'Add skill' }));

    await waitFor(() => expect(done).toHaveBeenCalled());
    const [skill, evidence] = posts(fetchMock);
    expect(skill).toEqual({ url: '/api/v1/skills', body: { name: 'Docker', category: 'TOOL' } });
    expect(evidence!.url).toBe('/api/v1/evidence');
    expect(evidence!.body).toMatchObject({ skillId: created.id, whatIDid: 'Wrote Dockerfiles.', context: 'COMMERCIAL' });
    expect(evidence!.body).not.toHaveProperty('isVerified');
  });

  it('adds evidence to a skill you already have instead of failing on the duplicate', async () => {
    const fetchMock = api();
    renderWithProviders(<AddSkillCard onDone={vi.fn()} />);
    await screen.findByLabelText('Skill');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/skills', expect.anything()));
    await userEvent.type(screen.getByLabelText('Skill'), 'react');
    expect(await screen.findByText(/You already have React/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('What you did with it'), 'Built the dashboard.');
    await userEvent.click(screen.getByRole('button', { name: 'Add evidence' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ url: '/api/v1/evidence', body: { skillId: react.id } });
  });

  it("checks the evidence before creating anything, so a mistake doesn't leave an empty skill", async () => {
    const fetchMock = api();
    renderWithProviders(<AddSkillCard onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Skill'), 'Docker');
    await userEvent.click(screen.getByRole('button', { name: 'Add skill' }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });
});
