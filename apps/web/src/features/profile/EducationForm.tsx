import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, TextField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useDeleteEducation, useSaveEducation } from '../../lib/queries';
import type { Education } from '../../lib/types';

export function EducationForm({ initial, onDone }: { initial?: Education; onDone: () => void }) {
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
