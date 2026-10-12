import {
  CAREER_EXTRACTION_JSON_SCHEMA,
  CareerExtractionSchema,
  checkCareerExtraction,
  normalizeForQuote,
  type CareerExtraction,
} from './index.js';

const NOW = new Date('2026-10-13T00:00:00Z');
const RESUME = `Jane Doe — Software Engineer
EXPERIENCE
Frontend Engineer, Acme Corp — Lahore (Jan 2024 – Present)
• Built React dashboards used by the operations team.
• Upgraded the Angular app to v17 across “legacy” modules.
PROJECTS
Trailmap — a hiking planner
• Built a Next.js app with a PostgreSQL backend.
SKILLS: React, Angular, Next.js, PostgreSQL, Docker`;

const out = (over: Partial<CareerExtraction> = {}): CareerExtraction => ({
  roles: [
    {
      ref: 'R1',
      title: 'Frontend Engineer',
      company: 'Acme Corp',
      location: 'Lahore',
      start: '2024-01',
      end: null,
      current: true,
    },
  ],
  projects: [{ ref: 'P1', name: 'Trailmap', description: 'A hiking planner', role: null }],
  items: [
    {
      skill: 'React',
      category: 'FRAMEWORK',
      context: 'COMMERCIAL',
      depth: 'PRODUCTION',
      whatIDid: 'Built React dashboards used by the operations team.',
      role: 'R1',
      project: null,
      lastUsed: null,
    },
  ],
  listedSkills: [{ name: 'Docker', category: 'TOOL' }],
  ...over,
});

describe('checkCareerExtraction', () => {
  it('keeps roles, projects and items the resume states word for word', () => {
    const r = checkCareerExtraction(RESUME, out(), [], NOW);
    expect(r.roles).toEqual([expect.objectContaining({ title: 'Frontend Engineer', isCurrent: true, endDate: null })]);
    expect(r.projects).toEqual([expect.objectContaining({ name: 'Trailmap', roleRef: null })]);
    expect(r.items).toEqual([
      expect.objectContaining({ skill: 'React', context: 'COMMERCIAL', roleRef: 'R1', lastUsed: NOW }),
    ]);
    expect(r.dropped).toEqual([]);
  });

  it('drops an item that paraphrases instead of quoting, or names a skill the resume never does', () => {
    const r = checkCareerExtraction(
      RESUME,
      out({
        items: [
          { ...out().items[0]!, whatIDid: 'Led the React dashboard architecture for operations.' },
          { ...out().items[0]!, skill: 'Kubernetes' },
        ],
      }),
      [],
      NOW,
    );
    expect(r.items).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      "it isn't a quote from your resume",
      '"Kubernetes" isn\'t named in your resume',
    ]);
  });

  it('tolerates PDF text differences: case, bullets, curly quotes, trailing period', () => {
    const r = checkCareerExtraction(
      RESUME,
      out({
        items: [
          {
            ...out().items[0]!,
            skill: 'Angular',
            depth: 'MAINTENANCE',
            whatIDid: 'upgraded the Angular app to v17 across "legacy" modules',
          },
        ],
      }),
      [],
      NOW,
    );
    expect(r.items).toHaveLength(1);
  });

  it("drops a role whose company isn't in the resume, and work claimed as paid without a role", () => {
    const r = checkCareerExtraction(
      RESUME,
      out({
        roles: [{ ...out().roles[0]!, company: 'Globex' }],
        items: [{ ...out().items[0]!, role: 'R1' }],
      }),
      [],
      NOW,
    );
    expect(r.roles).toEqual([]);
    // Its role is gone, so the item can't be paid work.
    expect(r.items[0]).toMatchObject({ context: 'PERSONAL', roleRef: null });
  });

  it("puts a project's item under the project only, inheriting the project's role", () => {
    const r = checkCareerExtraction(
      RESUME,
      out({
        projects: [{ ref: 'P1', name: 'Trailmap', description: null, role: 'R1' }],
        items: [
          {
            ...out().items[0]!,
            skill: 'Next.js',
            context: 'PERSONAL',
            whatIDid: 'Built a Next.js app with a PostgreSQL backend.',
            role: null,
            project: 'P1',
          },
        ],
      }),
      [],
      NOW,
    );
    expect(r.items[0]).toMatchObject({ projectRef: 'P1', roleRef: null, context: 'COMMERCIAL' });
  });

  it('keeps listed skills the resume names, and drops invented ones', () => {
    const r = checkCareerExtraction(
      RESUME,
      out({
        listedSkills: [
          { name: 'Docker', category: 'TOOL' },
          { name: 'Terraform', category: 'TOOL' },
        ],
      }),
      [],
      NOW,
    );
    expect(r.listedSkills).toEqual([{ name: 'Docker', category: 'TOOL' }]);
    expect(r.dropped).toEqual([{ what: 'Terraform', reason: "it isn't named in your resume" }]);
  });

  it('refuses never-claim terms in their scope', () => {
    const r = checkCareerExtraction(RESUME, out(), [{ term: 'React', scope: 'PAID_WORK' }], NOW);
    expect(r.items).toEqual([]);
    expect(r.dropped[0]!.reason).toMatch(/never-claim/);
  });

  it('normalizes only presentation, never wording', () => {
    expect(normalizeForQuote('  “Built”  — React• apps. ')).toBe('"built" - react apps');
  });
});

describe('CAREER_EXTRACTION_JSON_SCHEMA', () => {
  it('stays in sync with the Zod schema', () => {
    const s = CAREER_EXTRACTION_JSON_SCHEMA;
    expect([...s.required].sort()).toEqual(Object.keys(CareerExtractionSchema.shape).sort());
    for (const k of ['roles', 'projects', 'items', 'listedSkills'] as const) {
      const props = (s.properties[k] as { items: { required: string[] } }).items.required;
      expect([...props].sort()).toEqual(Object.keys(CareerExtractionSchema.shape[k].element.shape).sort());
    }
  });
});
