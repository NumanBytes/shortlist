import type { Verdict } from '../lib/types';

const STROKE: Record<Verdict, string> = { APPLY: 'stroke-apply', STRETCH: 'stroke-stretch', SKIP: 'stroke-skip' };

// The match score as a ring — the single most important number on a job, so it leads.
export function ScoreRing({ score, verdict, size = 44 }: { score: number; verdict: Verdict; size?: number }) {
  const r = 20;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-surface-2" />
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
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tracking-tight tabular-nums text-fg" style={{ fontSize: size > 60 ? size * 0.32 : undefined }}>
        <span className="sr-only">Match score </span>
        {score}
      </span>
    </div>
  );
}

// Placeholder ring for jobs not scored yet.
export function PendingRing({ size = 44 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border-4 border-dashed border-surface-2 text-xs text-muted"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      –
    </div>
  );
}
