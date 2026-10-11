import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project, WorkExperience } from '../../lib/types';
import { mockFetch, renderWithProviders } from '../../test/render';
import { ProjectForm, RoleForm } from './CareerForms';

const role: WorkExperience = { id: 'r1', company: 'CloudCard Inc.', title: 'Software Engineer', startDate: '2024-05-01T00:00:00.000Z', endDate: null, isCurrent: true, location: 'Lahore' };
const project: Project = {
  id: 'p1',
  name: 'Bank Portal',
  description: 'Enterprise banking portal',
  workExperienceId: 'r1',
  liveUrl: null,
  repoUrl: null,
  isShipped: true,
  startDate: null,
  endDate: null,
};
const api = () => mockFetch(undefined, (url) => (url.endsWith('/work-experiences') ? [role] : { id: 'x' }));
const sent = (f: ReturnType<typeof mockFetch>, method: string) =>
  f.mock.calls.filter(([, i]) => i?.method === method).map(([url, i]) => ({ url, body: i?.body ? JSON.parse(i.body as string) : undefined }));

describe('RoleForm', { timeout: 20_000 }, () => {
  it('edits only what changed, and warns that claim changes un-verify evidence', async () => {
    const fetchMock = api();
    const done = vi.fn();
    renderWithProviders(<RoleForm role={role} onDone={done} />);
    expect(screen.getByText(/makes the evidence linked to it unverified/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Senior Engineer');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(sent(fetchMock, 'PATCH')).toEqual([{ url: '/api/v1/work-experiences/r1', body: { title: 'Senior Engineer' } }]);
  });

  it("a current role can't also have an end date; a past one needs one", async () => {
    const fetchMock = api();
    renderWithProviders(<RoleForm onDone={vi.fn()} />);
    expect(screen.getByLabelText('Ended')).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Title'), 'Intern');
    await userEvent.type(screen.getByLabelText('Company'), 'Acme');
    await userEvent.click(screen.getByRole('switch', { name: 'I work here now' })); // no longer current, no end date
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Set an end date/)).toBeInTheDocument();
    expect(sent(fetchMock, 'POST')).toHaveLength(0);
  });

  it('asks before deleting, and says what happens to the evidence', async () => {
    const fetchMock = api();
    renderWithProviders(<RoleForm role={role} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Delete role/ }));
    expect(screen.getByText(/becomes unverified/)).toBeInTheDocument();
    expect(sent(fetchMock, 'DELETE')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sent(fetchMock, 'DELETE')).toEqual([{ url: '/api/v1/work-experiences/r1', body: undefined }]));
  });
});

describe('ProjectForm', { timeout: 20_000 }, () => {
  it('moving a project to personal work is a claim change sent on its own', async () => {
    const fetchMock = api();
    renderWithProviders(<ProjectForm project={project} onDone={vi.fn()} />);
    await screen.findByRole('option', { name: /Software Engineer, CloudCard/ });
    await userEvent.selectOptions(screen.getByLabelText('Done as part of'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent(fetchMock, 'PATCH')).toEqual([{ url: '/api/v1/projects/p1', body: { workExperienceId: null } }]));
  });

  it('refuses a non-http link before sending', async () => {
    const fetchMock = api();
    renderWithProviders(<ProjectForm onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Manzil');
    await userEvent.type(screen.getByLabelText('Live URL (optional)'), 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Must be an http(s) URL')).toBeInTheDocument();
    expect(sent(fetchMock, 'POST')).toHaveLength(0);
  });
});
