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
    ['PERSONAL', 'PRODUCTION', recent, []],
    ['PERSONAL', 'MAINTENANCE', recent, []],
  ] as const)('%s + %s', (context, depth, lastUsed, expected) => {
    expect(placementFor({ context, depth, lastUsed }, NOW)).toEqual(expected);
  });
});

describe('reuse overlap (docs/resume.md §13.2)', () => {
  const profile = requirementProfile([{ skillName: 'React.js' }, { skillName: 'TypeScript' }, { skillName: 'REST APIs' }, { skillName: 'AWS / GCP' }]);

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

  it('is zero for a job with no requirements (never reuse blindly)', () => {
    expect(resumeOverlap([], profile).overlap).toBe(0);
  });
});
