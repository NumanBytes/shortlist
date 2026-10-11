// Deterministic job scoring (docs/ai-scoring.md §12.1). The model only reads the job and maps
// each requirement to the user's VERIFIED skills; this file turns that mapping into a
// score, verdict, gaps, strengths and risks. Same inputs, same output — always — and a
// change to evidence re-scores with no model call.

export type Context = 'COMMERCIAL' | 'PERSONAL' | 'ACADEMIC';
export type Depth = 'PRODUCTION' | 'WORKING' | 'MAINTENANCE' | 'EXPOSURE';
export type Importance = 'REQUIRED' | 'PREFERRED' | 'BONUS';
export type Verdict = 'APPLY' | 'STRETCH' | 'SKIP';
export type GapSeverity = 'BLOCKING' | 'MODERATE' | 'MINOR';

export interface ScoringEvidence {
  context: Context;
  depth: Depth;
  lastUsed: Date;
  source: string | null; // e.g. "CloudCard Inc." or "Manzil"
}

export interface ScoringSkill {
  id: string;
  name: string;
  evidence: ScoringEvidence[]; // VERIFIED evidence only — callers must filter
}

export interface ScoringRequirement {
  skillName: string;
  importance: Importance;
  isCore: boolean;
  yearsRequired: number | null;
  matchedSkillIds: string[];
  relatedSkillIds: string[];
}

export interface ScoreResult {
  overallScore: number;
  commercialScore: number;
  verdict: Verdict;
  strengths: string[];
  risks: string[];
  gaps: { skillName: string; severity: GapSeverity; note: string | null }[];
}

// How much one piece of evidence proves. Commercial shipped work counts most; personal
// working knowledge about half; exposure barely. Mirrors the spirit of §6.1.
const STRENGTH: Record<Context, Record<Depth, number>> = {
  COMMERCIAL: { PRODUCTION: 1.0, MAINTENANCE: 0.6, WORKING: 0.6, EXPOSURE: 0.3 },
  PERSONAL: { PRODUCTION: 0.7, WORKING: 0.5, MAINTENANCE: 0.4, EXPOSURE: 0.2 },
  ACADEMIC: { PRODUCTION: 0.4, WORKING: 0.4, MAINTENANCE: 0.3, EXPOSURE: 0.2 },
};
const WEIGHT: Record<Importance, number> = { REQUIRED: 3, PREFERRED: 1.5, BONUS: 0.5 };
const CORE_MULTIPLIER = 1.5;
const RELATED_CREDIT = 0.5;
const TWO_YEARS_MS = 2 * 365.25 * 24 * 3600 * 1000;

export const VERDICT_THRESHOLDS = { apply: 70, stretch: 45 } as const;

// Normalizes a skill name for equality only: case, punctuation, spaces, a trailing
// "js" ("React.js" = "React") and a plural "s" ("REST APIs" = "REST API").
export function normalizeSkillName(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z0-9+#]/g, '');
  if (n.length > 4 && n.endsWith('js')) n = n.slice(0, -2);
  if (n.length > 3 && n.endsWith('s')) n = n.slice(0, -1);
  return n;
}

// The model occasionally files an identically named skill as merely "related" (first real
// run: "Prompt Engineering" vs the verified "Prompt engineering"). A requirement whose name
// equals a verified skill's name is that skill — decided in code, not left to the model.
export function promoteExactNameMatches(
  requirements: ScoringRequirement[],
  skills: Pick<ScoringSkill, 'id' | 'name'>[],
): ScoringRequirement[] {
  const byName = new Map(skills.map((s) => [normalizeSkillName(s.name), s.id]));
  return requirements.map((r) => {
    const id = byName.get(normalizeSkillName(r.skillName));
    if (!id || r.matchedSkillIds.includes(id)) return r;
    return {
      ...r,
      matchedSkillIds: [...r.matchedSkillIds, id],
      relatedSkillIds: r.relatedSkillIds.filter((x) => x !== id),
    };
  });
}

export function evidenceStrength(e: ScoringEvidence, now: Date): number {
  const stale = now.getTime() - e.lastUsed.getTime() > TWO_YEARS_MS;
  // §6.1: EXPOSURE older than two years is omitted entirely; other stale evidence decays.
  if (stale && e.depth === 'EXPOSURE') return 0;
  return STRENGTH[e.context][e.depth] * (stale ? 0.6 : 1);
}

function best(skill: ScoringSkill | undefined, now: Date, commercialOnly: boolean) {
  let top: { strength: number; evidence: ScoringEvidence } | null = null;
  for (const e of skill?.evidence ?? []) {
    if (commercialOnly && e.context !== 'COMMERCIAL') continue;
    const strength = evidenceStrength(e, now);
    if (!top || strength > top.strength) top = { strength, evidence: e };
  }
  return top;
}

function satisfaction(req: ScoringRequirement, skills: Map<string, ScoringSkill>, now: Date, commercialOnly: boolean) {
  let exact = 0;
  let exactBest: { skill: ScoringSkill; evidence: ScoringEvidence } | null = null;
  for (const id of req.matchedSkillIds) {
    const b = best(skills.get(id), now, commercialOnly);
    if (b && b.strength > exact) {
      exact = b.strength;
      exactBest = { skill: skills.get(id)!, evidence: b.evidence };
    }
  }
  let related = 0;
  let relatedName: string | null = null;
  for (const id of req.relatedSkillIds) {
    const b = best(skills.get(id), now, commercialOnly);
    if (b && b.strength * RELATED_CREDIT > related) {
      related = b.strength * RELATED_CREDIT;
      relatedName = skills.get(id)!.name;
    }
  }
  return { value: Math.max(exact, related), exact, exactBest, related, relatedName };
}

const label = (e: ScoringEvidence) =>
  `${e.context.toLowerCase()} ${e.depth.toLowerCase()}${e.source ? `, ${e.source}` : ''}`;

export function scoreJob(input: {
  requirements: ScoringRequirement[];
  skills: ScoringSkill[];
  userCommercialYears: number;
  jobYearsRequired: number | null;
  redFlags: string[];
  now?: Date;
}): ScoreResult {
  const now = input.now ?? new Date();
  const skills = new Map(input.skills.map((s) => [s.id, s]));
  let total = 0;
  let got = 0;
  let gotCommercial = 0;
  const strengths: string[] = [];
  const gaps: ScoreResult['gaps'] = [];

  for (const req of input.requirements) {
    const weight = WEIGHT[req.importance] * (req.isCore ? CORE_MULTIPLIER : 1);
    total += weight;
    const all = satisfaction(req, skills, now, false);
    got += weight * all.value;
    gotCommercial += weight * satisfaction(req, skills, now, true).value;

    if (all.exactBest && all.exact >= all.related) {
      strengths.push(`${req.skillName} — ${all.exactBest.skill.name} (${label(all.exactBest.evidence)})`);
    }
    if (all.exact === 0) {
      const severity: GapSeverity = req.importance === 'REQUIRED' ? (req.isCore ? 'BLOCKING' : 'MODERATE') : 'MINOR';
      gaps.push({
        skillName: req.skillName,
        // A related skill softens the gap but never closes it (it isn't the same skill).
        severity: all.related > 0 && severity === 'BLOCKING' ? 'MODERATE' : severity,
        note: all.relatedName ? `related experience: ${all.relatedName}` : null,
      });
    }
  }

  const pct = (x: number) => (total === 0 ? 0 : Math.round((100 * x) / total));
  const overallScore = pct(got);
  const commercialScore = pct(gotCommercial);
  const blocking = gaps.filter((g) => g.severity === 'BLOCKING').length;

  const risks: string[] = [];
  const years = input.jobYearsRequired;
  const yearsShort = years !== null && years > input.userCommercialYears + 2;
  if (years !== null && years > input.userCommercialYears) {
    risks.push(`Asks for ${years}+ years; you have about ${input.userCommercialYears.toFixed(1)} commercial`);
  }
  for (const g of gaps.filter((x) => x.severity !== 'MINOR')) {
    risks.push(
      `${g.severity === 'BLOCKING' ? 'Missing core skill' : 'Missing'}: ${g.skillName}${g.note ? ` (${g.note})` : ''}`,
    );
  }
  for (const f of input.redFlags) risks.push(`Red flag: ${f}`);

  let verdict: Verdict;
  if (input.requirements.length === 0 || blocking >= 2 || overallScore < VERDICT_THRESHOLDS.stretch) verdict = 'SKIP';
  else if (overallScore >= VERDICT_THRESHOLDS.apply && blocking === 0 && !yearsShort && input.redFlags.length === 0)
    verdict = 'APPLY';
  else verdict = 'STRETCH';

  return { overallScore, commercialScore, verdict, strengths, risks, gaps };
}

// Years of commercial experience from role dates (overlapping roles not double-counted).
export function commercialYears(roles: { startDate: Date; endDate: Date | null }[], now = new Date()): number {
  const spans = roles
    .map((r) => [r.startDate.getTime(), (r.endDate ?? now).getTime()] as const)
    .sort((a, b) => a[0] - b[0]);
  let ms = 0;
  let cursor = -Infinity;
  for (const [start, end] of spans) {
    const from = Math.max(start, cursor);
    if (end > from) ms += end - from;
    cursor = Math.max(cursor, end);
  }
  return ms / (365.25 * 24 * 3600 * 1000);
}
