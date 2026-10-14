import { UpdateProfileSchema } from '@shortlist/shared';
import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toast';
import { Button, TextField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useUpdateProfile } from '../../lib/queries';
import type { PublicUser } from '../../lib/types';

const FIELDS = [
  { key: 'name', label: 'Full name', autoComplete: 'name' },
  {
    key: 'headline',
    label: 'Headline',
    autoComplete: 'off',
    placeholder: 'e.g. Software Engineer — React & TypeScript',
  },
  { key: 'location', label: 'Location', autoComplete: 'address-level2', placeholder: 'Lahore, Pakistan' },
  { key: 'phone', label: 'Phone', autoComplete: 'tel', placeholder: '+92 300 0000000' },
  { key: 'linkedinUrl', label: 'LinkedIn URL', autoComplete: 'url', placeholder: 'https://linkedin.com/in/…' },
  { key: 'githubUrl', label: 'GitHub URL', autoComplete: 'url', placeholder: 'https://github.com/…' },
] as const;
type Key = (typeof FIELDS)[number]['key'];
// The resume header: name, headline and the contact line.
export function ContactForm({ profile: p, onDone }: { profile: PublicUser; onDone: () => void }) {
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
    const body = Object.fromEntries(
      FIELDS.map(({ key }) => [key, values[key].trim() === '' && key !== 'name' ? null : values[key]]),
    );
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
      <p className="text-footnote text-muted">Your resume's header. Claims about your work live in Evidence.</p>
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
