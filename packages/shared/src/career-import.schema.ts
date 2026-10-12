import { z } from 'zod';
import type { NeverClaimScope } from './never-claim.schema.js';
import { mentionsTerm } from './resume.js';

// Resume import (docs/career-data.md §7.6). The same split as everywhere else: the model READS
// the resume and proposes roles, projects and evidence; code keeps only what the resume says
// word for word, and everything is stored UNVERIFIED for the user to confirm.

// ── Request (the web app extracts the PDF's text in the browser) ─────────────────
export const MAX_RESUME_TEXT = 30_000;
export const ImportResumeSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(200, "That's too short for a resume — check the PDF had selectable text")
      .max(MAX_RESUME_TEXT, 'That is longer than a resume — paste only the resume'),
  })
  .strict();
export type ImportResumeInput = z.infer<typeof ImportResumeSchema>;

// ── What the model returns ───────────────────────────────────────────────────────
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const Ref = z.string().max(10);
export const SkillCategoryEnum = z.enum([
  'LANGUAGE',
  'FRAMEWORK',
  'LIBRARY',
  'DATABASE',
  'TOOL',
  'PLATFORM',
  'CONCEPT',
]);
export const EvidenceContextEnum = z.enum(['COMMERCIAL', 'PERSONAL', 'ACADEMIC']);
export const EvidenceDepthEnum = z.enum(['PRODUCTION', 'WORKING', 'MAINTENANCE', 'EXPOSURE']);

export const CareerExtractionSchema = z.object({
  roles: z
    .array(
      z.object({
        ref: Ref,
        title: z.string().min(1).max(120),
        company: z.string().min(1).max(120),
        location: z.string().max(120).nullable(),
        start: Month,
        end: Month.nullable(),
        current: z.boolean(),
      }),
    )
    .max(20),
  projects: z
    .array(
      z.object({
        ref: Ref,
        name: z.string().min(1).max(100),
        description: z.string().max(400).nullable(),
        role: Ref.nullable(),
      }),
    )
    .max(30),
  items: z
    .array(
      z.object({
        skill: z.string().min(1).max(60),
        category: SkillCategoryEnum,
        context: EvidenceContextEnum,
        depth: EvidenceDepthEnum,
        whatIDid: z.string().min(1).max(600),
        role: Ref.nullable(),
        project: Ref.nullable(),
        lastUsed: Month.nullable(),
      }),
    )
    .max(150),
  // Skills named only in a skills list, with no sentence to quote: stored as skills with no
  // evidence, so the user can add what they did with each in their own words.
  listedSkills: z.array(z.object({ name: z.string().min(1).max(60), category: SkillCategoryEnum })).max(100),
});
export type CareerExtraction = z.infer<typeof CareerExtractionSchema>;

// Hand-written for the API's structured output (see JOB_ANALYSIS_JSON_SCHEMA); a test keeps
// it in sync with the Zod schema, which still validates every response.
const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export const CAREER_EXTRACTION_JSON_SCHEMA = obj({
  roles: {
    type: 'array',
    items: obj({
      ref: str,
      title: str,
      company: str,
      location: nullableStr,
      start: str,
      end: nullableStr,
      current: { type: 'boolean' },
    }),
  },
  projects: { type: 'array', items: obj({ ref: str, name: str, description: nullableStr, role: nullableStr }) },
  items: {
    type: 'array',
    items: obj({
      skill: str,
      category: { type: 'string', enum: SkillCategoryEnum.options },
      context: { type: 'string', enum: EvidenceContextEnum.options },
      depth: { type: 'string', enum: EvidenceDepthEnum.options },
      whatIDid: str,
      role: nullableStr,
      project: nullableStr,
      lastUsed: nullableStr,
    }),
  },
  listedSkills: {
    type: 'array',
    items: obj({ name: str, category: { type: 'string', enum: SkillCategoryEnum.options } }),
  },
});

// ── The check: keep only what the resume says ────────────────────────────────────
// Case, whitespace, bullet glyphs, curly quotes and dash variants differ between a PDF's
// text layer and the model's copy; nothing else may.
export function normalizeForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[•●▪◦‣⁃·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;,]+$/, '');
}

export interface CheckedRole {
  ref: string;
  title: string;
  company: string;
  location: string | null;
  startDate: Date;
  endDate: Date | null;
  isCurrent: boolean;
}
export interface CheckedProject {
  ref: string;
  name: string;
  description: string | null;
  roleRef: string | null;
}
export interface CheckedItem {
  skill: string;
  category: z.infer<typeof SkillCategoryEnum>;
  context: z.infer<typeof EvidenceContextEnum>;
  depth: z.infer<typeof EvidenceDepthEnum>;
  whatIDid: string;
  roleRef: string | null; // set only when not under a project (chk_evidence_single_source)
  projectRef: string | null;
  lastUsed: Date;
}
export interface CheckedCareer {
  roles: CheckedRole[];
  projects: CheckedProject[];
  items: CheckedItem[];
  listedSkills: { name: string; category: z.infer<typeof SkillCategoryEnum> }[];
  dropped: { what: string; reason: string }[];
}

const monthStart = (m: string) => new Date(`${m}-01T00:00:00Z`);

export function checkCareerExtraction(
  resumeText: string,
  out: CareerExtraction,
  neverClaim: { term: string; scope: NeverClaimScope }[],
  now = new Date(),
): CheckedCareer {
  const text = normalizeForQuote(resumeText);
  const inText = (s: string) => {
    const n = normalizeForQuote(s);
    return n.length > 0 && text.includes(n);
  };
  const dropped: CheckedCareer['dropped'] = [];

  const roles: CheckedRole[] = [];
  for (const r of out.roles) {
    const what = `${r.title} at ${r.company}`;
    if (!inText(r.title) || !inText(r.company)) {
      dropped.push({ what, reason: "the title or company isn't in your resume as written" });
      continue;
    }
    const startDate = monthStart(r.start);
    const endDate = r.current || !r.end ? null : monthStart(r.end);
    if (startDate > now || (endDate && endDate < startDate)) {
      dropped.push({ what, reason: 'its dates are impossible' });
      continue;
    }
    roles.push({
      ref: r.ref,
      title: r.title.trim(),
      company: r.company.trim(),
      location: r.location?.trim() || null,
      startDate,
      endDate,
      isCurrent: r.current || !r.end,
    });
  }
  const roleByRef = new Map(roles.map((r) => [r.ref, r]));

  const projects: CheckedProject[] = [];
  for (const p of out.projects) {
    if (!inText(p.name)) {
      dropped.push({ what: p.name, reason: "its name isn't in your resume as written" });
      continue;
    }
    projects.push({
      ref: p.ref,
      name: p.name.trim(),
      description: p.description?.trim() || null,
      roleRef: p.role && roleByRef.has(p.role) ? p.role : null,
    });
  }
  const projectByRef = new Map(projects.map((p) => [p.ref, p]));

  const items: CheckedItem[] = [];
  for (const i of out.items) {
    const what = `${i.skill}: "${i.whatIDid}"`;
    // The user's own words are the only source a resume bullet may come from (Agents.md §6.2),
    // so an item must be a quote — never a paraphrase the user didn't write.
    if (normalizeForQuote(i.whatIDid).length < 15 || !inText(i.whatIDid)) {
      dropped.push({ what, reason: "it isn't a quote from your resume" });
      continue;
    }
    if (!inText(i.skill) && !mentionsTerm(resumeText, i.skill)) {
      dropped.push({ what, reason: `"${i.skill}" isn't named in your resume` });
      continue;
    }
    const project = i.project ? projectByRef.get(i.project) : undefined;
    const roleRef = project ? project.roleRef : i.role && roleByRef.has(i.role) ? i.role : null;
    // Paid work is only paid work when it's under a role (directly or through its project).
    const context = roleRef ? 'COMMERCIAL' : i.context === 'COMMERCIAL' ? 'PERSONAL' : i.context;
    const blocked = neverClaim.find(
      (c) =>
        (c.scope === 'ANYWHERE' || context === 'COMMERCIAL') &&
        (mentionsTerm(i.skill, c.term) || mentionsTerm(i.whatIDid, c.term)),
    );
    if (blocked) {
      dropped.push({ what, reason: `mentions ${blocked.term}, which your never-claim list rules out` });
      continue;
    }
    const role = roleRef ? roleByRef.get(roleRef) : undefined;
    const lastUsed = i.lastUsed ? monthStart(i.lastUsed) : role ? (role.endDate ?? now) : now;
    items.push({
      skill: i.skill.trim(),
      category: i.category,
      context,
      depth: i.depth,
      whatIDid: i.whatIDid.trim(),
      roleRef: project ? null : roleRef,
      projectRef: project?.ref ?? null,
      lastUsed: lastUsed > now ? now : lastUsed,
    });
  }
  const listedSkills: CheckedCareer['listedSkills'] = [];
  for (const k of out.listedSkills) {
    const named = inText(k.name) || mentionsTerm(resumeText, k.name);
    const blocked = neverClaim.find((c) => c.scope === 'ANYWHERE' && mentionsTerm(k.name, c.term));
    if (!named) dropped.push({ what: k.name, reason: "it isn't named in your resume" });
    else if (blocked) dropped.push({ what: k.name, reason: `${blocked.term} is on your never-claim list` });
    else listedSkills.push({ name: k.name.trim(), category: k.category });
  }
  return { roles, projects, items, listedSkills, dropped };
}
