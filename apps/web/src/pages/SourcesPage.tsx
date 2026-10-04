import { ChevronDown, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../components/AppShell';
import { GmailCard } from '../components/GmailCard';
import { Badge, Button, Card, SectionLabel, Skeleton, Switch } from '../components/ui';
import { providerLabel, timeAgo } from '../lib/format';
import { useAiUsage, useDiscoveryStatus, useRunSource, useSetSourceEnabled, useSources } from '../lib/queries';
import type { DiscoverySource } from '../lib/types';

const needsAttention = (s: DiscoverySource) => s.isEnabled && (s.lastRun?.status === 'FAILED' || s.lastRun?.status === 'EMPTY');
const money = (n: number) => `$${n.toFixed(2)}`;

// What AI costs (Agents.md §12.3) — the budget itself is changed on Profile.
function SpendTiles() {
  const usage = useAiUsage();
  const status = useDiscoveryStatus();
  // The month name, read once (calling Date during render isn't pure).
  const [month] = useState(() => new Date().toLocaleString(undefined, { month: 'long' }));
  if (usage.isPending) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (!usage.isSuccess) return null;
  const u = usage.data;
  return (
    <div className="space-y-2.5">
      <Card className="space-y-1 px-4 py-3.5">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] text-muted">AI spend · {month}</p>
          <Link to="/profile" className="-my-3 py-3 text-[13px] font-medium text-accent-fg">
            Budget
          </Link>
        </div>
        <p className="text-[26px] leading-8 font-bold tracking-[-0.03em] text-fg tabular-nums">
          {money(u.monthToDateUsd)} <span className="text-[13px] font-medium tracking-normal text-muted">of {money(u.settings.monthlyBudgetUsd)}</span>
        </p>
        <progress
          aria-label="Monthly budget used"
          max={Math.max(u.settings.monthlyBudgetUsd, 0.01)}
          value={Math.min(u.monthToDateUsd, u.settings.monthlyBudgetUsd)}
          className={`mt-1.5 block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-surface-2 [&::-moz-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-surface-2 [&::-webkit-progress-value]:rounded-full ${
            u.monthToDateUsd >= u.settings.monthlyBudgetUsd * 0.9
              ? '[&::-moz-progress-bar]:bg-danger [&::-webkit-progress-value]:bg-danger'
              : '[&::-moz-progress-bar]:bg-accent [&::-webkit-progress-value]:bg-accent'
          }`}
        />
      </Card>
      <div className="grid grid-cols-2 gap-2.5">
        <Card className="space-y-1 px-4 py-3.5">
          <p className="text-[13px] text-muted">Today</p>
          <p className="text-[26px] leading-8 font-bold tracking-[-0.03em] text-fg tabular-nums">{money(u.last24hUsd)}</p>
        </Card>
        <Card className="space-y-1 px-4 py-3.5">
          <p className="text-[13px] text-muted">Jobs this week</p>
          <p className="text-[26px] leading-8 font-bold tracking-[-0.03em] text-fg tabular-nums">{status.data?.jobsThisWeek ?? '–'}</p>
        </Card>
      </div>
    </div>
  );
}

// "24 jobs" opens the jobs list filtered to that source, across every pipeline stage.
export function JobsLink({ sourceId, count }: { sourceId: string; count: number }) {
  const label = `${count} ${count === 1 ? 'job' : 'jobs'}`;
  if (count === 0) return <>{label}</>;
  return (
    <Link to={`/?source=${sourceId}&tab=all`} className="font-medium text-accent-fg">
      {label}
    </Link>
  );
}

// A source that failed or came back empty — shown as such, never confused with "no jobs
// today" (Agents.md §9.5), with a retry for that source alone.
function AttentionRow({ source }: { source: DiscoverySource }) {
  const retry = useRunSource();
  const run = source.lastRun!;
  const failed = run.status === 'FAILED';
  return (
    <li className="space-y-2.5 px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-fg">{source.name}</p>
          <p className="text-xs text-muted">
            {providerLabel(source.provider)} · ran {timeAgo(source.lastRunAt)}
          </p>
        </div>
        <Badge tone={failed ? 'danger' : 'stretch'}>{failed ? 'Failed' : 'Empty'}</Badge>
      </div>
      {failed ? (
        <p className="rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-xs break-words text-fg">{run.errorMessage}</p>
      ) : (
        <p className="text-[13px] text-muted">The board returned no postings at all — check it still exists, or turn it off.</p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => retry.mutate(source.id)} disabled={retry.isPending || retry.isSuccess}>
          <RotateCw className="size-4" /> {retry.isSuccess ? 'Queued' : 'Retry'}
        </Button>
        {retry.isError && <p className="text-xs text-danger-fg">{retry.error.message}</p>}
      </div>
    </li>
  );
}

function SourceRow({ source }: { source: DiscoverySource }) {
  const toggle = useSetSourceEnabled();
  return (
    <li className="flex min-h-[68px] items-center gap-3 py-2.5 pr-3 pl-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[15px] font-semibold text-fg">{source.name}</p>
        <p className="text-xs text-muted tabular-nums">
          {providerLabel(source.provider)} · <JobsLink sourceId={source.id} count={source.jobCount} /> ·{' '}
          {source.isEnabled ? (source.lastRunAt ? `ran ${timeAgo(source.lastRunAt)}` : 'not run yet') : 'paused'}
        </p>
        {toggle.isError && <p className="text-xs text-danger-fg">{toggle.error.message}</p>}
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

// Sources (design board 5): AI spend, sources that need attention, the healthy ones, and
// Gmail. Finding new jobs now lives on the Jobs page.
export function SourcesPage() {
  const sources = useSources();
  const [showPlanned, setShowPlanned] = useState(false);
  const active = (sources.data ?? []).filter((s) => s.supported);
  const planned = (sources.data ?? []).filter((s) => !s.supported);
  const attention = active.filter(needsAttention);
  const healthy = active.filter((s) => !needsAttention(s));

  return (
    <main className="mx-auto max-w-2xl space-y-3">
      <PageHeader title="Sources" />
      <SpendTiles />

      {sources.isPending && <Skeleton className="h-64 w-full rounded-2xl" />}
      {sources.isError && <p className="text-danger-fg">Couldn't load sources: {sources.error.message}</p>}
      {sources.isSuccess && sources.data.length === 0 && (
        <p className="text-sm text-muted">
          No sources yet. Seed them with <code className="rounded bg-surface-2 px-1">pnpm --filter @shortlist/db db:seed:sources</code>.
        </p>
      )}

      {attention.length > 0 && (
        <section aria-labelledby="attention" className="space-y-2 pt-2">
          <SectionLabel>
            <span id="attention">
              Needs attention · <span className="tabular-nums">{attention.length}</span>
            </span>
          </SectionLabel>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {attention.map((s) => (
              <AttentionRow key={s.id} source={s} />
            ))}
          </ul>
        </section>
      )}

      {healthy.length > 0 && (
        <section aria-labelledby="healthy" className="space-y-2 pt-2">
          <SectionLabel>
            <span id="healthy">Healthy</span>
          </SectionLabel>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {healthy.map((s) => (
              <SourceRow key={s.id} source={s} />
            ))}
          </ul>
        </section>
      )}

      {planned.length > 0 && (
        <section>
          <Button variant="ghost" aria-expanded={showPlanned} onClick={() => setShowPlanned((v) => !v)} className="w-full font-medium">
            {showPlanned ? 'Hide' : 'Show'} {planned.length} recorded for later
            <ChevronDown className={`size-4 transition ${showPlanned ? 'rotate-180' : ''}`} />
          </Button>
          {showPlanned && (
            <ul className="mt-1 divide-y divide-border rounded-2xl border border-border bg-surface text-sm">
              {planned.map((s) => (
                <li key={s.id} className="flex justify-between gap-3 px-4 py-3">
                  <span className="text-fg">{s.name}</span>
                  <span className="text-muted">{s.provider.replace('_', ' ')} · coming later</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="gmail" className="space-y-2 pt-2">
        <SectionLabel>
          <span id="gmail">Gmail</span>
        </SectionLabel>
        <GmailCard />
      </section>
    </main>
  );
}
