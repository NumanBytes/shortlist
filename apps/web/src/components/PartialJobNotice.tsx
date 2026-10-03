import { PasteDescriptionSchema } from '@shortlist/shared';
import { ClipboardPaste, Mail } from 'lucide-react';
import { useState } from 'react';
import { providerLabel } from '../lib/format';
import { usePasteDescription } from '../lib/queries';
import type { JobDetail } from '../lib/types';
import { Button, Card } from './ui';

// A job read from an alert email has only the alert's summary (Agents.md §10.5). Shortlist
// can't fetch the posting — the portals forbid scraping — so the user pastes it, once, and
// only for jobs worth it: the paste form appears once the job is marked Interested.
export function PartialJobNotice({ job }: { job: JobDetail }) {
  const portal = providerLabel(job.source);
  const canPaste = job.status !== 'DISCOVERED' && job.status !== 'SKIPPED';
  return (
    <Card className="p-4 text-sm">
      <div className="flex gap-3">
        <Mail className="mt-0.5 size-4.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">From your {portal} alert — only a summary so far</p>
          <p className="mt-1 text-muted">
            The score above comes from the alert's few lines, so treat it as rough.{' '}
            {canPaste
              ? 'Paste the full description from the posting to score it properly and tailor a resume.'
              : 'Mark it Interested to paste the full description.'}
          </p>
          {canPaste && <PasteForm job={job} />}
        </div>
      </div>
    </Card>
  );
}

function PasteForm({ job }: { job: JobDetail }) {
  const paste = usePasteDescription();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const submit = () => {
    const parsed = PasteDescriptionSchema.safeParse({ description: text });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    paste.mutate({ id: job.id, description: parsed.data.description });
  };
  return (
    <div className="mt-3 space-y-2">
      <label htmlFor="paste-jd" className="block text-xs font-medium text-fg">
        Full job description
      </label>
      <textarea
        id="paste-jd"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Open the posting${job.sourceUrl ? ' (Open posting, above)' : ''}, select the whole description, copy, and paste it here.`}
        aria-invalid={error ? true : undefined}
        className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none aria-invalid:border-danger"
      />
      {(error || paste.isError) && <p className="text-xs text-danger-fg">{error ?? paste.error?.message}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={submit} disabled={paste.isPending || text.trim().length === 0}>
          <ClipboardPaste className="size-4" /> {paste.isPending ? 'Saving…' : 'Save and score again'}
        </Button>
        <span className="text-xs text-subtle">Scoring again costs about $0.006</span>
      </div>
    </div>
  );
}
