import { PROVIDER_LABELS } from '@shortlist/shared';

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const providerLabel = (provider: string | null) => (provider && PROVIDER_LABELS[provider]) || provider || 'unknown';
