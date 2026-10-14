import {
  CreateSkillEvidenceSchema,
  CreateSkillSchema,
  SkillCategory,
  UpdateSkillEvidenceSchema,
  type CreateSkillEvidenceInput,
} from '@shortlist/shared';
import { ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import {
  useCreateEvidence,
  useCreateSkill,
  useProjects,
  useSkills,
  useUpdateEvidence,
  useWorkExperiences,
} from '../../lib/queries';
import type { Evidence, Skill } from '../../lib/types';
import { Button, INPUT, Segmented, Sheet } from '../../components/ui';

// Plain-language meaning of each level — these decide where a claim may appear (Agents.md §6.1).
export const CONTEXTS = [
  { value: 'COMMERCIAL', label: 'Commercial', hint: 'Paid work' },
  { value: 'PERSONAL', label: 'Personal', hint: 'Personal or self-taught' },
  { value: 'ACADEMIC', label: 'Academic', hint: 'University or coursework' },
] as const;
export const DEPTHS = [
  { value: 'EXPOSURE', label: 'Exposure', hint: 'Learning — tutorials, coursework, a first try' },
  { value: 'WORKING', label: 'Working', hint: "Can build with it, hasn't shipped" },
  { value: 'PRODUCTION', label: 'Production', hint: 'Built things that shipped' },
  { value: 'MAINTENANCE', label: 'Maintenance', hint: "Upgraded or fixed it, didn't build it" },
] as const;

const CATEGORY_LABEL: Record<Skill['category'], string> = {
  LANGUAGE: 'Language',
  FRAMEWORK: 'Framework',
  LIBRARY: 'Library',
  DATABASE: 'Database',
  TOOL: 'Tool',
  PLATFORM: 'Platform',
  CONCEPT: 'Concept',
};

const FIELD_LABEL = 'block text-footnote font-medium text-muted';
const thisMonth = () => new Date().toISOString().slice(0, 7);
// Only to validate the evidence fields before the skill exists; never sent.
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

interface Draft {
  whatIDid: string;
  context: Evidence['context'];
  depth: Evidence['depth'];
  lastUsed: string; // yyyy-mm
  link: string; // "" | "role:<id>" | "project:<id>"
}

const linkOf = (e: Pick<Evidence, 'workExperienceId' | 'projectId'>) =>
  e.workExperienceId ? `role:${e.workExperienceId}` : e.projectId ? `project:${e.projectId}` : '';
const splitLink = (link: string) => {
  const [kind, id] = link.split(':');
  return { workExperienceId: kind === 'role' ? id! : null, projectId: kind === 'project' ? id! : null };
};

export type EvidenceSheetMode =
  | { kind: 'new-skill' }
  | { kind: 'add'; skill: Pick<Skill, 'id' | 'name'> }
  | { kind: 'edit'; evidence: Evidence; skillName: string };

// The evidence sheet (design board 4b): add a skill with its first evidence, add evidence
// to a skill, or edit an item. Truthfulness (Agents.md §6): new evidence is always saved
// unverified (no request body can carry isVerified); an edit sends only what changed and
// un-verifies the item; everything is checked with the API's own schemas first.
export function EvidenceSheet({
  mode,
  onClose,
  onSaved,
}: {
  mode: EvidenceSheetMode | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Sheet
      open={mode !== null}
      onClose={onClose}
      title={
        mode?.kind === 'edit'
          ? 'Edit evidence'
          : mode?.kind === 'add'
            ? `Add evidence for ${mode.skill.name}`
            : 'Add skill'
      }
    >
      {mode && (
        <EvidenceForm
          key={mode.kind === 'edit' ? mode.evidence.id : mode.kind}
          mode={mode}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Sheet>
  );
}

function EvidenceForm({
  mode,
  onClose,
  onSaved,
}: {
  mode: EvidenceSheetMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const skills = useSkills();
  const roles = useWorkExperiences();
  const projects = useProjects();
  const createSkill = useCreateSkill();
  const createEvidence = useCreateEvidence();
  const update = useUpdateEvidence();
  const editing = mode.kind === 'edit' ? mode.evidence : null;
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Skill['category']>('FRAMEWORK');
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? {
          whatIDid: editing.whatIDid,
          context: editing.context,
          depth: editing.depth,
          lastUsed: editing.lastUsed.slice(0, 7),
          link: linkOf(editing),
        }
      : { whatIDid: '', context: 'COMMERCIAL', depth: 'WORKING', lastUsed: thisMonth(), link: '' },
  );
  const [error, setError] = useState<string>();
  const busy = createSkill.isPending || createEvidence.isPending || update.isPending;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const existing =
    mode.kind === 'new-skill'
      ? (skills.data ?? []).find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase())
      : undefined;
  const title = mode.kind === 'edit' ? 'Edit evidence' : mode.kind === 'add' ? mode.skill.name : 'Add skill';

  const createBody = (skillId: string) =>
    CreateSkillEvidenceSchema.safeParse({
      skillId,
      whatIDid: draft.whatIDid,
      context: draft.context,
      depth: draft.depth,
      lastUsed: `${draft.lastUsed}-01`,
      ...Object.fromEntries(Object.entries(splitLink(draft.link)).filter(([, v]) => v)),
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      if (editing) {
        // Send only what changed — every change is a claim change and un-verifies the item.
        const links = splitLink(draft.link);
        const changes = {
          ...(draft.whatIDid.trim() !== editing.whatIDid ? { whatIDid: draft.whatIDid } : {}),
          ...(draft.context !== editing.context ? { context: draft.context } : {}),
          ...(draft.depth !== editing.depth ? { depth: draft.depth } : {}),
          ...(draft.lastUsed !== editing.lastUsed.slice(0, 7) ? { lastUsed: `${draft.lastUsed}-01` } : {}),
          ...(draft.link !== linkOf(editing) ? links : {}),
        };
        if (Object.keys(changes).length === 0) return onClose();
        const parsed = UpdateSkillEvidenceSchema.safeParse(changes);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message);
        await update.mutateAsync({ id: editing.id, body: parsed.data });
      } else if (mode.kind === 'add') {
        const body = createBody(mode.skill.id);
        if (!body.success) return setError(body.error.issues[0]?.message);
        await createEvidence.mutateAsync(body.data as CreateSkillEvidenceInput);
      } else {
        const skill = CreateSkillSchema.safeParse({ name, category });
        if (!skill.success) return setError(skill.error.issues[0]?.message);
        // Check the evidence before creating anything, so a mistake doesn't leave an empty skill.
        const check = createBody(PLACEHOLDER_ID);
        if (!check.success) return setError(check.error.issues[0]?.message);
        const skillId = existing?.id ?? (await createSkill.mutateAsync(skill.data)).id;
        await createEvidence.mutateAsync({ ...(check.data as CreateSkillEvidenceInput), skillId });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" aria-label={title}>
      {mode.kind === 'new-skill' && (
        <div className="grid grid-cols-[1fr_8.5rem] gap-2.5">
          <div className="space-y-1.5">
            <label htmlFor="ev-skill" className={FIELD_LABEL}>
              Skill
            </label>
            <input
              id="ev-skill"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Docker"
              className={`${INPUT} h-12`}
            />
          </div>
          <div className="space-y-1.5">
            {/* Not in the design: every skill is stored with a category, so it's asked here. */}
            <label htmlFor="ev-kind" className={FIELD_LABEL}>
              Kind
            </label>
            <select
              id="ev-kind"
              value={existing?.category ?? category}
              disabled={!!existing}
              onChange={(e) => setCategory(e.target.value as Skill['category'])}
              className={`${INPUT} h-12 px-2.5`}
            >
              {SkillCategory.options.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          {existing && (
            <p className="col-span-2 text-caption text-muted">
              You already have {existing.name} — this adds evidence to it.
            </p>
          )}
        </div>
      )}

      {mode.kind === 'new-skill' && (
        <p className="pt-1 text-caption font-semibold tracking-[0.06em] text-muted uppercase">First evidence</p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="ev-what" className={FIELD_LABEL}>
          What did you do? Use your own words.
        </label>
        <textarea
          id="ev-what"
          value={draft.whatIDid}
          onChange={(e) => set('whatIDid', e.target.value)}
          rows={3}
          placeholder="Resume bullets are built only from this."
          className={`${INPUT} py-3 leading-snug`}
        />
      </div>

      <div className="space-y-1.5">
        <p className={FIELD_LABEL}>Context</p>
        <Segmented
          label="Context"
          value={draft.context}
          onChange={(v) => set('context', v)}
          options={CONTEXTS.map(({ value, label }) => ({ value, label }))}
        />
      </div>
      <div className="space-y-1.5">
        <p className={FIELD_LABEL}>Depth</p>
        <Segmented
          label="Depth"
          value={draft.depth}
          onChange={(v) => set('depth', v)}
          options={DEPTHS.map(({ value, label }) => ({ value, label }))}
        />
        <p className="px-1 text-caption text-muted">{DEPTHS.find((d) => d.value === draft.depth)?.hint}</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1.5">
          <label htmlFor="ev-link" className={FIELD_LABEL}>
            Role or project
          </label>
          <select
            id="ev-link"
            value={draft.link}
            onChange={(e) => set('link', e.target.value)}
            className={`${INPUT} h-12 px-2.5`}
          >
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
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ev-used" className={FIELD_LABEL}>
            Last used
          </label>
          <input
            id="ev-used"
            type="month"
            value={draft.lastUsed}
            max={thisMonth()}
            onChange={(e) => set('lastUsed', e.target.value)}
            className={`${INPUT} h-12 px-2.5 tabular-nums`}
          />
        </div>
      </div>

      <div className="flex gap-2 rounded-md bg-stretch-bg px-3 py-2.5 text-footnote text-fg">
        <ShieldCheck className="mt-px size-4 shrink-0 text-stretch-fg" aria-hidden="true" />
        <p>
          {editing ? (
            <>
              Saving changes makes it <b className="font-semibold">Unverified</b> again — you'll confirm it once more.
            </>
          ) : (
            <>
              Saved as <b className="font-semibold">Unverified</b>. Resumes won't use it until you tap Verify.
            </>
          )}
        </p>
      </div>
      {error && <p className="text-footnote text-danger-fg">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {editing ? 'Save changes' : 'Save evidence'}
      </Button>
    </form>
  );
}
