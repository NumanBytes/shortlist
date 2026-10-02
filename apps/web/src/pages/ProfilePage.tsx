import { UpdateProfileSchema } from '@shortlist/shared';
import { GraduationCap, Plus, Trash2, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Card, IconButton, Skeleton, TextField } from '../components/ui';
import { useToast } from '../components/Toast';
import { ApiError } from '../lib/api';
import { useDeleteEducation, useEducation, useProfile, useSaveEducation, useUpdateProfile } from '../lib/queries';
import type { Education, PublicUser } from '../lib/types';

// The resume header (contact line) and education. Personal details live only in the
// database — never in committed files.
export function ProfilePage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-fg">Profile</h1>
        <p className="text-sm text-muted">Your resume's header and education. Claims about your work live in Evidence.</p>
      </div>
      <ContactCard />
      <EducationCard />
    </main>
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

function ContactCard() {
  const profile = useProfile();
  if (!profile.data) return <Skeleton className="h-96 w-full" />;
  // Mounted once the profile has loaded, so the form starts from it directly.
  return <ContactForm profile={profile.data} />;
}

function ContactForm({ profile: p }: { profile: PublicUser }) {
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
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-fg">
        <UserRound className="size-4 text-accent" /> Contact details
      </h2>
      <form onSubmit={save} noValidate className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Card>
  );
}

function EducationCard() {
  const education = useEducation();
  const [adding, setAdding] = useState(false);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-fg">
          <GraduationCap className="size-4 text-accent" /> Education
        </h2>
        {!adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add
          </Button>
        )}
      </div>
      {education.isPending && <Skeleton className="h-16 w-full" />}
      <ul className="space-y-2">
        {(education.data ?? []).map((e) => (
          <EducationRow key={e.id} education={e} />
        ))}
      </ul>
      {education.isSuccess && education.data.length === 0 && !adding && <p className="text-sm text-muted">No education added yet.</p>}
      {adding && <EducationForm onDone={() => setAdding(false)} />}
    </Card>
  );
}

function EducationRow({ education: e }: { education: Education }) {
  const [editing, setEditing] = useState(false);
  const remove = useDeleteEducation();
  if (editing) return <EducationForm initial={e} onDone={() => setEditing(false)} />;
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
      <button type="button" onClick={() => setEditing(true)} className="min-w-0 text-left">
        <p className="text-sm font-medium text-fg">{e.degree}</p>
        <p className="text-xs text-muted">
          {e.institution}
          {e.location && ` · ${e.location}`}
          {(e.startYear || e.endYear) && ` · ${e.startYear ?? '?'} – ${e.endYear ?? 'present'}`}
        </p>
      </button>
      <IconButton label={`Delete ${e.degree}`} onClick={() => remove.mutate(e.id)} disabled={remove.isPending}>
        <Trash2 className="size-4" />
      </IconButton>
    </li>
  );
}

function EducationForm({ initial, onDone }: { initial?: Education; onDone: () => void }) {
  const save = useSaveEducation();
  const [v, setV] = useState({
    degree: initial?.degree ?? '',
    institution: initial?.institution ?? '',
    location: initial?.location ?? '',
    startYear: initial?.startYear?.toString() ?? '',
    endYear: initial?.endYear?.toString() ?? '',
  });
  const [error, setError] = useState<string>();
  const year = (s: string) => (s.trim() === '' ? null : Number(s));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      await save.mutateAsync({
        id: initial?.id,
        body: { degree: v.degree, institution: v.institution, location: v.location.trim() || null, startYear: year(v.startYear), endYear: year(v.endYear) },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : 'Could not save');
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-2 space-y-3 rounded-lg border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="edu-degree" label="Degree" value={v.degree} onChange={(e) => setV({ ...v, degree: e.target.value })} />
        <TextField id="edu-institution" label="Institution" value={v.institution} onChange={(e) => setV({ ...v, institution: e.target.value })} />
        <TextField id="edu-location" label="Location (optional)" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <TextField id="edu-start" label="Start year" inputMode="numeric" value={v.startYear} onChange={(e) => setV({ ...v, startYear: e.target.value })} />
          <TextField id="edu-end" label="End year" inputMode="numeric" placeholder="present" value={v.endYear} onChange={(e) => setV({ ...v, endYear: e.target.value })} />
        </div>
      </div>
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
