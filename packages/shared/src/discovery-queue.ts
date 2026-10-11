// Queue contract between the API (producer: "run now") and the worker (consumer).
export const DISCOVERY_QUEUE = 'discovery';

export const DiscoveryJob = {
  // Fans out one DiscoverSource job per enabled source (all users). Fired nightly.
  All: 'discover-all',
  // Fetch -> filter -> dedupe -> store for one JobSource.
  Source: 'discover-source',
} as const;

// The nightly BullMQ job scheduler's id. The API reads it to show the next automatic run.
export const NIGHTLY_DISCOVERY_SCHEDULER_ID = 'nightly-discovery';

export interface DiscoverSourceData {
  sourceId: string;
}

// AI analysis queue (docs/ai-scoring.md §12). Separate from discovery so model calls get their
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

// Resume tailoring queue (docs/resume.md §13). Its own queue: a Sonnet call takes far longer
// than an analysis, and the user is waiting on this one.
export const RESUME_QUEUE = 'resume';

export const ResumeJob = {
  // Tailor a resume for one job (one model call), check every bullet, store a variant.
  Tailor: 'tailor-resume',
} as const;

export interface TailorResumeData {
  jobId: string;
}

// Email alerts queue (docs/email-alerts.md §10). Reading Gmail is I/O against one mailbox per user,
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

// Worker liveness (docs/architecture.md §4). The worker writes this key every
// WORKER_HEARTBEAT_INTERVAL_MS with a TTL; if it's missing, no worker is consuming the
// queues, and the API can say so instead of the UI spinning forever on queued work.
// A key with a TTL, not BullMQ's getWorkers(): that uses CLIENT LIST, which hosted Redis
// (Upstash) doesn't allow.
export const WORKER_HEARTBEAT_KEY = 'shortlist:worker:heartbeat';
export const WORKER_HEARTBEAT_INTERVAL_MS = 20_000;
export const WORKER_HEARTBEAT_TTL_MS = 60_000;

// ── Job ids and options ──────────────────────────────────────────────────────
// The API and the worker both add these jobs, so how each job is identified lives here,
// once. Two ids per job:
// - `deduplication.id` (per thing being worked on): while a job for that source / posting /
//   mailbox is waiting, in retry backoff or running, another add — a second tap, the nightly
//   run, the other app — joins it instead of running twice. For model calls, running twice
//   means paying twice, so a dedupe id that differs by one character between the apps would
//   silently cost money.
// - `jobId` (per batch): once a job has finished, the next batch can queue it again; and a
//   retried fan-out re-adding the same ids is a no-op.
// BullMQ custom ids can't contain ":", but scheduler-fired batch ids look like
// "repeat:<scheduler>:<millis>", so those are made safe.
export const safeJobId = (id: string) => id.replace(/:/g, '-');

export const dedupeId = {
  discoverSource: (sourceId: string) => `discover-${sourceId}`,
  analyzeJob: (jobId: string) => `analyze-${jobId}`,
  tailorResume: (jobId: string) => `tailor-${jobId}`,
  checkEmail: (userId: string) => `email-${userId}`,
};

const KEEP = {
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};
// Transient failures (timeouts, 5xx) retry with backoff. Analysis waits longer between
// attempts: its usual transient failure is the model API being overloaded.
const retry = (delayMs: number) => ({
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: delayMs },
  ...KEEP,
});

// Everything BullMQ needs to add one job besides its name and data.
export const queueJobOptions = {
  discoverSource: (sourceId: string, batchId: string) => ({
    ...retry(60_000),
    jobId: `${sourceId}__${safeJobId(batchId)}`,
    deduplication: { id: dedupeId.discoverSource(sourceId) },
  }),
  analyzeJob: (jobId: string, batchId: string) => ({
    ...retry(120_000),
    jobId: `analyze__${jobId}__${safeJobId(batchId)}`,
    deduplication: { id: dedupeId.analyzeJob(jobId) },
  }),
  tailorResume: (jobId: string, batchId: string) => ({
    ...retry(60_000),
    jobId: `tailor__${jobId}__${safeJobId(batchId)}`,
    deduplication: { id: dedupeId.tailorResume(jobId) },
  }),
  checkEmail: (userId: string, batchId: string) => ({
    ...retry(60_000),
    jobId: `email__${userId}__${safeJobId(batchId)}`,
    deduplication: { id: dedupeId.checkEmail(userId) },
  }),
};
