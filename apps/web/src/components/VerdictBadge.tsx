import { VERDICT_LABEL } from '../lib/format';
import type { Verdict } from '../lib/types';
import { Badge, type Tone } from './ui';

const TONE: Record<Verdict, Tone> = { APPLY: 'apply', STRETCH: 'stretch', SKIP: 'skip' };

export function VerdictBadge({ verdict, score }: { verdict: Verdict; score?: number }) {
  return (
    <Badge tone={TONE[verdict]}>
      {score !== undefined && <span className="tabular-nums">{score} · </span>}
      {VERDICT_LABEL[verdict]}
    </Badge>
  );
}
