import { UpdateSkillEvidenceSchema } from '@shortlist/shared';
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useUnverifyEvidence, useUpdateEvidence, useVerifyEvidence } from '../lib/queries';
import type { Evidence } from '../lib/types';
import { Badge, Button } from './ui';

const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

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
    <li className={`rounded-lg border p-3 ${evidence.isVerified ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {evidence.isVerified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Not verified</Badge>}
        <Badge>
          {evidence.context.toLowerCase()} · {evidence.depth.toLowerCase()}
        </Badge>
        {source && <Badge>{source}</Badge>}
        <span className="text-xs text-slate-500">last used {monthYear(evidence.lastUsed)}</span>
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
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-slate-900 focus:outline-none"
          />
          {evidence.isVerified && (
            <p className="text-xs text-amber-700">Saving changes un-verifies this item — you'll confirm the new wording.</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              Save
            </Button>
            <Button
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
          <p className="mt-2 text-sm leading-relaxed text-slate-800">{evidence.whatIDid}</p>
          {failed && <p className="mt-1 text-sm text-red-600">{failed.message}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {evidence.isVerified ? (
              <Button variant="secondary" onClick={() => unverify.mutate(evidence.id)} disabled={busy}>
                Unverify
              </Button>
            ) : (
              <Button onClick={() => verify.mutate(evidence.id)} disabled={busy}>
                This is true — verify
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
              Reword
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
