import { z } from 'zod';
import { normalizeSkillName, type Context, type Depth, type Importance } from './scoring.js';

// Resume tailoring (docs/resume.md §13). The model only words bullets and groups skills, citing
// evidence by short refs it was given; everything in this file is deterministic code that
// decides what it may cite (placement rules, §6.1) and throws out any bullet that claims
// more than its cited evidence says. The user's review is the final gate; this is the net.

// ── Placement rules (Agents.md §6.1) ──────────────────────────────────────────
export type ResumeSection = 'EXPERIENCE' | 'PROJECTS' | 'SKILLS';

const TWO_YEARS_MS = 2 * 365.25 * 24 * 3600 * 1000;

export function placementFor(e: { context: Context; depth: Depth; lastUsed: Date }, now = new Date()): ResumeSection[] {
  if (e.context === 'COMMERCIAL') {
    switch (e.depth) {
      case 'PRODUCTION':
        return ['EXPERIENCE', 'PROJECTS', 'SKILLS'];
      // Decided by the user 2026-10-02: Skills, and bullets worded as what was actually done.
      case 'WORKING':
        return ['EXPERIENCE', 'PROJECTS', 'SKILLS'];
      case 'MAINTENANCE':
        return ['EXPERIENCE', 'PROJECTS'];
      case 'EXPOSURE':
        return []; // open decision — placed nowhere until the user decides
    }
  }
  switch (e.depth) {
    case 'WORKING':
      return ['PROJECTS', 'SKILLS'];
    case 'EXPOSURE':
      return now.getTime() - e.lastUsed.getTime() < TWO_YEARS_MS ? ['SKILLS'] : [];
    default:
      return []; // PERSONAL/ACADEMIC + PRODUCTION/MAINTENANCE: open decision
  }
}

// ── What the model returns (shape only; meaning is checked by assembleResume) ──
// Skill lists hold S-refs; a model sometimes writes the skill's name instead, which
// assembleResume() resolves only against the skills it was offered — so allow names here.
const refList = z.array(z.string().max(60)).max(30);
const OutputBulletSchema = z.object({
  label: z.string().max(60).nullable(),
  text: z.string().min(1).max(400),
  evidence: z.array(z.string().max(10)).max(10),
});

export const ResumeOutputSchema = z.object({
  experience: z.array(z.object({ role: z.string().max(10), bullets: z.array(OutputBulletSchema).max(10) })).max(10),
  projects: z.array(z.object({ project: z.string().max(10), bullets: z.array(OutputBulletSchema).max(6) })).max(10),
  skillGroups: z.array(z.object({ label: z.string().min(1).max(40), skills: refList })).max(10),
  learning: refList,
});
export type ResumeOutput = z.infer<typeof ResumeOutputSchema>;

// Hand-written for the API's structured output, like JOB_ANALYSIS_JSON_SCHEMA (the Zod
// converter is unreliable). Kept in sync with ResumeOutputSchema by a test.
const stringList = { type: 'array', items: { type: 'string' } };
const BULLETS = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'text', 'evidence'],
    properties: { label: { type: ['string', 'null'] }, text: { type: 'string' }, evidence: stringList },
  },
};
export const RESUME_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['experience', 'projects', 'skillGroups', 'learning'],
  properties: {
    experience: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['role', 'bullets'], properties: { role: { type: 'string' }, bullets: BULLETS } },
    },
    projects: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['project', 'bullets'], properties: { project: { type: 'string' }, bullets: BULLETS } },
    },
    skillGroups: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['label', 'skills'], properties: { label: { type: 'string' }, skills: stringList } },
    },
    learning: stringList,
  },
} as const;

// ── What is stored (ResumeVariant.content) ────────────────────────────────────
const BulletSchema = z.object({ label: z.string().nullable(), text: z.string(), evidenceIds: z.array(z.string()) });
export const ResumeContentSchema = z.object({
  experience: z.array(
    z.object({
      workExperienceId: z.string(),
      title: z.string(),
      company: z.string(),
      location: z.string().nullable(),
      startDate: z.string(),
      endDate: z.string().nullable(),
      isCurrent: z.boolean(),
      bullets: z.array(BulletSchema),
    }),
  ),
  projects: z.array(z.object({ projectId: z.string(), name: z.string(), bullets: z.array(BulletSchema) })),
  skillGroups: z.array(z.object({ label: z.string(), skills: z.array(z.object({ id: z.string(), name: z.string() })) })),
  // Bullets the checks removed, with the reason — shown to the user, never printed.
  dropped: z.array(z.object({ where: z.string(), text: z.string(), reason: z.string() })),
});
export type ResumeContent = z.infer<typeof ResumeContentSchema>;
export type ResumeBullet = z.infer<typeof BulletSchema>;

export const LEARNING_GROUP_LABEL = 'Learning';
export const MAX_BULLETS_PER_ROLE = 6;
export const MAX_BULLETS_PER_PROJECT = 3;

// ── Inputs to assembly ────────────────────────────────────────────────────────
export interface ResumeEvidence {
  id: string;
  skillId: string;
  skillName: string;
  context: Context;
  depth: Depth;
  lastUsed: Date;
  whatIDid: string;
  workExperienceId: string | null;
  projectId: string | null;
  projectRoleId: string | null; // the role a linked project belongs to, if any
}
export interface ResumeRole {
  id: string;
  title: string;
  company: string;
  location: string | null;
  startDate: Date;
  endDate: Date | null;
  isCurrent: boolean;
}
export interface ResumeProject {
  id: string;
  name: string;
  workExperienceId: string | null;
}
export interface ResumeRefs {
  evidence: Map<string, string>; // "E3" -> evidence id
  roles: Map<string, string>; // "R1" -> role id
  projects: Map<string, string>; // "P2" -> project id
  skills: Map<string, string>; // "S7" -> skill id
}
export interface AssembleInput {
  output: ResumeOutput;
  refs: ResumeRefs;
  evidence: ResumeEvidence[]; // VERIFIED only — callers must filter
  roles: ResumeRole[];
  projects: ResumeProject[];
  // Names a bullet must not mention without citing evidence for: the user's skills and
  // the job's requirements ("AWS / GCP" counts as each option).
  policedNames: string[];
  // Job requirement names → the user's skills the analysis matched exactly. Lets a bullet
  // citing React say "React.js" when the posting does.
  requirementAliases: { name: string; skillIds: string[] }[];
  now?: Date;
}

export interface AssembleResult {
  content: ResumeContent;
  evidenceIds: string[]; // everything the resume relies on; staleness is derived from these
}

// ── Checks ────────────────────────────────────────────────────────────────────
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Where `name` appears in `text` as a whole term. Short names ("Go", "C") are matched
// case-sensitively so ordinary words ("go live") don't count as claims.
export function mentionSpans(text: string, name: string): [number, number][] {
  const variants = new Set([name.trim()]);
  if (/\.js$/i.test(name)) variants.add(name.replace(/\.js$/i, ''));
  const spans: [number, number][] = [];
  for (const v of variants) {
    if (!v) continue;
    const flags = v.replace(/[^A-Za-z0-9]/g, '').length >= 4 ? 'gi' : 'g';
    const re = new RegExp(`(?<![A-Za-z0-9+#])${escapeRe(v)}(?![A-Za-z0-9+#])`, flags);
    for (const m of text.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

// Numbers that stand on their own ("2 years", "40%", "1,200"), compared whole. Digits
// inside a word are part of a name ("B2C", "HTML5", "S3"), not a claim — matching them
// as substrings let "2 years" pass because the evidence said "B2C" (code review).
export function standaloneNumbers(text: string): string[] {
  return text.match(/(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)*(?![A-Za-z0-9])/g) ?? [];
}

const splitOptions = (name: string) =>
  name
    .split(/\s+\/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 40);

// Verbs that claim building or owning something. "Working" and "maintenance" evidence
// doesn't support them unless the user's own words use them.
const STRONG_VERBS: Record<string, string[]> = {
  built: ['built', 'build'],
  building: ['build', 'built'],
  architected: ['architect'],
  designed: ['design'],
  led: ['led', 'lead'],
  owned: ['owned', 'own '],
  developed: ['develop'],
  developing: ['develop'],
  created: ['creat'],
  implemented: ['implement'],
  engineered: ['engineer'],
  launched: ['launch'],
  shipped: ['ship'],
  spearheaded: ['spearhead'],
};

type Where = { kind: 'EXPERIENCE'; roleId: string; commercial: true } | { kind: 'PROJECTS'; projectId: string; commercial: boolean };

interface CheckContext {
  byId: Map<string, ResumeEvidence>;
  refs: ResumeRefs;
  policed: string[];
  aliases: { name: string; skillIds: string[] }[];
  now: Date;
}

export function checkBullet(
  b: ResumeOutput['experience'][number]['bullets'][number],
  where: Where,
  ctx: CheckContext,
): { ok: true; bullet: ResumeBullet } | { ok: false; reason: string } {
  const text = b.text.trim();
  const label = b.label?.trim() || null;
  const full = `${label ?? ''} ${text}`;

  if (b.evidence.length === 0) return { ok: false, reason: 'cites no evidence' };
  const ids: string[] = [];
  for (const ref of new Set(b.evidence.map((r) => r.trim()))) {
    const id = ctx.refs.evidence.get(ref);
    if (!id || !ctx.byId.has(id)) return { ok: false, reason: `cites "${ref}", which isn't one of your verified items` };
    ids.push(id);
  }
  const cited = ids.map((id) => ctx.byId.get(id)!);

  for (const e of cited) {
    const placedHere = placementFor(e, ctx.now).includes(where.kind);
    const belongs =
      where.kind === 'EXPERIENCE'
        ? e.workExperienceId === where.roleId || e.projectRoleId === where.roleId
        : e.projectId === where.projectId;
    if (!placedHere || !belongs) {
      const level = `${e.context.toLowerCase()} ${e.depth.toLowerCase()}`;
      return { ok: false, reason: `uses your ${e.skillName} item (${level}), which can't appear here` };
    }
  }

  // Known false claims (docs/career-data.md §7.2) — refused whatever is cited.
  if (/azure/i.test(full)) return { ok: false, reason: 'mentions Azure, a known false claim' };
  if (where.commercial && /(?<![A-Za-z])(node(\.js)?|express(\.js)?)(?![A-Za-z])/i.test(full)) {
    return { ok: false, reason: 'mentions Node.js/Express in paid work, where they were never used' };
  }

  const source = cited.map((e) => e.whatIDid).join('\n');
  const stated = new Set(standaloneNumbers(source));
  for (const n of standaloneNumbers(full)) {
    if (!stated.has(n)) return { ok: false, reason: `adds "${n}", which isn't in your evidence` };
  }

  // Every technology the bullet names must be one it cites (or one the cited items'
  // own words name). Matches inside a covered mention ("APIs" in "REST APIs") don't count.
  const citedSkillIds = new Set(cited.map((e) => e.skillId));
  const covered = new Set(cited.map((e) => normalizeSkillName(e.skillName)));
  for (const a of ctx.aliases) {
    if (a.skillIds.some((id) => citedSkillIds.has(id))) for (const o of splitOptions(a.name)) covered.add(normalizeSkillName(o));
  }
  for (const n of ctx.policed) if (mentionSpans(source, n).length) covered.add(normalizeSkillName(n));
  const coveredSpans = ctx.policed
    .filter((n) => covered.has(normalizeSkillName(n)))
    .flatMap((n) => mentionSpans(full, n));
  for (const n of ctx.policed) {
    if (covered.has(normalizeSkillName(n))) continue;
    const inside = (s: [number, number]) => coveredSpans.some(([a, z]) => a <= s[0] && s[1] <= z);
    if (mentionSpans(full, n).some((s) => !inside(s))) return { ok: false, reason: `mentions ${n} without citing evidence for it` };
  }

  if (!cited.some((e) => e.depth === 'PRODUCTION')) {
    const lowerSource = source.toLowerCase();
    for (const w of full.toLowerCase().match(/[a-z]+/g) ?? []) {
      const roots = STRONG_VERBS[w];
      if (roots && !roots.some((r) => lowerSource.includes(r))) {
        return { ok: false, reason: `says "${w}", but the evidence it cites is working-level or maintenance` };
      }
    }
  }

  return { ok: true, bullet: { label, text, evidenceIds: ids } };
}

// Turns the model's output into stored resume content, keeping only what the checks allow.
export function assembleResume(input: AssembleInput): AssembleResult {
  const now = input.now ?? new Date();
  const byId = new Map(input.evidence.map((e) => [e.id, e]));
  const policed = [...new Set([...input.policedNames.flatMap(splitOptions)])];
  const ctx: CheckContext = { byId, refs: input.refs, policed, aliases: input.requirementAliases, now };
  const dropped: ResumeContent['dropped'] = [];
  const used = new Set<string>();

  const keep = (bullets: ResumeOutput['experience'][number]['bullets'], where: Where, place: string, max: number) => {
    const out: ResumeBullet[] = [];
    for (const b of bullets) {
      const r = checkBullet(b, where, ctx);
      if (!r.ok) dropped.push({ where: place, text: b.text, reason: r.reason });
      else if (out.length >= max) dropped.push({ where: place, text: b.text, reason: 'over the bullet limit' });
      else out.push(r.bullet);
    }
    return out;
  };

  // Every role is listed (a resume doesn't hide jobs), newest first; bullets from the model.
  const roleById = new Map(input.roles.map((r) => [r.id, r]));
  const roleBullets = new Map<string, ResumeOutput['experience'][number]['bullets']>();
  for (const x of input.output.experience) {
    const id = input.refs.roles.get(x.role.trim());
    if (!id || !roleById.has(id)) {
      for (const b of x.bullets) dropped.push({ where: x.role, text: b.text, reason: 'for a role that is not yours' });
      continue;
    }
    roleBullets.set(id, [...(roleBullets.get(id) ?? []), ...x.bullets]);
  }
  const experience = [...input.roles]
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
    .map((r) => {
      const place = `${r.title}, ${r.company}`;
      const bullets = keep(roleBullets.get(r.id) ?? [], { kind: 'EXPERIENCE', roleId: r.id, commercial: true }, place, MAX_BULLETS_PER_ROLE);
      return {
        workExperienceId: r.id,
        title: r.title,
        company: r.company,
        location: r.location,
        startDate: r.startDate.toISOString(),
        endDate: r.endDate?.toISOString() ?? null,
        isCurrent: r.isCurrent,
        bullets,
      };
    });

  // Projects: the model's choice and order; a project with no surviving bullet is left out.
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  const seenProjects = new Set<string>();
  const projects: ResumeContent['projects'] = [];
  for (const x of input.output.projects) {
    const id = input.refs.projects.get(x.project.trim());
    const p = id ? projectById.get(id) : undefined;
    if (!p || seenProjects.has(p.id)) continue;
    seenProjects.add(p.id);
    const where: Where = { kind: 'PROJECTS', projectId: p.id, commercial: p.workExperienceId !== null };
    const bullets = keep(x.bullets, where, p.name, MAX_BULLETS_PER_PROJECT);
    if (bullets.length) projects.push({ projectId: p.id, name: p.name, bullets });
  }

  for (const b of [...experience, ...projects].flatMap((s) => s.bullets)) for (const id of b.evidenceIds) used.add(id);

  // Skills: only skills with verified evidence placeable in Skills. Skills known only at
  // exposure level go in a "Learning" group the code labels, whatever the model did.
  const eligible = new Map<string, { name: string; items: ResumeEvidence[] }>();
  for (const e of input.evidence) {
    if (!placementFor(e, now).includes('SKILLS')) continue;
    const s = eligible.get(e.skillId) ?? { name: e.skillName, items: [] };
    s.items.push(e);
    eligible.set(e.skillId, s);
  }
  const learningOnly = (id: string) => eligible.get(id)!.items.every((e) => e.depth === 'EXPOSURE');
  const listed = new Set<string>();
  // A skill may come back as its S-ref or, when the model slips, as its exact name — but
  // only a skill that was offered (it has an S-ref). An unknown name is dropped like an
  // unknown ref, so this can't list anything new (2026-10-04: one slip failed a paid run).
  const offeredByName = new Map<string, string>();
  for (const id of input.refs.skills.values()) {
    const name = eligible.get(id)?.name;
    if (name) offeredByName.set(name.trim().toLowerCase(), id);
  }
  const take = (ref: string) => {
    const id = input.refs.skills.get(ref.trim()) ?? offeredByName.get(ref.trim().toLowerCase());
    if (!id || !eligible.has(id) || listed.has(id)) return null;
    listed.add(id);
    for (const e of eligible.get(id)!.items) used.add(e.id);
    return { id, name: eligible.get(id)!.name };
  };
  const learning: { id: string; name: string }[] = [];
  const other: { id: string; name: string }[] = [];
  const skillGroups: ResumeContent['skillGroups'] = [];
  const isLearningLabel = (l: string) => l.toLowerCase() === LEARNING_GROUP_LABEL.toLowerCase();
  for (const g of input.output.skillGroups) {
    const skills: { id: string; name: string }[] = [];
    for (const ref of g.skills) {
      const s = take(ref);
      if (s) (learningOnly(s.id) ? learning : skills).push(s);
    }
    const label = g.label.trim();
    if (!skills.length) continue;
    if (isLearningLabel(label)) other.push(...skills);
    else skillGroups.push({ label, skills });
  }
  for (const ref of input.output.learning) {
    const s = take(ref);
    if (s) (learningOnly(s.id) ? learning : other).push(s);
  }
  if (other.length) skillGroups.push({ label: 'Other', skills: other });
  if (learning.length) skillGroups.push({ label: LEARNING_GROUP_LABEL, skills: learning });

  return {
    content: { experience, projects, skillGroups, dropped },
    evidenceIds: [...used].sort(),
  };
}

// ── Reuse (docs/resume.md §13.2) ───────────────────────────────────────────────────
// Plain code, no AI: how much of a job's requirement list a stored variant was built for.
export function requirementProfile(requirements: { skillName: string }[]): string[] {
  return [...new Set(requirements.flatMap((r) => splitOptions(r.skillName).map(normalizeSkillName)))].sort();
}

export function resumeOverlap(
  job: { skillName: string; importance: Importance }[],
  profile: string[],
): { overlap: number; missingRequired: string[] } {
  const have = new Set(profile);
  const jobNames = requirementProfile(job);
  if (jobNames.length === 0) return { overlap: 0, missingRequired: [] };
  const covered = jobNames.filter((n) => have.has(n)).length;
  const missingRequired = job
    .filter((r) => r.importance === 'REQUIRED' && !splitOptions(r.skillName).some((o) => have.has(normalizeSkillName(o))))
    .map((r) => r.skillName);
  return { overlap: covered / jobNames.length, missingRequired };
}

// ── API request bodies ────────────────────────────────────────────────────────
export const PrepareResumeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('tailor') }).strict(),
  z.object({ mode: z.literal('reuse'), variantId: z.string().uuid() }).strict(),
]);
export type PrepareResumeInput = z.infer<typeof PrepareResumeSchema>;
