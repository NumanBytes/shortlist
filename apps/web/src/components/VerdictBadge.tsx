import type { Verdict } from '../lib/types';

const STYLE: Record<Verdict, string> = {
  APPLY: 'bg-emerald-100 text-emerald-800',
  STRETCH: 'bg-amber-100 text-amber-800',
  SKIP: 'bg-slate-100 text-slate-600',
};

export function VerdictBadge({ score, verdict }: { score: number; verdict: Verdict }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[verdict]}`}
      title={`Match score ${score} — ${verdict.toLowerCase()}`}
    >
      {score} · {verdict.charAt(0) + verdict.slice(1).toLowerCase()}
    </span>
  );
}
