// A failure retrying can't fix (bad config, provider not implemented yet, a careers page
// that's gone). The processor turns it into a non-retried job; transient errors (timeouts,
// 5xx) are thrown as-is so the queue retries them with backoff. Its own file so adapters
// can throw it without importing the service that imports them.
export class PermanentSourceError extends Error {}
