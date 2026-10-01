import { ChevronDown, Inbox, MousePointerClick } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useParams, useSearchParams } from 'react-router';
import { JobRow } from '../components/JobRow';
import { EmptyState, Segmented, Skeleton } from '../components/ui';
import { useJobs, type JobSort } from '../lib/queries';
import type { JobListItem, JobStatus, Verdict } from '../lib/types';

type Tab = 'new' | 'interested' | 'applied' | 'skipped';
type VerdictFilter = 'all' | Verdict;

const TAB_STATUS: Record<Tab, JobStatus | undefined> = {
  new: 'DISCOVERED',
  interested: 'INTERESTED',
  applied: undefined, // several later stages — filtered client-side
  skipped: 'SKIPPED',
};
const PIPELINE: JobStatus[] = ['APPLIED', 'ASSESSMENT', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'];

// List state lives in the URL (?tab=&verdict=&sort=), so opening a job and coming back —
// or the phone's back gesture — returns to exactly the same list.
function useListState() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'new';
  const verdict = (params.get('verdict') as VerdictFilter | null) ?? 'all';
  const sort = (params.get('sort') as JobSort | null) ?? 'score';
  const set = (key: string, value: string, fallback: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  return {
    tab,
    verdict,
    sort,
    setTab: (v: Tab) => set('tab', v, 'new'),
    setVerdict: (v: VerdictFilter) => set('verdict', v, 'all'),
    setSort: (v: JobSort) => set('sort', v, 'score'),
  };
}

export function JobsLayout() {
  const { jobId } = useParams();
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-6">
      <section aria-label="Jobs" className={jobId ? 'hidden lg:block' : ''}>
        <JobsList selectedId={jobId} />
      </section>
      <div className={jobId ? '' : 'hidden lg:block'}>
        <div className="lg:sticky lg:top-18 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:pr-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export function NoJobSelected() {
  return (
    <EmptyState icon={<MousePointerClick className="size-8" />} title="Select a job">
      Its match breakdown — what fits, what's missing — appears here.
    </EmptyState>
  );
}

function JobsList({ selectedId }: { selectedId?: string }) {
  const s = useListState();
  const jobs = useJobs(TAB_STATUS[s.tab], s.sort);
  const [showWeaker, setShowWeaker] = useState(false);

  const all = (jobs.data ?? []).filter((j) => s.tab !== 'applied' || PIPELINE.includes(j.status));
  const count = (v: Verdict) => all.filter((j) => j.match?.verdict === v).length;
  const visible = s.verdict === 'all' ? all : all.filter((j) => j.match?.verdict === s.verdict);
  // With no verdict filter and best-match order, SKIPs fold away so the list leads with
  // what's worth your time. Nothing is hidden for good — one tap shows them.
  const fold = s.verdict === 'all' && s.sort === 'score';
  const main = fold ? visible.filter((j) => j.match?.verdict !== 'SKIP') : visible;
  const weaker = fold ? visible.filter((j) => j.match?.verdict === 'SKIP') : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-fg">Your shortlist</h1>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select
            value={s.sort}
            onChange={(e) => s.setSort(e.target.value as JobSort)}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
            aria-label="Sort jobs"
          >
            <option value="score">Best match</option>
            <option value="recent">Newest</option>
          </select>
        </label>
      </div>

      <Segmented
        label="Pipeline"
        value={s.tab}
        onChange={s.setTab}
        options={[
          { value: 'new', label: 'New' },
          { value: 'interested', label: 'Interested' },
          { value: 'applied', label: 'Applied' },
          { value: 'skipped', label: 'Skipped' },
        ]}
      />

      {jobs.isSuccess && all.length > 0 && (
        <fieldset className="m-0 flex min-w-0 gap-1.5 overflow-x-auto border-0 p-0">
          <legend className="sr-only">Filter by verdict</legend>
          {(
            [
              ['all', 'All', all.length],
              ['APPLY', 'Apply', count('APPLY')],
              ['STRETCH', 'Stretch', count('STRETCH')],
              ['SKIP', 'Skip', count('SKIP')],
            ] as const
          ).map(([value, label, n]) => (
            <button
              key={value}
              type="button"
              aria-pressed={s.verdict === value}
              onClick={() => s.setVerdict(value)}
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition ${
                s.verdict === value ? 'border-fg bg-fg text-bg' : 'border-border bg-surface text-muted hover:text-fg'
              }`}
            >
              {label} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </fieldset>
      )}

      {jobs.isPending && <ListSkeleton />}
      {jobs.isError && <p className="text-danger-fg">Couldn't load jobs: {jobs.error.message}</p>}
      {jobs.isSuccess && visible.length === 0 && (
        <EmptyState icon={<Inbox className="size-8" />} title={s.tab === 'new' ? 'No new jobs' : 'Nothing here yet'}>
          {s.tab === 'new' ? (
            <>
              Discovery runs every night at 02:00. See each source's last run, or start one now, in{' '}
              <Link className="font-medium text-fg underline" to="/sources">
                Sources
              </Link>
              .
            </>
          ) : null}
        </EmptyState>
      )}

      <ul className="space-y-2">
        {main.map((j) => (
          <JobRow key={j.id} job={j} selected={j.id === selectedId} />
        ))}
      </ul>

      {weaker.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={showWeaker}
            onClick={() => setShowWeaker((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-sm font-medium text-muted hover:text-fg"
          >
            {showWeaker ? 'Hide' : 'Show'} {weaker.length} weaker {weaker.length === 1 ? 'match' : 'matches'}
            <ChevronDown className={`size-4 transition ${showWeaker ? 'rotate-180' : ''}`} />
          </button>
          {showWeaker && (
            <ul className="mt-1 space-y-2 opacity-80">
              {weaker.map((j: JobListItem) => (
                <JobRow key={j.id} job={j} selected={j.id === selectedId} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label="Loading jobs">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex gap-3 rounded-xl border border-border bg-surface p-3">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
