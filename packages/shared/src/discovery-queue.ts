// Queue contract between the API (producer: "run now") and the worker (consumer).
export const DISCOVERY_QUEUE = 'discovery';

export const DiscoveryJob = {
  // Fans out one DiscoverSource job per enabled source (all users). Fired nightly.
  All: 'discover-all',
  // Fetch -> filter -> dedupe -> store for one JobSource.
  Source: 'discover-source',
} as const;

export interface DiscoverSourceData {
  sourceId: string;
}

// AI analysis queue (Agents.md §12). Separate from discovery so model calls get their
// own (low) concurrency and a slow source never delays scoring, or vice versa.
export const ANALYSIS_QUEUE = 'analysis';

export const AnalysisJob = {
  // Extract requirements + map to verified skills (one model call) + score in code.
  Job: 'analyze-job',
  // Nightly: re-queue PENDING/DEFERRED jobs within the daily cap, re-score DONE jobs.
  Sweep: 'analysis-sweep',
} as const;

export interface AnalyzeJobData {
  jobId: string;
}

// Resume tailoring queue (Agents.md §13). Its own queue: a Sonnet call takes far longer
// than an analysis, and the user is waiting on this one.
export const RESUME_QUEUE = 'resume';

export const ResumeJob = {
  // Tailor a resume for one job (one model call), check every bullet, store a variant.
  Tailor: 'tailor-resume',
} as const;

export interface TailorResumeData {
  jobId: string;
}

// Email alerts queue (Agents.md §10). Reading Gmail is I/O against one mailbox per user,
// on its own schedule; kept apart so a slow mailbox never delays discovery or scoring.
export const EMAIL_QUEUE = 'email';

export const EmailJob = {
  // Fans out one Check per connected Gmail account. Fired on a schedule.
  CheckAll: 'email-check-all',
  // Read new messages under the user's Shortlist label.
  Check: 'email-check',
} as const;

export interface CheckEmailData {
  userId: string;
}
