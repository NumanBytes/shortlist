import { useState } from 'react';
import { providerLabel, timeAgo } from '../lib/format';
import { useJobDetail, useSetJobStatus } from '../lib/queries';
import type { JobListItem, JobStatus } from '../lib/types';
import { Badge, Button } from './ui';

const AGGREGATORS = new Set(['remoteok', 'remotive', 'arbeitnow', 'himalayas', 'jobicy', 'weworkremotely']);
const LATER_STAGES: JobStatus[] = ['APPLIED', 'ASSESSMENT', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'];

export function JobCard({ job }: { job: JobListItem }) {
  const setStatus = useSetJobStatus();
  const [open, setOpen] = useState(false);
  const detail = useJobDetail(job.id, open);
  const move = (status: JobStatus) => setStatus.mutate({ id: job.id, status });
  const fromAggregator = AGGREGATORS.has(job.source ?? '');

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{job.title}</h3>
          <p className="text-sm text-slate-600">
            {job.company}
            {job.location && <> · {job.location}</>}
          </p>
        </div>
        {job.workMode && <Badge>{job.workMode.toLowerCase()}</Badge>}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {/* Attribution: aggregators require naming them and linking back to the original. */}
        {fromAggregator ? <>via {providerLabel(job.source)}</> : <>{job.jobSource?.name ?? job.company} careers</>}
        {' · '}found {timeAgo(job.discoveredAt)}
        {job.postedAt && <> · posted {timeAgo(job.postedAt)}</>}
      </p>

      {open && (
        <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
          {detail.isPending ? 'Loading…' : detail.isError ? `Couldn't load: ${detail.error.message}` : detail.data.rawJD}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {job.sourceUrl && (
          // You apply on the original posting — Shortlist never submits for you.
          // rel="noopener" but not "noreferrer": aggregators ask for referral traffic.
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Open posting ↗
          </a>
        )}
        <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide details' : 'Details'}
        </Button>

        {job.status === 'DISCOVERED' && (
          <>
            <Button variant="secondary" onClick={() => move('INTERESTED')} disabled={setStatus.isPending}>
              Interested
            </Button>
            <Button variant="ghost" onClick={() => move('SKIPPED')} disabled={setStatus.isPending}>
              Skip
            </Button>
          </>
        )}
        {job.status === 'INTERESTED' && (
          <>
            <Button variant="secondary" onClick={() => move('APPLIED')} disabled={setStatus.isPending}>
              I applied
            </Button>
            <Button variant="ghost" onClick={() => move('SKIPPED')} disabled={setStatus.isPending}>
              Skip
            </Button>
          </>
        )}
        {job.status === 'SKIPPED' && (
          <Button variant="ghost" onClick={() => move('DISCOVERED')} disabled={setStatus.isPending}>
            Undo skip
          </Button>
        )}
        {LATER_STAGES.includes(job.status) && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Stage
            <select
              value={job.status}
              onChange={(e) => move(e.target.value as JobStatus)}
              disabled={setStatus.isPending}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              {LATER_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {setStatus.isError && <p className="mt-2 text-sm text-red-600">{setStatus.error.message}</p>}
    </li>
  );
}
