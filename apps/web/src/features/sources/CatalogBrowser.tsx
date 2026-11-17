import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { Button, Chip, EmptyState, INPUT, Skeleton } from '../../components/ui';
import { providerLabel } from '../../lib/format';
import { useCatalog, useFollowCatalogEntry } from '../../lib/queries';
import type { CatalogEntry } from '../../lib/types';

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Places shown as filter chips: the most common ones first, so the list stays short.
function topPlaces(entries: CatalogEntry[], max = 8): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const r of e.regions) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([r]) => r);
}

// The shared catalog (docs/discovery.md §9.16): companies and job boards an admin keeps up to date.
// Search by name, narrow to one place, and follow. Fetched once and filtered here — the catalog
// is a few hundred rows at most.
export function CatalogBrowser() {
  const catalog = useCatalog({});
  const follow = useFollowCatalogEntry();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [place, setPlace] = useState<string | null>(null);
  const places = useMemo(() => topPlaces(catalog.data ?? []), [catalog.data]);
  const shown = (catalog.data ?? []).filter(
    (e) => (!place || e.regions.includes(place)) && e.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  if (catalog.isPending) return <Skeleton className="h-64 w-full" />;
  if (catalog.isError) return <p className="text-danger-fg">Couldn't load the list: {catalog.error.message}</p>;
  if (catalog.data.length === 0)
    return <EmptyState icon={<Search className="size-6" />} title="Nothing to browse yet" />;

  return (
    <div className="space-y-3">
      <label htmlFor="catalog-search" className="sr-only">
        Search companies and job boards
      </label>
      <input
        id="catalog-search"
        type="search"
        placeholder="Search companies and job boards"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className={`${INPUT} h-11`}
      />
      {places.length > 1 && (
        <fieldset className="-mx-1 flex min-w-0 gap-2 overflow-x-auto border-0 px-1 pb-1">
          <legend className="sr-only">Filter by place</legend>
          {places.map((p) => (
            <Chip key={p} pressed={place === p} onClick={() => setPlace(place === p ? null : p)}>
              {title(p)}
            </Chip>
          ))}
        </fieldset>
      )}
      {shown.length === 0 ? (
        <p className="py-6 text-center text-footnote text-muted">No matches. Try another name or place.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {shown.map((e) => (
            <li key={e.id} className="flex min-h-[60px] items-center gap-3 py-2 pr-3 pl-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-semibold text-fg">{e.name}</p>
                <p className="truncate text-caption text-muted">
                  {[providerLabel(e.provider), ...e.regions.map(title)].join(' · ')}
                </p>
              </div>
              {e.following ? (
                <span className="inline-flex items-center gap-1 text-footnote font-medium text-muted">
                  <Check className="size-4" aria-hidden="true" /> Following
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="tinted"
                  aria-label={`Follow ${e.name}`}
                  disabled={follow.isPending && follow.variables === e.id}
                  onClick={() =>
                    follow.mutate(e.id, {
                      onSuccess: (r) => toast({ text: `Following ${r.name} — checking it now` }),
                      onError: (err) => toast({ text: err.message, tone: 'error' }),
                    })
                  }
                >
                  Follow
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
