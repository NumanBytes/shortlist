import { CheckCircle2, ExternalLink, Mail, Star, Undo2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { nameSharedRing } from '../../lib/navigation';
import { useSearchParams } from 'react-router';
import { PushLink } from '../../components/PushLink';
import { returningRows, useSwipeRow, type SwipeDir } from '../../lib/hooks/useSwipeRow';
import { prettyLocation, sourceName, timeAgo } from '../../lib/format';
import { jobKeys, useSetJobStatus } from '../../lib/queries';
import type { JobListItem, JobStatus } from '../../lib/types';
import { PendingRing, ScoreRing } from '../../components/ScoreRing';
import { useToast } from '../../components/Toast';
import { Badge, IconButton } from '../../components/ui';
import { VerdictBadge } from '../../components/VerdictBadge';

const PIPELINE: JobStatus[] = ['APPLIED', 'ASSESSMENT', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'];
const MOVED: Partial<Record<JobStatus, string>> = {
  INTERESTED: 'Moved to Interested',
  SKIPPED: 'Skipped',
  DISCOVERED: 'Moved back to New',
};

// One job in the list: the score and what/where on top; source and quick actions in a
// footer row, so the row is only as tall as its content.
export function JobRow({ job, selected }: { job: JobListItem; selected: boolean }) {
  const [params] = useSearchParams();
  const setStatus = useSetJobStatus();
  const queryClient = useQueryClient();
  const ringRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const location = prettyLocation(job.location);
  const href = `/jobs/${job.id}${params.size ? `?${params}` : ''}`;
  const interested = job.status === 'INTERESTED';
  const applied = PIPELINE.includes(job.status);
  // Named, so a job from the user's own company list reads differently from a portal's.
  const source = `via ${sourceName(job)}`;
  const showMode = job.workMode && !(job.workMode === 'REMOTE' && /remote/i.test(location ?? ''));

  // A status change moves the job out of this list — confirm it, and offer Undo. Undo
  // marks the row so it slides back in when it reappears (motion spec, 200 ms reverse).
  const move = (status: JobStatus, dir: SwipeDir) =>
    setStatus.mutateAsync({ id: job.id, status }).then(() =>
      toast({
        text: MOVED[status] ?? 'Updated',
        action: {
          label: 'Undo',
          onClick: () => {
            returningRows.set(job.id, dir === 'right' ? 'left' : 'right');
            setStatus.mutate({ id: job.id, status: job.status });
          },
        },
      }),
    );

  // What each swipe does here: New → right Interested, left Skip; Interested → left back
  // to New; Skipped → right back to New. Applied jobs don't swipe.
  const actions: Partial<Record<SwipeDir, { status: JobStatus; label: string; icon: ReactNode; tone: string }>> =
    applied
      ? {}
      : job.status === 'SKIPPED'
        ? {
            right: {
              status: 'DISCOVERED',
              label: 'Back to New',
              icon: <Undo2 className="size-5" />,
              tone: 'bg-accent text-on-accent',
            },
          }
        : interested
          ? {
              left: {
                status: 'DISCOVERED',
                label: 'Back to New',
                icon: <Undo2 className="size-5" />,
                tone: 'bg-skip-bg text-skip-fg',
              },
            }
          : {
              right: {
                status: 'INTERESTED',
                label: 'Interested',
                icon: <Star className="size-5 fill-current" />,
                tone: 'bg-accent text-on-accent',
              },
              left: {
                status: 'SKIPPED',
                label: 'Skip',
                icon: <X className="size-5" />,
                tone: 'bg-skip-bg text-skip-fg',
              },
            };
  const { row, ...swipe } = useSwipeRow({
    id: job.id,
    allowed: { right: !!actions.right, left: !!actions.left },
    onCommit: (dir) => move(actions[dir]!.status, dir),
  });
  const under = swipe.dir ? actions[swipe.dir] : undefined;
  // The buttons play the same exit as a swipe, then do their own move.
  const busy = swipe.phase === 'exit' || swipe.phase === 'collapse';
  const press = (dir: SwipeDir, status: JobStatus) => swipe.commit(dir, () => move(status, dir));

  const meta = [job.company, location, job.salary].filter(Boolean).join(' · ');
  return (
    <li ref={row} style={swipe.rowStyle} className="relative rounded-2xl">
      {/* What letting go will do: green (right) or grey (left), behind the card. */}
      {under && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center gap-2 rounded-2xl px-5 text-sm font-semibold ${under.tone} ${swipe.dir === 'left' ? 'justify-end' : ''}`}
        >
          <span className={`transition-transform duration-150 ${swipe.armed ? 'scale-[1.15]' : ''}`}>{under.icon}</span>
          {under.label}
        </div>
      )}
      <div
        {...swipe.handlers}
        style={swipe.cardStyle}
        className={`relative rounded-2xl border bg-surface shadow-card select-none ${selected ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-fg/25'}`}
      >
        <PushLink
          to={href}
          dir="forward"
          // Name this card's ring for the shared-element transition, and fetch the job so the
          // detail's ring is on screen for the browser's "new" snapshot.
          onClick={() => nameSharedRing(ringRef.current, job.id)}
          before={() =>
            queryClient.prefetchQuery({ queryKey: jobKeys.detail(job.id), queryFn: () => api(`/jobs/${job.id}`) })
          }
          aria-current={selected ? 'page' : undefined}
          draggable={false}
          className="flex gap-3 rounded-t-2xl px-3.5 pt-3.5 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {job.match ? (
            <ScoreRing score={job.match.overallScore} verdict={job.match.verdict} ringRef={ringRef} />
          ) : (
            <PendingRing />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <h3 className="line-clamp-2 text-base leading-[21px] font-semibold tracking-[-0.01em] text-fg">
              {job.title}
            </h3>
            <p className="truncate text-[13px] text-muted">{meta}</p>
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {job.match && <VerdictBadge verdict={job.match.verdict} />}
              {showMode && (
                <Badge>
                  {job.workMode === 'ONSITE'
                    ? 'On-site'
                    : job.workMode!.charAt(0) + job.workMode!.slice(1).toLowerCase()}
                </Badge>
              )}
              {/* From an alert email: scored from a summary only (docs/email-alerts.md §10.5). */}
              {job.isPartial && (
                <Badge>
                  <Mail className="size-3" aria-hidden="true" /> From alert
                </Badge>
              )}
              {job.redFlags.length > 0 && <Badge tone="danger">Possible scam</Badge>}
              {job.analysisStatus === 'DEFERRED' && <Badge tone="stretch">Scoring deferred</Badge>}
              {job.analysisStatus === 'FAILED' && <Badge tone="danger">Scoring failed</Badge>}
              {job.analysisStatus === 'PENDING' && <Badge>{job.match ? 'Re-scoring…' : 'Scoring…'}</Badge>}
            </div>
          </div>
        </PushLink>

        <div className="mt-2.5 flex items-center border-t border-border py-0.5 pr-0.5 pl-3.5">
          <div className="flex min-w-0 flex-1 flex-col text-xs leading-4 text-muted">
            <span className="truncate">{source}</span>
            {/* The one time on the card: when Shortlist found it (user's choice, 2026-10-04). */}
            <time dateTime={job.discoveredAt} title={new Date(job.discoveredAt).toLocaleString()}>
              Found {timeAgo(job.discoveredAt)}
            </time>
          </div>
          <div className="flex shrink-0 items-center">
            {job.sourceUrl && (
              // You apply on the original posting — Shortlist never submits for you.
              // rel="noopener" but not "noreferrer": aggregators ask for referral traffic.
              <a
                href={job.sourceUrl}
                target="_blank"
                rel="noopener"
                aria-label="Open posting"
                title="Open posting"
                draggable={false}
                className="inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
              >
                <ExternalLink className="size-5" strokeWidth={1.75} />
              </a>
            )}
            {applied ? (
              <span
                className="inline-flex size-11 items-center justify-center text-apply"
                title="Applied"
                aria-label="Applied"
              >
                <CheckCircle2 className="size-5" />
              </span>
            ) : job.status === 'SKIPPED' ? (
              <IconButton label="Undo skip" onClick={() => press('right', 'DISCOVERED')} disabled={busy}>
                <Undo2 className="size-5" strokeWidth={1.75} />
              </IconButton>
            ) : (
              <>
                <IconButton
                  label={interested ? 'Remove from interested' : 'Mark interested'}
                  onClick={() => press(interested ? 'left' : 'right', interested ? 'DISCOVERED' : 'INTERESTED')}
                  disabled={busy}
                  className={interested ? 'text-stretch' : ''}
                >
                  <Star className={`size-5 ${interested ? 'fill-current' : ''}`} strokeWidth={1.75} />
                </IconButton>
                <IconButton label="Skip" onClick={() => press('left', 'SKIPPED')} disabled={busy}>
                  <X className="size-5" strokeWidth={1.75} />
                </IconButton>
              </>
            )}
          </div>
        </div>
        {setStatus.isError && <p className="px-3 pb-2 text-xs text-danger-fg">{setStatus.error.message}</p>}
      </div>
    </li>
  );
}
