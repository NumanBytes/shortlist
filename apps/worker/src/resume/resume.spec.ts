import {
  RESUME_JSON_SCHEMA,
  ResumeOutputSchema,
  assembleResume,
  mentionSpans,
  type AssembleInput,
  type ResumeEvidence,
  type ResumeOutput,
} from '@shortlist/shared';
import { buildResumePrompt } from './prompt.js';

const NOW = new Date('2026-10-02T00:00:00Z');
const recent = new Date('2026-09-01T00:00:00Z');
const old = new Date('2023-07-01T00:00:00Z');

const role = { id: 'cc', title: 'Software Engineer', company: 'CloudCard Inc.', location: 'Lahore', startDate: new Date('2024-05-01'), endDate: null, isCurrent: true };
const projects = [
  { id: 'bank', name: 'Bank Portal', workExperienceId: 'cc' },
  { id: 'shortlist', name: 'Shortlist', workExperienceId: null },
];
const ev = (id: string, skillName: string, over: Partial<ResumeEvidence> = {}): ResumeEvidence => ({
  id,
  skillId: `s-${skillName}`,
  skillName,
  context: 'COMMERCIAL',
  depth: 'PRODUCTION',
  lastUsed: recent,
  whatIDid: `Used ${skillName} to build frontend features that shipped to production at CloudCard.`,
  workExperienceId: 'cc',
  projectId: null,
  projectRoleId: null,
  ...over,
});
const evidence: ResumeEvidence[] = [
  ev('react', 'React'),
  ev('ts', 'TypeScript'),
  ev('cicd', 'CI/CD', { depth: 'WORKING', whatIDid: 'Deployed CloudCard applications through existing CI/CD pipelines; did not own them.' }),
  ev('upgrade', 'Angular', { depth: 'MAINTENANCE', whatIDid: 'Upgraded Angular versions across CloudCard apps.' }),
  ev('rbac', 'Role-based access control', { workExperienceId: null, projectId: 'bank', projectRoleId: 'cc', whatIDid: 'Built role-based administration screens for the bank portal.' }),
  ev('node', 'Node.js', { context: 'PERSONAL', depth: 'WORKING', workExperienceId: null, whatIDid: 'Built small MERN learning projects.' }),
  ev('pnpm', 'pnpm', { context: 'PERSONAL', depth: 'WORKING', workExperienceId: null, projectId: 'shortlist', whatIDid: 'Use pnpm workspaces in Shortlist.' }),
  ev('nest', 'NestJS', { context: 'PERSONAL', depth: 'EXPOSURE', workExperienceId: null, projectId: 'shortlist', whatIDid: 'Learning NestJS while building Shortlist.' }),
  ev('python', 'Python', { context: 'ACADEMIC', depth: 'EXPOSURE', workExperienceId: null, lastUsed: old, whatIDid: 'Coursework.' }),
];

// The prompt's own refs, so tests cite exactly what the service would.
const prompt = buildResumePrompt({
  job: { title: 'Frontend Engineer', company: 'Kwanso', rawJD: 'React and TypeScript.' },
  requirements: [{ skillName: 'React.js', importance: 'REQUIRED', isCore: true }],
  roles: [role],
  projects,
  evidence,
  now: NOW,
});
const E = (id: string) => [...prompt.refs.evidence].find(([, v]) => v === id)![0];
const S = (name: string) => [...prompt.refs.skills].find(([, v]) => v === `s-${name}`)![0];

const bullet = (text: string, refs: string[], label: string | null = null) => ({ label, text, evidence: refs });
const assemble = (output: Partial<ResumeOutput>, over: Partial<AssembleInput> = {}) =>
  assembleResume({
    output: { experience: [], projects: [], skillGroups: [], learning: [], ...output },
    refs: prompt.refs,
    evidence,
    roles: [role],
    projects,
    policedNames: [...evidence.map((e) => e.skillName), 'React.js', 'GraphQL', 'AWS / GCP / Azure', 'Go'],
    requirementAliases: [{ name: 'React.js', skillIds: ['s-React'] }],
    now: NOW,
    ...over,
  });
const roleBullets = (text: string, refs: string[], label: string | null = null) =>
  assemble({ experience: [{ role: 'R1', bullets: [bullet(text, refs, label)] }] });

describe('assembleResume — bullets', () => {
  it('keeps a bullet that cites its evidence, with the evidence IDs', () => {
    const r = roleBullets('Developed production web applications using React and TypeScript.', [E('react'), E('ts')], 'Frontend');
    expect(r.content.experience[0]!.bullets).toEqual([
      { label: 'Frontend', text: 'Developed production web applications using React and TypeScript.', evidenceIds: ['react', 'ts'] },
    ]);
    expect(r.evidenceIds).toEqual(['react', 'ts']);
    expect(r.content.dropped).toEqual([]);
  });

  it('drops a bullet that cites nothing or an unknown ref', () => {
    const r = assemble({ experience: [{ role: 'R1', bullets: [bullet('Did things.', []), bullet('Used React.', ['E99'])] }] });
    expect(r.content.experience[0]!.bullets).toEqual([]);
    expect(r.content.dropped.map((d) => d.reason)).toEqual(['cites no evidence', `cites "E99", which isn't one of your verified items`]);
  });

  it('never puts personal work in Experience, even if the model cites it there', () => {
    // Node.js is personal: it has no ref under the role, so its id can't be cited at all…
    expect([...prompt.refs.evidence.values()]).not.toContain('node');
    // …and if a ref to personal work is forced in, the placement check refuses it.
    const refs = { ...prompt.refs, evidence: new Map([...prompt.refs.evidence, ['E50', 'node']]) };
    const r = assemble({ experience: [{ role: 'R1', bullets: [bullet('Worked with Node.js.', ['E50'])] }] }, { refs });
    expect(r.content.dropped[0]!.reason).toMatch(/Node\.js item \(personal working\), which can't appear here/);
  });

  it('refuses Azure anywhere and Node.js/Express in paid work (known false claims)', () => {
    expect(roleBullets('Built React apps on Azure B2C.', [E('react')]).content.dropped[0]!.reason).toMatch(/Azure/);
    expect(roleBullets('Built React frontends for an Express API.', [E('react')]).content.dropped[0]!.reason).toMatch(/Node\.js\/Express/);
  });

  it('refuses numbers the evidence never stated', () => {
    expect(roleBullets('Shipped 12 React features.', [E('react')]).content.dropped[0]!.reason).toBe(`adds "12", which isn't in your evidence`);
  });

  // Code review: numbers were compared as substrings, so digits inside a word in the
  // evidence ("B2C", "2019") let invented figures through, and "HTML5" was refused.
  describe('numbers are compared whole', () => {
    const b2c = ev('b2c', 'API Integration', { whatIDid: "Wrote Ruby functions in CloudCard's B2C layer since 2019." });
    // The skill is named HTML5; the user's words say "HTML" — the bullet may use the name.
    const html = ev('html', 'HTML5', { whatIDid: 'Used HTML to build frontend features that shipped to production.' });
    const migrations = ev('mig', 'PostgreSQL', { whatIDid: 'Wrote 3 migrations and reviewed 1,200 lines of SQL; met a 99.9% uptime target.' });
    const refs = { ...prompt.refs, evidence: new Map([['E70', 'b2c'], ['E71', 'html'], ['E72', 'mig']]) };
    const check = (text: string, ref: string) =>
      assemble({ experience: [{ role: 'R1', bullets: [bullet(text, [ref])] }] }, { refs, evidence: [...evidence, b2c, html, migrations] });

    it('refuses a number hidden inside a word in the evidence ("2" in B2C, "19" in 2019)', () => {
      expect(check('Integrated APIs for 2 years across 19 services.', 'E70').content.dropped[0]!.reason).toBe(
        `adds "2", which isn't in your evidence`,
      );
      expect(check('Integrated APIs across 19 services.', 'E70').content.dropped[0]!.reason).toBe(`adds "19", which isn't in your evidence`);
    });

    it('allows digits that are part of a name (HTML5, B2C)', () => {
      expect(check('Built production frontend features in HTML5.', 'E71').content.dropped).toEqual([]);
      expect(check("Wrote Ruby functions in CloudCard's B2C layer.", 'E70').content.dropped).toEqual([]);
    });

    it('allows numbers the evidence states, including thousands and decimals', () => {
      expect(check('Wrote 3 migrations and reviewed 1,200 lines of SQL toward 99.9% uptime.', 'E72').content.dropped).toEqual([]);
      expect(check('Wrote 4 migrations.', 'E72').content.dropped[0]!.reason).toMatch(/adds "4"/);
    });

    it('keeps a year the evidence states', () => {
      expect(check('Wrote Ruby functions in the B2C layer since 2019.', 'E70').content.dropped).toEqual([]);
    });
  });

  it('refuses a technology the bullet names without citing evidence for it', () => {
    const r = roleBullets('Built React features with GraphQL.', [E('react')]);
    expect(r.content.dropped[0]!.reason).toBe('mentions GraphQL without citing evidence for it');
    // An uncited skill of the user's own is refused too.
    expect(roleBullets('Built React features in TypeScript.', [E('react')]).content.dropped[0]!.reason).toMatch(/TypeScript/);
  });

  it("allows the posting's name for a cited skill (React.js for React)", () => {
    expect(roleBullets('Built React.js features that shipped to production.', [E('react')]).content.dropped).toEqual([]);
  });

  it('allows names the cited item itself uses, and parts of a longer covered name', () => {
    const r = roleBullets('Deployed applications through existing CI/CD pipelines at CloudCard.', [E('cicd')], 'CI/CD');
    expect(r.content.dropped).toEqual([]);
  });

  it("matches short names case-sensitively: 'go live' isn't Go", () => {
    expect(mentionSpans('Helped features go live.', 'Go')).toEqual([]);
    expect(mentionSpans('Wrote services in Go.', 'Go')).toHaveLength(1);
    expect(roleBullets('Helped React features go live in production.', [E('react')]).content.dropped).toEqual([]);
  });

  it('refuses building verbs for working-level or maintenance evidence', () => {
    expect(roleBullets('Built the CI/CD pipelines for CloudCard.', [E('cicd')]).content.dropped[0]!.reason).toMatch(/says "built"/);
    expect(roleBullets('Developed Angular applications.', [E('upgrade')]).content.dropped[0]!.reason).toMatch(/says "developed"/);
    expect(roleBullets('Upgraded Angular versions across CloudCard apps.', [E('upgrade')]).content.dropped).toEqual([]);
  });

  it("lets a role's project evidence be an Experience bullet, but not another project's", () => {
    expect(roleBullets('Built role-based administration screens for a bank portal.', [E('rbac')]).content.dropped).toEqual([]);
    const r = assemble({ projects: [{ project: 'P2', bullets: [bullet('Built role-based administration screens.', [E('rbac')])] }] });
    expect(r.content.projects).toEqual([]);
    expect(r.content.dropped[0]!.reason).toMatch(/can't appear here/);
  });

  it('keeps personal working evidence in its own project, and drops empty projects', () => {
    const r = assemble({
      projects: [
        { project: 'P2', bullets: [bullet('Used pnpm workspaces in Shortlist.', [E('pnpm')])] },
        { project: 'P1', bullets: [] },
      ],
    });
    expect(r.content.projects).toEqual([{ projectId: 'shortlist', name: 'Shortlist', bullets: [expect.objectContaining({ evidenceIds: ['pnpm'] })] }]);
  });

  it('lists every role even with no surviving bullets, and caps bullets per role', () => {
    const many = Array.from({ length: 8 }, () => bullet('Built React features that shipped to production.', [E('react')]));
    const r = assemble({ experience: [{ role: 'R1', bullets: many }] });
    expect(r.content.experience[0]!.bullets).toHaveLength(6);
    expect(r.content.dropped.filter((d) => d.reason === 'over the bullet limit')).toHaveLength(2);
    expect(assemble({}).content.experience).toHaveLength(1);
  });
});

describe('assembleResume — skills', () => {
  it('lists only placeable skills, and moves learning-only ones to a Learning group', () => {
    const r = assemble({
      skillGroups: [{ label: 'Frontend', skills: [S('React'), S('NestJS'), S('TypeScript'), S('React')] }],
      learning: [],
    });
    expect(r.content.skillGroups).toEqual([
      { label: 'Frontend', skills: [{ id: 's-React', name: 'React' }, { id: 's-TypeScript', name: 'TypeScript' }] },
      { label: 'Learning', skills: [{ id: 's-NestJS', name: 'NestJS' }] },
    ]);
    expect(r.evidenceIds).toEqual(['nest', 'react', 'ts']);
  });

  it("never lists stale coursework or maintenance-only skills (they aren't offered)", () => {
    expect([...prompt.refs.skills.values()]).not.toContain('s-Python');
    expect(prompt.user).not.toMatch(/S\d+: Python/);
  });

  // A real run returned names instead of S-refs and failed a paid resume (2026-10-04).
  it("accepts a skill by its exact name — but only one it was offered", () => {
    const r = assemble({ skillGroups: [{ label: 'Frontend', skills: ['react', S('TypeScript'), 'Python', 'Kubernetes'] }], learning: ['NestJS'] });
    expect(r.content.skillGroups).toEqual([
      { label: 'Frontend', skills: [{ id: 's-React', name: 'React' }, { id: 's-TypeScript', name: 'TypeScript' }] },
      { label: 'Learning', skills: [{ id: 's-NestJS', name: 'NestJS' }] },
    ]); // Python (stale coursework, not offered) and Kubernetes (not a skill) are dropped
  });

  it("can't relabel strong skills as Learning, or a learning skill as strong", () => {
    const r = assemble({ skillGroups: [{ label: 'learning', skills: [S('React')] }], learning: [S('TypeScript')] });
    expect(r.content.skillGroups).toEqual([{ label: 'Other', skills: [{ id: 's-React', name: 'React' }, { id: 's-TypeScript', name: 'TypeScript' }] }]);
  });
});

describe('buildResumePrompt', () => {
  it('lists verified items under where they may be used, by ref only', () => {
    expect(prompt.user).toMatch(/E\d+ \[R1\] React — commercial, production: "Used React/);
    expect(prompt.user).toMatch(/E\d+ \[P1, R1\] Role-based access control/);
    expect(prompt.user).toMatch(/E\d+ \[P2\] pnpm — personal, working/);
    expect(prompt.user).toContain('P1: Bank Portal — a project of R1');
    expect(prompt.user).toMatch(/S\d+: NestJS — learning/);
  });

  // Matched to the user's CV (docs/resume.md §13.1): its Experience bullets average 12 words; the
  // first real run averaged 20 (up to 35), repeated the company name and said what the
  // candidate didn't do ("without owning the services").
  it('asks for short, single-topic bullets that state what was done', () => {
    expect(prompt.system).toMatch(/at most 18 words \(never more than 22\)/);
    // A minimum made the model pad a short fact with work the evidence didn't describe.
    expect(prompt.system).toMatch(/never pad/);
    expect(prompt.system).toMatch(/One topic per bullet/);
    expect(prompt.system).toMatch(/Don't name the company or the role/);
    expect(prompt.system).toMatch(/not what they didn't do/);
    expect(prompt.system).not.toMatch(/Keep qualifiers/);
  });

  it('wraps the posting as untrusted data', () => {
    expect(prompt.user).toMatch(/<job_posting>[\s\S]*Kwanso[\s\S]*<\/job_posting>/);
    expect(prompt.system).toMatch(/untrusted text/);
  });

  it('JSON schema stays in sync with the Zod schema', () => {
    const s = RESUME_JSON_SCHEMA;
    expect([...s.required].sort()).toEqual(Object.keys(ResumeOutputSchema.shape).sort());
    const bulletKeys = Object.keys(ResumeOutputSchema.shape.experience.element.shape.bullets.element.shape).sort();
    expect([...s.properties.experience.items.properties.bullets.items.required].sort()).toEqual(bulletKeys);
    expect([...s.properties.projects.items.properties.bullets.items.required].sort()).toEqual(bulletKeys);
    expect([...s.properties.skillGroups.items.required].sort()).toEqual(Object.keys(ResumeOutputSchema.shape.skillGroups.element.shape).sort());
  });
});
