import { AddJobSchema } from '@shortlist/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../../components/Toast';
import { Button, INPUT, Sheet, TextField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { pushNavigate } from '../../lib/navigation';
import { useAddJob } from '../../lib/queries';

// "Add a job" (docs/discovery.md §11): a posting Shortlist didn't find — a LinkedIn alert, a
// WhatsApp group, a referral. Title, company and the pasted description become a regular
// job, scored at once; its page then offers "Tailor a resume" like any other.
export function AddJobButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="tinted" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add job
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add a job">
        {open && <AddJobForm onDone={() => setOpen(false)} />}
      </Sheet>
    </>
  );
}

type Field = 'title' | 'company' | 'location' | 'sourceUrl' | 'description';

function AddJobForm({ onDone }: { onDone: () => void }) {
  const add = useAddJob();
  const toast = useToast();
  const navigate = useNavigate();
  const [v, setV] = useState<Record<Field, string>>({
    title: '',
    company: '',
    location: '',
    sourceUrl: '',
    description: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const set = (k: Field) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const open = (id: string) => {
    onDone();
    pushNavigate(navigate, `/jobs/${id}`, 'forward');
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = AddJobSchema.safeParse({
      ...v,
      location: v.location.trim() || null,
      sourceUrl: v.sourceUrl.trim() || null,
    });
    if (!parsed.success) {
      const by: Partial<Record<Field, string>> = {};
      for (const i of parsed.error.issues) by[i.path[0] as Field] ??= i.message;
      return setErrors(by);
    }
    setErrors({});
    add.mutate(parsed.data, {
      onSuccess: ({ id, merged }) => {
        toast({ text: merged ? 'Added the description to the job from your alert' : 'Job added — scoring it now' });
        open(id);
      },
      onError: (err) => {
        // Already in Shortlist: open that one instead of a second copy.
        const jobId = err instanceof ApiError ? (err.body as { jobId?: string } | null)?.jobId : undefined;
        if (jobId) {
          toast({ text: 'Already in Shortlist — opened it' });
          open(jobId);
        }
      },
    });
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-3">
      <p className="text-footnote text-muted">
        For a job Shortlist didn't find. It's scored against your verified skills, then you can tailor a resume.
      </p>
      <TextField id="add-title" label="Job title" value={v.title} onChange={set('title')} error={errors.title} />
      <TextField id="add-company" label="Company" value={v.company} onChange={set('company')} error={errors.company} />
      <TextField
        id="add-location"
        label="Location (optional)"
        value={v.location}
        onChange={set('location')}
        error={errors.location}
      />
      <TextField
        id="add-link"
        label="Posting link (optional)"
        inputMode="url"
        placeholder="https://…"
        value={v.sourceUrl}
        onChange={set('sourceUrl')}
        error={errors.sourceUrl}
      />
      <div className="space-y-1.5">
        <label htmlFor="add-description" className="block text-footnote font-medium text-muted">
          Full job description
        </label>
        <textarea
          id="add-description"
          rows={8}
          value={v.description}
          onChange={set('description')}
          placeholder="Open the posting, select the whole description, copy, and paste it here."
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? 'add-description-error' : undefined}
          className={`${INPUT} py-3 leading-snug`}
        />
        {errors.description && (
          <p id="add-description-error" className="text-footnote text-danger-fg">
            {errors.description}
          </p>
        )}
      </div>
      {add.isError && !(add.error instanceof ApiError && add.error.status === 409) && (
        <p className="text-footnote text-danger-fg">{add.error.message}</p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={add.isPending}>
        {add.isPending ? 'Adding…' : 'Add and score'}
      </Button>
    </form>
  );
}
