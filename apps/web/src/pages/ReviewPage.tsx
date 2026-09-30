import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { EvidenceItem } from '../components/EvidenceItem';
import { Badge, Button } from '../components/ui';
import { useProjects, useSkills, useWorkExperiences } from '../lib/queries';
import type { Evidence } from '../lib/types';

type Filter = 'unverified' | 'verified' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'unverified', label: 'To review' },
  { value: 'verified', label: 'Verified' },
  { value: 'all', label: 'All' },
];

const matches = (e: Evidence, f: Filter) => f === 'all' || e.isVerified === (f === 'verified');

export function ReviewPage() {
  const { state } = useAuth();
  const skills = useSkills();
  const work = useWorkExperiences();
  const projects = useProjects();
  const [filter, setFilter] = useState<Filter>('unverified');

  // Evidence stores only IDs for its role/project; resolve them to display names.
  const sourceName = useMemo(() => {
    const names = new Map<string, string>();
    for (const w of work.data ?? []) names.set(w.id, `${w.title}, ${w.company}`);
    for (const p of projects.data ?? []) names.set(p.id, p.name);
    return (e: Evidence) => names.get(e.workExperienceId ?? e.projectId ?? '');
  }, [work.data, projects.data]);

  const all = skills.data?.flatMap((s) => s.evidence) ?? [];
  const verified = all.filter((e) => e.isVerified).length;
  const visible = (skills.data ?? [])
    .map((s) => ({ ...s, evidence: s.evidence.filter((e) => matches(e, filter)) }))
    .filter((s) => s.evidence.length > 0);

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          Only <strong>verified</strong> evidence can ever reach a resume. Verify an item only if it's true as worded —
          reword it first if it isn't.
        </p>
        {all.length > 0 && (
          <div className="mt-3">
            <div className="flex justify-between text-sm">
              <span className="font-medium">
                {verified} of {all.length} verified
              </span>
            </div>
            {/* Decorative: the "N of M verified" text above carries the same information. */}
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(verified / all.length) * 100}%` }} />
            </div>
          </div>
        )}
      </section>

      <nav className="mt-4 flex gap-1" aria-label="Filter evidence">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? 'primary' : 'ghost'}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </nav>

      <main className="mt-4 space-y-4">
        {skills.isPending && <p className="text-slate-500">Loading…</p>}
        {skills.isError && <p className="text-red-600">Couldn't load your skills: {skills.error.message}</p>}
        {skills.isSuccess && all.length === 0 && (
          <div className="space-y-2 text-sm text-slate-600">
            <p>No evidence yet. New accounts start empty — load your career data with the seed, then refresh:</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {`SEED_USER_EMAIL=${state.status === 'signedIn' ? state.user.email : 'you@example.com'} pnpm --filter @shortlist/db db:seed:career`}
            </pre>
            <p>Everything it adds starts unverified.</p>
          </div>
        )}
        {skills.isSuccess && all.length > 0 && visible.length === 0 && (
          <p className="text-slate-500">{filter === 'unverified' ? 'Everything is verified. 🎉' : 'Nothing here yet.'}</p>
        )}
        {visible.map((skill) => (
          <section key={skill.id} aria-labelledby={`skill-${skill.id}`}>
            <div className="mb-2 flex items-center gap-2">
              <h2 id={`skill-${skill.id}`} className="font-semibold">
                {skill.name}
              </h2>
              <Badge>{skill.category.toLowerCase()}</Badge>
            </div>
            <ul className="space-y-2">
              {skill.evidence.map((e) => (
                <EvidenceItem key={e.id} evidence={e} source={sourceName(e)} />
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
