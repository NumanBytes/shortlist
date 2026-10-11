import {
  JOB_ANALYSIS_JSON_SCHEMA,
  ImportanceEnum,
  JobAnalysisOutputSchema,
  SeniorityEnum,
  commercialYears,
  costUsd,
  normalizeSkillName,
  promoteExactNameMatches,
  evidenceStrength,
  scoreJob,
  type ScoringRequirement,
  type ScoringSkill,
} from './index.js';

const NOW = new Date('2026-10-02T00:00:00Z');
const recent = new Date('2026-09-01T00:00:00Z');
const old = new Date('2022-01-01T00:00:00Z');

const skills: ScoringSkill[] = [
  {
    id: 'react',
    name: 'React',
    evidence: [{ context: 'COMMERCIAL', depth: 'PRODUCTION', lastUsed: recent, source: 'CloudCard Inc.' }],
  },
  {
    id: 'ts',
    name: 'TypeScript',
    evidence: [{ context: 'COMMERCIAL', depth: 'PRODUCTION', lastUsed: recent, source: 'CloudCard Inc.' }],
  },
  {
    id: 'node',
    name: 'Node.js',
    evidence: [{ context: 'PERSONAL', depth: 'WORKING', lastUsed: recent, source: null }],
  },
  { id: 'python', name: 'Python', evidence: [{ context: 'ACADEMIC', depth: 'EXPOSURE', lastUsed: old, source: null }] },
  {
    id: 'pg',
    name: 'PostgreSQL',
    evidence: [{ context: 'COMMERCIAL', depth: 'PRODUCTION', lastUsed: recent, source: 'CloudCard Inc.' }],
  },
];

const req = (over: Partial<ScoringRequirement> & Pick<ScoringRequirement, 'skillName'>): ScoringRequirement => ({
  importance: 'REQUIRED',
  isCore: false,
  yearsRequired: null,
  matchedSkillIds: [],
  relatedSkillIds: [],
  ...over,
});

const score = (requirements: ScoringRequirement[], extra: Partial<Parameters<typeof scoreJob>[0]> = {}) =>
  scoreJob({
    requirements,
    skills,
    userCommercialYears: 2.4,
    jobYearsRequired: null,
    redFlags: [],
    now: NOW,
    ...extra,
  });

describe('evidenceStrength', () => {
  it('ranks commercial production above personal working above academic exposure', () => {
    const e = (context: 'COMMERCIAL' | 'PERSONAL' | 'ACADEMIC', depth: 'PRODUCTION' | 'WORKING' | 'EXPOSURE') =>
      evidenceStrength({ context, depth, lastUsed: recent, source: null }, NOW);
    expect(e('COMMERCIAL', 'PRODUCTION')).toBe(1);
    expect(e('PERSONAL', 'WORKING')).toBe(0.5);
    expect(e('ACADEMIC', 'EXPOSURE')).toBe(0.2);
  });

  it('drops EXPOSURE older than two years to zero (§6.1) and decays other stale evidence', () => {
    expect(evidenceStrength({ context: 'ACADEMIC', depth: 'EXPOSURE', lastUsed: old, source: null }, NOW)).toBe(0);
    expect(
      evidenceStrength({ context: 'COMMERCIAL', depth: 'PRODUCTION', lastUsed: old, source: null }, NOW),
    ).toBeCloseTo(0.6);
  });
});

describe('scoreJob', () => {
  it('a job you fully match commercially is APPLY at 100', () => {
    const r = score([
      req({ skillName: 'React', isCore: true, matchedSkillIds: ['react'] }),
      req({ skillName: 'TypeScript', matchedSkillIds: ['ts'] }),
    ]);
    expect(r).toMatchObject({ overallScore: 100, commercialScore: 100, verdict: 'APPLY', gaps: [] });
    expect(r.strengths[0]).toBe('React — React (commercial production, CloudCard Inc.)');
  });

  it('counts personal experience in the overall score but not the commercial one', () => {
    const r = score([req({ skillName: 'Node.js', matchedSkillIds: ['node'] })]);
    expect(r.overallScore).toBe(50);
    expect(r.commercialScore).toBe(0);
  });

  it('gives related experience half credit, never full credit, and still lists the gap', () => {
    const r = score([req({ skillName: 'MySQL', isCore: true, relatedSkillIds: ['pg'] })]);
    expect(r.overallScore).toBe(50);
    expect(r.gaps).toEqual([{ skillName: 'MySQL', severity: 'MODERATE', note: 'related experience: PostgreSQL' }]);
    expect(r.strengths).toEqual([]); // MySQL is never claimed
  });

  it('treats a missing core required skill as BLOCKING', () => {
    const r = score([
      req({ skillName: 'React', isCore: true, matchedSkillIds: ['react'] }),
      req({ skillName: 'Go', isCore: true }),
    ]);
    expect(r.gaps).toEqual([{ skillName: 'Go', severity: 'BLOCKING', note: null }]);
    expect(r.verdict).toBe('STRETCH');
    expect(r.risks).toContain('Missing core skill: Go');
  });

  it('two blocking gaps mean SKIP regardless of score', () => {
    const r = score([
      req({ skillName: 'React', isCore: true, matchedSkillIds: ['react'] }),
      req({ skillName: 'TypeScript', isCore: true, matchedSkillIds: ['ts'] }),
      req({ skillName: 'PostgreSQL', isCore: true, matchedSkillIds: ['pg'] }),
      req({ skillName: 'Go', isCore: true }),
      req({ skillName: 'Kubernetes', isCore: true }),
    ]);
    expect(r.verdict).toBe('SKIP');
  });

  it('weights REQUIRED above PREFERRED above BONUS', () => {
    const missingRequired = score([
      req({ skillName: 'React', importance: 'PREFERRED', matchedSkillIds: ['react'] }),
      req({ skillName: 'Go', importance: 'REQUIRED' }),
    ]);
    const missingBonus = score([
      req({ skillName: 'React', importance: 'REQUIRED', matchedSkillIds: ['react'] }),
      req({ skillName: 'Go', importance: 'BONUS' }),
    ]);
    expect(missingBonus.overallScore).toBeGreaterThan(missingRequired.overallScore);
    expect(missingBonus.gaps[0]!.severity).toBe('MINOR');
  });

  it('stale academic exposure earns nothing', () => {
    const r = score([req({ skillName: 'Python', matchedSkillIds: ['python'] })]);
    expect(r.overallScore).toBe(0);
    expect(r.verdict).toBe('SKIP');
  });

  it('a years requirement far above yours caps the verdict at STRETCH and is a stated risk', () => {
    const r = score([req({ skillName: 'React', matchedSkillIds: ['react'] })], { jobYearsRequired: 6 });
    expect(r.verdict).toBe('STRETCH');
    expect(r.risks[0]).toBe('Asks for 6+ years; you have about 2.4 commercial');
  });

  it('a red flag blocks APPLY and is listed', () => {
    const r = score([req({ skillName: 'React', matchedSkillIds: ['react'] })], {
      redFlags: ['asks for a registration fee'],
    });
    expect(r.verdict).toBe('STRETCH');
    expect(r.risks).toContain('Red flag: asks for a registration fee');
  });

  it('ignores references to skills that are not in the verified set', () => {
    const r = score([req({ skillName: 'Azure', matchedSkillIds: ['azure-b2c'] })]);
    expect(r.overallScore).toBe(0);
    expect(r.gaps[0]!.skillName).toBe('Azure');
  });

  it('is deterministic', () => {
    const reqs = [req({ skillName: 'React', matchedSkillIds: ['react'] }), req({ skillName: 'Go' })];
    expect(score(reqs)).toEqual(score(reqs));
  });
});

describe('exact-name matching', () => {
  it('normalizes case, punctuation, ".js" and plurals — for equality only', () => {
    expect(normalizeSkillName('Prompt Engineering')).toBe(normalizeSkillName('Prompt engineering'));
    expect(normalizeSkillName('React.js')).toBe(normalizeSkillName('React'));
    expect(normalizeSkillName('REST APIs')).toBe(normalizeSkillName('REST API'));
    expect(normalizeSkillName('Node.js')).toBe(normalizeSkillName('NodeJS'));
    expect(normalizeSkillName('C++')).not.toBe(normalizeSkillName('C#'));
    expect(normalizeSkillName('Java')).not.toBe(normalizeSkillName('JavaScript'));
  });

  it('promotes an identically named skill from "related" to "same" (first real run)', () => {
    const [r] = promoteExactNameMatches(
      [req({ skillName: 'Prompt Engineering', relatedSkillIds: ['pe'] })],
      [{ id: 'pe', name: 'Prompt engineering' }],
    );
    expect(r).toMatchObject({ matchedSkillIds: ['pe'], relatedSkillIds: [] });
  });

  it('leaves requirements without an identically named skill alone', () => {
    const reqs = [req({ skillName: 'Vue', relatedSkillIds: ['react'] })];
    expect(promoteExactNameMatches(reqs, [{ id: 'react', name: 'React' }])).toEqual(reqs);
  });
});

describe('commercialYears', () => {
  it('sums roles without double-counting overlaps, counting a current role to now', () => {
    const years = commercialYears(
      [
        { startDate: new Date('2024-05-01'), endDate: null },
        { startDate: new Date('2024-06-01'), endDate: new Date('2024-12-01') }, // overlaps
      ],
      NOW,
    );
    expect(years).toBeCloseTo(2.42, 1);
  });
});

describe('costUsd', () => {
  it('prices the dated model ID by its alias', () => {
    expect(costUsd('claude-haiku-4-5-20251001', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(1);
    expect(costUsd('claude-haiku-4-5', { inputTokens: 2000, outputTokens: 500 })).toBeCloseTo(0.0045);
  });

  it('refuses to guess a price for an unknown model', () => {
    expect(() => costUsd('claude-unknown-1', { inputTokens: 1, outputTokens: 1 })).toThrow(/No price/);
  });
});

describe('JSON schema stays in sync with the Zod schema', () => {
  it('has the same enums and required fields', () => {
    const s = JOB_ANALYSIS_JSON_SCHEMA;
    expect(s.properties.seniority.enum).toEqual(SeniorityEnum.options);
    expect(s.properties.requirements.items.properties.importance.enum).toEqual(ImportanceEnum.options);
    expect([...s.required].sort()).toEqual(Object.keys(JobAnalysisOutputSchema.shape).sort());
    expect([...s.properties.requirements.items.required].sort()).toEqual(
      Object.keys(JobAnalysisOutputSchema.shape.requirements.element.shape).sort(),
    );
  });
});
