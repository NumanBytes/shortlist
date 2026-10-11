import { Link2, RotateCw, Undo2, X } from 'lucide-react';
import { MoreMenu, type MenuAction } from '../../../components/MoreMenu';
import { useToast } from '../../../components/Toast';
import { useAnalyzeJob, useSetJobStatus } from '../../../lib/queries';
import type { JobDetail } from '../../../lib/types';

// "···" (design board 2): copy the posting's link, score it again, skip it.
export function JobMenu({ job }: { job: JobDetail }) {
  const toast = useToast();
  const analyze = useAnalyzeJob();
  const setStatus = useSetJobStatus();
  const skipped = job.status === 'SKIPPED';
  const actions: MenuAction[] = [];
  if (job.sourceUrl)
    actions.push({
      label: 'Copy posting link',
      icon: <Link2 className="size-[18px]" />,
      onSelect: () =>
        void navigator.clipboard?.writeText(job.sourceUrl!).then(
          () => toast({ text: 'Link copied' }),
          () => toast({ text: "Couldn't copy the link" }),
        ),
    });
  actions.push({
    label: 'Score again',
    icon: <RotateCw className="size-[18px]" />,
    disabled: job.analysisStatus === 'PENDING',
    onSelect: () =>
      analyze.mutate(job.id, {
        onSuccess: () => toast({ text: 'Scoring again with your verified skills' }),
        onError: (err) => toast({ text: err.message }),
      }),
  });
  actions.push({
    label: skipped ? 'Move back to New' : 'Skip this job',
    icon: skipped ? <Undo2 className="size-[18px]" /> : <X className="size-[18px]" />,
    danger: !skipped,
    onSelect: () =>
      setStatus.mutate(
        { id: job.id, status: skipped ? 'DISCOVERED' : 'SKIPPED' },
        { onSuccess: () => toast({ text: skipped ? 'Moved back to New' : 'Skipped', action: { label: 'Undo', onClick: () => setStatus.mutate({ id: job.id, status: job.status }) } }) },
      ),
  });
  return <MoreMenu title={`${job.title} · ${job.company}`} actions={actions} />;
}
