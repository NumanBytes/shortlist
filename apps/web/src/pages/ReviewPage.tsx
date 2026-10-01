import { PartyPopper, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { EvidenceItem } from '../components/EvidenceItem';
import { Badge, Card, EmptyState, Segmented, Skeleton } from '../components/ui';
import { useProjects, useSkills, useWorkExperiences } from '../lib/queries';
import type { Evidence } from '../lib/types';

type Filter = 'unverified' | 'verified' | 'all';
const matches = (e: Evidence, f: Filter) => f === 'all' || e.isVerified === (f === 'verified');

export function ReviewPage() {
  const { state } = useAuthName();
  const skills = useSkills();
  const work = useWorkExperiences();
  const projects = useProjects();

  const all = skills.data?.flatMap((s) => s.evidence) ?? [];
  const verified = all.filter((e) => e.isVerified).length;
  const toReview = all.length - verified;
  // Default to the review queue while there is one; otherwise show everything.
  const [filter, setFilter] = useState<Filter | null>(null);
  const active: Filter = filter ?? (toReview > 0 ? 'unverified' : 'all');

  // Evidence stores only IDs for its role/project; resolve them to display names.
  const sourceName = useMemo(() => {
    const names = new Map<string, string>();
    for (const w of work.data ?? []) names.set(w.id, `${w.title}, ${w.company}`);
    for (const p of projects.data ?? []) names.set(p.id, p.name);
    return (e: Evidence) => names.get(e.workExperienceId ?? e.projectId ?? '');
  }, [work.data, projects.data]);

  const visible = (skills.data ?? [])
    .map((s) => ({ ...s, evidence: s.evidence.filter((e) => matches(e, active)) }))
    .filter((s) => s.evidence.length > 0);
  const pct = all.length ? Math.round((verified / all.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-fg">Career evidence</h1>
        {state && <p className="text-sm text-muted">{state}</p>}
      </div>

      <Card className="p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" />
          <p className="text-sm text-muted">
            Only <strong className="text-fg">verified</strong> evidence is used to score jobs or write a resume. Verify an
            item only if it's true as worded — reword it first if it isn't.
          </p>
        </div>
        {all.length > 0 && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-fg">
                {verified} of {all.length} verified
              </span>
              {toReview > 0 ? <Badge tone="stretch">{toReview} to review</Badge> : <Badge tone="apply">All verified</Badge>}
            </div>
            {/* Decorative: the text above carries the same information. */}
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ring-track" aria-hidden="true">
              <div className="h-full rounded-full bg-apply transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </Card>

      <Segmented
        label="Filter evidence"
        value={active}
        onChange={setFilter}
        options={[
          { value: 'unverified', label: 'To review', count: toReview },
          { value: 'verified', label: 'Verified', count: verified },
          { value: 'all', label: 'All', count: all.length },
        ]}
      />

      <main className="space-y-5">
        {skills.isPending && (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {skills.isError && <p className="text-danger-fg">Couldn't load your skills: {skills.error.message}</p>}
        {skills.isSuccess && all.length === 0 && (
          <div className="space-y-2 text-sm text-muted">
            <p>No evidence yet. New accounts start empty — load your career data with the seed, then refresh:</p>
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs text-fg">
              {`SEED_USER_EMAIL=${state ?? 'you@example.com'} pnpm --filter @shortlist/db db:seed:career`}
            </pre>
            <p>Everything it adds starts unverified.</p>
          </div>
        )}
        {skills.isSuccess && all.length > 0 && visible.length === 0 && (
          <EmptyState icon={<PartyPopper className="size-8" />} title={active === 'unverified' ? 'Everything is verified' : 'Nothing here yet'} />
        )}
        {visible.map((skill) => (
          <section key={skill.id} aria-labelledby={`skill-${skill.id}`}>
            <div className="mb-2 flex items-center gap-2">
              <h2 id={`skill-${skill.id}`} className="font-semibold text-fg">
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
    </div>
  );
}

// The signed-in user's email, for the seed hint and the header.
function useAuthName() {
  const { state } = useAuth();
  return { state: state.status === 'signedIn' ? state.user.email : null };
}
