import { useState } from 'react';
import { Badge, Button } from '../components/ui';
import { providerLabel, timeAgo } from '../lib/format';
import { useAiUsage, useRunDiscovery, useSetSourceEnabled, useSources, useUpdateAiSettings } from '../lib/queries';
import type { DiscoverySource, RunStatus } from '../lib/types';

const STATUS_TONE: Record<RunStatus, 'green' | 'amber' | 'slate'> = {
  SUCCESS: 'green',
  RUNNING: 'slate',
  EMPTY: 'amber',
  FAILED: 'amber',
};

function SourceRow({ source }: { source: DiscoverySource }) {
  const toggle = useSetSourceEnabled();
  const run = source.lastRun;
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{source.name}</p>
          <p className="text-xs text-slate-500">
            {providerLabel(source.provider)} · {source.jobCount} jobs · last run {timeAgo(source.lastRunAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run && <Badge tone={STATUS_TONE[run.status]}>{run.status.toLowerCase()}</Badge>}
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={source.isEnabled}
              disabled={toggle.isPending}
              onChange={(e) => toggle.mutate({ id: source.id, isEnabled: e.target.checked })}
              className="size-4 accent-slate-900"
            />
            On
          </label>
        </div>
      </div>
      {run && run.status !== 'FAILED' && run.status !== 'RUNNING' && (
        <p className="mt-1 text-xs text-slate-500">
          {run.jobsFound} found · {run.jobsMatched} matched · {run.jobsNew} new
        </p>
      )}
      {/* A failing or empty source is shown as such — never confused with "no jobs today". */}
      {run?.status === 'FAILED' && <p className="mt-1 text-xs text-red-600">Failed: {run.errorMessage}</p>}
      {run?.status === 'EMPTY' && <p className="mt-1 text-xs text-amber-700">The source returned no postings at all.</p>}
      {toggle.isError && <p className="mt-1 text-xs text-red-600">{toggle.error.message}</p>}
    </li>
  );
}

// Budget guard visibility (Agents.md §12.3): what AI scoring has cost, and the caps.
function AiSpendCard() {
  const usage = useAiUsage();
  const update = useUpdateAiSettings();
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState('');
  if (!usage.isSuccess) return null;
  const u = usage.data;
  const pct = Math.min(100, (u.monthToDateUsd / Math.max(u.settings.monthlyBudgetUsd, 0.01)) * 100);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="ai-spend">
      <h2 id="ai-spend" className="font-semibold">
        AI scoring
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        ${u.monthToDateUsd.toFixed(2)} of ${u.settings.monthlyBudgetUsd.toFixed(2)} this month · {u.analysesLast24h} of{' '}
        {u.settings.maxAnalysesPerDay} analyses in the last 24h
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className={`h-full ${pct >= 90 ? 'bg-red-500' : 'bg-slate-900'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {u.jobs.done} scored · {u.jobs.pending} pending · {u.jobs.deferred} deferred · {u.jobs.failed} failed
      </p>
      {editing ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = Number(budget);
            if (Number.isFinite(value) && value >= 0) update.mutate({ monthlyBudgetUsd: value }, { onSuccess: () => setEditing(false) });
          }}
        >
          <label className="text-sm text-slate-600" htmlFor="budget">
            Monthly budget $
          </label>
          <input
            id="budget"
            type="number"
            min="0"
            step="0.5"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
          <Button type="submit" disabled={update.isPending}>
            Save
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          className="mt-1 px-0"
          onClick={() => {
            setBudget(String(u.settings.monthlyBudgetUsd));
            setEditing(true);
          }}
        >
          Change budget
        </Button>
      )}
      {update.isError && <p className="text-xs text-red-600">{update.error.message}</p>}
    </section>
  );
}

export function SourcesPage() {
  const sources = useSources();
  const runNow = useRunDiscovery();
  const [showPlanned, setShowPlanned] = useState(false);
  const active = (sources.data ?? []).filter((s) => s.supported);
  const planned = (sources.data ?? []).filter((s) => !s.supported);

  return (
    <main className="space-y-4">
      <AiSpendCard />
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          Discovery runs every night at 02:00. Run it now to check your sources — any source that ran in the last few
          hours is skipped, to respect the job boards' request limits.
        </p>
        <Button className="mt-3" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
          {runNow.isPending ? 'Queuing…' : 'Run discovery now'}
        </Button>
        {runNow.isSuccess && (
          <output className="mt-2 block text-sm text-slate-700">
            Queued {runNow.data.queued.length} source{runNow.data.queued.length === 1 ? '' : 's'}.
            {runNow.data.skipped.length > 0 &&
              ` Skipped ${runNow.data.skipped.length} that ran in the last ${runNow.data.cooldownHours}h.`}{' '}
            Results appear here as each finishes (the worker must be running).
          </output>
        )}
        {runNow.isError && <p className="mt-2 text-sm text-red-600">{runNow.error.message}</p>}
      </section>

      {sources.isPending && <p className="text-slate-500">Loading…</p>}
      {sources.isError && <p className="text-red-600">Couldn't load sources: {sources.error.message}</p>}
      {sources.isSuccess && sources.data.length === 0 && (
        <p className="text-sm text-slate-600">
          No sources yet. Seed them with{' '}
          <code className="rounded bg-slate-100 px-1">pnpm --filter @shortlist/db db:seed:sources</code>.
        </p>
      )}

      {active.length > 0 && (
        <section aria-labelledby="active-sources">
          <h2 id="active-sources" className="mb-2 font-semibold">
            Watching ({active.filter((s) => s.isEnabled).length} on)
          </h2>
          <ul className="space-y-2">
            {active.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </ul>
        </section>
      )}

      {planned.length > 0 && (
        <section>
          <Button variant="ghost" onClick={() => setShowPlanned((v) => !v)} aria-expanded={showPlanned}>
            {showPlanned ? 'Hide' : 'Show'} {planned.length} recorded for later
          </Button>
          {showPlanned && (
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {planned.map((s) => (
                <li key={s.id} className="flex justify-between rounded-lg bg-white px-3 py-2">
                  <span>{s.name}</span>
                  <span className="text-slate-400">{s.provider.replace('_', ' ')} · coming later</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
