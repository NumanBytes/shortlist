import { CheckCircle2, ExternalLink, Star, Undo2, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { isAggregator, postedLabel, prettyLocation, providerLabel } from '../lib/format';
import { useSetJobStatus } from '../lib/queries';
import type { JobListItem, JobStatus } from '../lib/types';
import { PendingRing, ScoreRing } from './ScoreRing';
import { useToast } from './Toast';
import { Badge, IconButton } from './ui';

const PIPELINE: JobStatus[] = ['APPLIED', 'ASSESSMENT', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'];
const MOVED: Partial<Record<JobStatus, string>> = { INTERESTED: 'Moved to Interested', SKIPPED: 'Skipped', DISCOVERED: 'Moved back to New' };

// One job in the list: the score and what/where on top; source and quick actions in a
// footer row, so the row is only as tall as its content.
export function JobRow({ job, selected }: { job: JobListItem; selected: boolean }) {
  const [params] = useSearchParams();
  const setStatus = useSetJobStatus();
  const toast = useToast();
  const location = prettyLocation(job.location);
  const posted = postedLabel(job);
  const href = `/jobs/${job.id}${params.size ? `?${params}` : ''}`;
  const interested = job.status === 'INTERESTED';
  const applied = PIPELINE.includes(job.status);
  // Company boards: the company IS the source, so say where, not who, again.
  const source = isAggregator(job) ? `via ${providerLabel(job.source)}` : 'company site';
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

  return (
    <li className={`rounded-xl border bg-surface transition ${selected ? 'border-fg/40 ring-1 ring-fg/20' : 'border-border hover:border-fg/25'}`}>
      <Link
        to={href}
        aria-current={selected ? 'page' : undefined}
        className="flex gap-3 rounded-t-xl px-3 pt-3 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {job.match ? <ScoreRing score={job.match.overallScore} verdict={job.match.verdict} /> : <PendingRing />}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold text-fg">{job.title}</h3>
          <p className="mt-0.5 truncate text-sm text-muted">
            {job.company}
            {location && <> · {location}</>}
          </p>
          {(showMode || job.redFlags.length > 0 || job.analysisStatus !== 'DONE') && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {showMode && <Badge>{job.workMode === 'ONSITE' ? 'On-site' : job.workMode!.charAt(0) + job.workMode!.slice(1).toLowerCase()}</Badge>}
              {job.redFlags.length > 0 && <Badge tone="danger">Possible scam</Badge>}
              {job.analysisStatus === 'DEFERRED' && <Badge tone="stretch">Scoring deferred</Badge>}
              {job.analysisStatus === 'FAILED' && <Badge tone="danger">Scoring failed</Badge>}
              {job.analysisStatus === 'PENDING' && <Badge>{job.match ? 'Re-scoring…' : 'Scoring…'}</Badge>}
            </div>
          )}
        </div>
      </Link>

      <div className="flex items-center justify-between gap-2 py-1 pr-1.5 pl-3 sm:pl-[4.25rem]">
        <span className="min-w-0 truncate text-xs text-subtle">
          {source}
          {posted && ` · ${posted}`}
        </span>
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
              className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ExternalLink className="size-4.5" />
            </a>
          )}
          {applied ? (
            <span className="inline-flex size-10 items-center justify-center text-apply" title="Applied" aria-label="Applied">
              <CheckCircle2 className="size-4.5" />
            </span>
          ) : job.status === 'SKIPPED' ? (
            <IconButton label="Undo skip" className="size-10" onClick={() => move('DISCOVERED')} disabled={setStatus.isPending}>
              <Undo2 className="size-4.5" />
            </IconButton>
          ) : (
            <>
              <IconButton
                label={interested ? 'Remove from interested' : 'Mark interested'}
                onClick={() => move(interested ? 'DISCOVERED' : 'INTERESTED')}
                disabled={setStatus.isPending}
                className={`size-10 ${interested ? 'text-stretch' : ''}`}
              >
                <Star className={`size-4.5 ${interested ? 'fill-current' : ''}`} />
              </IconButton>
              <IconButton label="Skip" className="size-10" onClick={() => move('SKIPPED')} disabled={setStatus.isPending}>
                <X className="size-4.5" />
              </IconButton>
            </>
          )}
        </div>
      </div>
      {setStatus.isError && <p className="px-3 pb-2 text-xs text-danger-fg">{setStatus.error.message}</p>}
    </li>
  );
}
