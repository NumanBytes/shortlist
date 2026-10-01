import type { Verdict } from '../lib/types';

const STROKE: Record<Verdict, string> = { APPLY: 'stroke-apply', STRETCH: 'stroke-stretch', SKIP: 'stroke-skip' };

// The match score as a ring — the single most important number on a job, so it leads.
export function ScoreRing({ score, verdict, size = 48 }: { score: number; verdict: Verdict; size?: number }) {
  const r = 20;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-ring-track" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className={STROKE[verdict]}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-fg">
        <span className="sr-only">Match score </span>
        {score}
      </span>
    </div>
  );
}

// Placeholder ring for jobs not scored yet.
export function PendingRing({ size = 48 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border-4 border-dashed border-ring-track text-xs text-subtle"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      –
    </div>
  );
}
