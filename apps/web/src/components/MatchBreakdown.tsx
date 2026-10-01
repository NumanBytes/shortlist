import type { JobDetail } from '../lib/types';
import { VerdictBadge } from './VerdictBadge';

const SEVERITY_STYLE = {
  BLOCKING: 'text-red-700',
  MODERATE: 'text-amber-700',
  MINOR: 'text-slate-500',
} as const;

// Why a job scored what it did. Everything here is computed in code from the job's
// requirements and the user's verified evidence — the model only mapped skills.
export function MatchBreakdown({ job }: { job: JobDetail }) {
  const m = job.match;
  if (!m) return null;
  return (
    <section aria-label="Match breakdown" className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge score={m.overallScore} verdict={m.verdict} />
        <span className="text-xs text-slate-500">
          {m.commercialScore}% from commercial work
          {job.seniority && job.seniority !== 'UNKNOWN' && <> · {job.seniority.toLowerCase()} role</>}
          {job.yearsRequired !== null && <> · asks {job.yearsRequired}+ yrs</>}
        </span>
      </div>

      {job.redFlags.length > 0 && (
        <div role="alert" className="rounded-md bg-red-50 p-2 text-red-800">
          <p className="font-medium">Possible scam — check before applying</p>
          <ul className="mt-1 list-disc pl-5">
            {job.redFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {m.strengths.length > 0 && (
        <div>
          <h4 className="font-medium text-emerald-800">You have</h4>
          <ul className="mt-1 space-y-0.5 text-slate-700">
            {m.strengths.map((s) => (
              <li key={s}>✓ {s}</li>
            ))}
          </ul>
        </div>
      )}

      {m.gaps.length > 0 && (
        <div>
          <h4 className="font-medium text-slate-800">Gaps</h4>
          <ul className="mt-1 space-y-0.5">
            {m.gaps.map((g) => (
              <li key={g.skillName} className={SEVERITY_STYLE[g.severity]}>
                {g.severity === 'BLOCKING' ? '✕' : '–'} {g.skillName}
                <span className="text-xs"> · {g.severity.toLowerCase()}</span>
                {g.note && <span className="text-xs text-slate-500"> ({g.note})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.risks.filter((r) => !r.startsWith('Missing') && !r.startsWith('Red flag')).map((r) => (
        <p key={r} className="text-amber-800">
          ⚠ {r}
        </p>
      ))}
    </section>
  );
}
