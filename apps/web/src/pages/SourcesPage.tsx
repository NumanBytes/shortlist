import { AlertTriangle, ChevronDown, Play, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Skeleton, Switch, type Tone } from '../components/ui';
import { providerLabel, timeAgo } from '../lib/format';
import { useAiUsage, useRunDiscovery, useSetSourceEnabled, useSources, useUpdateAiSettings } from '../lib/queries';
import type { DiscoverySource, RunStatus } from '../lib/types';

const STATUS_TONE: Record<RunStatus, Tone> = { SUCCESS: 'apply', RUNNING: 'neutral', EMPTY: 'stretch', FAILED: 'danger' };
const needsAttention = (s: DiscoverySource) => s.isEnabled && (s.lastRun?.status === 'FAILED' || s.lastRun?.status === 'EMPTY');

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{value}</p>
      {sub && <p className="text-xs text-subtle">{sub}</p>}
    </div>
  );
}

// Budget guard visibility (Agents.md §12.3): what AI scoring has cost, and the caps.
function AiSpendCard() {
  const usage = useAiUsage();
  const update = useUpdateAiSettings();
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState('');
  if (usage.isPending) return <Skeleton className="h-36 w-full" />;
  if (!usage.isSuccess) return null;
  const u = usage.data;
  const pct = Math.min(100, (u.monthToDateUsd / Math.max(u.settings.monthlyBudgetUsd, 0.01)) * 100);
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h2 id="ai-spend" className="flex items-center gap-2 font-semibold text-fg">
          <Sparkles className="size-4 text-accent" /> AI scoring
        </h2>
        {!editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setBudget(String(u.settings.monthlyBudgetUsd));
              setEditing(true);
            }}
          >
            Change budget
          </Button>
        )}
      </div>
      <p className="mt-2 text-sm text-fg">
        ${u.monthToDateUsd.toFixed(2)} of ${u.settings.monthlyBudgetUsd.toFixed(2)} this month
      </p>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ring-track" aria-hidden="true">
        <div className={`h-full rounded-full ${pct >= 90 ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Scored" value={String(u.jobs.done)} />
        <Stat label="Last 24h" value={`${u.analysesLast24h}`} sub={`cap ${u.settings.maxAnalysesPerDay}`} />
        <Stat label="Waiting" value={String(u.jobs.pending + u.jobs.deferred)} sub={u.jobs.failed ? `${u.jobs.failed} failed` : undefined} />
      </div>
      {editing && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // Number('') is 0 — an emptied field must not silently set a $0 budget.
            const value = budget.trim() === '' ? Number.NaN : Number(budget);
            if (Number.isFinite(value) && value >= 0) update.mutate({ monthlyBudgetUsd: value }, { onSuccess: () => setEditing(false) });
          }}
        >
          <label className="text-sm text-muted" htmlFor="budget">
            Monthly budget $
          </label>
          <input
            id="budget"
            type="number"
            min="0"
            step="0.5"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="h-9 w-24 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
          />
          <Button type="submit" size="sm" disabled={update.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      )}
      {update.isError && <p className="mt-2 text-xs text-danger-fg">{update.error.message}</p>}
    </Card>
  );
}

function SourceRow({ source }: { source: DiscoverySource }) {
  const toggle = useSetSourceEnabled();
  const run = source.lastRun;
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-fg">{source.name}</p>
          {/* Healthy is the normal state; only problems (and in-flight runs) get a badge. */}
          {run && run.status !== 'SUCCESS' && <Badge tone={STATUS_TONE[run.status]}>{run.status.toLowerCase()}</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {providerLabel(source.provider)} · {source.jobCount} {source.jobCount === 1 ? 'job' : 'jobs'} · ran {timeAgo(source.lastRunAt)}
          {run && run.status !== 'FAILED' && run.status !== 'RUNNING' && (
            <>
              {' '}
              · {run.jobsFound} found, {run.jobsMatched} matched, {run.jobsNew} new
            </>
          )}
        </p>
        {/* A failing or empty source is shown as such — never confused with "no jobs today". */}
        {run?.status === 'FAILED' && <p className="mt-1 text-xs text-danger-fg">Failed: {run.errorMessage}</p>}
        {run?.status === 'EMPTY' && <p className="mt-1 text-xs text-stretch-fg">Returned no postings at all.</p>}
        {toggle.isError && <p className="mt-1 text-xs text-danger-fg">{toggle.error.message}</p>}
      </div>
      <Switch
        checked={source.isEnabled}
        disabled={toggle.isPending}
        onChange={(isEnabled) => toggle.mutate({ id: source.id, isEnabled })}
        label={`Watch ${source.name}`}
      />
    </li>
  );
}

export function SourcesPage() {
  const sources = useSources();
  const runNow = useRunDiscovery();
  const [showPlanned, setShowPlanned] = useState(false);
  const active = (sources.data ?? []).filter((s) => s.supported);
  const planned = (sources.data ?? []).filter((s) => !s.supported);
  const attention = active.filter(needsAttention);
  const healthy = active.filter((s) => !needsAttention(s));

  return (
    <main className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold text-fg">Sources</h1>
      <AiSpendCard />

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-sm text-muted">
            Discovery runs every night at 02:00. Sources that ran in the last few hours are skipped, to respect the job
            boards' request limits.
          </p>
          <Button onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            <Play className="size-4" /> {runNow.isPending ? 'Queuing…' : 'Run now'}
          </Button>
        </div>
        {runNow.isSuccess && (
          <output className="mt-2 block text-sm text-fg">
            Queued {runNow.data.queued.length} source{runNow.data.queued.length === 1 ? '' : 's'}.
            {runNow.data.skipped.length > 0 && ` Skipped ${runNow.data.skipped.length} that ran in the last ${runNow.data.cooldownHours}h.`}{' '}
            Results appear here as each finishes (the worker must be running).
          </output>
        )}
        {runNow.isError && <p className="mt-2 text-sm text-danger-fg">{runNow.error.message}</p>}
      </Card>

      {sources.isPending && <Skeleton className="h-64 w-full" />}
      {sources.isError && <p className="text-danger-fg">Couldn't load sources: {sources.error.message}</p>}
      {sources.isSuccess && sources.data.length === 0 && (
        <p className="text-sm text-muted">
          No sources yet. Seed them with <code className="rounded bg-surface-2 px-1">pnpm --filter @shortlist/db db:seed:sources</code>.
        </p>
      )}

      {attention.length > 0 && (
        <section aria-labelledby="attention">
          <h2 id="attention" className="mb-2 flex items-center gap-2 text-sm font-semibold text-danger-fg">
            <AlertTriangle className="size-4" /> Needs attention ({attention.length})
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {attention.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </ul>
        </section>
      )}

      {healthy.length > 0 && (
        <section aria-labelledby="watching">
          <h2 id="watching" className="mb-2 text-sm font-semibold text-fg">
            Watching ({active.filter((s) => s.isEnabled).length} on)
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {healthy.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </ul>
        </section>
      )}

      {planned.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={showPlanned}
            onClick={() => setShowPlanned((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-sm font-medium text-muted hover:text-fg"
          >
            {showPlanned ? 'Hide' : 'Show'} {planned.length} recorded for later
            <ChevronDown className={`size-4 transition ${showPlanned ? 'rotate-180' : ''}`} />
          </button>
          {showPlanned && (
            <ul className="mt-1 divide-y divide-border rounded-xl border border-border bg-surface text-sm">
              {planned.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 px-3 py-2.5">
                  <span className="text-fg">{s.name}</span>
                  <span className="text-subtle">{s.provider.replace('_', ' ')} · coming later</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
