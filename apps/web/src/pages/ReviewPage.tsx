import { ChevronDown, ChevronUp, PartyPopper, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/AppShell';
import { EvidenceSheet, type EvidenceSheetMode } from '../components/AddEvidence';
import { EvidenceItem } from '../components/EvidenceItem';
import { Badge, Button, Card, EmptyState, Skeleton } from '../components/ui';
import { useProjects, useSkills, useWorkExperiences } from '../lib/queries';
import type { Evidence, Skill } from '../lib/types';

// Evidence (design board 4): what you've done, grouped by skill, and the review queue.
// Only verified evidence is used to score jobs or write a resume (Agents.md §6).
export function ReviewPage() {
  const email = useEmail();
  const skills = useSkills();
  const work = useWorkExperiences();
  const projects = useProjects();
  const [sheet, setSheet] = useState<EvidenceSheetMode | null>(null);
  // Which groups are open. Until the user toggles one, the first group with something to
  // review opens by itself — the review queue leads.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const list = skills.data ?? [];
  const all = list.flatMap((s) => s.evidence);
  const verified = all.filter((e) => e.isVerified).length;
  const toReview = all.length - verified;
  const firstToReview = list.find((s) => s.evidence.some((e) => !e.isVerified))?.id;
  const isOpen = (id: string) => open[id] ?? id === firstToReview;

  // Evidence stores only IDs for its role/project; resolve them to display names.
  const sourceName = useMemo(() => {
    const names = new Map<string, string>();
    for (const w of work.data ?? []) names.set(w.id, `${w.title}, ${w.company}`);
    for (const p of projects.data ?? []) names.set(p.id, p.name);
    return (e: Evidence) => names.get(e.workExperienceId ?? e.projectId ?? '');
  }, [work.data, projects.data]);

  // Skills with something to review come first (the design leads with the queue); the
  // rest keep the API's alphabetical order.
  const pendingOf = (s: Skill) => s.evidence.some((e) => !e.isVerified);
  const shown = list.filter((s) => s.evidence.length > 0).sort((a, b) => Number(pendingOf(b)) - Number(pendingOf(a)));

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <PageHeader title="Evidence" />

      {all.length > 0 && (
        <Card className="space-y-2.5 px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px] font-semibold text-fg">
              {toReview > 0 ? (
                <>
                  <span className="tabular-nums">{toReview}</span> to review
                </>
              ) : (
                'All verified'
              )}
            </p>
            <p className="text-xs text-muted tabular-nums">
              {verified} of {all.length} verified
            </p>
          </div>
          <progress
            aria-label="Verified evidence"
            max={all.length}
            value={verified}
            className="block h-1.5 w-full appearance-none overflow-hidden rounded-full bg-surface-2 [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-surface-2 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-accent"
          />
          <p className="text-xs text-muted">Resumes only use evidence you've verified. Verify an item only if it's true as worded.</p>
        </Card>
      )}

      {skills.isPending && (
        <div className="space-y-2.5" aria-busy="true">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      )}
      {skills.isError && <p className="text-danger-fg">Couldn't load your skills: {skills.error.message}</p>}
      {skills.isSuccess && all.length === 0 && (
        <div className="space-y-2 text-sm text-muted">
          <p>No evidence yet. Tap “Add skill”, or load your career data with the seed, then refresh:</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs text-fg">
            {`SEED_USER_EMAIL=${email ?? 'you@example.com'} pnpm --filter @shortlist/db db:seed:career`}
          </pre>
          <p>Everything added starts unverified.</p>
        </div>
      )}
      {skills.isSuccess && all.length > 0 && shown.length === 0 && <EmptyState icon={<PartyPopper className="size-6" />} title="Everything is verified" />}

      <div className="space-y-2.5">
        {shown.map((skill) => (
          <SkillGroup
            key={skill.id}
            skill={skill}
            open={isOpen(skill.id)}
            onToggle={() => setOpen((o) => ({ ...o, [skill.id]: !isOpen(skill.id) }))}
            sourceName={sourceName}
            onEdit={(evidence) => setSheet({ kind: 'edit', evidence, skillName: skill.name })}
            onAdd={() => setSheet({ kind: 'add', skill })}
          />
        ))}
      </div>

      {/* Floating "Add skill" above the tab bar on phones (design board 4); inline on desktop. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setSheet({ kind: 'new-skill' })}
          className="fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 flex h-13 items-center gap-2 rounded-full bg-fg pr-5 pl-4 text-[15px] font-semibold text-bg shadow-[0_10px_28px_rgb(15_23_42/0.28)] sm:static sm:shadow-none print:hidden"
        >
          <Plus className="size-5" /> Add skill
        </button>
      </div>

      <EvidenceSheet mode={sheet} onClose={() => setSheet(null)} onSaved={() => setSheet(null)} />
    </div>
  );
}

// A skill's evidence, collapsible. Collapsed, it says how many items wait for review.
function SkillGroup({
  skill,
  open,
  onToggle,
  sourceName,
  onEdit,
  onAdd,
}: {
  skill: Skill;
  open: boolean;
  onToggle: () => void;
  sourceName: (e: Evidence) => string | undefined;
  onEdit: (e: Evidence) => void;
  onAdd: () => void;
}) {
  const verified = skill.evidence.filter((e) => e.isVerified).length;
  const pending = skill.evidence.length - verified;
  const learning = skill.evidence.every((e) => e.depth === 'EXPOSURE');
  return (
    <section aria-label={`${skill.name} evidence`} className="overflow-hidden rounded-2xl border border-border bg-surface">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-13 w-full items-center gap-2.5 pr-2 pl-4 text-left">
        <span className="flex-1 text-[15px] font-semibold text-fg">
          {skill.name}
          {learning && <span className="text-xs font-medium text-muted"> · learning</span>}
        </span>
        {open || pending === 0 ? (
          <span className="text-xs text-muted tabular-nums">
            {verified} of {skill.evidence.length} verified
          </span>
        ) : (
          <Badge tone="stretch">
            <span className="tabular-nums">{pending}</span> to review
          </Badge>
        )}
        <span className="grid size-8 place-items-center text-muted" aria-hidden="true">
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </button>
      {open && (
        <>
          <ul>
            {skill.evidence.map((e) => (
              <EvidenceItem key={e.id} evidence={e} source={sourceName(e)} onEdit={() => onEdit(e)} />
            ))}
          </ul>
          <div className="border-t border-border px-2 py-1">
            <Button variant="ghost" size="sm" className="text-accent-fg" onClick={onAdd}>
              <Plus className="size-4" /> Add evidence for {skill.name}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

// The signed-in user's email, for the seed hint.
function useEmail() {
  const { state } = useAuth();
  return state.status === 'signedIn' ? state.user.email : null;
}
