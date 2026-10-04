import { UpdateSkillEvidenceSchema } from '@shortlist/shared';
import { Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useUnverifyEvidence, useUpdateEvidence, useVerifyEvidence } from '../lib/queries';
import type { Evidence } from '../lib/types';

// Plain-language meaning of each level — these decide where a claim may appear (Agents.md §6.1).
export const CONTEXTS = [
  { value: 'COMMERCIAL', label: 'Paid work' },
  { value: 'PERSONAL', label: 'Personal / self-taught' },
  { value: 'ACADEMIC', label: 'University' },
] as const;
export const DEPTHS = [
  { value: 'PRODUCTION', label: 'Production — built things that shipped' },
  { value: 'WORKING', label: "Working — can build with it, hasn't shipped" },
  { value: 'MAINTENANCE', label: 'Maintenance — upgraded or fixed, didn\'t build' },
  { value: 'EXPOSURE', label: 'Exposure — learning, tutorials, coursework' },
] as const;
import { Badge, Button } from './ui';

const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const lower = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function EvidenceItem({ evidence, source }: { evidence: Evidence; source?: string }) {
  const verify = useVerifyEvidence();
  const unverify = useUnverifyEvidence();
  const update = useUpdateEvidence();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(evidence.whatIDid);
  const [context, setContext] = useState(evidence.context);
  const [depth, setDepth] = useState(evidence.depth);
  const [error, setError] = useState<string>();

  const busy = verify.isPending || unverify.isPending || update.isPending;
  const failed = verify.error ?? unverify.error;

  async function save() {
    // Same schema the API validates against — shared from @shortlist/shared.
    // Send only what changed — every change is a claim change and un-verifies the item.
    const changes = {
      ...(draft.trim() !== evidence.whatIDid ? { whatIDid: draft } : {}),
      ...(context !== evidence.context ? { context } : {}),
      ...(depth !== evidence.depth ? { depth } : {}),
    };
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    const parsed = UpdateSkillEvidenceSchema.safeParse(changes);
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
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-medium text-muted">
              Where
              <select
                value={context}
                onChange={(e) => setContext(e.target.value as Evidence['context'])}
                className="block h-10 w-full rounded-lg border border-border bg-surface px-2 text-sm font-normal text-fg"
              >
                {CONTEXTS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted">
              How deeply
              <select
                value={depth}
                onChange={(e) => setDepth(e.target.value as Evidence['depth'])}
                className="block h-10 w-full rounded-lg border border-border bg-surface px-2 text-sm font-normal text-fg"
              >
                {DEPTHS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {evidence.isVerified && (
            <p className="text-xs text-stretch-fg">Saving changes un-verifies this item — you'll confirm it again.</p>
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
                setContext(evidence.context);
                setDepth(evidence.depth);
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
              <Pencil className="size-3.5" /> Edit
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
