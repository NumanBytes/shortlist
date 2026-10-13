import { placementFor, requirementProfile, resumeOverlap } from './resume.js';

// The pure rules behind tailoring. The prompt-to-assembly checks stay in the worker's
// resume.spec.ts, because they cite the refs the worker's prompt actually hands out.
const NOW = new Date('2026-10-02T00:00:00Z');
const recent = new Date('2026-09-01T00:00:00Z');
const old = new Date('2023-07-01T00:00:00Z');

describe('placementFor (Agents.md §6.1)', () => {
  it.each([
    ['COMMERCIAL', 'PRODUCTION', recent, ['EXPERIENCE', 'PROJECTS', 'SKILLS']],
    ['COMMERCIAL', 'WORKING', recent, ['EXPERIENCE', 'PROJECTS', 'SKILLS']],
    ['COMMERCIAL', 'MAINTENANCE', recent, ['EXPERIENCE', 'PROJECTS']],
    ['COMMERCIAL', 'EXPOSURE', recent, []],
    ['PERSONAL', 'WORKING', recent, ['PROJECTS', 'SKILLS']],
    ['ACADEMIC', 'WORKING', recent, ['PROJECTS', 'SKILLS']],
    ['PERSONAL', 'EXPOSURE', recent, ['SKILLS']],
    ['ACADEMIC', 'EXPOSURE', old, []],
    ['PERSONAL', 'PRODUCTION', recent, ['PROJECTS', 'SKILLS']],
    ['ACADEMIC', 'PRODUCTION', recent, []],
    ['PERSONAL', 'MAINTENANCE', recent, []],
  ] as const)('%s + %s', (context, depth, lastUsed, expected) => {
    expect(placementFor({ context, depth, lastUsed }, NOW)).toEqual(expected);
  });
});

describe('reuse overlap (docs/resume.md §13.2)', () => {
  const profile = requirementProfile([
    { skillName: 'React.js' },
    { skillName: 'TypeScript' },
    { skillName: 'REST APIs' },
    { skillName: 'AWS / GCP' },
  ]);

  it('normalizes names and splits alternatives', () => {
    expect(profile).toEqual(['aws', 'gcp', 'react', 'restapi', 'typescript']);
  });

  it('measures the share of the new job covered and lists uncovered REQUIRED items', () => {
    const r = resumeOverlap(
      [
        { skillName: 'React', importance: 'REQUIRED' },
        { skillName: 'TypeScript', importance: 'REQUIRED' },
        { skillName: 'GraphQL', importance: 'REQUIRED' },
        { skillName: 'REST API', importance: 'PREFERRED' },
      ],
      profile,
    );
    expect(r.overlap).toBe(0.75);
    expect(r.missingRequired).toEqual(['GraphQL']);
  });

  it("measures how much of the resume's own profile the new job asks for", () => {
    // A resume built for 5 names; a job asking for 2 of them is fully covered but off-focus.
    const narrow = resumeOverlap(
      [
        { skillName: 'React', importance: 'REQUIRED' },
        { skillName: 'TypeScript', importance: 'REQUIRED' },
      ],
      profile,
    );
    expect(narrow).toMatchObject({ overlap: 1, focus: 0.4 });
  });

  it('is zero for a job with no requirements (never reuse blindly)', () => {
    expect(resumeOverlap([], profile).overlap).toBe(0);
  });
});

describe('mentionsTerm (never-claim matching, docs/resume.md §13.8)', () => {
  it('matches the term as a whole word, with or without dots', async () => {
    const { mentionsTerm } = await import('./resume.js');
    expect(mentionsTerm('Shipped on Azure B2C', 'Azure')).toBe(true);
    expect(mentionsTerm('An Azure-based login', 'Azure')).toBe(true);
    expect(mentionsTerm('A NodeJS service', 'Node.js')).toBe(true);
    expect(mentionsTerm('Built the Express.js API', 'Express')).toBe(true);
    // Whole words only, so "expressive" isn't Express — and "AzureAD" isn't Azure: a user who
    // needs that refused adds it as its own entry.
    expect(mentionsTerm('An expressive UI', 'Express')).toBe(false);
    expect(mentionsTerm('Signed in with AzureAD', 'Azure')).toBe(false);
  });
});
