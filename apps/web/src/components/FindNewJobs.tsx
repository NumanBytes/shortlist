import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { timeAgo, timeUntil } from '../lib/format';
import { jobKeys, useDiscoveryStatus, useRunDiscovery } from '../lib/queries';
import type { RunNowResult } from '../lib/types';
import { useNow } from '../lib/useNow';
import { useToast } from './Toast';
import { Button } from './ui';

// After a tap, watch closely this long: the worker may take a few seconds to pick the
// sources up, and until it does there's no RUNNING run to see.
const WATCH_MS = 90_000;

const nightly = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;

// How fresh the New list is, and a way to look for new jobs now instead of waiting for the
// nightly run (Agents.md §9.9). It only queues work — the worker fetches — so it says when
// no worker is running instead of pretending to check.
export function FindNewJobs() {
  const [watchUntil, setWatchUntil] = useState(0);
  const now = useNow(5000);
  const watching = now < watchUntil;
  const status = useDiscoveryStatus(watching);
  const run = useRunDiscovery();
  const toast = useToast();
  const queryClient = useQueryClient();

  const running = (status.data?.running ?? 0) > 0;
  // Without a worker nothing will start, so don't show "Queued…" — the warning says why.
  const busy = running || run.isPending || (watching && status.data?.workerOnline !== false);

  // The run started and has now finished: stop watching early.
  const sawRunning = useRef(false);
  useEffect(() => {
    if (running) sawRunning.current = true;
    else if (sawRunning.current) {
      sawRunning.current = false;
      setWatchUntil(0);
    }
  }, [running]);

  // When checking ends, refresh the lists so what it found appears.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.sources });
    }
    wasBusy.current = busy;
  }, [busy, queryClient]);

  const start = () =>
    run.mutate(undefined, {
      onSuccess: (r) => {
        toast({ text: summary(r) });
        if (r.queued.length || r.emailQueued) setWatchUntil(Date.now() + WATCH_MS);
      },
      onError: (err) => toast({ text: err.message }),
    });

  const s = status.data;
  const next = nightly(s?.nextNightlyAt ?? null);
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs text-muted">
          {busy ? (
            <p className="flex items-center gap-1.5 font-medium text-fg">
              <Loader2 className="size-3.5 animate-spin text-accent" />
              {running ? `Checking ${s!.running} ${s!.running === 1 ? 'source' : 'sources'}…` : 'Queued — starting…'}
            </p>
          ) : (
            <p className="font-medium text-fg">Last checked {timeAgo(s?.lastCheckedAt ?? null)}</p>
          )}
          {next && <p className="truncate">Checks automatically every night at {next}</p>}
        </div>
        <Button size="sm" variant="secondary" onClick={start} disabled={busy || s?.enabledSources === 0}>
          <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> Find new jobs
        </Button>
      </div>
      {s?.workerOnline === false && (
        <output className="mt-2 flex gap-1.5 text-xs text-stretch-fg">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          The background worker isn't running, so checks wait in the queue until it starts.
        </output>
      )}
      {!busy && s?.availableAt && (
        <p className="mt-1 text-xs text-subtle">
          Every source was checked in the last {s.cooldownHours}h — they can be checked again {timeUntil(s.availableAt, now)}.
        </p>
      )}
    </div>
  );
}

function summary(r: RunNowResult): string {
  const email = r.emailQueued ? ' and your Gmail alerts' : '';
  if (r.queued.length) return `Checking ${r.queued.length} ${r.queued.length === 1 ? 'source' : 'sources'}${email} for new jobs`;
  if (r.emailQueued) return `Checking your Gmail alerts — every board was checked in the last ${r.cooldownHours}h`;
  return `Every source was checked in the last ${r.cooldownHours}h — try again later`;
}
