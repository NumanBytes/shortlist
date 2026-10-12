import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleX, Clock, FileText, RefreshCw, RotateCw, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { elapsed } from '../../lib/format';
import { PushLink } from '../../components/PushLink';
import {
  TAILOR_POLL_LIMIT_MS,
  resumeKeys,
  useCancelTailoring,
  useJobResume,
  usePrepareResume,
} from '../../lib/queries';
import type { JobDetail, JobResume } from '../../lib/types';
import { useNow } from '../../lib/hooks/useNow';
import { Badge, Button, Card, Sheet, buttonStyles } from '../../components/ui';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// The job's resume (docs/resume.md §13): reuse an approved one, tailor a new one, or open the
// one it has. Shown once the user marks a job Interested — tailoring costs money, so it
// never starts on its own.
export function ResumeSection({ job }: { job: JobDetail }) {
  const wanted = job.status !== 'DISCOVERED' && job.status !== 'SKIPPED';
  const resume = useJobResume(job.id, wanted);
  if (job.status === 'SKIPPED') return null;

  return (
    <section aria-labelledby="resume-heading">
      <Card className="p-4">
        <div className="flex items-center gap-2.5">
          <FileText className="size-5 text-muted" strokeWidth={1.75} aria-hidden="true" />
          <h2 id="resume-heading" className="flex-1 text-[15px] font-semibold text-fg">
            Resume for this job
          </h2>
          {resume.data?.variant && <VariantBadge resume={resume.data} />}
        </div>
        <div className="mt-3 text-sm">
          {job.status === 'DISCOVERED' ? (
            <p className="text-muted">Mark it Interested to prepare a tailored resume.</p>
          ) : (
            <>
              {resume.isPending && <p className="text-muted">Loading…</p>}
              {resume.isError && <p className="text-danger-fg">Couldn't load the resume: {resume.error.message}</p>}
              {resume.data && <Body job={job} resume={resume.data} />}
            </>
          )}
        </div>
      </Card>
    </section>
  );
}

// A tinted message box inside the card: warnings, failures, the stalled state.
function Callout({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'stretch' | 'danger';
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  const tones = { stretch: 'bg-stretch-bg', danger: 'bg-danger-bg' };
  const iconTone = { stretch: 'text-stretch-fg', danger: 'text-danger-fg' };
  return (
    <div className={`rounded-[14px] p-3.5 ${tones[tone]}`}>
      <div className="flex gap-2.5">
        <span className={`mt-px shrink-0 ${iconTone[tone]}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">{title}</p>
          {children && <div className="mt-0.5 text-[13px] text-muted">{children}</div>}
        </div>
      </div>
    </div>
  );
}

const SLOW_MS = 2 * 60 * 1000;

// Never an endless spinner (docs/resume.md §13.1): show how long it has waited, and say plainly
// when nothing can be happening — no worker running — or when it has taken far too long.
// No fake step-by-step progress: the worker doesn't report steps, so none are shown.
export function TailoringProgress({ jobId, resume }: { jobId: string; resume: JobResume }) {
  const now = useNow();
  const queryClient = useQueryClient();
  const cancel = useCancelTailoring();
  // Cancel removes a run that hasn't started (nothing is charged); one the worker is
  // already writing can't be recalled, and the API says so.
  const cancelButton = (
    <>
      <Button variant="ghost" className="w-full" onClick={() => cancel.mutate(jobId)} disabled={cancel.isPending}>
        {cancel.isPending ? 'Cancelling…' : 'Cancel'}
      </Button>
      {cancel.isError && <p className="text-center text-xs text-danger-fg">{cancel.error.message}</p>}
    </>
  );
  const waited = resume.queuedAt ? now - new Date(resume.queuedAt).getTime() : 0;
  const time = elapsed(resume.queuedAt, now);

  if (resume.workerOnline === false) {
    return (
      <div className="space-y-1">
        <output className="block">
          <Callout
            tone="stretch"
            icon={<AlertTriangle className="size-[18px]" />}
            title="Still waiting — the background worker isn't running."
          >
            Queued {time} ago, so tailoring hasn't started. Nothing has been charged. It starts by itself once the
            worker is back.
          </Callout>
        </output>
        {cancelButton}
      </div>
    );
  }
  if (waited > TAILOR_POLL_LIMIT_MS) {
    return (
      <div className="space-y-2.5">
        <output className="block">
          <Callout
            tone="stretch"
            icon={<AlertTriangle className="size-[18px]" />}
            title={`Still waiting after ${time}`}
          >
            Far longer than tailoring takes. Something is stuck.
          </Callout>
        </output>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => void queryClient.invalidateQueries({ queryKey: resumeKeys.job(jobId) })}
          >
            <RotateCw className="size-4" /> Check again
          </Button>
          <Button variant="ghost" onClick={() => cancel.mutate(jobId)} disabled={cancel.isPending}>
            Cancel
          </Button>
        </div>
        {cancel.isError && <p className="text-center text-xs text-danger-fg">{cancel.error.message}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <output className="block space-y-2.5">
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-accent border-r-transparent"
          />
          <span className="flex-1 font-semibold text-fg">Tailoring from your verified evidence</span>
          <span className="text-[13px] text-muted tabular-nums">{time}</span>
        </span>
        {/* Indeterminate: it moves, but claims no percentage it doesn't know. */}
        <span aria-hidden="true" className="relative block h-1.5 overflow-hidden rounded-full bg-surface-2">
          <span className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-accent motion-reduce:animate-none" />
        </span>
        <span className="block text-xs text-muted">
          {waited > SLOW_MS
            ? 'Taking longer than usual — Claude may be busy; it retries on its own.'
            : 'Usually under a minute. Runs on the server — you can leave this page.'}
        </span>
      </output>
      {cancelButton}
    </div>
  );
}

function VariantBadge({ resume }: { resume: JobResume }) {
  const v = resume.variant!;
  if (v.stale.length) return <Badge tone="danger">Out of date</Badge>;
  return v.status === 'APPROVED' ? (
    <Badge tone="accent">Approved</Badge>
  ) : (
    <Badge tone="stretch">Draft — review it</Badge>
  );
}

function Body({ job, resume }: { job: JobDetail; resume: JobResume }) {
  const prepare = usePrepareResume();
  const tailor = () => prepare.mutate({ jobId: job.id, body: { mode: 'tailor' } });
  const busy = prepare.isPending;
  const error = prepare.isError && <p className="text-danger-fg">{prepare.error.message}</p>;

  const pending = resume.status === 'PENDING' && <TailoringProgress jobId={job.id} resume={resume} />;
  const problem =
    resume.status === 'FAILED' ? (
      <Callout
        tone="danger"
        icon={<CircleX className="size-[18px]" />}
        title={`Tailoring failed: ${resume.error ?? 'unknown error'}`}
      />
    ) : resume.status === 'DEFERRED' ? (
      <Callout
        tone="stretch"
        icon={<Clock className="size-[18px]" />}
        title={`Tailoring deferred: ${resume.error ?? ''}`}
      >
        It runs once there's budget again —{' '}
        <Link to="/profile" className="font-medium text-accent-fg underline-offset-2 hover:underline">
          change the monthly cap
        </Link>
        .
      </Callout>
    ) : null;

  // A resume this job already has stays reachable whatever happens to a new attempt: a
  // failed, deferred or running "Tailor again" must not hide it (code review).
  const v = resume.variant;
  if (v) {
    const bullets = [...v.content.experience, ...v.content.projects].reduce((n, s) => n + s.bullets.length, 0);
    const stale = v.stale.length > 0;
    const current = resume.status === 'READY';
    const approved = v.status === 'APPROVED' && !stale;
    return (
      <div className="space-y-3">
        {pending}
        {problem}
        {(pending || problem) && <p className="text-xs text-muted">Your current resume for this job is still below.</p>}
        {stale ? (
          <Callout
            tone="stretch"
            icon={<RefreshCw className="size-[18px]" />}
            title="Evidence it uses has changed — tailor again before sending"
          >
            {v.stale.join(' · ')}
          </Callout>
        ) : (
          <div>
            <p className="font-semibold text-fg">
              {approved ? `Approved ${v.approvedAt ? shortDate(v.approvedAt) : ''}` : 'Resume ready to review'}
            </p>
            <p className="text-[13px] text-muted">
              {resume.reused && current
                ? `Reusing a resume you approved — ${Math.round((resume.overlap ?? 0) * 100)}% of this job's requirements.`
                : `${bullets} bullets, each from your own verified words.`}
              {v.content.dropped.length > 0 && ` ${v.content.dropped.length} removed by the truthfulness checks.`}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <PushLink
            to={`/jobs/${job.id}/resume`}
            dir="forward"
            className={`${buttonStyles(stale ? 'secondary' : 'primary')} ${resume.status !== 'PENDING' && resume.canTailor ? '' : 'col-span-2'}`}
          >
            <FileText className="size-4" /> {approved ? 'Open & save PDF' : 'Review'}
          </PushLink>
          {resume.status !== 'PENDING' && resume.canTailor && (
            <TailorAgain
              onConfirm={tailor}
              busy={busy}
              needsConfirm={!stale}
              approvedAt={v.approvedAt ?? v.generatedAt}
            />
          )}
        </div>
        {error}
      </div>
    );
  }

  if (pending) return pending;

  return (
    <div className="space-y-3">
      {problem}
      {resume.reuse.map((r) => (
        <div key={r.variantId} className="space-y-3">
          <div className="flex items-center gap-3 rounded-[14px] bg-surface-2 p-3">
            <span
              aria-hidden="true"
              className="grid h-11 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface"
            >
              <FileText className="size-4 text-muted" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-fg">Reuse your approved resume</p>
              <p className="text-[13px] text-muted">
                {/* Not a score: how much of this job's requirement list the resume was built for. */}
                <span className="font-semibold text-accent-fg">
                  Covers {Math.round(r.overlap * 100)}% of this job's requirements
                </span>
                {r.approvedAt && ` · approved ${shortDate(r.approvedAt)}`}
              </p>
              {r.usedFor.length > 0 && <p className="truncate text-xs text-muted">Used for {r.usedFor.join(', ')}</p>}
            </div>
          </div>
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => prepare.mutate({ jobId: job.id, body: { mode: 'reuse', variantId: r.variantId } })}
          >
            Reuse resume
          </Button>
        </div>
      ))}
      {resume.canTailor ? (
        <div className="space-y-2">
          <Button
            onClick={tailor}
            disabled={busy}
            variant={resume.reuse.length ? 'secondary' : 'primary'}
            className="w-full"
          >
            <Sparkles className="size-4" />
            {busy
              ? 'Queuing…'
              : resume.reuse.length
                ? 'Tailor fresh'
                : resume.status === 'NONE'
                  ? 'Tailor a resume'
                  : 'Try again'}
            <span className="font-normal opacity-80">~$0.03</span>
          </Button>
          <p className="text-xs text-muted">Uses only your verified evidence. Takes about a minute.</p>
        </div>
      ) : resume.needsDescription ? (
        <p className="text-muted">
          The alert only had a summary. Paste the full description above, and a resume can be tailored to it.
        </p>
      ) : (
        <p className="text-muted">Tailoring uses this job's requirements, so it can start once scoring finishes.</p>
      )}
      {error}
    </div>
  );
}

// Re-tailoring costs money and replaces a resume you may already have reviewed, so it
// asks first (the design's confirm sheet) — unless the resume is out of date and must be
// redone anyway.
function TailorAgain({
  onConfirm,
  busy,
  needsConfirm,
  approvedAt,
}: {
  onConfirm: () => void;
  busy: boolean;
  needsConfirm: boolean;
  approvedAt: string;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => (needsConfirm ? setConfirming(true) : onConfirm())} disabled={busy}>
        <RotateCw className="size-4" /> Tailor again
      </Button>
      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Tailor again?"
        footer={
          <div className="space-y-1">
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                setConfirming(false);
                onConfirm();
              }}
              disabled={busy}
            >
              Yes, tailor · ~$0.03
            </Button>
            <Button size="lg" variant="ghost" className="w-full" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        }
      >
        <div className="grid size-11 place-items-center rounded-xl bg-stretch-bg text-stretch-fg">
          <RefreshCw className="size-5" />
        </div>
        <p className="mt-3 text-[17px] font-semibold text-fg">Tailor again?</p>
        <p className="mt-1 text-[15px] text-muted">
          This replaces the resume from {shortDate(approvedAt)} and needs a fresh review. It costs about $0.03 and takes
          a minute.
        </p>
      </Sheet>
    </>
  );
}
