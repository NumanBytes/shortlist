import { AddSourceSchema } from '@shortlist/shared';
import { ChevronDown, Pencil, Plus, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../layout/AppShell';
import { GmailCard } from './GmailCard';
import { AdminCode, AdminNote } from '../../components/AdminNote';
import { useToast } from '../../components/Toast';
import { Badge, Button, Card, IconButton, SectionLabel, Sheet, Skeleton, Switch, TextField } from '../../components/ui';
import { providerLabel, timeAgo } from '../../lib/format';
import {
  useAiUsage,
  useDiscoveryStatus,
  useAddSource,
  useRemoveSource,
  useRunSource,
  useSetSourceAddress,
  useSetSourceEnabled,
  useSources,
} from '../../lib/queries';
import type { DiscoverySource } from '../../lib/types';

const needsAttention = (s: DiscoverySource) =>
  s.isEnabled && (s.lastRun?.status === 'FAILED' || s.lastRun?.status === 'EMPTY');
const money = (n: number) => `$${n.toFixed(2)}`;

// What AI costs (docs/ai-scoring.md §12.3) — the budget itself is changed on Profile.
function SpendTiles() {
  const usage = useAiUsage();
  const status = useDiscoveryStatus();
  // The month name, read once (calling Date during render isn't pure).
  const [month] = useState(() => new Date().toLocaleString(undefined, { month: 'long' }));
  if (usage.isPending) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (!usage.isSuccess) return null;
  const u = usage.data;
  return (
    <div className="space-y-2.5">
      <Card className="space-y-1 px-4 py-3.5">
        <div className="flex items-baseline justify-between">
          <p className="text-footnote text-muted">AI spend · {month}</p>
          <Link to="/profile?tab=settings" className="-my-3 py-3 text-footnote font-medium text-accent-fg">
            Budget
          </Link>
        </div>
        <p className="text-title font-bold tracking-[-0.03em] text-fg tabular-nums">
          {money(u.monthToDateUsd)}{' '}
          <span className="text-footnote font-medium tracking-normal text-muted">
            of {money(u.settings.monthlyBudgetUsd)}
          </span>
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
          <p className="text-footnote text-muted">Today</p>
          <p className="text-title font-bold tracking-[-0.03em] text-fg tabular-nums">{money(u.last24hUsd)}</p>
        </Card>
        <Card className="space-y-1 px-4 py-3.5">
          <p className="text-footnote text-muted">Jobs this week</p>
          <p className="text-title font-bold tracking-[-0.03em] text-fg tabular-nums">
            {status.data?.jobsThisWeek ?? '–'}
          </p>
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

// "Greenhouse · " before a row's details — skipped when the provider is the source's own
// name (an aggregator like Remote OK read "Remote OK · Remote OK", UI audit S3).
const providerPrefix = (source: DiscoverySource) => {
  const p = providerLabel(source.provider);
  return p === source.name ? '' : `${p} · `;
};

// A source that failed or came back empty — shown as such, never confused with "no jobs
// today" (docs/discovery.md §9.5), with a retry for that source alone.
function AttentionRow({ source }: { source: DiscoverySource }) {
  const retry = useRunSource();
  const [editing, setEditing] = useState(false);
  const run = source.lastRun!;
  const failed = run.status === 'FAILED';
  return (
    <li className="space-y-2.5 px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-fg">{source.name}</p>
          <p className="text-caption text-muted">
            {providerPrefix(source)}ran {timeAgo(source.lastRunAt)}
          </p>
        </div>
        <Badge tone={failed ? 'danger' : 'stretch'}>{failed ? 'Failed' : 'Empty'}</Badge>
      </div>
      {failed ? (
        <p className="rounded-sm bg-surface-2 px-2.5 py-2 font-mono text-caption break-words text-fg">
          {run.errorMessage}
        </p>
      ) : (
        <p className="text-footnote text-muted">
          The board returned no postings at all — check it still exists, or turn it off.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => retry.mutate(source.id)}
          disabled={retry.isPending || retry.isSuccess}
        >
          <RotateCw className="size-4" /> {retry.isSuccess ? 'Queued' : 'Retry'}
        </Button>
        {editable(source) && (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Edit URL
          </Button>
        )}
      </div>
      {retry.isError && <p className="text-caption text-danger-fg">{retry.error.message}</p>}
      {editable(source) && (
        <Sheet open={editing} onClose={() => setEditing(false)} title={`Edit ${source.name}'s address`}>
          <AddressForm source={source} onDone={() => setEditing(false)} />
        </Sheet>
      )}
    </li>
  );
}

// A company board or page has an address the user can change, and can be removed;
// aggregators (fixed addresses) can only be paused.
const editable = (s: DiscoverySource) => s.board !== null || s.link !== null;

// "Edit URL" (design board 5): a company board that moved gets its new link — or just its
// name; a careers page gets its new link (which may now be a board — the API re-detects it).
// The cooldown is cleared so Retry works at once. Remove deletes the source; jobs it found
// stay (docs/discovery.md §9.15).
function AddressForm({ source, onDone }: { source: DiscoverySource; onDone: () => void }) {
  const save = useSetSourceAddress();
  const remove = useRemoveSource();
  const toast = useToast();
  const [address, setAddress] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const board = source.board !== null;
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: source.id, address }, { onSuccess: onDone });
      }}
    >
      <p className="text-footnote text-muted">
        {source.name} on {providerLabel(source.provider)} — now{' '}
        <span className="font-mono break-all text-fg">{source.board ?? source.link}</span>.{' '}
        {board ? "Paste the board's new link, or just its name." : 'Paste the new link to its jobs page.'}
      </p>
      <TextField
        id="board-address"
        label={board ? 'Board link or name' : 'Jobs page link'}
        inputMode="url"
        placeholder={board ? `e.g. ${source.board}` : 'https://company.com/careers'}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        error={save.error?.message}
      />
      <Button type="submit" size="lg" className="w-full" disabled={save.isPending || address.trim() === ''}>
        Save address
      </Button>
      <Button
        variant={confirmRemove ? 'danger' : 'ghost'}
        size="lg"
        className="w-full"
        disabled={remove.isPending}
        onClick={() => {
          if (!confirmRemove) return setConfirmRemove(true);
          remove.mutate(source.id, {
            onSuccess: () => {
              toast({ text: `${source.name} removed — the jobs it found stay` });
              onDone();
            },
            onError: (err) => toast({ text: err.message, tone: 'error' }),
          });
        }}
      >
        {confirmRemove ? `Yes, remove ${source.name}` : 'Remove source'}
      </Button>
    </form>
  );
}

// "Add a source": a company's jobs page becomes a row (docs/discovery.md §9.15). The link
// picks the platform; any page Shortlist doesn't recognise is watched as a careers page.
function AddSourceForm({ onDone }: { onDone: () => void }) {
  const add = useAddSource();
  const toast = useToast();
  const [v, setV] = useState({ name: '', link: '' });
  const [error, setError] = useState<{ name?: string; link?: string }>({});
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = AddSourceSchema.safeParse(v);
        if (!parsed.success) {
          const by = (k: string) => parsed.error.issues.find((i) => i.path[0] === k)?.message;
          return setError({ name: by('name'), link: by('link') });
        }
        setError({});
        add.mutate(parsed.data, {
          onSuccess: (s) => {
            toast({ text: `Added ${s.name} — checking it now` });
            onDone();
          },
        });
      }}
    >
      <p className="text-footnote text-muted">
        A company's careers page, or its Greenhouse, Lever, Workable or SmartRecruiters board. Shortlist checks it every
        night.
      </p>
      <TextField
        id="source-name"
        label="Company"
        value={v.name}
        onChange={(e) => setV({ ...v, name: e.target.value })}
        error={error.name}
      />
      <TextField
        id="source-link"
        label="Jobs page link"
        inputMode="url"
        autoComplete="url"
        placeholder="https://company.com/careers"
        value={v.link}
        onChange={(e) => setV({ ...v, link: e.target.value })}
        error={error.link ?? add.error?.message}
      />
      <Button type="submit" size="lg" className="w-full" disabled={add.isPending}>
        Add source
      </Button>
    </form>
  );
}

function SourceRow({ source }: { source: DiscoverySource }) {
  const toggle = useSetSourceEnabled();
  const [editing, setEditing] = useState(false);
  return (
    <li className="flex min-h-[68px] items-center gap-3 py-2.5 pr-3 pl-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-body font-semibold text-fg">{source.name}</p>
        <p className="text-caption text-muted tabular-nums">
          {providerPrefix(source)}
          <JobsLink sourceId={source.id} count={source.jobCount} /> ·{' '}
          {source.isEnabled ? (source.lastRunAt ? `ran ${timeAgo(source.lastRunAt)}` : 'not run yet') : 'paused'}
        </p>
        {toggle.isError && <p className="text-caption text-danger-fg">{toggle.error.message}</p>}
      </div>
      {editable(source) && (
        <IconButton label={`Edit ${source.name}`} onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
        </IconButton>
      )}
      <Switch
        checked={source.isEnabled}
        disabled={toggle.isPending}
        onChange={(isEnabled) => toggle.mutate({ id: source.id, isEnabled })}
        label={`Watch ${source.name}`}
      />
      {editable(source) && (
        <Sheet open={editing} onClose={() => setEditing(false)} title={`Edit ${source.name}`}>
          {editing && <AddressForm source={source} onDone={() => setEditing(false)} />}
        </Sheet>
      )}
    </li>
  );
}

// Sources (design board 5): AI spend, sources that need attention, the healthy ones, and
// Gmail. Finding new jobs now lives on the Jobs page.
export function SourcesPage() {
  const sources = useSources();
  const [showPlanned, setShowPlanned] = useState(false);
  const [adding, setAdding] = useState(false);
  const active = (sources.data ?? []).filter((s) => s.supported);
  const planned = (sources.data ?? []).filter((s) => !s.supported);
  const attention = active.filter(needsAttention);
  // Working sources split by whether they're being watched (UI audit S1): a paused one isn't
  // "healthy", it's off.
  const watching = active.filter((s) => !needsAttention(s) && s.isEnabled);
  const paused = active.filter((s) => !needsAttention(s) && !s.isEnabled);

  return (
    <main className="mx-auto max-w-2xl space-y-3">
      <PageHeader title="Sources" />
      <SpendTiles />

      {sources.isPending && <Skeleton className="h-64 w-full rounded-lg" />}
      {sources.isError && <p className="text-danger-fg">Couldn't load sources: {sources.error.message}</p>}
      {sources.isSuccess && sources.data.length === 0 && (
        <div className="text-footnote text-muted">
          <p>No sources yet. Add a company's jobs page, or connect Gmail below to read your job alerts.</p>
          <AdminNote>
            <p>Load the starter list of job boards:</p>
            <AdminCode>pnpm --filter @shortlist/db db:seed:sources</AdminCode>
          </AdminNote>
        </div>
      )}

      {attention.length > 0 && (
        <section aria-labelledby="attention" className="space-y-2 pt-2">
          <SectionLabel>
            <span id="attention">
              Needs attention · <span className="tabular-nums">{attention.length}</span>
            </span>
          </SectionLabel>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {attention.map((s) => (
              <AttentionRow key={s.id} source={s} />
            ))}
          </ul>
        </section>
      )}

      {(
        [
          ['watching', 'Watching', watching],
          ['paused', 'Paused', paused],
        ] as const
      ).map(
        ([id, label, list]) =>
          list.length > 0 && (
            <section key={id} aria-labelledby={id} className="space-y-2 pt-2">
              <SectionLabel>
                <span id={id}>
                  {label} · <span className="tabular-nums">{list.length}</span>
                </span>
              </SectionLabel>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {list.map((s) => (
                  <SourceRow key={s.id} source={s} />
                ))}
              </ul>
            </section>
          ),
      )}

      <Button variant="secondary" className="w-full" onClick={() => setAdding(true)}>
        <Plus className="size-4" /> Add a company's jobs page
      </Button>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a source">
        {adding && <AddSourceForm onDone={() => setAdding(false)} />}
      </Sheet>

      {planned.length > 0 && (
        <section>
          <Button
            variant="ghost"
            aria-expanded={showPlanned}
            onClick={() => setShowPlanned((v) => !v)}
            className="w-full font-medium"
          >
            {showPlanned ? 'Hide' : 'Show'} {planned.length} recorded for later
            <ChevronDown className={`size-4 transition ${showPlanned ? 'rotate-180' : ''}`} />
          </Button>
          {showPlanned && (
            <ul className="mt-1 divide-y divide-border rounded-lg border border-border bg-surface text-body">
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
