import { CreateSkillEvidenceSchema, CreateSkillSchema, SkillCategory, type CreateSkillEvidenceInput } from '@shortlist/shared';
import { Info } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { useCreateEvidence, useCreateSkill, useProjects, useSkills, useWorkExperiences } from '../lib/queries';
import type { Evidence, Skill } from '../lib/types';
import { CONTEXTS, DEPTHS } from './EvidenceItem';
import { Button, Card, TextField } from './ui';

const CATEGORY_LABEL: Record<Skill['category'], string> = {
  LANGUAGE: 'Language',
  FRAMEWORK: 'Framework',
  LIBRARY: 'Library',
  DATABASE: 'Database',
  TOOL: 'Tool',
  PLATFORM: 'Platform',
  CONCEPT: 'Concept / practice',
};

const SELECT = 'block h-10 w-full rounded-lg border border-border bg-surface px-2 text-sm font-normal text-fg';
const thisMonth = () => new Date().toISOString().slice(0, 7);
// Only to validate the evidence fields before the skill exists; never sent.
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

interface EvidenceDraft {
  whatIDid: string;
  context: Evidence['context'];
  depth: Evidence['depth'];
  lastUsed: string; // yyyy-mm
  link: string; // "" | "role:<id>" | "project:<id>"
}

const emptyDraft = (): EvidenceDraft => ({ whatIDid: '', context: 'COMMERCIAL', depth: 'WORKING', lastUsed: thisMonth(), link: '' });

// The draft as a request body, checked with the same schema the API uses. No isVerified:
// new evidence always starts unverified (Agents.md §6) — the schema doesn't even have it.
function toBody(d: EvidenceDraft, skillId: string) {
  const [kind, id] = d.link.split(':');
  return CreateSkillEvidenceSchema.safeParse({
    skillId,
    whatIDid: d.whatIDid,
    context: d.context,
    depth: d.depth,
    lastUsed: `${d.lastUsed}-01`,
    ...(kind === 'role' ? { workExperienceId: id } : kind === 'project' ? { projectId: id } : {}),
  });
}

function EvidenceFields({ draft, onChange, idPrefix }: { draft: EvidenceDraft; onChange: (d: EvidenceDraft) => void; idPrefix: string }) {
  const roles = useWorkExperiences();
  const projects = useProjects();
  const set = <K extends keyof EvidenceDraft>(key: K, value: EvidenceDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-what`} className="block text-sm font-medium text-fg">
          What you did with it
        </label>
        <textarea
          id={`${idPrefix}-what`}
          value={draft.whatIDid}
          onChange={(e) => set('whatIDid', e.target.value)}
          rows={3}
          placeholder="In your own words — resume bullets are built only from this."
          className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-muted">
          Where
          <select value={draft.context} onChange={(e) => set('context', e.target.value as Evidence['context'])} className={SELECT}>
            {CONTEXTS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted">
          How deeply
          <select value={draft.depth} onChange={(e) => set('depth', e.target.value as Evidence['depth'])} className={SELECT}>
            {DEPTHS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-muted">
          Last used
          <input
            type="month"
            value={draft.lastUsed}
            max={thisMonth()}
            onChange={(e) => set('lastUsed', e.target.value)}
            className={SELECT}
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-muted">
          Role or project (optional)
          <select value={draft.link} onChange={(e) => set('link', e.target.value)} className={SELECT}>
            <option value="">Not linked</option>
            {(roles.data ?? []).length > 0 && (
              <optgroup label="Roles">
                {roles.data!.map((r) => (
                  <option key={r.id} value={`role:${r.id}`}>
                    {r.title}, {r.company}
                  </option>
                ))}
              </optgroup>
            )}
            {(projects.data ?? []).length > 0 && (
              <optgroup label="Projects">
                {projects.data!.map((p) => (
                  <option key={p.id} value={`project:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      </div>
      <p className="flex gap-2 text-xs text-muted">
        <Info className="mt-px size-3.5 shrink-0" />
        It's saved as not verified. Read it back and verify it in the list — only verified evidence is used for scoring
        and resumes.
      </p>
    </div>
  );
}

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Could not save');

// "Add a skill" (Agents.md §6.3): a skill and the first piece of evidence for it, in one
// form — a skill with no evidence can't be used for anything. Naming a skill you already
// have adds the evidence to that one instead of failing on the duplicate.
export function AddSkillCard({ onDone }: { onDone: () => void }) {
  const skills = useSkills();
  const createSkill = useCreateSkill();
  const createEvidence = useCreateEvidence();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Skill['category']>('FRAMEWORK');
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState<string>();
  const busy = createSkill.isPending || createEvidence.isPending;
  const existing = (skills.data ?? []).find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const skill = CreateSkillSchema.safeParse({ name, category });
    if (!skill.success) return setError(skill.error.issues[0]?.message);
    // Check the evidence before creating anything, so a typo doesn't leave an empty skill.
    const check = toBody(draft, PLACEHOLDER_ID);
    if (!check.success) return setError(check.error.issues[0]?.message);
    try {
      const skillId = existing?.id ?? (await createSkill.mutateAsync(skill.data)).id;
      await createEvidence.mutateAsync({ ...(check.data as CreateSkillEvidenceInput), skillId });
      onDone();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3" aria-label="Add a skill">
        <h2 className="font-semibold text-fg">Add a skill</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <TextField id="new-skill-name" label="Skill" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Docker" />
          <label className="space-y-1.5 text-sm font-medium text-fg">
            Kind
            <select
              value={existing?.category ?? category}
              disabled={!!existing}
              onChange={(e) => setCategory(e.target.value as Skill['category'])}
              className={`${SELECT} h-11`}
            >
              {SkillCategory.options.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {existing && <p className="text-xs text-muted">You already have {existing.name} — this adds evidence to it.</p>}
        <EvidenceFields draft={draft} onChange={setDraft} idPrefix="new-skill" />
        {error && <p className="text-sm text-danger-fg">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {existing ? 'Add evidence' : 'Add skill'}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

// Another piece of evidence for a skill you already have.
export function AddEvidenceForm({ skill, onDone }: { skill: Pick<Skill, 'id' | 'name'>; onDone: () => void }) {
  const createEvidence = useCreateEvidence();
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = toBody(draft, skill.id);
    if (!body.success) return setError(body.error.issues[0]?.message);
    try {
      await createEvidence.mutateAsync(body.data as CreateSkillEvidenceInput);
      onDone();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-3" aria-label={`Add evidence for ${skill.name}`}>
      <EvidenceFields draft={draft} onChange={setDraft} idPrefix={`add-${skill.id}`} />
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={createEvidence.isPending}>
          Add evidence
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
