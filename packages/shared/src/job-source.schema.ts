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
