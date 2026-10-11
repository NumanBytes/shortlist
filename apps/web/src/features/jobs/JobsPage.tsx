import { ArrowUpDown, ChevronDown, Filter, Inbox, MousePointerClick, RotateCw, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useParams, useSearchParams } from 'react-router';
import { FindNewJobs } from './FindNewJobs';
import { JobRow } from './JobRow';
import { Button, Chip, EmptyState, IconButton, Segmented, Skeleton } from '../../components/ui';
import { useJobCounts, useJobs, type JobSort } from '../../lib/queries';
import { PageHeader } from '../../layout/AppShell';
import type { JobListItem, JobStatus, Verdict } from '../../lib/types';

type Tab = 'new' | 'interested' | 'applied' | 'skipped' | 'all';
type VerdictFilter = 'all' | Verdict;

const TAB_STATUS: Record<Tab, JobStatus | undefined> = {
  new: 'DISCOVERED',
  interested: 'INTERESTED',
  applied: undefined, // several later stages — filtered client-side
  skipped: 'SKIPPED',
  all: undefined, // offered when viewing one source's jobs (from the Sources page)
};
const PIPELINE: JobStatus[] = ['APPLIED', 'ASSESSMENT', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'];

// List state lives in the URL (?tab=&verdict=&sort=&source=), so opening a job and coming
// back — or the phone's back gesture — returns to exactly the same list.
function useListState() {
  const [params, setParams] = useSearchParams();
  const source = params.get('source') ?? undefined;
  const requested = (params.get('tab') as Tab | null) ?? 'new';
  const tab = requested === 'all' && !source ? 'new' : requested;
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
    source,
    clearSource: () =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete('source');
          if (next.get('tab') === 'all') next.delete('tab');
          return next;
        },
        { replace: true },
      ),
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
  const jobs = useJobs(TAB_STATUS[s.tab], s.sort, s.source);
  const counts = useJobCounts(s.source);
  const [showWeaker, setShowWeaker] = useState(false);

  const all = (jobs.data ?? []).filter((j) => s.tab !== 'applied' || PIPELINE.includes(j.status));
  const count = (v: Verdict) => all.filter((j) => j.match?.verdict === v).length;
  const visible = s.verdict === 'all' ? all : all.filter((j) => j.match?.verdict === s.verdict);
  // With no verdict filter and best-match order, SKIPs fold away so the list leads with
  // what's worth your time. Nothing is hidden for good — one tap shows them.
  const fold = s.verdict === 'all' && s.sort === 'score';
  const main = fold ? visible.filter((j) => j.match?.verdict !== 'SKIP') : visible;
  const weaker = fold ? visible.filter((j) => j.match?.verdict === 'SKIP') : [];

  const c = counts.data;
  const tabCount = (t: Tab) =>
    !c ? undefined : t === 'applied' ? PIPELINE.reduce((n, st) => n + (c[st] ?? 0), 0) : t === 'all' ? Object.values(c).reduce((a, b) => a + (b ?? 0), 0) : (c[TAB_STATUS[t]!] ?? 0);
  const interested = tabCount('interested') ?? 0;

  return (
    <div className="space-y-3">
      <PageHeader title="Jobs" />

      {s.source && (
        <div className="flex items-center gap-2 rounded-[14px] bg-surface-2 py-1 pr-1 pl-3.5 text-sm text-muted">
          <Filter className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Only jobs from <span className="font-medium text-fg">{all[0]?.jobSource?.name ?? 'one source'}</span>
          </span>
          <IconButton label="Show jobs from every source" onClick={s.clearSource}>
            <X className="size-4" />
          </IconButton>
        </div>
      )}

      <Segmented
        label="Pipeline"
        value={s.tab}
        onChange={s.setTab}
        options={[
          ...(s.source ? [{ value: 'all' as const, label: 'All', count: tabCount('all') }] : []),
          { value: 'new', label: 'New', count: tabCount('new') },
          { value: 'interested', label: 'Interested', count: tabCount('interested') },
          { value: 'applied', label: 'Applied', count: tabCount('applied') },
          { value: 'skipped', label: 'Skipped', count: tabCount('skipped') },
        ]}
      />

      {s.tab === 'new' && !s.source && <FindNewJobs />}

      {jobs.isSuccess && all.length > 0 && (
        <>
          <fieldset className="-mx-4 flex min-w-0 gap-2 overflow-x-auto border-0 px-4 py-0 sm:mx-0 sm:px-0">
            <legend className="sr-only">Filter by verdict</legend>
            <Chip pressed={s.verdict === 'all'} onClick={() => s.setVerdict('all')} count={all.length}>
              All
            </Chip>
            <Chip pressed={s.verdict === 'APPLY'} onClick={() => s.setVerdict('APPLY')} count={count('APPLY')} dot="apply">
              Apply
            </Chip>
            <Chip pressed={s.verdict === 'STRETCH'} onClick={() => s.setVerdict('STRETCH')} count={count('STRETCH')} dot="stretch">
              Stretch
            </Chip>
            <Chip pressed={s.verdict === 'SKIP'} onClick={() => s.setVerdict('SKIP')} count={count('SKIP')} dot="skip">
              Skip
            </Chip>
          </fieldset>
          <div className="flex items-center justify-between">
            <p className="px-1 text-xs text-muted tabular-nums">
              {visible.length} {visible.length === 1 ? 'match' : 'matches'}
            </p>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Sort: ${s.sort === 'score' ? 'best match' : 'newest'} (tap to change)`}
              onClick={() => s.setSort(s.sort === 'score' ? 'recent' : 'score')}
              className="font-medium"
            >
              <ArrowUpDown className="size-4" /> {s.sort === 'score' ? 'Best match' : 'Newest'}
            </Button>
          </div>
        </>
      )}

      {jobs.isPending && <ListSkeleton />}
      {jobs.isError && (
        <EmptyState icon={<WifiOff className="size-6 text-danger" />} title="Couldn't load your jobs">
          The server didn't respond. Nothing was lost — your jobs and resumes are saved.
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={() => void jobs.refetch()}>
              <RotateCw className="size-4" /> Try again
            </Button>
          </div>
        </EmptyState>
      )}
      {jobs.isSuccess && visible.length === 0 && (
        <EmptyState icon={<Inbox className="size-6" />} title={s.tab === 'new' ? 'No new jobs' : 'Nothing here yet'}>
          {s.tab === 'new' && !s.source ? (
            <>
              You're all caught up. New jobs are checked every night, or tap “Check for new jobs”.
              {interested > 0 && (
                <div className="mt-4">
                  <Button variant="secondary" size="sm" onClick={() => s.setTab('interested')}>
                    See Interested ({interested})
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </EmptyState>
      )}

      <ul className="space-y-2.5">
        {main.map((j) => (
          <JobRow key={j.id} job={j} selected={j.id === selectedId} />
        ))}
      </ul>

      {weaker.length > 0 && (
        <div>
          <Button
            variant="ghost"
            aria-expanded={showWeaker}
            onClick={() => setShowWeaker((v) => !v)}
            className="w-full font-medium"
          >
            {showWeaker ? 'Hide' : 'Show'} <span className="tabular-nums">{weaker.length}</span> weaker {weaker.length === 1 ? 'match' : 'matches'}
            <ChevronDown className={`size-4 transition ${showWeaker ? 'rotate-180' : ''}`} />
          </Button>
          {showWeaker && (
            <ul className="mt-1 space-y-2.5 opacity-80">
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
    <ul className="space-y-2.5" aria-busy="true" aria-label="Loading jobs">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex gap-3 rounded-2xl border border-border bg-surface p-3.5">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="flex gap-1.5">
              <Skeleton className="h-[22px] w-14" />
              <Skeleton className="h-[22px] w-14" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
