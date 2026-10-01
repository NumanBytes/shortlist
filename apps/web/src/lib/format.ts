import { PROVIDER_LABELS } from '@shortlist/shared';
import type { JobListItem, Verdict } from './types';

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 24 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}

export const providerLabel = (provider: string | null) => (provider && PROVIDER_LABELS[provider]) || provider || 'unknown';

export const AGGREGATORS = new Set(['remoteok', 'remotive', 'arbeitnow', 'himalayas', 'jobicy', 'weworkremotely']);
export const isAggregator = (job: Pick<JobListItem, 'source'>) => AGGREGATORS.has(job.source ?? '');

// "Lahore, Punjab, pk" → "Lahore, Punjab, PK". Sources are inconsistent about case.
export function prettyLocation(location: string | null): string | null {
  if (!location) return null;
  return location
    .split(/\s*,\s*/)
    .map((part) => (/^[a-z]{2}$/i.test(part) ? part.toUpperCase() : part))
    .join(', ');
}

// Posting age only means something on aggregators (Agents.md §9.6): a company board's
// publish date can be years old for a role that is still open, so don't show it there.
export function postedLabel(job: Pick<JobListItem, 'source' | 'postedAt'>): string | null {
  if (!job.postedAt || !isAggregator(job)) return null;
  return `posted ${timeAgo(job.postedAt)}`;
}

export const VERDICT_LABEL: Record<Verdict, string> = { APPLY: 'Apply', STRETCH: 'Stretch', SKIP: 'Skip' };
