import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  CornerDownRight,
  ExternalLink,
  Info,
  Link2,
  RotateCw,
  Star,
  Undo2,
  X,
} from 'lucide-react';
import { MoreMenu, type MenuAction } from '../components/MoreMenu';
import { PushLink } from '../components/PushLink';
import { setNavDirection } from '../lib/navigation';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useEdgeSwipeBack } from '../lib/useEdgeSwipeBack';
import { PartialJobNotice } from '../components/PartialJobNotice';
import { ResumeSection } from '../components/ResumeSection';
import { ScoreRing } from '../components/ScoreRing';
import { useToast } from '../components/Toast';
import { VerdictBadge } from '../components/VerdictBadge';
import { Badge, Button, Card, EmptyState, Sheet, Skeleton, buttonStyles, type Tone } from '../components/ui';
import { isAggregator, postedLabel, prettyLocation, providerLabel, timeAgo } from '../lib/format';
import { useAnalyzeJob, useJobDetail, useSetJobStatus } from '../lib/queries';
import type { GapSeverity, JobDetail, JobStatus } from '../lib/types';

const SEVERITY_TONE: Record<GapSeverity, Tone> = { BLOCKING: 'danger', MODERATE: 'neutral', MINOR: 'neutral' };
// "4 of 5 required skills backed by verified evidence" (design board 2): a fact from the
// analysis, not an adjective. Falls back to the verdict's meaning when the posting names
// no required skills.
function fitSummary(job: JobDetail): string {
  const required = job.requirements.filter((r) => r.importance === 'REQUIRED');
  if (required.length === 0) return VERDICT_SENTENCE[job.match!.verdict];
  const backed = required.filter((r) => r.matchedSkillIds.length > 0).length;
  return `${backed} of ${required.length} required skills backed by verified evidence`;
}

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
  const navigate = useNavigate();
  const edge = useEdgeSwipeBack(() => {
    setNavDirection('back');
    navigate(back);
  });

  return (
    <article {...edge.handlers} style={edge.style} className="space-y-3 pb-20 lg:pb-4" aria-label="Job details">
      <div className="flex items-center justify-between">
        <PushLink to={back} dir="back" className="-ml-1 inline-flex min-h-11 items-center gap-1 text-[17px] font-medium text-accent-fg lg:invisible">
          <ChevronLeft className="size-5" /> Jobs
        </PushLink>
        {detail.data && <JobMenu job={detail.data} />}
      </div>
      {detail.isPending && <DetailSkeleton />}
      {detail.isError && <EmptyState icon={<AlertTriangle className="size-6" />} title="Couldn't load this job">{detail.error.message}</EmptyState>}
      {detail.isSuccess && <Detail job={detail.data} />}
    </article>
  );
}

// "···" (design board 2): copy the posting's link, score it again, skip it.
function JobMenu({ job }: { job: JobDetail }) {
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

const SEVERITY_LABEL: Record<GapSeverity, string> = { BLOCKING: 'Blocking', MODERATE: 'Moderate', MINOR: 'Minor' };

// A card with a header row: icon, title, and a count on the right ("4 matched").
function Section({ id, icon, title, meta, children }: { id: string; icon: ReactNode; title: string; meta?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
        <span className="text-muted" aria-hidden="true">
          {icon}
        </span>
        <h2 id={id} className="flex-1 text-[15px] font-semibold text-fg">
          {title}
        </h2>
        {meta && <span className="text-xs text-muted">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function Detail({ job }: { job: JobDetail }) {
  const location = prettyLocation(job.location);
  const posted = postedLabel(job);
  const m = job.match;
  const otherRisks = (m?.risks ?? []).filter((r) => !r.startsWith('Missing') && !r.startsWith('Red flag'));
  const mode = job.workMode ? (job.workMode === 'ONSITE' ? 'On-site' : job.workMode.charAt(0) + job.workMode.slice(1).toLowerCase()) : null;
  const where = isAggregator(job) ? providerLabel(job.source) : `${job.jobSource?.name ?? job.company} careers`;

  return (
    <>
      <header className="space-y-3 pt-1">
        {m ? (
          <div className="flex items-center gap-4">
            <ScoreRing score={m.overallScore} verdict={m.verdict} size={88} outOf sharedId={job.id} />
            <div className="min-w-0 space-y-1.5">
              <VerdictBadge verdict={m.verdict} />
              <p className="text-[13px] leading-[18px] text-muted">{fitSummary(job)}</p>
            </div>
          </div>
        ) : (
          <AnalysisState job={job} />
        )}
        {job.analysisStatus === 'PENDING' && m && <p className="text-xs text-muted">Re-scoring with your newly verified skills…</p>}
        <div>
          <h1 className="text-2xl leading-[30px] font-bold tracking-[-0.02em] text-fg">{job.title}</h1>
          <p className="mt-1 text-[15px] text-fg">
            {job.company}
            {location && <> · {location}</>}
          </p>
        </div>
        {(mode || job.salary || job.seniority) && (
          <div className="flex flex-wrap gap-1.5">
            {mode && <Badge>{mode}</Badge>}
            {job.salary && <Badge>{job.salary}</Badge>}
            {job.seniority && job.seniority !== 'UNKNOWN' && <Badge>{job.seniority.charAt(0) + job.seniority.slice(1).toLowerCase()}</Badge>}
          </div>
        )}
        <p className="text-xs text-muted">
          via {where} · Found {timeAgo(job.discoveredAt)}
          {posted && ` · ${posted.charAt(0).toUpperCase()}${posted.slice(1)}`}
        </p>
        {/* One action bar: fixed at the bottom on phones (thumb reach; the tab bar is
            hidden on this screen), inline under the title on wider screens. */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-glass px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none print:hidden">
          <ActionBar job={job} />
        </div>
      </header>

      {job.redFlags.length > 0 && (
        <div role="alert" className="flex gap-3 rounded-2xl bg-danger-bg p-4 text-sm text-danger-fg">
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

      {job.isPartial && <PartialJobNotice job={job} />}

      <ResumeSection job={job} />

      {m && m.strengths.length > 0 && (
        <Section id="fits" icon={<CircleCheck className="size-5 text-accent" strokeWidth={1.75} />} title="Why it fits" meta={`${m.strengths.length} matched`}>
          <ul className="divide-y divide-border border-t border-border">
            {m.strengths.map((s) => {
              const p = parseStrength(s);
              return (
                <li key={s} className="px-4 py-3 text-sm">
                  <p className="text-fg">{p.requirement}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <CornerDownRight className="size-4 shrink-0" aria-hidden="true" />
                    <Badge tone="accent">{p.skill}</Badge>
                    {p.evidence && <span>{p.evidence}</span>}
                  </p>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {m && m.gaps.length > 0 && (
        <Section id="gaps" icon={<AlertTriangle className="size-5 text-stretch" strokeWidth={1.75} />} title="Gaps" meta={`${m.gaps.length} missing`}>
          <ul className="divide-y divide-border border-t border-border">
            {m.gaps.map((g) => (
              <li key={g.skillName} className="px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-fg">{g.skillName}</span>
                  <Badge tone={SEVERITY_TONE[g.severity]}>{SEVERITY_LABEL[g.severity]}</Badge>
                </div>
                {g.note && <p className="mt-0.5 text-[13px] text-muted">{g.note}</p>}
              </li>
            ))}
          </ul>
          <Link to="/evidence" className="block border-t border-border px-4 py-3.5 text-[15px] font-semibold text-accent-fg">
            Have experience here? Add evidence
          </Link>
        </Section>
      )}

      {otherRisks.length > 0 && (
        <Section id="risks" icon={<CircleAlert className="size-5 text-danger" strokeWidth={1.75} />} title="Risks">
          <ul className="divide-y divide-border border-t border-border">
            {otherRisks.map((r) => (
              <li key={r} className="flex items-start gap-2.5 px-4 py-3 text-sm text-fg">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-stretch" />
                {r}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <details className="group overflow-hidden rounded-2xl border border-border bg-surface">
        <summary className="cursor-pointer list-none px-4 pt-3.5 pb-3 marker:hidden">
          <span className="block text-[15px] font-semibold text-fg">{job.isPartial ? 'Alert summary' : 'Description'}</span>
          <span className="mt-1 line-clamp-3 text-sm leading-relaxed whitespace-pre-line text-muted group-open:hidden">{job.rawJD || 'No description.'}</span>
          <span className="mt-2 flex items-center justify-center gap-1 text-[15px] font-semibold text-accent-fg group-open:hidden">
            Read more <ChevronDown className="size-4" />
          </span>
        </summary>
        <div className="max-h-[60vh] overflow-y-auto px-4 pb-4 text-sm leading-relaxed whitespace-pre-line text-muted">{job.rawJD || 'No description.'}</div>
      </details>

      <p className="flex gap-2 px-1 text-xs text-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        Shortlist prepares everything. You apply yourself, on {isAggregator(job) ? 'the original posting' : `${job.company}'s site`}.
      </p>

    </>
  );
}

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
function ActionBar({ job }: { job: JobDetail }) {
  const [open, setOpen] = useState(false);
  const starred = job.status !== 'DISCOVERED' && job.status !== 'SKIPPED';
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        size="lg"
        variant="secondary"
        className="px-3"
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
      ) : (
        <span />
      )}
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
  const LABEL: Partial<Record<JobStatus, string>> = { INTERESTED: 'Marked interested', APPLIED: 'Marked as applied', SKIPPED: 'Skipped', DISCOVERED: 'Moved back to New' };
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
    st === 'APPLIED' ? (job.appliedAt ? `Applied ${new Date(job.appliedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : "Logs today's date") : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Set status"
      footer={
        job.status !== 'DISCOVERED' && (
          <Button size="lg" variant="ghost" className="w-full" onClick={() => move('DISCOVERED')} disabled={setStatus.isPending}>
            Move back to New
          </Button>
        )
      }
    >
      <div className="flex items-start justify-between gap-3 pb-1">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-fg">Set status</p>
          <p className="truncate text-[13px] text-muted">
            {job.company} · {job.title}
          </p>
        </div>
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-2 text-[15px] font-semibold text-accent-fg">
          Done
        </button>
      </div>
      {GROUPS.map((g) => (
        <fieldset key={g.label} className="mt-3 border-0 p-0">
          <legend className="mb-1 px-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">{g.label}</legend>
          {g.statuses.map((st) => {
            const on = st === job.status;
            return (
              <button
                key={st}
                type="button"
                aria-pressed={on}
                onClick={() => move(st)}
                disabled={setStatus.isPending}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-base ${on ? 'bg-accent-soft font-medium text-fg' : 'text-fg hover:bg-surface-2'}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-[22px] shrink-0 place-items-center rounded-full ${on ? 'bg-accent text-on-accent' : 'border-[1.5px] border-border'}`}
                >
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="flex-1">{STATUS_LABEL[st]}</span>
                {hint(st) && <span className="text-xs text-muted">{hint(st)}</span>}
              </button>
            );
          })}
        </fieldset>
      ))}
      {setStatus.isError && <p className="mt-2 text-sm text-danger-fg">{setStatus.error.message}</p>}
    </Sheet>
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
