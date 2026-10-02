import { AlertTriangle, FileText, Loader2, RotateCw, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { useJobResume, usePrepareResume } from '../lib/queries';
import type { JobDetail, JobResume } from '../lib/types';
import { Badge, Button, Card } from './ui';

// The job's resume (Agents.md §13): reuse an approved one, tailor a new one, or open the
// one it has. Shown once the user marks a job Interested — tailoring costs money, so it
// never starts on its own.
export function ResumeSection({ job }: { job: JobDetail }) {
  const wanted = job.status !== 'DISCOVERED' && job.status !== 'SKIPPED';
  const resume = useJobResume(job.id, wanted);

  if (job.status === 'DISCOVERED') {
    return <p className="text-sm text-muted">Mark it Interested to prepare a tailored resume.</p>;
  }
  if (!wanted) return null;

  return (
    <section aria-labelledby="resume-heading">
      <Card className="p-4">
      <div className="flex items-center gap-2">
        <FileText className="size-4.5 text-accent" />
        <h2 id="resume-heading" className="text-sm font-semibold text-fg">
          Resume
        </h2>
        {resume.data?.variant && <VariantBadge resume={resume.data} />}
      </div>
      <div className="mt-3 text-sm">
        {resume.isPending && <p className="text-muted">Loading…</p>}
        {resume.isError && <p className="text-danger-fg">Couldn't load the resume: {resume.error.message}</p>}
        {resume.data && <Body job={job} resume={resume.data} />}
      </div>
      </Card>
    </section>
  );
}

function VariantBadge({ resume }: { resume: JobResume }) {
  const v = resume.variant!;
  if (v.stale.length) return <Badge tone="danger">Out of date</Badge>;
  return v.status === 'APPROVED' ? <Badge tone="apply">Approved</Badge> : <Badge tone="stretch">Draft — review it</Badge>;
}

function Body({ job, resume }: { job: JobDetail; resume: JobResume }) {
  const prepare = usePrepareResume();
  const tailor = () => prepare.mutate({ jobId: job.id, body: { mode: 'tailor' } });
  const busy = prepare.isPending;
  const error = prepare.isError && <p className="mt-2 text-danger-fg">{prepare.error.message}</p>;

  if (resume.status === 'PENDING') {
    return (
      <output className="flex items-center gap-2 text-muted">
        <Loader2 className="size-4 animate-spin" /> Tailoring from your verified evidence — usually under a minute.
      </output>
    );
  }

  const v = resume.variant;
  if (resume.status === 'READY' && v) {
    const bullets = [...v.content.experience, ...v.content.projects].reduce((n, s) => n + s.bullets.length, 0);
    return (
      <div className="space-y-3">
        <p className="text-muted">
          {resume.reused
            ? `Reusing a resume you approved — ${Math.round((resume.overlap ?? 0) * 100)}% of this job's requirements.`
            : `${bullets} bullets, each from your own verified words.`}
          {v.content.dropped.length > 0 && ` ${v.content.dropped.length} removed by the truthfulness checks.`}
        </p>
        {v.stale.length > 0 && (
          <div className="flex gap-2 rounded-lg bg-danger-bg px-3 py-2 text-danger-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Evidence it uses has changed — tailor it again before sending.</p>
              <p className="text-xs">{v.stale.join(' · ')}</p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/jobs/${job.id}/resume`}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-fg hover:opacity-90"
          >
            <FileText className="size-4" /> {v.status === 'APPROVED' && !v.stale.length ? 'Open & save PDF' : 'Review'}
          </Link>
          <Button variant={v.stale.length ? 'secondary' : 'ghost'} onClick={tailor} disabled={busy}>
            <RotateCw className="size-4" /> Tailor again
          </Button>
        </div>
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(resume.status === 'FAILED' || resume.status === 'DEFERRED') && (
        <p className={resume.status === 'FAILED' ? 'text-danger-fg' : 'text-stretch-fg'}>
          {resume.status === 'FAILED' ? 'Tailoring failed' : 'Tailoring deferred'}: {resume.error}
        </p>
      )}
      {resume.reuse.length > 0 && (
        <ul className="space-y-2">
          {resume.reuse.map((r) => (
            <li key={r.variantId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
              <div className="min-w-0">
                <p className="font-medium text-fg">Reuse an approved resume — {Math.round(r.overlap * 100)}% match</p>
                {r.usedFor.length > 0 && <p className="truncate text-xs text-muted">Used for {r.usedFor.join(', ')}</p>}
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => prepare.mutate({ jobId: job.id, body: { mode: 'reuse', variantId: r.variantId } })}
              >
                Use it
              </Button>
            </li>
          ))}
        </ul>
      )}
      {resume.canTailor ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={tailor} disabled={busy} variant={resume.reuse.length ? 'secondary' : 'primary'}>
            <Sparkles className="size-4" /> {busy ? 'Queuing…' : resume.status === 'NONE' ? 'Tailor a resume' : 'Try again'}
          </Button>
          <span className="text-xs text-subtle">From verified evidence only · about $0.03</span>
        </div>
      ) : (
        <p className="text-muted">Tailoring uses this job's requirements, so it can start once scoring finishes.</p>
      )}
      {error}
    </div>
  );
}
