import { CheckCircle2, ExternalLink, Mail, Star, Undo2, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { isAggregator, prettyLocation, providerLabel, timeAgo } from '../lib/format';
import { useSetJobStatus } from '../lib/queries';
import type { JobListItem, JobStatus } from '../lib/types';
import { PendingRing, ScoreRing } from './ScoreRing';
import { useToast } from './Toast';
import { Badge, IconButton } from './ui';
import { VerdictBadge } from './VerdictBadge';

const PIPELINE: JobStatus[] = ['APPLIED', 'ASSESSMENT', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'];
const MOVED: Partial<Record<JobStatus, string>> = { INTERESTED: 'Moved to Interested', SKIPPED: 'Skipped', DISCOVERED: 'Moved back to New' };

// One job in the list: the score and what/where on top; source and quick actions in a
// footer row, so the row is only as tall as its content.
export function JobRow({ job, selected }: { job: JobListItem; selected: boolean }) {
  const [params] = useSearchParams();
  const setStatus = useSetJobStatus();
  const toast = useToast();
  const location = prettyLocation(job.location);
  const href = `/jobs/${job.id}${params.size ? `?${params}` : ''}`;
  const interested = job.status === 'INTERESTED';
  const applied = PIPELINE.includes(job.status);
  // Company boards: the company IS the source, so say where, not who, again.
  const source = isAggregator(job) ? `via ${providerLabel(job.source)}` : 'via company site';
  const showMode = job.workMode && !(job.workMode === 'REMOTE' && /remote/i.test(location ?? ''));

  // A status change moves the job out of this list — confirm it, and offer Undo.
  const move = (status: JobStatus) =>
    setStatus.mutate(
      { id: job.id, status },
      {
        onSuccess: () =>
          toast({
            text: MOVED[status] ?? 'Updated',
            action: { label: 'Undo', onClick: () => setStatus.mutate({ id: job.id, status: job.status }) },
          }),
      },
    );

  const meta = [job.company, location, job.salary].filter(Boolean).join(' · ');
  return (
    <li
      className={`rounded-2xl border bg-surface shadow-card transition ${selected ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-fg/25'}`}
    >
      <Link
        to={href}
        aria-current={selected ? 'page' : undefined}
        className="flex gap-3 rounded-t-2xl px-3.5 pt-3.5 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {job.match ? <ScoreRing score={job.match.overallScore} verdict={job.match.verdict} /> : <PendingRing />}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <h3 className="line-clamp-2 text-base leading-[21px] font-semibold tracking-[-0.01em] text-fg">{job.title}</h3>
          <p className="truncate text-[13px] text-muted">{meta}</p>
          <div className="flex flex-wrap gap-1.5 pt-1.5">
            {job.match && <VerdictBadge verdict={job.match.verdict} />}
            {showMode && <Badge>{job.workMode === 'ONSITE' ? 'On-site' : job.workMode!.charAt(0) + job.workMode!.slice(1).toLowerCase()}</Badge>}
            {/* From an alert email: scored from a summary only (Agents.md §10.5). */}
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
      </Link>

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
              className="inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ExternalLink className="size-5" strokeWidth={1.75} />
            </a>
          )}
          {applied ? (
            <span className="inline-flex size-11 items-center justify-center text-apply" title="Applied" aria-label="Applied">
              <CheckCircle2 className="size-5" />
            </span>
          ) : job.status === 'SKIPPED' ? (
            <IconButton label="Undo skip" onClick={() => move('DISCOVERED')} disabled={setStatus.isPending}>
              <Undo2 className="size-5" strokeWidth={1.75} />
            </IconButton>
          ) : (
            <>
              <IconButton
                label={interested ? 'Remove from interested' : 'Mark interested'}
                onClick={() => move(interested ? 'DISCOVERED' : 'INTERESTED')}
                disabled={setStatus.isPending}
                className={interested ? 'text-stretch' : ''}
              >
                <Star className={`size-5 ${interested ? 'fill-current' : ''}`} strokeWidth={1.75} />
              </IconButton>
              <IconButton label="Skip" onClick={() => move('SKIPPED')} disabled={setStatus.isPending}>
                <X className="size-5" strokeWidth={1.75} />
              </IconButton>
            </>
          )}
        </div>
      </div>
      {setStatus.isError && <p className="px-3 pb-2 text-xs text-danger-fg">{setStatus.error.message}</p>}
    </li>
  );
}
