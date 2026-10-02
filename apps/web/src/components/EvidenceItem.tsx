import { UpdateSkillEvidenceSchema } from '@shortlist/shared';
import { Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useUnverifyEvidence, useUpdateEvidence, useVerifyEvidence } from '../lib/queries';
import type { Evidence } from '../lib/types';
import { Badge, Button } from './ui';

const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const lower = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function EvidenceItem({ evidence, source }: { evidence: Evidence; source?: string }) {
  const verify = useVerifyEvidence();
  const unverify = useUnverifyEvidence();
  const update = useUpdateEvidence();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(evidence.whatIDid);
  const [error, setError] = useState<string>();

  const busy = verify.isPending || unverify.isPending || update.isPending;
  const failed = verify.error ?? unverify.error;

  async function save() {
    // Same schema the API validates against — shared from @shortlist/shared.
    const parsed = UpdateSkillEvidenceSchema.safeParse({ whatIDid: draft });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    try {
      await update.mutateAsync({ id: evidence.id, body: parsed.data });
      setEditing(false);
      setError(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    }
  }

  return (
    <li className={`rounded-xl border p-3 ${evidence.isVerified ? 'border-border bg-surface' : 'border-stretch/40 bg-surface'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {evidence.isVerified ? (
          <Badge tone="apply">
            <Check className="size-3" /> Verified
          </Badge>
        ) : (
          <Badge tone="stretch">Not verified</Badge>
        )}
        <Badge>
          {lower(evidence.context)} · {lower(evidence.depth)}
        </Badge>
        {source && <span className="text-xs text-muted">{source}</span>}
        <span className="text-xs text-subtle">· last used {monthYear(evidence.lastUsed)}</span>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <label htmlFor={`what-${evidence.id}`} className="sr-only">
            What you did
          </label>
          <textarea
            id={`what-${evidence.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-fg focus:border-accent focus:outline-none"
          />
          {evidence.isVerified && (
            <p className="text-xs text-stretch-fg">Saving changes un-verifies this item — you'll confirm the new wording.</p>
          )}
          {error && <p className="text-sm text-danger-fg">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(evidence.whatIDid);
                setEditing(false);
                setError(undefined);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-fg">{evidence.whatIDid}</p>
          {failed && <p className="mt-1 text-sm text-danger-fg">{failed.message}</p>}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {evidence.isVerified ? (
              <Button size="sm" variant="secondary" onClick={() => unverify.mutate(evidence.id)} disabled={busy}>
                Unverify
              </Button>
            ) : (
              <Button size="sm" onClick={() => verify.mutate(evidence.id)} disabled={busy}>
                <Check className="size-4" /> This is true — verify
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
              <Pencil className="size-3.5" /> Reword
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
