import { Check } from 'lucide-react';
import { useUnverifyEvidence, useVerifyEvidence } from '../../lib/queries';
import type { Evidence } from '../../lib/types';
import { Badge, Button } from '../../components/ui';

export { CONTEXTS, DEPTHS } from './AddEvidence';

const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// One piece of evidence (design board 4): the user's own words, where and how deeply, and
// the verify action. Verification is never optimistic — "Verified" shows only after the
// server confirms (Agents.md §6.3). Editing happens in the evidence sheet.
export function EvidenceItem({
  evidence,
  source,
  onEdit,
}: {
  evidence: Evidence;
  source?: string;
  onEdit: () => void;
}) {
  const verify = useVerifyEvidence();
  const unverify = useUnverifyEvidence();
  const busy = verify.isPending || unverify.isPending;
  const failed = verify.error ?? unverify.error;

  return (
    <li className="flex flex-col gap-2.5 border-t border-border px-4 pt-3.5 pb-1.5">
      <p className="text-body text-fg">“{evidence.whatIDid}”</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge>{title(evidence.context)}</Badge>
        <Badge>{title(evidence.depth)}</Badge>
        <span className="text-caption text-muted tabular-nums">Last used {monthYear(evidence.lastUsed)}</span>
        {source && <span className="text-caption text-muted">· {source}</span>}
      </div>
      {failed && <p className="text-footnote text-danger-fg">{failed.message}</p>}
      <div className="flex items-center gap-1">
        {evidence.isVerified ? (
          <Badge tone="accent">
            <Check className="size-3" strokeWidth={2.5} /> Verified
          </Badge>
        ) : (
          <Badge tone="stretch">Unverified</Badge>
        )}
        <span className="flex-1" />
        <Button variant="ghost" className="text-fg" onClick={onEdit} disabled={busy}>
          Edit
        </Button>
        {evidence.isVerified ? (
          <Button variant="ghost" className="text-fg" onClick={() => unverify.mutate(evidence.id)} disabled={busy}>
            Unverify
          </Button>
        ) : (
          <Button variant="tinted" onClick={() => verify.mutate(evidence.id)} disabled={busy}>
            <Check className="size-4" /> Verify
          </Button>
        )}
      </div>
    </li>
  );
}
