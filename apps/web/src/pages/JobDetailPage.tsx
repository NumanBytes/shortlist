import { AlertTriangle, ArrowLeft, Check, ExternalLink, RotateCw, Star, X } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ScoreRing } from '../components/ScoreRing';
import { useToast } from '../components/Toast';
import { VerdictBadge } from '../components/VerdictBadge';
import { Badge, Button, Card, EmptyState, IconButton, Skeleton, type Tone } from '../components/ui';
import { isAggregator, postedLabel, prettyLocation, providerLabel, timeAgo } from '../lib/format';
import { useAnalyzeJob, useJobDetail, useSetJobStatus } from '../lib/queries';
import type { GapSeverity, JobDetail, JobStatus } from '../lib/types';

const LATER_STAGES: JobStatus[] = ['APPLIED', 'ASSESSMENT', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'];
const SEVERITY_TONE: Record<GapSeverity, Tone> = { BLOCKING: 'danger', MODERATE: 'stretch', MINOR: 'neutral' };
const VERDICT_SENTENCE = {
  APPLY: 'A strong fit for your verified experience.',
  STRETCH: 'Within reach, with gaps worth knowing before you apply.',
  SKIP: 'A weak fit for your verified experience.',
} as const;

// "React.js — React (commercial production, CloudCard Inc.)" → parts for display.
function parseStrength(s: string) {
  const [requirement = s, rest = ''] = s.split(' — ');
  const m = /^(.*) \((.*)\)$/.exec(rest);
  return { requirement, skill: m?.[1] ?? rest, evidence: m?.[2] ?? '' };
}

export function JobDetailPage() {
  const { jobId = '' } = useParams();
  const [params] = useSearchParams();
  const detail = useJobDetail(jobId, true);
  const back = `/${params.size ? `?${params}` : ''}`;

  return (
    <article className="space-y-4" aria-label="Job details">
      <Link to={back} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg lg:hidden">
        <ArrowLeft className="size-4" /> All jobs
      </Link>
      {detail.isPending && <DetailSkeleton />}
      {detail.isError && <EmptyState icon={<AlertTriangle className="size-8" />} title="Couldn't load this job">{detail.error.message}</EmptyState>}
      {detail.isSuccess && <Detail job={detail.data} />}
    </article>
  );
}

function Detail({ job }: { job: JobDetail }) {
  const location = prettyLocation(job.location);
  const posted = postedLabel(job);
  const m = job.match;
  const otherRisks = (m?.risks ?? []).filter((r) => !r.startsWith('Missing') && !r.startsWith('Red flag'));

  return (
    <>
      <header>
        <h1 className="text-xl leading-tight font-semibold text-fg sm:text-2xl">{job.title}</h1>
        <p className="mt-1 text-muted">
          {job.company}
          {location && <> · {location}</>}
        </p>
        <p className="mt-1 text-xs text-subtle">
          {isAggregator(job) ? `via ${providerLabel(job.source)}` : `${job.jobSource?.name ?? job.company} careers`} · found{' '}
          {timeAgo(job.discoveredAt)}
          {posted && ` · ${posted}`}
        </p>
        <StatusActions job={job} />
      </header>

      {job.redFlags.length > 0 && (
        <div role="alert" className="flex gap-3 rounded-xl bg-danger-bg p-3 text-sm text-danger-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Possible scam — check before applying</p>
            <ul className="mt-1 list-disc pl-4">
              {job.redFlags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {m ? (
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <ScoreRing score={m.overallScore} verdict={m.verdict} size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <VerdictBadge verdict={m.verdict} />
                <span className="text-xs text-muted">{m.commercialScore}% from paid work</span>
              </div>
              <p className="mt-1 text-sm text-fg">{VERDICT_SENTENCE[m.verdict]}</p>
              <p className="mt-0.5 text-xs text-subtle">
                {job.seniority && job.seniority !== 'UNKNOWN' && `${job.seniority.charAt(0)}${job.seniority.slice(1).toLowerCase()} role · `}
                {job.yearsRequired !== null && `asks ${job.yearsRequired}+ yrs · `}
                scored from your verified evidence only
              </p>
            </div>
          </div>
          {job.analysisStatus === 'PENDING' && <p className="mt-3 text-xs text-muted">Re-scoring with your newly verified skills…</p>}
        </Card>
      ) : (
        <AnalysisState job={job} />
      )}

      {m && m.strengths.length > 0 && (
        <section aria-labelledby="fits">
          <h2 id="fits" className="mb-2 text-sm font-semibold text-fg">
            Why it fits
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {m.strengths.map((s) => {
              const p = parseStrength(s);
              const same = p.skill.toLowerCase() === p.requirement.toLowerCase();
              return (
                <li key={s} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-apply" />
                  <div className="min-w-0">
                    <span className="font-medium text-fg">{p.requirement}</span>
                    {!same && <span className="text-muted"> — your {p.skill}</span>}
                    {p.evidence && <p className="text-xs text-subtle">{p.evidence}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {m && m.gaps.length > 0 && (
        <section aria-labelledby="gaps">
          <h2 id="gaps" className="mb-2 text-sm font-semibold text-fg">
            Gaps
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {m.gaps.map((g) => (
              <li key={g.skillName} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-fg">{g.skillName}</span>
                  {g.note && <p className="text-xs text-subtle">{g.note}</p>}
                </div>
                <Badge tone={SEVERITY_TONE[g.severity]}>{g.severity.toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherRisks.length > 0 && (
        <ul className="space-y-1.5">
          {otherRisks.map((r) => (
            <li key={r} className="flex gap-2 rounded-lg bg-stretch-bg px-3 py-2 text-sm text-stretch-fg">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {r}
            </li>
          ))}
        </ul>
      )}

      <details className="group rounded-xl border border-border bg-surface">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-fg marker:hidden">
          Job description <span className="font-normal text-subtle group-open:hidden">· show</span>
        </summary>
        <div className="max-h-[60vh] overflow-y-auto border-t border-border px-3 py-3 text-sm leading-relaxed whitespace-pre-line text-muted">
          {job.rawJD || 'No description.'}
        </div>
      </details>
    </>
  );
}

function StatusActions({ job }: { job: JobDetail }) {
  const setStatus = useSetJobStatus();
  const toast = useToast();
  const LABEL: Partial<Record<JobStatus, string>> = { INTERESTED: 'Marked interested', APPLIED: 'Marked as applied', SKIPPED: 'Skipped' };
  const move = (status: JobStatus) =>
    setStatus.mutate(
      { id: job.id, status },
      {
        onSuccess: () =>
          toast({
            text: LABEL[status] ?? `Stage: ${status.charAt(0)}${status.slice(1).toLowerCase()}`,
            action: { label: 'Undo', onClick: () => setStatus.mutate({ id: job.id, status: job.status }) },
          }),
      },
    );
  const busy = setStatus.isPending;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {job.sourceUrl && (
        // Shortlist never submits — the user applies on the original posting.
        <a
          href={job.sourceUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-fg hover:opacity-90"
        >
          Open posting <ExternalLink className="size-4" />
        </a>
      )}
      {(job.status === 'DISCOVERED' || job.status === 'SKIPPED') && (
        <Button variant="secondary" onClick={() => move('INTERESTED')} disabled={busy}>
          <Star className="size-4" /> Interested
        </Button>
      )}
      {job.status === 'INTERESTED' && (
        <Button variant="secondary" onClick={() => move('APPLIED')} disabled={busy}>
          <Check className="size-4" /> I applied
        </Button>
      )}
      {job.status !== 'SKIPPED' && !LATER_STAGES.includes(job.status) && (
        <>
          {/* Icon-only on phones so the actions stay on one line. */}
          <IconButton label="Skip" onClick={() => move('SKIPPED')} disabled={busy} className="size-10 sm:hidden">
            <X className="size-4.5" />
          </IconButton>
          {/* A wrapper controls visibility: putting `hidden` on the button itself loses to
              its own `inline-flex` (same CSS property; the later utility wins). */}
          <span className="hidden sm:inline">
            <Button variant="ghost" onClick={() => move('SKIPPED')} disabled={busy}>
              <X className="size-4" /> Skip
            </Button>
          </span>
        </>
      )}
      {LATER_STAGES.includes(job.status) && (
        <label className="flex items-center gap-2 text-sm text-muted">
          Stage
          <select
            value={job.status}
            onChange={(e) => move(e.target.value as JobStatus)}
            disabled={busy}
            className="h-10 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
          >
            {LATER_STAGES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      )}
      {setStatus.isError && <p className="w-full text-sm text-danger-fg">{setStatus.error.message}</p>}
    </div>
  );
}

// Why there's no score yet — never a silent blank (Agents.md §1.3).
function AnalysisState({ job }: { job: JobDetail }) {
  const analyze = useAnalyzeJob();
  const failed = job.analysisStatus === 'FAILED';
  const pending = job.analysisStatus === 'PENDING';
  return (
    <Card className="p-4 text-sm">
      <p className={`font-medium ${failed ? 'text-danger-fg' : pending ? 'text-fg' : 'text-stretch-fg'}`}>
        {pending ? 'Scoring in progress' : failed ? 'Scoring failed' : 'Scoring deferred'}
      </p>
      <p className="mt-1 text-muted">
        {pending ? 'The match score appears here once the worker has analysed this job.' : job.analysisError}
      </p>
      {!pending && (
        <Button className="mt-3" variant="secondary" size="sm" onClick={() => analyze.mutate(job.id)} disabled={analyze.isPending}>
          <RotateCw className="size-4" /> {analyze.isPending ? 'Queuing…' : 'Retry'}
        </Button>
      )}
      {analyze.isError && <p className="mt-2 text-danger-fg">{analyze.error.message}</p>}
    </Card>
  );
}

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
