import type { JobListItem } from '../../lib/types';

export interface DayGroup {
  key: string; // local date, "2026-10-13"
  label: string; // "Today", "Yesterday", "Mon 6 Oct", "28 Sep"
  jobs: JobListItem[];
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function dayLabel(d: Date, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo < 7) return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

// Best first within a day: scored jobs by score, then unscored ones; newer breaks ties.
function byScore(a: JobListItem, b: JobListItem) {
  const sa = a.match?.overallScore ?? -1;
  const sb = b.match?.overallScore ?? -1;
  return sb - sa || b.discoveredAt.localeCompare(a.discoveredAt);
}

// The default Jobs order (user's request, 2026-10-13): newest day first — jobs arrive in a
// nightly batch, so the latest batch is what's new — and the best matches first inside each
// day. Days are the phone's local days, by when Shortlist found the job (the card's "Found").
export function groupByDay(jobs: JobListItem[], now = new Date()): DayGroup[] {
  const groups = new Map<string, JobListItem[]>();
  for (const j of jobs) {
    const key = localDay(new Date(j.discoveredAt));
    const list = groups.get(key);
    if (list) list.push(j);
    else groups.set(key, [j]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => ({
      key,
      label: dayLabel(new Date(list[0]!.discoveredAt), now),
      jobs: [...list].sort(byScore),
    }));
}
