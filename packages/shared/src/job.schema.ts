import { z } from 'zod';

export const JobStatus = z.enum([
  'DISCOVERED',
  'INTERESTED',
  'SKIPPED',
  'APPLIED',
  'ASSESSMENT',
  'INTERVIEWING',
  'REJECTED',
  'OFFER',
  'WITHDRAWN',
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const ListJobsQuerySchema = z
  .object({
    status: JobStatus.optional(),
    // "score": best match first (unscored last); "recent": newest first.
    sort: z.enum(['score', 'recent']).default('score'),
    // Only jobs from this JobSource ("24 jobs" on the Sources page links here).
    sourceId: z.string().uuid().optional(),
  })
  .strict();
export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;

export const JobCountsQuerySchema = z.object({ sourceId: z.string().uuid().optional() }).strict();
export type JobCountsQuery = z.infer<typeof JobCountsQuerySchema>;

// The user moves a job through their pipeline. Shortlist never applies on its own —
// APPLIED only ever records what the user did (Agents.md §1: the human clicks submit).
export const UpdateJobSchema = z.object({ status: JobStatus }).strict();
export type UpdateJobInput = z.infer<typeof UpdateJobSchema>;

export const UpdateJobSourceSchema = z.object({ isEnabled: z.boolean() }).strict();
export type UpdateJobSourceInput = z.infer<typeof UpdateJobSourceSchema>;

// A manual "run now" skips sources that ran more recently than this. Protects the
// aggregators' request limits (Remotive: at most ~4 requests a day).
export const MANUAL_RUN_COOLDOWN_HOURS = 6;

// Display names for attribution. Aggregators must be named and linked back to.
export const PROVIDER_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  remoteok: 'Remote OK',
  remotive: 'Remotive',
  arbeitnow: 'Arbeitnow',
  himalayas: 'Himalayas',
  jobicy: 'Jobicy',
  weworkremotely: 'We Work Remotely',
  // Job-alert email portals (docs/email-alerts.md §10) — same ids as the worker's portalFor().
  indeed: 'Indeed',
  linkedin: 'LinkedIn',
  'rozee-pk': 'Rozee.pk',
  wellfound: 'Wellfound',
  arc: 'Arc.dev',
  wttj: 'Welcome to the Jungle',
  glassdoor: 'Glassdoor',
  mustakbil: 'Mustakbil',
  'remote-co': 'remote.co',
};
