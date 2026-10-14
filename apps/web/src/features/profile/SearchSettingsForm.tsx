import {
  DiscoveryPreferencesSchema,
  STARTER_DISCOVERY_PREFERENCES,
  type DiscoveryPreferencesInput,
} from '@shortlist/shared';
import { useState, type FormEvent } from 'react';
import { Button, INPUT, Switch, TextField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useSavePreferences } from '../../lib/queries';

const LABEL = 'block text-footnote font-medium text-fg';
const list = (s: string) =>
  s
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
const text = (terms: string[]) => terms.join(', ');

// What the user is looking for — the rule filter's settings (docs/discovery.md §9.6, §9.13).
// Used by onboarding and by Profile → "What I'm looking for". Terms are comma-separated and
// matched as whole words in a job's title (or description, for the stack).
export function SearchSettingsForm({
  initial,
  onDone,
  submitLabel = 'Save',
}: {
  initial: DiscoveryPreferencesInput;
  onDone: () => void;
  submitLabel?: string;
}) {
  const save = useSavePreferences();
  const [v, setV] = useState({
    titleInclude: text(initial.titleInclude),
    stackKeywords: text(initial.stackKeywords),
    onsiteLocations: text(initial.onsiteLocations),
    allowRemote: initial.allowRemote,
    remoteAllowRegions: text(initial.remoteAllowRegions),
    titleExclude: text(initial.titleExclude),
    maxPostingAgeDays: String(initial.maxPostingAgeDays),
  });
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const titles = list(v.titleInclude);
    const body = DiscoveryPreferencesSchema.safeParse({
      titleInclude: titles,
      titleExclude: list(v.titleExclude),
      stackKeywords: list(v.stackKeywords),
      // Alert emails carry no description; a title naming one of these roles still passes.
      // Rebuilt from the current titles each save, so a removed title stops letting jobs in.
      roleTitleTerms: [...new Set([...STARTER_DISCOVERY_PREFERENCES.roleTitleTerms, ...titles])],
      onsiteLocations: list(v.onsiteLocations),
      allowRemote: v.allowRemote,
      remoteAllowRegions: list(v.remoteAllowRegions),
      maxPostingAgeDays: Number(v.maxPostingAgeDays),
    });
    if (!body.success) return setError(body.error.issues[0]?.message);
    if (titles.length === 0) return setError('Add at least one word a job title should contain');
    try {
      await save.mutateAsync(body.data);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    }
  }

  const area = (id: keyof typeof v, label: string, hint: string, placeholder?: string) => (
    <div className="space-y-1.5">
      <label htmlFor={`search-${id}`} className={LABEL}>
        {label}
      </label>
      <textarea
        id={`search-${id}`}
        rows={2}
        placeholder={placeholder}
        value={v[id] as string}
        onChange={(e) => setV({ ...v, [id]: e.target.value })}
        className={`${INPUT} py-3 leading-snug`}
      />
      <p className="text-footnote text-muted">{hint}</p>
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="What I'm looking for">
      {area(
        'titleInclude',
        'Job titles',
        'A job title must contain one of these words. Separate with commas.',
        'frontend, react, full stack, software engineer',
      )}
      {area(
        'stackKeywords',
        'Your stack',
        'The posting must mention one of these.',
        'react, typescript, node.js, postgresql',
      )}
      {area(
        'onsiteLocations',
        'On-site or hybrid in',
        'Cities or countries you can commute to. Empty: remote only.',
        'lahore, pakistan',
      )}
      <div className="flex items-center justify-between rounded-md border border-border px-3.5 py-2.5">
        <span className="text-body text-fg">Open to remote work</span>
        <Switch
          checked={v.allowRemote}
          onChange={(allowRemote) => setV({ ...v, allowRemote })}
          label="Open to remote work"
        />
      </div>
      {v.allowRemote &&
        area(
          'remoteAllowRegions',
          'Remote roles open to',
          'A remote job limited to a region passes only if it is one of these (or worldwide).',
        )}
      {area('titleExclude', 'Skip titles with', 'Seniority or roles you never want to see.')}
      <TextField
        id="search-age"
        label="Ignore remote-board postings older than (days)"
        inputMode="numeric"
        value={v.maxPostingAgeDays}
        onChange={(e) => setV({ ...v, maxPostingAgeDays: e.target.value })}
      />
      {error && <p className="text-footnote text-danger-fg">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}
