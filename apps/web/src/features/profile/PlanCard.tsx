import { useAiUsage } from '../../lib/queries';
import type { PlanUsage } from '../../lib/types';
import { Group } from './ListGroup';
import { PlanBilling } from './PlanBilling';

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const full = used >= limit;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body text-fg">{label}</span>
        <span className={`text-footnote tabular-nums ${full ? 'font-semibold text-danger-fg' : 'text-muted'}`}>
          {Math.min(used, limit)} of {limit}
        </span>
      </div>
      <progress
        aria-label={label}
        max={limit}
        value={Math.min(used, limit)}
        className={`block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-surface-2 [&::-moz-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-surface-2 [&::-webkit-progress-value]:rounded-full ${
          full
            ? '[&::-moz-progress-bar]:bg-danger [&::-webkit-progress-value]:bg-danger'
            : '[&::-moz-progress-bar]:bg-accent [&::-webkit-progress-value]:bg-accent'
        }`}
      />
    </div>
  );
}

const periodText = (p: PlanUsage) =>
  p.period === 'trial' ? 'A one-time trial' : p.resetsAt ? `Resets ${dayMonth(p.resetsAt)}` : 'This month';

// The user's plan in their own terms (docs/ai-scoring.md §12.5): jobs scored and resumes
// tailored, how often sources are checked, and whether "Find new jobs" is included — then buying
// or managing it (docs/billing.md §20).
export function PlanCard() {
  const usage = useAiUsage();
  const p = usage.data?.plan;
  if (!p) return null;
  return (
    <Group label="Plan">
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-headline font-semibold text-fg">{p.label}</p>
          <p className="text-footnote text-muted">{periodText(p)}</p>
        </div>
        <Meter label="Jobs scored" {...p.scoredJobs} />
        <Meter label="Tailored resumes" {...p.tailoredResumes} />
        <p className="text-caption text-muted">
          Sources are checked {p.discoveryEveryDays === 1 ? 'every night' : `every ${p.discoveryEveryDays} nights`}
          {p.runNow ? ', and on demand from Jobs' : ''}. Reusing an approved resume doesn't count. Finding and tracking
          jobs never stop.
        </p>
      </div>
      <PlanBilling />
    </Group>
  );
}
