import {
  CreateProjectSchema,
  CreateWorkExperienceSchema,
  UpdateProjectSchema,
  UpdateWorkExperienceSchema,
} from '@shortlist/shared';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { useDeleteProject, useDeleteRole, useSaveProject, useSaveRole, useWorkExperiences } from '../../lib/queries';
import type { Project, WorkExperience } from '../../lib/types';
import { Button, INPUT, Switch, TextField } from '../../components/ui';

const LABEL = 'block text-[13px] font-medium text-muted';
const month = (iso: string | null | undefined) => (iso ? iso.slice(0, 7) : '');
const toDate = (m: string) => (m ? `${m}-01` : null);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? 'Check the fields';
const apiMessage = (err: unknown) =>
  err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : 'Could not save';

// Only what changed, so an edit to a cosmetic field doesn't touch the claim fields (the
// server compares by value too, but a smaller body is the clearer contract).
function changed<T extends Record<string, unknown>>(next: T, prev: Record<string, unknown>): Partial<T> {
  return Object.fromEntries(
    Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(prev[k] ?? null)),
  ) as Partial<T>;
}

function ClaimNote({ what }: { what: string }) {
  return (
    <p className="flex gap-2 rounded-xl bg-stretch-bg px-3 py-2.5 text-[13px] text-fg">
      <ShieldAlert className="mt-px size-4 shrink-0 text-stretch-fg" aria-hidden="true" />
      <span>Changing {what} makes the evidence linked to it unverified — you'll confirm it again.</span>
    </p>
  );
}

function DeleteButton({
  label,
  warning,
  onDelete,
  busy,
}: {
  label: string;
  warning: string;
  onDelete: () => void;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Button variant="danger" className="w-full" onClick={() => setConfirming(true)}>
        <Trash2 className="size-4" /> Delete {label}
      </Button>
    );
  return (
    <div className="space-y-2 rounded-xl bg-danger-bg p-3">
      <p className="text-[13px] text-fg">{warning}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
        <Button variant="danger" className="bg-surface" onClick={onDelete} disabled={busy}>
          Delete
        </Button>
      </div>
    </div>
  );
}

// A paid role (Experience). Company, title and dates are claims: changing them, or
// deleting the role, un-verifies the evidence linked to it (server-side, §6.3).
export function RoleForm({ role, onDone }: { role?: WorkExperience; onDone: () => void }) {
  const save = useSaveRole();
  const remove = useDeleteRole();
  const [v, setV] = useState({
    company: role?.company ?? '',
    title: role?.title ?? '',
    location: role?.location ?? '',
    start: month(role?.startDate),
    end: month(role?.endDate),
    isCurrent: role?.isCurrent ?? !role,
  });
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const body = {
      company: v.company,
      title: v.title,
      location: v.location.trim() || null,
      startDate: toDate(v.start),
      endDate: v.isCurrent ? null : toDate(v.end),
      isCurrent: v.isCurrent,
    };
    // The create schema checks the dates as a whole; reuse it for edits too.
    const whole = CreateWorkExperienceSchema.safeParse(body);
    if (!whole.success) return setError(firstIssue(whole.error));
    try {
      if (role) {
        const diff = changed(body, {
          ...role,
          startDate: toDate(month(role.startDate)),
          endDate: toDate(month(role.endDate)),
        });
        if (Object.keys(diff).length === 0) return onDone();
        const parsed = UpdateWorkExperienceSchema.safeParse(diff);
        if (!parsed.success) return setError(firstIssue(parsed.error));
        await save.mutateAsync({ id: role.id, body: parsed.data });
      } else {
        await save.mutateAsync({ body: whole.data });
      }
      onDone();
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={role ? 'Edit role' : 'Add role'}>
      <p className="text-[17px] font-semibold text-fg">{role ? 'Edit role' : 'Add role'}</p>
      <TextField
        id="role-title"
        label="Title"
        value={v.title}
        onChange={(e) => setV({ ...v, title: e.target.value })}
      />
      <TextField
        id="role-company"
        label="Company"
        value={v.company}
        onChange={(e) => setV({ ...v, company: e.target.value })}
      />
      <TextField
        id="role-location"
        label="Location (optional)"
        value={v.location}
        onChange={(e) => setV({ ...v, location: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1.5">
          <label htmlFor="role-start" className={LABEL}>
            Started
          </label>
          <input
            id="role-start"
            type="month"
            max={thisMonth()}
            value={v.start}
            onChange={(e) => setV({ ...v, start: e.target.value })}
            className={`${INPUT} h-12 px-2.5`}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="role-end" className={LABEL}>
            Ended
          </label>
          <input
            id="role-end"
            type="month"
            max={thisMonth()}
            value={v.isCurrent ? '' : v.end}
            disabled={v.isCurrent}
            onChange={(e) => setV({ ...v, end: e.target.value })}
            className={`${INPUT} h-12 px-2.5 disabled:opacity-50`}
          />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border px-3.5 py-2.5">
        <span className="text-[15px] text-fg">I work here now</span>
        <Switch checked={v.isCurrent} onChange={(isCurrent) => setV({ ...v, isCurrent })} label="I work here now" />
      </div>
      {role && <ClaimNote what="the company, title or dates" />}
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
        Save
      </Button>
      {role && (
        <DeleteButton
          label="role"
          busy={remove.isPending}
          warning="Delete this role? Its evidence stays in Evidence but becomes unverified, and its projects become personal ones."
          onDelete={() => remove.mutate(role.id, { onSuccess: onDone, onError: (err) => setError(apiMessage(err)) })}
        />
      )}
    </form>
  );
}

// A project — part of a paid role, or personal. Which role it belongs to is a claim too:
// it decides whether its work may appear under Experience (§6.1).
export function ProjectForm({ project, onDone }: { project?: Project; onDone: () => void }) {
  const roles = useWorkExperiences();
  const save = useSaveProject();
  const remove = useDeleteProject();
  const [v, setV] = useState({
    name: project?.name ?? '',
    description: project?.description ?? '',
    workExperienceId: project?.workExperienceId ?? '',
    isShipped: project?.isShipped ?? false,
    isPinned: project?.isPinned ?? false,
    start: month(project?.startDate),
    end: month(project?.endDate),
    liveUrl: project?.liveUrl ?? '',
    repoUrl: project?.repoUrl ?? '',
  });
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const body = {
      name: v.name,
      description: v.description.trim() || null,
      workExperienceId: v.workExperienceId || null,
      isShipped: v.isShipped,
      isPinned: v.isPinned,
      startDate: toDate(v.start),
      endDate: toDate(v.end),
      liveUrl: v.liveUrl.trim() || null,
      repoUrl: v.repoUrl.trim() || null,
    };
    const whole = CreateProjectSchema.safeParse(body);
    if (!whole.success) return setError(firstIssue(whole.error));
    try {
      if (project) {
        const diff = changed(body, {
          ...project,
          startDate: toDate(month(project.startDate)),
          endDate: toDate(month(project.endDate)),
        });
        if (Object.keys(diff).length === 0) return onDone();
        const parsed = UpdateProjectSchema.safeParse(diff);
        if (!parsed.success) return setError(firstIssue(parsed.error));
        await save.mutateAsync({ id: project.id, body: parsed.data });
      } else {
        await save.mutateAsync({ body: whole.data });
      }
      onDone();
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={project ? 'Edit project' : 'Add project'}>
      <p className="text-[17px] font-semibold text-fg">{project ? 'Edit project' : 'Add project'}</p>
      <TextField id="project-name" label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <div className="space-y-1.5">
        <label htmlFor="project-description" className={LABEL}>
          What it is (optional)
        </label>
        <textarea
          id="project-description"
          rows={2}
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
          className={`${INPUT} py-3 leading-snug`}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="project-role" className={LABEL}>
          Done as part of
        </label>
        <select
          id="project-role"
          value={v.workExperienceId}
          onChange={(e) => setV({ ...v, workExperienceId: e.target.value })}
          className={`${INPUT} h-12 px-2.5`}
        >
          <option value="">A personal project</option>
          {(roles.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}, {r.company}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1.5">
          <label htmlFor="project-start" className={LABEL}>
            Started (optional)
          </label>
          <input
            id="project-start"
            type="month"
            max={thisMonth()}
            value={v.start}
            onChange={(e) => setV({ ...v, start: e.target.value })}
            className={`${INPUT} h-12 px-2.5`}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="project-end" className={LABEL}>
            Ended (optional)
          </label>
          <input
            id="project-end"
            type="month"
            max={thisMonth()}
            value={v.end}
            onChange={(e) => setV({ ...v, end: e.target.value })}
            className={`${INPUT} h-12 px-2.5`}
          />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border px-3.5 py-2.5">
        <span className="text-[15px] text-fg">It shipped to real users</span>
        <Switch
          checked={v.isShipped}
          onChange={(isShipped) => setV({ ...v, isShipped })}
          label="It shipped to real users"
        />
      </div>
      {/* docs/resume.md §13.7: tailoring rewords a pinned project's bullets but never drops it. */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">
        <span>
          <span className="block text-[15px] text-fg">Always on my resume</span>
          <span className="block text-[13px] text-muted">
            Tailoring rewords it for each job but never leaves it out.
          </span>
        </span>
        <Switch checked={v.isPinned} onChange={(isPinned) => setV({ ...v, isPinned })} label="Always on my resume" />
      </div>
      <TextField
        id="project-live"
        label="Live URL (optional)"
        inputMode="url"
        value={v.liveUrl}
        onChange={(e) => setV({ ...v, liveUrl: e.target.value })}
      />
      <TextField
        id="project-repo"
        label="Repository URL (optional)"
        inputMode="url"
        value={v.repoUrl}
        onChange={(e) => setV({ ...v, repoUrl: e.target.value })}
      />
      {project && <ClaimNote what="the name, description, dates, role or whether it shipped" />}
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
        Save
      </Button>
      {project && (
        <DeleteButton
          label="project"
          busy={remove.isPending}
          warning="Delete this project? Its evidence stays in Evidence but becomes unverified."
          onDelete={() => remove.mutate(project.id, { onSuccess: onDone, onError: (err) => setError(apiMessage(err)) })}
        />
      )}
    </form>
  );
}
