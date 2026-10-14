import { ImportResumeSchema } from '@shortlist/shared';
import { CheckCircle2, ChevronDown, FileUp, Loader2 } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { Button, INPUT, buttonStyles } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { pdfText } from '../../lib/pdf-text';
import { useLatestImport, useRetryImport, useStartImport } from '../../lib/queries';

// "Import from my resume" (docs/career-data.md §7.6). The PDF's text is read here, in the
// browser, and shown so the user can see (and fix) what will be sent. The worker turns it
// into roles, projects and evidence — every item unverified, each a quote from the resume.
export function ResumeImport() {
  const latest = useLatestImport();
  const start = useStartImport();
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const [started, setStarted] = useState(false);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(undefined);
    setReading(true);
    try {
      const t = await pdfText(file);
      if (t.length < 200)
        setError("This PDF has little or no selectable text (a scan?). Paste the resume's text below.");
      setText(t);
    } catch {
      setError("Couldn't read that PDF. Paste the resume's text below instead.");
    } finally {
      setReading(false);
    }
  }

  async function submit() {
    setError(undefined);
    const body = ImportResumeSchema.safeParse({ text });
    if (!body.success) return setError(body.error.issues[0]?.message);
    try {
      await start.mutateAsync(body.data);
      setStarted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the import');
    }
  }

  const run = latest.data;
  if (run?.status === 'PENDING') {
    return (
      <output className="flex items-center gap-3 rounded-[14px] bg-surface-2 p-4">
        <Loader2 className="size-5 shrink-0 animate-spin text-muted" aria-hidden="true" />
        <div>
          <p className="font-semibold text-fg">Reading your resume…</p>
          <p className="text-[13px] text-muted">Usually under a minute. You can leave this screen.</p>
        </div>
      </output>
    );
  }

  return (
    <div className="space-y-3">
      {run && (started || run.status !== 'DONE') && <LastImport run={run} />}

      <label className={`${buttonStyles('secondary')} w-full cursor-pointer`}>
        <FileUp className="size-4" />
        {reading ? 'Reading the PDF…' : 'Choose your resume (PDF)'}
        <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={pick} disabled={reading} />
      </label>
      <div className="space-y-1.5">
        <label htmlFor="import-text" className="block text-sm font-medium text-fg">
          Resume text
        </label>
        <textarea
          id="import-text"
          rows={8}
          value={text}
          placeholder="Choose a PDF, or paste your resume's text here."
          onChange={(e) => setText(e.target.value)}
          className={`${INPUT} py-3 leading-snug`}
        />
        <p className="text-[13px] text-muted">
          Only this text is sent. Everything found is added <strong>unverified</strong> — you confirm each item before
          it can appear on a resume.
        </p>
      </div>
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <Button className="w-full" size="lg" onClick={() => void submit()} disabled={start.isPending || !text.trim()}>
        Import
      </Button>
    </div>
  );
}

function LastImport({ run }: { run: NonNullable<ReturnType<typeof useLatestImport>['data']> }) {
  const [open, setOpen] = useState(false);
  const retry = useRetryImport();
  // Waiting on the budget (or credit): the text was kept, so it can run again as it was.
  if (run.status === 'DEFERRED') {
    return (
      <div className="space-y-2 rounded-[14px] bg-stretch-bg p-3.5 text-sm text-fg">
        <p>Your resume is waiting{run.error ? `: ${run.error}` : '.'}</p>
        <Button size="sm" variant="secondary" disabled={retry.isPending} onClick={() => retry.mutate(run.id)}>
          Try again
        </Button>
      </div>
    );
  }
  if (run.status !== 'DONE') {
    return (
      <p className="rounded-[14px] bg-stretch-bg p-3 text-sm text-fg">
        The last import didn't finish{run.error ? `: ${run.error}` : '.'}
      </p>
    );
  }
  const c = run.created;
  const dropped = run.dropped ?? [];
  return (
    <div className="space-y-2 rounded-[14px] bg-apply-bg p-3.5">
      <p className="flex items-center gap-2 font-semibold text-fg">
        <CheckCircle2 className="size-4 text-apply" aria-hidden="true" /> Imported — all unverified
      </p>
      {c && (
        <p className="text-[13px] text-fg">
          {c.roles} roles, {c.projects} projects, {c.skills} skills and {c.evidence} items added.
        </p>
      )}
      <Link to="/evidence" className={`${buttonStyles('primary', 'sm')} w-full`}>
        Review them in Evidence
      </Link>
      {dropped.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-1 text-[13px] font-medium text-muted"
          >
            {dropped.length} left out <ChevronDown className={`size-3.5 transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <ul className="mt-1 space-y-1 text-[13px] text-muted">
              {dropped.map((d, i) => (
                <li key={i}>
                  <span className="text-fg">{d.what}</span> — {d.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
