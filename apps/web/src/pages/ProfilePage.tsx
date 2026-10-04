import { UpdateProfileSchema } from '@shortlist/shared';
import { Briefcase, ChevronLeft, ChevronRight, FolderKanban, GraduationCap, LogOut, Mail, Minus, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import { Button, SectionLabel, Sheet, Skeleton, TextField } from '../components/ui';
import { ApiError } from '../lib/api';
import {
  useAiUsage,
  useDeleteEducation,
  useEducation,
  useGmail,
  useProfile,
  useProjects,
  useSaveEducation,
  useUpdateAiSettings,
  useUpdateProfile,
  useWorkExperiences,
} from '../lib/queries';
import type { Education, PublicUser } from '../lib/types';

const year = (iso: string | null) => (iso ? new Date(iso).getUTCFullYear() : null);
const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('') || '?';

// Profile (design board 6): the resume header, roles, projects, education, the AI budget
// and the account. Personal details live only in the database — never in committed files.
export function ProfilePage() {
  const profile = useProfile();
  const [editing, setEditing] = useState(false);
  return (
    <main className="mx-auto max-w-2xl space-y-3 pb-6">
      <nav className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Link to="/" className="-ml-1 inline-flex min-h-11 items-center gap-0.5 text-[17px] font-medium text-accent-fg">
          <ChevronLeft className="size-6" /> Jobs
        </Link>
        <h1 className="text-[15px] font-semibold text-fg">Profile</h1>
        <button type="button" onClick={() => setEditing(true)} className="min-h-11 justify-self-end px-1 text-[15px] font-semibold text-accent-fg">
          Edit
        </button>
      </nav>

      {profile.data ? <Identity profile={profile.data} /> : <Skeleton className="mx-auto h-40 w-64" />}

      <Roles />
      <Projects />
      <EducationList />
      <Budget />
      <Account />

      {profile.data && (
        <Sheet open={editing} onClose={() => setEditing(false)} title="Edit profile">
          <ContactForm profile={profile.data} onDone={() => setEditing(false)} />
        </Sheet>
      )}
    </main>
  );
}

function Identity({ profile: p }: { profile: PublicUser }) {
  return (
    <header className="flex flex-col items-center gap-1 px-4 pt-2 pb-2 text-center">
      <span className="mb-2 grid size-[72px] place-items-center rounded-full bg-accent-soft text-2xl font-semibold text-accent-fg">{initialsOf(p.name)}</span>
      <p className="text-xl font-bold tracking-[-0.01em] text-fg">{p.name}</p>
      {p.headline && <p className="text-[15px] text-muted">{p.headline}</p>}
      <p className="text-[13px] text-muted">{[p.location, p.email].filter(Boolean).join(' · ')}</p>
    </header>
  );
}

// A grouped list in a card (design board 6): icon tile, title, subtitle, optional chevron.
function Row({ icon, title, sub, onClick, trailing }: { icon: ReactNode; title: string; sub?: string; onClick?: () => void; trailing?: ReactNode }) {
  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-fg">{title}</span>
        {sub && <span className="block truncate text-[13px] text-muted">{sub}</span>}
      </span>
      {trailing}
      {onClick && <ChevronRight className="size-4 shrink-0 text-muted" />}
    </>
  );
  const cls = 'flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:bg-surface-2`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2 pt-2" aria-label={label}>
      <SectionLabel>{label}</SectionLabel>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">{children}</div>
    </section>
  );
}

// Roles and projects are listed here; editing them in the app is planned work
// (Agents.md §17.3), so the rows don't open anything yet.
function Roles() {
  const roles = useWorkExperiences();
  if (!roles.data?.length) return null;
  return (
    <Group label="Experience">
      {roles.data.map((r) => (
        <Row
          key={r.id}
          icon={<Briefcase className="size-[18px]" />}
          title={r.title}
          sub={`${r.company} · ${year(r.startDate)} – ${r.isCurrent || !r.endDate ? 'Present' : year(r.endDate)}`}
        />
      ))}
    </Group>
  );
}

function Projects() {
  const projects = useProjects();
  if (!projects.data?.length) return null;
  return (
    <Group label="Projects">
      {projects.data.map((p) => (
        <Row key={p.id} icon={<FolderKanban className="size-[18px]" />} title={p.name} sub={p.description ?? undefined} />
      ))}
    </Group>
  );
}

function EducationList() {
  const education = useEducation();
  const [editing, setEditing] = useState<Education | 'new' | null>(null);
  return (
    <Group label="Education">
      {education.isPending && <Skeleton className="m-3 h-12" />}
      {(education.data ?? []).map((e) => (
        <Row
          key={e.id}
          icon={<GraduationCap className="size-[18px]" />}
          title={e.degree}
          sub={[e.institution, e.startYear || e.endYear ? `${e.startYear ?? '?'} – ${e.endYear ?? 'present'}` : null].filter(Boolean).join(' · ')}
          onClick={() => setEditing(e)}
        />
      ))}
      <button type="button" onClick={() => setEditing('new')} className="flex min-h-12 w-full items-center gap-2 px-4 text-[15px] font-semibold text-accent-fg">
        <Plus className="size-4" /> Add education
      </button>
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add education' : 'Edit education'}>
        {editing && <EducationForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </Group>
  );
}

// The monthly AI cap (a stepper; the middle is editable) and the resume-reuse threshold
// (Agents.md §12.3, §13.2). Both save straight away; the server confirms.
function Budget() {
  const usage = useAiUsage();
  const update = useUpdateAiSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<number | null>(null);
  if (!usage.data) return null;
  const u = usage.data;
  const cap = u.settings.monthlyBudgetUsd;
  const saveCap = (value: number) => {
    if (Number.isFinite(value) && value >= 0 && value <= 1000 && value !== cap) update.mutate({ monthlyBudgetUsd: value });
    setDraft(null);
  };
  const pct = Math.round((overlap ?? u.settings.resumeReuseMinOverlap) * 100);
  return (
    <Group label="Budget">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-fg">Monthly AI cap</p>
          <p className="text-[13px] text-muted tabular-nums">${u.monthToDateUsd.toFixed(2)} used this month</p>
        </div>
        <div className="flex h-11 items-center overflow-hidden rounded-xl border border-border">
          <button type="button" aria-label="Lower the cap by $1" onClick={() => saveCap(Math.max(0, cap - 1))} className="grid h-full w-11 place-items-center text-fg">
            <Minus className="size-4" />
          </button>
          <label className="sr-only" htmlFor="budget">
            Monthly budget in dollars
          </label>
          <input
            id="budget"
            inputMode="decimal"
            value={draft ?? `$${cap}`}
            onFocus={() => setDraft(String(cap))}
            onChange={(e) => setDraft(e.target.value)}
            // Number('') is 0 — an emptied field must not silently set a $0 budget.
            onBlur={() => saveCap(draft === null || draft.trim() === '' ? Number.NaN : Number(draft.replace('$', '')))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-full w-16 border-x border-border bg-transparent text-center text-[15px] font-semibold text-fg tabular-nums focus:outline-none"
          />
          <button type="button" aria-label="Raise the cap by $1" onClick={() => saveCap(cap + 1)} className="grid h-full w-11 place-items-center text-fg">
            <Plus className="size-4" />
          </button>
        </div>
      </div>
      <div className="space-y-2 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <label htmlFor="reuse" className="text-[15px] font-semibold text-fg">
            Resume reuse threshold
          </label>
          <span className="text-[15px] font-semibold text-accent-fg tabular-nums">{pct}%</span>
        </div>
        <input
          id="reuse"
          type="range"
          min={50}
          max={100}
          step={5}
          value={pct}
          onChange={(e) => setOverlap(Number(e.target.value) / 100)}
          onPointerUp={() => overlap !== null && update.mutate({ resumeReuseMinOverlap: overlap })}
          onKeyUp={() => overlap !== null && update.mutate({ resumeReuseMinOverlap: overlap })}
          className="w-full accent-[var(--accent)]"
        />
        <p className="text-xs text-muted">
          Offer an approved resume instead of tailoring when it matches a job at least this well. Lower saves money; higher fits better.
        </p>
      </div>
      {update.isError && <p className="px-4 pb-3 text-xs text-danger-fg">{update.error.message}</p>}
    </Group>
  );
}

function Account() {
  const { logout } = useAuth();
  const gmail = useGmail();
  const c = gmail.data?.connection;
  return (
    <Group label="Account">
      <Link to="/sources" className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-muted">
          <Mail className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-fg">Gmail</span>
          <span className="block truncate text-[13px] text-muted">{c ? `Connected · label “${c.labelName}”` : 'Not connected'}</span>
        </span>
        <ChevronRight className="size-4 text-muted" />
      </Link>
      <button type="button" onClick={() => void logout()} className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] font-semibold text-danger-fg">
        <span className="grid size-9 place-items-center rounded-[10px] bg-danger-bg">
          <LogOut className="size-[18px]" />
        </span>
        Sign out
      </button>
    </Group>
  );
}

const FIELDS = [
  { key: 'name', label: 'Full name', autoComplete: 'name' },
  { key: 'headline', label: 'Headline', autoComplete: 'off', placeholder: 'e.g. Software Engineer — React & TypeScript' },
  { key: 'location', label: 'Location', autoComplete: 'address-level2', placeholder: 'Lahore, Pakistan' },
  { key: 'phone', label: 'Phone', autoComplete: 'tel', placeholder: '+92 300 0000000' },
  { key: 'linkedinUrl', label: 'LinkedIn URL', autoComplete: 'url', placeholder: 'https://linkedin.com/in/…' },
  { key: 'githubUrl', label: 'GitHub URL', autoComplete: 'url', placeholder: 'https://github.com/…' },
] as const;
type Key = (typeof FIELDS)[number]['key'];

// The resume header: name, headline and the contact line.
function ContactForm({ profile: p, onDone }: { profile: PublicUser; onDone: () => void }) {
  const update = useUpdateProfile();
  const toast = useToast();
  const [values, setValues] = useState<Record<Key, string>>({
    name: p.name,
    headline: p.headline ?? '',
    location: p.location ?? '',
    phone: p.phone ?? '',
    linkedinUrl: p.linkedinUrl ?? '',
    githubUrl: p.githubUrl ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save(e: FormEvent) {
    e.preventDefault();
    // Empty optional fields are cleared (null); the name is required.
    const body = Object.fromEntries(FIELDS.map(({ key }) => [key, values[key].trim() === '' && key !== 'name' ? null : values[key]]));
    const parsed = UpdateProfileSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(parsed.data);
      toast({ text: 'Profile saved' });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-3">
      <p className="text-[17px] font-semibold text-fg">Edit profile</p>
      <p className="text-[13px] text-muted">Your resume's header. Claims about your work live in Evidence.</p>
      {FIELDS.map((f) => (
        <TextField
          key={f.key}
          id={`profile-${f.key}`}
          label={f.label}
          autoComplete={f.autoComplete}
          placeholder={'placeholder' in f ? f.placeholder : undefined}
          value={values[f.key]}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          error={errors[f.key]}
        />
      ))}
      <Button type="submit" size="lg" className="w-full" disabled={update.isPending}>
        {update.isPending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}

function EducationForm({ initial, onDone }: { initial?: Education; onDone: () => void }) {
  const save = useSaveEducation();
  const remove = useDeleteEducation();
  const [v, setV] = useState({
    degree: initial?.degree ?? '',
    institution: initial?.institution ?? '',
    location: initial?.location ?? '',
    startYear: initial?.startYear?.toString() ?? '',
    endYear: initial?.endYear?.toString() ?? '',
  });
  const [error, setError] = useState<string>();
  const yearOf = (s: string) => (s.trim() === '' ? null : Number(s));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      await save.mutateAsync({
        id: initial?.id,
        body: { degree: v.degree, institution: v.institution, location: v.location.trim() || null, startYear: yearOf(v.startYear), endYear: yearOf(v.endYear) },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : 'Could not save');
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <p className="text-[17px] font-semibold text-fg">{initial ? 'Edit education' : 'Add education'}</p>
      <TextField id="edu-degree" label="Degree" value={v.degree} onChange={(e) => setV({ ...v, degree: e.target.value })} />
      <TextField id="edu-institution" label="Institution" value={v.institution} onChange={(e) => setV({ ...v, institution: e.target.value })} />
      <TextField id="edu-location" label="Location (optional)" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <TextField id="edu-start" label="Start year" inputMode="numeric" value={v.startYear} onChange={(e) => setV({ ...v, startYear: e.target.value })} />
        <TextField id="edu-end" label="End year" inputMode="numeric" placeholder="present" value={v.endYear} onChange={(e) => setV({ ...v, endYear: e.target.value })} />
      </div>
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
        Save
      </Button>
      {initial && (
        <Button
          variant="danger"
          className="w-full"
          disabled={remove.isPending}
          onClick={() => remove.mutate(initial.id, { onSuccess: onDone })}
        >
          <Trash2 className="size-4" /> Delete
        </Button>
      )}
    </form>
  );
}
