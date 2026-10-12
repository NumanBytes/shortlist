import { CreateNeverClaimSchema } from '@shortlist/shared';
import { Ban, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, IconButton, Sheet, Switch, TextField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useAddNeverClaim, useNeverClaims, useRemoveNeverClaim } from '../../lib/queries';
import { AddRow, Group, Row } from './ListGroup';

// Terms a tailored resume must never contain — the user's own known false claims
// (docs/resume.md §13.8). Tailoring refuses any bullet that mentions one.
export function NeverClaimList() {
  const list = useNeverClaims();
  const remove = useRemoveNeverClaim();
  const [adding, setAdding] = useState(false);
  return (
    <Group label="Never on my resume">
      {(list.data ?? []).map((c) => (
        <Row
          key={c.id}
          icon={<Ban className="size-[18px]" />}
          title={c.term}
          sub={[c.scope === 'PAID_WORK' ? 'Not in paid work' : 'Anywhere', c.note].filter(Boolean).join(' · ')}
          trailing={
            <IconButton label={`Remove ${c.term}`} onClick={() => remove.mutate(c.id)} disabled={remove.isPending}>
              <Trash2 className="size-4" />
            </IconButton>
          }
        />
      ))}
      <AddRow onClick={() => setAdding(true)}>Add a term</AddRow>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Never on my resume">
        {adding && <NeverClaimForm onDone={() => setAdding(false)} />}
      </Sheet>
    </Group>
  );
}

function NeverClaimForm({ onDone }: { onDone: () => void }) {
  const add = useAddNeverClaim();
  const [v, setV] = useState({ term: '', paidOnly: false, note: '' });
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const body = CreateNeverClaimSchema.safeParse({
      term: v.term,
      scope: v.paidOnly ? 'PAID_WORK' : 'ANYWHERE',
      note: v.note.trim() || null,
    });
    if (!body.success) return setError(body.error.issues[0]?.message);
    try {
      await add.mutateAsync(body.data);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Add a term">
      <p className="text-[17px] font-semibold text-fg">Never on my resume</p>
      <p className="text-[13px] text-muted">
        Something you haven't done that could slip into a tailored resume. Any bullet mentioning it is removed.
      </p>
      <TextField
        id="never-term"
        label="Term"
        placeholder="e.g. Azure"
        value={v.term}
        onChange={(e) => setV({ ...v, term: e.target.value })}
      />
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">
        <span>
          <span className="block text-[15px] text-fg">Only in paid work</span>
          <span className="block text-[13px] text-muted">Allowed in personal projects, never under a job.</span>
        </span>
        <Switch checked={v.paidOnly} onChange={(paidOnly) => setV({ ...v, paidOnly })} label="Only in paid work" />
      </div>
      <TextField
        id="never-note"
        label="Why (optional)"
        value={v.note}
        onChange={(e) => setV({ ...v, note: e.target.value })}
      />
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={add.isPending}>
        Add
      </Button>
    </form>
  );
}
