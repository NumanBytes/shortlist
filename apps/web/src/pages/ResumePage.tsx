import { AlertTriangle, ArrowLeft, Check, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ResumeDocument } from '../components/ResumeDocument';
import { useToast } from '../components/Toast';
import { Badge, Button, EmptyState, Skeleton, Switch } from '../components/ui';
import { useApproveResume, useEducation, useJobDetail, useJobResume, useProfile } from '../lib/queries';

// Review → approve → print. Printing is offered only for an approved, up-to-date resume:
// every new resume is read before it goes out (Agents.md §13.2). A draft printed anyway
// (Ctrl+P) carries a DRAFT banner.
export function ResumePage() {
  const { jobId = '' } = useParams();
  const job = useJobDetail(jobId, true);
  const resume = useJobResume(jobId, true);
  const profile = useProfile();
  const education = useEducation();
  const approve = useApproveResume();
  const toast = useToast();
  const [showSources, setShowSources] = useState(true);

  // The browser names the saved PDF after the page title.
  const name = profile.data?.name;
  const company = job.data?.company;
  useEffect(() => {
    if (!name || !company) return;
    const previous = document.title;
    document.title = `${name} - Resume - ${company}`;
    return () => {
      document.title = previous;
    };
  }, [name, company]);

  const back = (
    <Link to={`/jobs/${jobId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
      <ArrowLeft className="size-4" /> Back to the job
    </Link>
  );

  if (resume.isPending || profile.isPending || education.isPending || job.isPending) {
    return (
      <div className="mx-auto max-w-[210mm] space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }
  const v = resume.data?.variant;
  if (!v || !profile.data || !resume.data) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        {back}
        <EmptyState icon={<AlertTriangle className="size-8" />} title="No resume for this job yet">
          Open the job and choose “Tailor a resume”.
        </EmptyState>
      </div>
    );
  }

  const stale = v.stale.length > 0;
  const approved = v.status === 'APPROVED';
  const { dropped } = v.content;

  return (
    <div className="mx-auto max-w-[210mm] space-y-4 print:space-y-0">
      <div className="space-y-3 print:hidden">
        {back}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-fg">
              Resume for {job.data?.company ?? 'this job'}
            </h1>
            {stale ? <Badge tone="danger">Out of date</Badge> : approved ? <Badge tone="apply">Approved</Badge> : <Badge tone="stretch">Draft</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* The switch carries its own accessible name; the word is for sighted users. */}
            <span className="flex items-center gap-2 text-sm text-muted">
              <Switch checked={showSources} onChange={setShowSources} label="Show sources" />
              <span aria-hidden="true">Sources</span>
            </span>
            {approved && !stale ? (
              <Button onClick={() => window.print()}>
                <Printer className="size-4" /> Save as PDF
              </Button>
            ) : (
              <Button
                disabled={stale || approve.isPending}
                onClick={() =>
                  approve.mutate({ variantId: v.id, jobId }, { onSuccess: () => toast({ text: 'Resume approved — you can save it as a PDF' }) })
                }
              >
                <Check className="size-4" /> {approve.isPending ? 'Approving…' : 'Approve'}
              </Button>
            )}
          </div>
        </div>

        {stale ? (
          <p className="flex gap-2 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Evidence it uses has changed ({v.stale.join(' · ')}). Tailor it again from the job page before sending.
          </p>
        ) : (
          !approved && (
            <p className="rounded-lg bg-stretch-bg px-3 py-2 text-sm text-stretch-fg">
              Read every bullet against its sources. If one says more than you did, don't approve — edit that evidence and
              tailor again. Approving lets you save the PDF and reuse this resume for similar jobs without another review.
            </p>
          )
        )}
        {approve.isError && <p className="text-sm text-danger-fg">{approve.error.message}</p>}

        {dropped.length > 0 && (
          <details className="rounded-xl border border-border bg-surface text-sm">
            <summary className="cursor-pointer px-3 py-2.5 font-medium text-fg">
              {dropped.length} bullet{dropped.length === 1 ? '' : 's'} removed by the truthfulness checks
            </summary>
            <ul className="divide-y divide-border border-t border-border">
              {dropped.map((d, i) => (
                <li key={i} className="px-3 py-2">
                  <p className="text-muted line-through">{d.text}</p>
                  <p className="text-xs text-subtle">
                    {d.where} — {d.reason}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <ResumeDocument
        content={v.content}
        profile={profile.data}
        education={education.data ?? []}
        sources={resume.data.sources}
        showSources={showSources}
        draft={!approved || stale}
      />
    </div>
  );
}
