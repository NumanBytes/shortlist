import { AlertTriangle, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { timeAgo } from '../../lib/format';
import { gmailKeys, useCheckGmail, useConnectGmail, useDisconnectGmail, useGmail } from '../../lib/queries';
import type { GmailStatus } from '../../lib/types';
import { Badge, Button, Card, Skeleton } from '../../components/ui';

// What happened on the way back from Google (?gmail=… set by the API's callback).
const OUTCOME: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Gmail connected. The first check is running — it reads only your Shortlist label.' },
  denied: { ok: false, text: 'You cancelled on Google’s screen. Nothing was connected.' },
  expired: { ok: false, text: 'That attempt took longer than 10 minutes. Try again.' },
  mismatch: { ok: false, text: 'That sign-in didn’t start in this browser, so it was refused. Start again from here.' },
  scope: { ok: false, text: 'Read access to Gmail wasn’t granted. Tick it on Google’s screen to connect.' },
  no_refresh_token: { ok: false, text: 'Google didn’t grant offline access. Remove Shortlist at myaccount.google.com/permissions, then connect again.' },
  google_error: { ok: false, text: 'Google returned an error. Try again in a minute.' },
};
const POLLS = 15;

// Email job alerts (docs/email-alerts.md §10): connect the personal Gmail read-only; Shortlist reads
// only the "Shortlist" label and never sends anything.
export function GmailCard() {
  const [params, setParams] = useSearchParams();
  const outcome = params.get('gmail');
  // About a minute of polling (15 × 4s) after connecting or "Check now".
  const [pollUntil, setPollUntil] = useState(() => (outcome === 'connected' ? POLLS : 0));
  const gmail = useGmail(pollUntil);
  const queryClient = useQueryClient();
  const startPolling = () => setPollUntil((queryClient.getQueryState(gmailKeys.status)?.dataUpdateCount ?? 0) + POLLS);

  return (
    <Card className="p-4">
      {!gmail.data?.connection && (
        <div className="mb-3 flex items-center gap-2">
          <Mail className="size-5 text-muted" strokeWidth={1.75} />
          <h2 className="text-[15px] font-semibold text-fg">Email job alerts</h2>
        </div>
      )}

      {outcome && OUTCOME[outcome] && (
        <div
          role={OUTCOME[outcome].ok ? undefined : 'alert'}
          className={`mt-3 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${OUTCOME[outcome].ok ? 'bg-apply-bg text-apply-fg' : 'bg-danger-bg text-danger-fg'}`}
        >
          <span>{OUTCOME[outcome].text}</span>
          <button type="button" className="shrink-0 text-xs underline" onClick={() => setParams({}, { replace: true })}>
            Dismiss
          </button>
        </div>
      )}

      <div className="text-sm">
        {gmail.isPending && <Skeleton className="h-16 w-full" />}
        {gmail.isError && <p className="text-danger-fg">Couldn't load: {gmail.error.message}</p>}
        {gmail.data && <Body status={gmail.data} onCheck={startPolling} />}
      </div>
    </Card>
  );
}

function Body({ status, onCheck }: { status: GmailStatus; onCheck: () => void }) {
  const connect = useConnectGmail();
  const check = useCheckGmail();
  const disconnect = useDisconnectGmail();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const goToGoogle = () => connect.mutate(undefined, { onSuccess: ({ url }) => window.location.assign(url) });
  const c = status.connection;

  if (!status.configured) {
    return (
      <p className="text-muted">
        Not set up on this server yet: it needs a Google OAuth client (GOOGLE_* and TOKEN_ENCRYPTION_KEY in the API and
        worker env). See docs/email-alerts.md §10.6.
      </p>
    );
  }

  if (!c) {
    return (
      <div className="space-y-3">
        <ul className="space-y-1.5 text-muted">
          {[
            'Read-only: Shortlist can’t send, delete or change mail.',
            'Reads only messages with your “Shortlist” label — set a Gmail filter to label job alerts.',
            'You can revoke it any time, here or in your Google account.',
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" /> {line}
            </li>
          ))}
        </ul>
        <Button onClick={goToGoogle} disabled={connect.isPending}>
          <Mail className="size-4" /> {connect.isPending ? 'Opening Google…' : 'Connect Gmail'}
        </Button>
        <FilterHelp />
        {connect.isError && <p className="text-danger-fg">{connect.error.message}</p>}
      </div>
    );
  }

  const s = status.last30Days;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
          <Mail className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-fg">Connected as {c.emailAddress}</p>
          <p className="text-xs text-muted">
            Reads only the label <b className="font-semibold text-fg">{c.labelName}</b> · checked{' '}
            {c.lastCheckedAt ? timeAgo(c.lastCheckedAt) : 'not yet'}
          </p>
        </div>
        {c.status === 'ACTIVE' ? <Badge tone="accent">On</Badge> : <Badge tone="danger">Reconnect</Badge>}
      </div>
      {c.lastError && (
        <p className="flex gap-2 rounded-lg bg-danger-bg px-3 py-2 text-danger-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {c.lastError}
        </p>
      )}
      <p className="text-xs text-muted">
        {c.lastCheckedAt
          ? `Last check: ${c.lastCheckStatus === 'FAILED' ? 'failed' : `${c.lastCheckFound ?? 0} new message${c.lastCheckFound === 1 ? '' : 's'}`}. `
          : ''}
        Checked every two hours. Last 30 days: {s.alerts} alert email{s.alerts === 1 ? '' : 's'} read
        {s.notAlerts > 0 && `, ${s.notAlerts} skipped as not alerts`}.
      </p>
      {s.portals.length > 0 && (
        <ul className="divide-y divide-border rounded-xl bg-surface-2 text-xs">
          {s.portals.map((p) => (
            <li key={p.portal} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-fg">{p.label}</span>
                <span className="text-muted tabular-nums">
                  {p.emails} email{p.emails === 1 ? '' : 's'} · {p.jobsFound} job{p.jobsFound === 1 ? '' : 's'}
                  {p.sourceId && p.jobsFound > 0 && (
                    <>
                      {' · '}
                      <Link
                        to={`/?source=${p.sourceId}&tab=all`}
                        className="font-medium text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
                      >
                        View jobs
                      </Link>
                    </>
                  )}
                </span>
              </div>
              {p.lastRun && (
                <p className="text-subtle">
                  Last: {p.lastRun.jobsNew} new{p.lastRun.finishedAt ? `, ${timeAgo(p.lastRun.finishedAt)}` : ''}
                </p>
              )}
              {p.parserWarnings > 0 && (
                // A code parser found nothing in what looked like an alert, and the model read
                // it instead (docs/email-alerts.md §10.4) — the portal likely changed its email layout.
                <p className="mt-0.5 flex gap-1.5 text-stretch-fg">
                  <AlertTriangle className="size-3.5 shrink-0" /> {p.label}'s email layout may have changed — read by AI for now
                  ({p.parserWarnings})
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {(s.deferred > 0 || s.failed > 0) && (
        <p className="text-xs text-muted">
          {s.deferred > 0 && `${s.deferred} waiting for AI budget (read on the next check). `}
          {s.failed > 0 && `${s.failed} couldn't be read.`}
        </p>
      )}
      {confirmDisconnect ? (
        <div className="space-y-2 rounded-xl bg-danger-bg p-3">
          <p className="text-fg">Disconnect and revoke Shortlist's access at Google?</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmDisconnect(false)}>
              Cancel
            </Button>
            <Button variant="danger" className="bg-surface" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {c.status === 'ACTIVE' ? (
            <Button variant="secondary" onClick={() => check.mutate(undefined, { onSuccess: onCheck })} disabled={check.isPending}>
              <RefreshCw className="size-4" /> {check.isPending ? 'Queuing…' : 'Check now'}
            </Button>
          ) : (
            <Button onClick={goToGoogle} disabled={connect.isPending}>
              <Mail className="size-4" /> Reconnect Gmail
            </Button>
          )}
          <Button variant="danger" onClick={() => setConfirmDisconnect(true)}>
            Disconnect
          </Button>
        </div>
      )}
      <FilterHelp />
      {(check.isError || disconnect.isError || connect.isError) && (
        <p className="text-danger-fg">{(check.error ?? disconnect.error ?? connect.error)?.message}</p>
      )}
    </div>
  );
}

// Shortlist can't create the filter (read-only scope), so the user does, once.
function FilterHelp() {
  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg">How to label job alerts in Gmail</summary>
      <ol className="list-decimal space-y-1 border-t border-border py-2 pr-3 pl-8 text-sm text-muted">
        <li>Open a job-alert email from one portal (LinkedIn, Indeed, Rozee.pk, Wellfound…).</li>
        <li>
          Click <strong className="text-fg">▾</strong> next to “to me” and copy the <strong className="text-fg">from</strong>{' '}
          address (e.g. donotreply@jobalert.indeed.com).
        </li>
        <li>
          Click <strong className="text-fg">⋮ → Filter messages like these</strong>. Put that address in{' '}
          <strong className="text-fg">From</strong> and clear anything Gmail filled in (such as “list:…” — it would match only
          one alert), then <strong className="text-fg">Create filter</strong>.
        </li>
        <li>
          Tick <strong className="text-fg">Apply the label</strong> → New label “Shortlist”, and{' '}
          <strong className="text-fg">Also apply filter to matching conversations</strong>.
        </li>
        <li>Repeat for each portal. Only labelled mail is ever read.</li>
      </ol>
    </details>
  );
}
