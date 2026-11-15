import { AddCatalogEntrySchema, UpdateCatalogEntrySchema, type UpdateCatalogEntryInput } from '@shortlist/shared';
import { Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toast';
import { Button, IconButton, Sheet, Skeleton, Switch, TextField } from '../../components/ui';
import { providerLabel } from '../../lib/format';
import { useAddCatalogEntry, useAdminCatalog, useRemoveCatalogEntry, useUpdateCatalogEntry } from '../../lib/queries';
import type { AdminCatalogEntry } from '../../lib/types';

// "lahore, Pakistan" → ['lahore', 'pakistan'] (the schema lowercases and drops duplicates).
const placesFrom = (text: string) =>
  text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

// The shared source catalog (docs/discovery.md §9.16): what every user can follow. Adding takes
// the same links as a user's "Add a source"; a fixed name or address reaches every follower
// still linked; hiding keeps followers' copies; removing leaves them as their own sources.
export function CatalogAdmin() {
  const catalog = useAdminCatalog(true);
  const [adding, setAdding] = useState(false);
  if (!catalog.data) return <Skeleton className="h-40 w-full" />;
  const listed = catalog.data.filter((e) => e.isListed).length;
  return (
    <div className="space-y-3">
      <p className="text-footnote text-muted tabular-nums">
        {catalog.data.length} sources · {listed} listed for users
      </p>
      <Button variant="secondary" className="w-full" onClick={() => setAdding(true)}>
        <Plus className="size-4" /> Add to the catalog
      </Button>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add to the catalog">
        {adding && <AddEntryForm onDone={() => setAdding(false)} />}
      </Sheet>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {catalog.data.map((e) => (
          <EntryRow key={e.id} entry={e} />
        ))}
      </ul>
    </div>
  );
}

function EntryRow({ entry: e }: { entry: AdminCatalogEntry }) {
  const [editing, setEditing] = useState(false);
  const details = [
    providerLabel(e.provider),
    e.regions.join(', ') || 'no places',
    `${e.followers} ${e.followers === 1 ? 'follower' : 'followers'}`,
    ...(e.isListed ? [] : ['hidden']),
  ];
  return (
    <li className="flex min-h-[60px] items-center gap-3 py-2 pr-3 pl-4">
      <div className="min-w-0 flex-1">
        <p className={`truncate text-body font-semibold ${e.isListed ? 'text-fg' : 'text-muted'}`}>{e.name}</p>
        <p className="truncate text-caption text-muted tabular-nums">{details.join(' · ')}</p>
      </div>
      <IconButton label={`Edit ${e.name}`} onClick={() => setEditing(true)}>
        <Pencil className="size-4" />
      </IconButton>
      <Sheet open={editing} onClose={() => setEditing(false)} title={`Edit ${e.name}`}>
        {editing && <EditEntryForm entry={e} onDone={() => setEditing(false)} />}
      </Sheet>
    </li>
  );
}

function AddEntryForm({ onDone }: { onDone: () => void }) {
  const add = useAddCatalogEntry();
  const toast = useToast();
  const [v, setV] = useState({ name: '', link: '', places: '' });
  const [error, setError] = useState<{ name?: string; link?: string; places?: string }>({});
  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    const parsed = AddCatalogEntrySchema.safeParse({ name: v.name, link: v.link, regions: placesFrom(v.places) });
    if (!parsed.success) {
      const by = (k: string) => parsed.error.issues.find((i) => i.path[0] === k)?.message;
      setError({ name: by('name'), link: by('link'), places: by('regions') && 'Up to 10 places, 40 characters each' });
      return;
    }
    setError({});
    add.mutate(parsed.data, {
      onSuccess: (entry) => {
        toast({ text: `Added ${entry.name} to the catalog` });
        onDone();
      },
    });
  };
  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3">
      <TextField
        id="catalog-name"
        label="Company or board"
        value={v.name}
        onChange={(e) => setV({ ...v, name: e.target.value })}
        error={error.name}
      />
      <TextField
        id="catalog-link"
        label="Jobs page link"
        inputMode="url"
        placeholder="https://company.com/careers"
        value={v.link}
        onChange={(e) => setV({ ...v, link: e.target.value })}
        error={error.link ?? add.error?.message}
      />
      <TextField
        id="catalog-places"
        label="Places it hires in"
        placeholder="lahore, pakistan"
        value={v.places}
        onChange={(e) => setV({ ...v, places: e.target.value })}
        error={error.places}
      />
      <Button type="submit" size="lg" className="w-full" disabled={add.isPending}>
        Add
      </Button>
    </form>
  );
}

function EditEntryForm({ entry: e, onDone }: { entry: AdminCatalogEntry; onDone: () => void }) {
  const update = useUpdateCatalogEntry();
  const remove = useRemoveCatalogEntry();
  const toast = useToast();
  const [v, setV] = useState({ name: e.name, address: '', places: e.regions.join(', '), isListed: e.isListed });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string>();
  // Only what changed is sent: a new name or address is copied to every linked follower.
  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    const regions = placesFrom(v.places);
    const changes: UpdateCatalogEntryInput = {
      ...(v.name.trim() !== e.name && { name: v.name }),
      ...(v.address.trim() && { address: v.address }),
      ...(regions.join(',') !== e.regions.join(',') && { regions }),
      ...(v.isListed !== e.isListed && { isListed: v.isListed }),
    };
    if (Object.keys(changes).length === 0) return onDone();
    const parsed = UpdateCatalogEntrySchema.safeParse(changes);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    update.mutate(
      { id: e.id, body: parsed.data },
      {
        onSuccess: () => {
          toast({ text: `Saved ${v.name.trim()}` });
          onDone();
        },
      },
    );
  };
  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3">
      <TextField
        id={`edit-name-${e.id}`}
        label="Company or board"
        value={v.name}
        onChange={(ev) => setV({ ...v, name: ev.target.value })}
      />
      {e.type !== 'AGGREGATOR_API' && (
        <TextField
          id={`edit-address-${e.id}`}
          label="New jobs page link"
          inputMode="url"
          placeholder={e.link ?? 'Leave empty to keep it'}
          value={v.address}
          onChange={(ev) => setV({ ...v, address: ev.target.value })}
        />
      )}
      <TextField
        id={`edit-places-${e.id}`}
        label="Places it hires in"
        value={v.places}
        onChange={(ev) => setV({ ...v, places: ev.target.value })}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-fg">Listed for users</span>
        <Switch
          checked={v.isListed}
          onChange={(isListed) => setV({ ...v, isListed })}
          label={`List ${e.name} for users`}
        />
      </div>
      <p className="text-caption text-muted">
        A new name or link is copied to its {e.followers} {e.followers === 1 ? 'follower' : 'followers'}. Hiding it
        keeps their copies running.
      </p>
      {(error ?? update.error?.message ?? remove.error?.message) && (
        <p className="text-footnote text-danger-fg">{error ?? update.error?.message ?? remove.error?.message}</p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={update.isPending}>
        Save
      </Button>
      <Button
        type="button"
        variant="danger"
        className="w-full"
        disabled={remove.isPending}
        onClick={() =>
          confirmRemove
            ? remove.mutate(e.id, {
                onSuccess: () => {
                  toast({ text: `Removed ${e.name} from the catalog` });
                  onDone();
                },
              })
            : setConfirmRemove(true)
        }
      >
        {confirmRemove ? `Remove — followers keep their own copy` : 'Remove from the catalog'}
      </Button>
    </form>
  );
}
