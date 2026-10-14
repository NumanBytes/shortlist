import { AlertTriangle, ChevronLeft, SearchX } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PushLink } from '../../../components/PushLink';
import { EmptyState, Skeleton, buttonStyles } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { setNavDirection } from '../../../lib/navigation';
import { useJobDetail } from '../../../lib/queries';
import { useEdgeSwipeBack } from '../../../lib/hooks/useEdgeSwipeBack';
import { Detail } from './Detail';
import { JobMenu } from './JobMenu';

// One job: score and verdict, why it fits, gaps, the resume, and the status/apply bar.
// The sections live in ./job-detail/.
export function JobDetailPage() {
  const { jobId = '' } = useParams();
  const [params] = useSearchParams();
  const detail = useJobDetail(jobId, true);
  const back = `/${params.size ? `?${params}` : ''}`;
  const navigate = useNavigate();
  const edge = useEdgeSwipeBack(() => {
    setNavDirection('back');
    void navigate(back);
  });

  return (
    <article {...edge.handlers} style={edge.style} className="space-y-3 pb-20 lg:pb-4" aria-label="Job details">
      <div className="flex items-center justify-between">
        <PushLink
          to={back}
          dir="back"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 text-headline font-medium text-accent-fg lg:invisible"
        >
          <ChevronLeft className="size-5" /> Jobs
        </PushLink>
        {detail.data && <JobMenu job={detail.data} />}
      </div>
      {detail.isPending && <DetailSkeleton />}
      {detail.isError &&
        // A malformed or someone else's job id is 400/404 — say that, not the validator's words (UI audit D6).
        (missing(detail.error) ? (
          <EmptyState icon={<SearchX className="size-6" />} title="This job doesn't exist or was removed">
            <PushLink to={back} dir="back" className={`${buttonStyles('secondary', 'sm')} mt-4`}>
              Back to Jobs
            </PushLink>
          </EmptyState>
        ) : (
          <EmptyState icon={<AlertTriangle className="size-6" />} title="Couldn't load this job">
            {detail.error.message}
          </EmptyState>
        ))}
      {detail.isSuccess && <Detail job={detail.data} />}
    </article>
  );
}

const missing = (e: Error) => e instanceof ApiError && (e.status === 400 || e.status === 404);

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading job">
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
