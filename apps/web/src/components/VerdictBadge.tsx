import type { Verdict } from '../lib/types';
import { Badge, type Tone } from './ui';

const TONE: Record<Verdict, Tone> = { APPLY: 'apply', STRETCH: 'stretch', SKIP: 'skip' };

// The verdict as the design's uppercase tag (APPLY / STRETCH / SKIP), same on list and detail.
export function VerdictBadge({ verdict, score }: { verdict: Verdict; score?: number }) {
  return (
    <Badge tone={TONE[verdict]} className="font-semibold tracking-[0.04em]">
      {score !== undefined && <span className="tabular-nums">{score} · </span>}
      {verdict}
    </Badge>
  );
}
