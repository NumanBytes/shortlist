import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JobResume } from '../lib/types';
import { job } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { ResumePage } from './ResumePage';

const profile = { id: 'u', email: 'numan@example.com', name: 'Numan Razzaq', headline: null, targetRole: null, location: 'Lahore, Pakistan', phone: '+92 300 0000000', linkedinUrl: 'https://linkedin.com/in/numan', githubUrl: null, createdAt: '' };
const education = [{ id: 'ed', degree: 'BS Information Technology', institution: 'University of the Punjab', location: null, startYear: 2019, endYear: 2023 }];

const resume = (status: 'DRAFT' | 'APPROVED', stale: string[] = []): JobResume => ({
  status: 'READY',
  error: null,
  queuedAt: null,
  workerOnline: null,
  reused: false,
  overlap: null,
  canTailor: true,
  needsDescription: false,
  reuse: [],
  sources: {
    e1: { skillName: 'React', whatIDid: 'Used React to build frontend features.', isVerified: true, context: 'COMMERCIAL', depth: 'PRODUCTION', lastUsed: '2026-09-01T00:00:00Z' },
  },
  variant: {
    id: 'v1',
    status,
    model: 'claude-sonnet-5-5',
    generatedAt: '2026-10-02T00:00:00Z',
    approvedAt: null,
    stale,
    content: {
      experience: [{ workExperienceId: 'r', title: 'Software Engineer', company: 'CloudCard Inc.', location: null, startDate: '2024-05-01T00:00:00Z', endDate: null, isCurrent: true, bullets: [{ label: 'Frontend', text: 'Built frontend features in React.', evidenceIds: ['e1'] }] }],
      projects: [],
      skillGroups: [{ label: 'Frontend', skills: [{ id: 's', name: 'React' }] }],
      dropped: [{ where: 'Software Engineer, CloudCard Inc.', text: 'Led a team of 12.', reason: 'adds "12", which isn\'t in your evidence' }],
    },
  },
});

function setup(r: JobResume) {
  return mockFetch({}, (url) => {
    if (url.endsWith('/resume')) return r;
    if (url.endsWith('/profile')) return profile;
    if (url.endsWith('/education')) return education;
    if (url.includes('/approve')) return { id: 'v1', status: 'APPROVED' };
    return { ...job, rawJD: '', requirements: [], match: null };
  });
}
const render = () => renderWithProviders(<ResumePage />, { path: '/jobs/:jobId/resume', route: '/jobs/j1/resume' });

describe('ResumePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the CV layout clean — as it will print — and what the checks removed', async () => {
    setup(resume('DRAFT'));
    render();
    expect(await screen.findByRole('heading', { name: 'Numan Razzaq' })).toBeInTheDocument();
    expect(screen.getByText(/numan@example.com \| \+92 300 0000000 \| Lahore, Pakistan/)).toBeInTheDocument();
    expect(screen.getByText('Built frontend features in React.')).toBeInTheDocument();
    // Sources are a review aid, shown only on tapping a bullet — never as if part of the resume.
    expect(screen.queryByText(/Used React to build frontend features/)).not.toBeInTheDocument();
    expect(screen.getByText(/BS Information Technology \| University of the Punjab/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Removed by checks · 1/ })).toBeInTheDocument();
    expect(screen.getByText('Led a team of 12.')).toBeInTheDocument();
  });

  it('tapping a bullet shows the evidence it was built from, in your words', async () => {
    setup(resume('DRAFT'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Built frontend features in React/ }));
    const sheet = screen.getByRole('dialog', { name: 'Bullet evidence' });
    expect(sheet).toHaveTextContent('“Used React to build frontend features.”');
    expect(sheet).toHaveTextContent(/Commercial.*Production.*Verified/);
  });

  it('copies the resume as plain text from the ··· menu, in the printed order', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup(resume('APPROVED'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('button', { name: /Copy as plain text/ }));
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toMatch(/^Numan Razzaq\n/);
    expect(text).toMatch(/EXPERIENCE\nSoftware Engineer \| CloudCard Inc\. — May 2024 - Present\n• Frontend: Built frontend features in React\./);
    expect(text.indexOf('SKILLS')).toBeLessThan(text.indexOf('EDUCATION'));
    expect(text).not.toMatch(/Led a team of 12/); // removed bullets are never copied
  });

  it('asks for approval before offering the PDF — never optimistically', async () => {
    const fetch = setup(resume('DRAFT'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/resumes/v1/approve'))).toBe(true));
    expect(screen.queryByRole('button', { name: /Save as PDF/ })).not.toBeInTheDocument();
  });

  it('offers Save as PDF once approved', async () => {
    setup(resume('APPROVED'));
    render();
    expect(await screen.findByRole('button', { name: /Save as PDF/ })).toBeInTheDocument();
  });

  it("won't approve or print an out-of-date resume", async () => {
    setup(resume('APPROVED', ['React: changed since']));
    render();
    expect(await screen.findByText(/React: changed since/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save as PDF/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled();
  });
});
