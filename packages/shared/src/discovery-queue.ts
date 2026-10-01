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
