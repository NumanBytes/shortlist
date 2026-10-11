import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { timeAgo, timeUntil } from '../lib/format';
import { jobKeys, useDiscoveryStatus, useGmail, useRunDiscovery } from '../lib/queries';
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
// nightly run (docs/discovery.md §9.9). It only queues work — the worker fetches — so it says when
// no worker is running instead of pretending to check.
export function FindNewJobs() {
  const [watchUntil, setWatchUntil] = useState(0);
  const now = useNow(5000);
  const watching = now < watchUntil;
  const status = useDiscoveryStatus(watching);
  const run = useRunDiscovery();
  const gmail = useGmail();
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
  // In the cooldown every board was checked recently, so tapping would only check Gmail —
  // still worth it when Gmail is connected; otherwise the button says when it's back.
  const gmailOn = gmail.data?.connection?.status === 'ACTIVE';
  const cooling = !busy && !!s?.availableAt && !gmailOn;
  const justChecked = s?.lastCheckedAt && now - new Date(s.lastCheckedAt).getTime() < 60_000;
  return (
    <div className="rounded-[14px] border border-border bg-surface">
      <div className="flex items-center gap-2 py-1 pr-1 pl-3.5">
        {busy ? (
          <span aria-hidden="true" className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-r-transparent" />
        ) : (
          <Clock className="size-4 shrink-0 text-muted" aria-hidden="true" />
        )}
        <p className={`min-w-0 flex-1 truncate text-[13px] ${busy ? 'font-medium text-fg' : 'text-muted'}`}>
          {busy
            ? running
              ? `Checking ${s!.running} ${s!.running === 1 ? 'source' : 'sources'}…`
              : 'Queued — starting…'
            : justChecked
              ? 'Checked just now'
              : `Last checked ${timeAgo(s?.lastCheckedAt ?? null)}`}
        </p>
        <Button
          size="sm"
          variant="tinted"
          onClick={start}
          disabled={busy || cooling || s?.enabledSources === 0}
          title={next ? `Also checks automatically every night at ${next}` : undefined}
        >
          {busy ? (
            <>
              <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" /> Checking
            </>
          ) : cooling ? (
            `Available again ${timeUntil(s!.availableAt!, now)}`
          ) : (
            <>
              <RefreshCw className="size-4" /> Check for new jobs
            </>
          )}
        </Button>
      </div>
      {s?.workerOnline === false && (
        <output className="flex gap-1.5 border-t border-border px-3.5 py-2 text-xs text-stretch-fg">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          The background worker isn't running, so checks wait in the queue until it starts.
        </output>
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
