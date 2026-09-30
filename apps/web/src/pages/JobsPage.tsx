import { useState } from 'react';
import { Link } from 'react-router';
import { JobCard } from '../components/JobCard';
import { Button } from '../components/ui';
import { useJobs } from '../lib/queries';
import type { JobStatus } from '../lib/types';

const TABS: { status: JobStatus | 'PIPELINE'; label: string }[] = [
  { status: 'DISCOVERED', label: 'New' },
  { status: 'INTERESTED', label: 'Interested' },
  { status: 'PIPELINE', label: 'Applied' },
  { status: 'SKIPPED', label: 'Skipped' },
];
const PIPELINE: JobStatus[] = ['APPLIED', 'ASSESSMENT', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN'];

export function JobsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['status']>('DISCOVERED');
  // "Applied" spans several later stages, so it filters the full list client-side.
  const jobs = useJobs(tab === 'PIPELINE' ? undefined : tab);
  const visible = tab === 'PIPELINE' ? (jobs.data ?? []).filter((j) => PIPELINE.includes(j.status)) : (jobs.data ?? []);

  return (
    <>
      <nav className="flex gap-1" aria-label="Filter jobs">
        {TABS.map((t) => (
          <Button
            key={t.status}
            variant={tab === t.status ? 'primary' : 'ghost'}
            aria-pressed={tab === t.status}
            onClick={() => setTab(t.status)}
          >
            {t.label}
          </Button>
        ))}
      </nav>

      <main className="mt-4">
        {jobs.isPending && <p className="text-slate-500">Loading…</p>}
        {jobs.isError && <p className="text-red-600">Couldn't load jobs: {jobs.error.message}</p>}
        {jobs.isSuccess && visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
            {tab === 'DISCOVERED' ? (
              <>
                <p>No new jobs. Discovery runs every night at 02:00.</p>
                <p className="mt-1">
                  Check <Link className="font-medium underline" to="/sources">Sources</Link> to see each source's last
                  run, or start one now.
                </p>
              </>
            ) : (
              <p>Nothing here yet.</p>
            )}
          </div>
        )}
        <ul className="space-y-3">
          {visible.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </ul>
      </main>
    </>
  );
}
