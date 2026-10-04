import { z } from 'zod';

// What a JobSource.config may contain, discriminated by `provider`. Validated when a
// source is seeded/created and again by the worker before every run, so a malformed
// row fails loudly as a FAILED DiscoveryRun instead of fetching the wrong thing.

const slug = z.string().trim().min(1).max(100);
const pages = z.number().int().min(1).max(20);

// Providers the worker has an adapter for (Milestone 1).
export const ImplementedSourceConfigSchema = z.discriminatedUnion('provider', [
  // Company applicant-tracking systems with public job APIs.
  z.object({ provider: z.literal('greenhouse'), board: slug }).strict(),
  z.object({ provider: z.literal('lever'), site: slug }).strict(),
  z.object({ provider: z.literal('smartrecruiters'), company: slug }).strict(),
  z.object({ provider: z.literal('workable'), account: slug }).strict(),
  // Remote-job aggregators with public APIs / feeds. Each requires attribution and a
  // link back to the original posting — the Jobs screen shows both.
  z.object({ provider: z.literal('remoteok') }).strict(),
  z.object({ provider: z.literal('remotive'), category: slug.default('software-dev') }).strict(),
  z.object({ provider: z.literal('arbeitnow'), maxPages: pages.default(3) }).strict(),
  z.object({ provider: z.literal('himalayas'), maxPages: pages.default(5) }).strict(),
  z.object({ provider: z.literal('jobicy'), tag: slug.optional() }).strict(),
  z.object({ provider: z.literal('weworkremotely'), category: slug }).strict(),
]);

// Recorded now so the full source list lives in the database, but no adapter yet:
// enabling one produces a FAILED run that says so. Milestone 2 = hosted ATS pages;
// Milestone 3 = custom careers sites (change-detection + extraction) and email alerts.
export const PLANNED_PROVIDERS = [
  'jazzhr',
  'zohorecruit',
  'opencats',
  'simplicant',
  'webhr',
  'hirestream',
  'successfactors',
  'pinpoint',
  'careers_page',
  'email_alerts',
] as const;

export const PlannedSourceConfigSchema = z
  .object({ provider: z.enum(PLANNED_PROVIDERS), url: z.url().optional(), note: z.string().max(300).optional() })
  .strict();

export const JobSourceConfigSchema = z.union([ImplementedSourceConfigSchema, PlannedSourceConfigSchema]);

export type ImplementedSourceConfig = z.infer<typeof ImplementedSourceConfigSchema>;
export type JobSourceConfig = z.infer<typeof JobSourceConfigSchema>;
export type SourceProvider = ImplementedSourceConfig['provider'];

// "Edit URL" on a failing company board (Agents.md §9.5): the user pastes the board's
// link — or just its name — and we keep only the part the adapter needs. Aggregators have
// fixed APIs, so only these four have an address to edit.
const BOARD_HOSTS = {
  greenhouse: { field: 'board', hosts: [/(?:job-)?boards(?:-api)?\.greenhouse\.io$/], path: /^\/(?:v1\/boards\/)?([^/?#]+)/ },
  lever: { field: 'site', hosts: [/jobs\.(?:eu\.)?lever\.co$/], path: /^\/([^/?#]+)/ },
  smartrecruiters: { field: 'company', hosts: [/(?:careers|jobs)\.smartrecruiters\.com$/], path: /^\/([^/?#]+)/ },
  workable: { field: 'account', hosts: [/apply\.workable\.com$/], path: /^\/([^/?#]+)/ },
} as const;
export type BoardProvider = keyof typeof BOARD_HOSTS;
export const isBoardProvider = (p: string): p is BoardProvider => p in BOARD_HOSTS;

export const UpdateSourceAddressSchema = z.object({ address: z.string().trim().min(1, 'Paste the board link or its name').max(300) }).strict();
export type UpdateSourceAddressInput = z.infer<typeof UpdateSourceAddressSchema>;

// The board's link or bare name → the provider's config, or an error a person can act on.
export function parseBoardAddress(
  provider: BoardProvider,
  input: string,
): { ok: true; config: ImplementedSourceConfig } | { ok: false; error: string } {
  const spec = BOARD_HOSTS[provider];
  const raw = input.trim();
  let name = raw;
  if (/^https?:\/\//i.test(raw) || raw.includes('/')) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return { ok: false, error: "That isn't a valid link" };
    }
    if (!spec.hosts.some((h) => h.test(url.hostname))) {
      return { ok: false, error: `That isn't a ${provider} board link` };
    }
    const m = spec.path.exec(url.pathname);
    if (!m) return { ok: false, error: "The link doesn't include the board's name" };
    name = decodeURIComponent(m[1]!);
  }
  const parsed = ImplementedSourceConfigSchema.safeParse({ provider, [spec.field]: name });
  if (!parsed.success || !/^[A-Za-z0-9._-]+$/.test(name)) return { ok: false, error: "That board name doesn't look right" };
  return { ok: true, config: parsed.data };
}
