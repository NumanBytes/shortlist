import { Badge } from '../../components/ui';
import type { JobResume } from '../../lib/types';

// One vocabulary for a resume's state, in sentence case, on the job and on the review
// screen (UI audit R3). The printed page keeps its own "DRAFT — NOT YET APPROVED" banner.
export function ResumeStatusBadge({
  variant,
  className,
}: {
  variant: Pick<NonNullable<JobResume['variant']>, 'stale' | 'status'>;
  className?: string;
}) {
  if (variant.stale.length)
    return (
      <Badge tone="danger" className={className}>
        Out of date
      </Badge>
    );
  return variant.status === 'APPROVED' ? (
    <Badge tone="accent" className={className}>
      Approved
    </Badge>
  ) : (
    <Badge tone="stretch" className={className}>
      Draft
    </Badge>
  );
}
