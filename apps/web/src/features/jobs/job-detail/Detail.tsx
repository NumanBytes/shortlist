import { AlertTriangle, ChevronDown, Info, RotateCw } from 'lucide-react';
import { PartialJobNotice } from '../PartialJobNotice';
import { ResumeSection } from '../../resume/ResumeSection';
import { ScoreRing } from '../../../components/ScoreRing';
import { VerdictBadge } from '../../../components/VerdictBadge';
import { Badge, Button, Card } from '../../../components/ui';
import { isAggregator, postedLabel, prettyLocation, sourceName, timeAgo } from '../../../lib/format';
import { useAnalyzeJob } from '../../../lib/queries';
import type { JobDetail } from '../../../lib/types';
import { Gaps, Risks, Strengths } from './MatchSections';
import { ActionBar } from './StatusControls';
import { useBottomInset } from '../../../lib/hooks/useBottomInset';

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

export function Detail({ job }: { job: JobDetail }) {
  const location = prettyLocation(job.location);
  const posted = postedLabel(job);
  const m = job.match;
  const mode = job.workMode
    ? job.workMode === 'ONSITE'
      ? 'On-site'
      : job.workMode.charAt(0) + job.workMode.slice(1).toLowerCase()
    : null;
  const where = sourceName(job);
  const actionBar = useBottomInset('bar');

  return (
    <>
      <header className="space-y-3 pt-1">
        {m ? (
          <div className="flex items-center gap-4">
            <ScoreRing score={m.overallScore} verdict={m.verdict} size={88} outOf sharedId={job.id} />
            <div className="min-w-0 space-y-1.5">
              <VerdictBadge verdict={m.verdict} />
              <p className="text-footnote leading-[18px] text-muted">{fitSummary(job)}</p>
            </div>
          </div>
        ) : (
          <AnalysisState job={job} />
        )}
        {job.analysisStatus === 'PENDING' && m && (
          <p className="text-caption text-muted">Re-scoring with your newly verified skills…</p>
        )}
        <div>
          <h1 className="text-title font-bold tracking-[-0.02em] text-fg">{job.title}</h1>
          <p className="mt-1 text-body text-fg">
            {job.company}
            {location && <> · {location}</>}
          </p>
        </div>
        {(mode || job.salary || job.seniority) && (
          <div className="flex flex-wrap gap-1.5">
            {mode && <Badge>{mode}</Badge>}
            {job.salary && <Badge>{job.salary}</Badge>}
            {job.seniority && job.seniority !== 'UNKNOWN' && (
              <Badge>{job.seniority.charAt(0) + job.seniority.slice(1).toLowerCase()}</Badge>
            )}
          </div>
        )}
        <p className="text-caption text-muted">
          via {where} · Found {timeAgo(job.discoveredAt)}
          {posted && ` · ${posted.charAt(0).toUpperCase()}${posted.slice(1)}`}
        </p>
        {/* One action bar: fixed at the bottom on phones (thumb reach; the tab bar is
            hidden on this screen), inline under the title on wider screens. */}
        <div
          ref={actionBar}
          className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-glass px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none print:hidden"
        >
          <ActionBar job={job} />
        </div>
      </header>

      {job.redFlags.length > 0 && (
        <div role="alert" className="flex gap-3 rounded-lg bg-danger-bg p-4 text-body text-danger-fg">
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

      {m && (
        <>
          <Strengths strengths={m.strengths} />
          <Gaps gaps={m.gaps} />
          <Risks risks={m.risks} />
        </>
      )}

      <details className="group overflow-hidden rounded-lg border border-border bg-surface">
        <summary className="cursor-pointer list-none px-4 pt-3.5 pb-3 marker:hidden">
          <span className="block text-body font-semibold text-fg">
            {job.isPartial ? 'Alert summary' : 'Description'}
          </span>
          <span className="mt-1 line-clamp-3 text-body leading-relaxed whitespace-pre-line text-muted group-open:hidden">
            {job.rawJD || 'No description.'}
          </span>
          <span className="mt-2 flex items-center justify-center gap-1 text-body font-semibold text-accent-fg group-open:hidden">
            Read more <ChevronDown className="size-4" />
          </span>
        </summary>
        <div className="max-h-[60vh] overflow-y-auto px-4 pb-4 text-body leading-relaxed whitespace-pre-line text-muted">
          {job.rawJD || 'No description.'}
        </div>
      </details>

      <p className="flex gap-2 px-1 text-caption text-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        Shortlist prepares everything. You apply yourself, on{' '}
        {isAggregator(job) ? 'the original posting' : `${job.company}'s site`}.
      </p>
    </>
  );
}

// Why there's no score yet — never a silent blank (Agents.md §1.3).
function AnalysisState({ job }: { job: JobDetail }) {
  const analyze = useAnalyzeJob();
  const failed = job.analysisStatus === 'FAILED';
  const pending = job.analysisStatus === 'PENDING';
  return (
    <Card className="p-4 text-body">
      <p className={`font-medium ${failed ? 'text-danger-fg' : pending ? 'text-fg' : 'text-stretch-fg'}`}>
        {pending ? 'Scoring in progress' : failed ? 'Scoring failed' : 'Scoring deferred'}
      </p>
      <p className="mt-1 text-muted">
        {pending ? 'The match score appears here once the worker has analysed this job.' : job.analysisError}
      </p>
      {!pending && (
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          onClick={() => analyze.mutate(job.id)}
          disabled={analyze.isPending}
        >
          <RotateCw className="size-4" /> {analyze.isPending ? 'Queuing…' : 'Retry'}
        </Button>
      )}
      {analyze.isError && <p className="mt-2 text-danger-fg">{analyze.error.message}</p>}
    </Card>
  );
}
