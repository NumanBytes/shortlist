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
