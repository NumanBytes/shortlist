import { Check, ChevronDown, ExternalLink, Star } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../../components/Toast';
import { Button, Sheet, buttonStyles } from '../../../components/ui';
import { useSetJobStatus } from '../../../lib/queries';
import type { JobDetail, JobStatus } from '../../../lib/types';

const STATUS_LABEL: Record<JobStatus, string> = {
  DISCOVERED: 'New',
  INTERESTED: 'Interested',
  SKIPPED: 'Skipped',
  APPLIED: 'Applied',
  ASSESSMENT: 'Assessment',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

// The status button (opens the status sheet) and "Open posting" — Shortlist never
// submits; the user applies on the original posting.
export function ActionBar({ job }: { job: JobDetail }) {
  const [open, setOpen] = useState(false);
  const starred = job.status !== 'DISCOVERED' && job.status !== 'SKIPPED';
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        size="lg"
        variant="secondary"
        // No posting link: the status button takes the whole bar (UI audit D1).
        className={`px-3 ${job.sourceUrl ? '' : 'col-span-2'}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Status: ${STATUS_LABEL[job.status]}. Change status`}
      >
        <Star className={`size-5 ${starred ? 'fill-stretch text-stretch' : ''}`} />
        <span className="truncate">{STATUS_LABEL[job.status]}</span>
        <ChevronDown className="size-4 text-muted" />
      </Button>
      {job.sourceUrl ? (
        // rel="noopener" but not "noreferrer": aggregators ask for referral traffic.
        <a href={job.sourceUrl} target="_blank" rel="noopener" className={`${buttonStyles('primary', 'lg')} px-3`}>
          Open posting <ExternalLink className="size-[18px]" />
        </a>
      ) : null}
      <StatusSheet job={job} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

const GROUPS: { label: string; statuses: JobStatus[] }[] = [
  { label: 'Shortlist', statuses: ['INTERESTED'] },
  { label: 'Pipeline', statuses: ['APPLIED', 'ASSESSMENT', 'INTERVIEWING', 'OFFER'] },
  { label: 'Closed', statuses: ['REJECTED', 'WITHDRAWN', 'SKIPPED'] },
];

// Where the job is in your search. Every change shows a toast with Undo. "Applied" only
// records what you did — Shortlist never applies for you (Agents.md §1.2).
function StatusSheet({ job, open, onClose }: { job: JobDetail; open: boolean; onClose: () => void }) {
  const setStatus = useSetJobStatus();
  const toast = useToast();
  const LABEL: Partial<Record<JobStatus, string>> = {
    INTERESTED: 'Marked interested',
    APPLIED: 'Marked as applied',
    SKIPPED: 'Skipped',
    DISCOVERED: 'Moved back to New',
  };
  const move = (status: JobStatus) => {
    if (status === job.status) return onClose();
    setStatus.mutate(
      { id: job.id, status },
      {
        onSuccess: () => {
          onClose();
          toast({
            text: LABEL[status] ?? `Stage: ${STATUS_LABEL[status]}`,
            action: { label: 'Undo', onClick: () => setStatus.mutate({ id: job.id, status: job.status }) },
          });
        },
      },
    );
  };
  const hint = (st: JobStatus) =>
    st === 'APPLIED'
      ? job.appliedAt
        ? `Applied ${new Date(job.appliedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
        : "Logs today's date"
      : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Set status"
      description={
        <span className="block truncate">
          {job.company} · {job.title}
        </span>
      }
      footer={
        job.status !== 'DISCOVERED' && (
          <Button
            size="lg"
            variant="ghost"
            className="w-full"
            onClick={() => move('DISCOVERED')}
            disabled={setStatus.isPending}
          >
            Move back to New
          </Button>
        )
      }
    >
      {GROUPS.map((g) => (
        <fieldset key={g.label} className="mt-3 border-0 p-0">
          <legend className="mb-1 px-1 text-caption font-semibold tracking-[0.06em] text-muted uppercase">
            {g.label}
          </legend>
          {g.statuses.map((st) => {
            const on = st === job.status;
            return (
              <button
                key={st}
                type="button"
                aria-pressed={on}
                onClick={() => move(st)}
                disabled={setStatus.isPending}
                className={`flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-body ${on ? 'bg-accent-soft font-medium text-fg' : 'text-fg hover:bg-surface-2'}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-[22px] shrink-0 place-items-center rounded-full ${on ? 'bg-accent text-on-accent' : 'border-[1.5px] border-input-border'}`}
                >
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="flex-1">{STATUS_LABEL[st]}</span>
                {hint(st) && <span className="text-caption text-muted">{hint(st)}</span>}
              </button>
            );
          })}
        </fieldset>
      ))}
      {setStatus.isError && <p className="mt-2 text-footnote text-danger-fg">{setStatus.error.message}</p>}
    </Sheet>
  );
}
