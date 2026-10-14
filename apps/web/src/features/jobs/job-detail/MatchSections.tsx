import { AlertTriangle, CircleAlert, CircleCheck, CornerDownRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, type Tone } from '../../../components/ui';
import type { GapSeverity, JobDetail } from '../../../lib/types';

type Gap = NonNullable<JobDetail['match']>['gaps'][number];

// The analysis, explained (design board 2): what matched, what's missing, what else to
// weigh. Each is a card that only appears when it has something to say.

const SEVERITY_TONE: Record<GapSeverity, Tone> = { BLOCKING: 'danger', MODERATE: 'neutral', MINOR: 'neutral' };
const SEVERITY_LABEL: Record<GapSeverity, string> = { BLOCKING: 'Blocking', MODERATE: 'Moderate', MINOR: 'Minor' };

// "React.js — React (commercial production, CloudCard Inc.)" → parts for display.
function parseStrength(s: string) {
  const [requirement = s, rest = ''] = s.split(' — ');
  const m = /^(.*) \((.*)\)$/.exec(rest);
  return { requirement, skill: m?.[1] ?? rest, evidence: m?.[2] ?? '' };
}

// A card with a header row: icon, title, and a count on the right ("4 matched").
function Section({
  id,
  icon,
  title,
  meta,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
        <span className="text-muted" aria-hidden="true">
          {icon}
        </span>
        <h2 id={id} className="flex-1 text-body font-semibold text-fg">
          {title}
        </h2>
        {meta && <span className="text-caption text-muted">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

export function Strengths({ strengths }: { strengths: string[] }) {
  if (strengths.length === 0) return null;
  return (
    <Section
      id="fits"
      icon={<CircleCheck className="size-5 text-accent" strokeWidth={1.75} />}
      title="Why it fits"
      meta={`${strengths.length} matched`}
    >
      <ul className="divide-y divide-border border-t border-border">
        {strengths.map((s) => {
          const p = parseStrength(s);
          return (
            <li key={s} className="px-4 py-3 text-body">
              <p className="text-fg">{p.requirement}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption text-muted">
                <CornerDownRight className="size-4 shrink-0" aria-hidden="true" />
                <Badge tone="accent">{p.skill}</Badge>
                {p.evidence && <span>{p.evidence}</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function Gaps({ gaps }: { gaps: Gap[] }) {
  if (gaps.length === 0) return null;
  return (
    <Section
      id="gaps"
      icon={<AlertTriangle className="size-5 text-stretch" strokeWidth={1.75} />}
      title="Gaps"
      meta={`${gaps.length} missing`}
    >
      <ul className="divide-y divide-border border-t border-border">
        {gaps.map((g) => (
          <li key={g.skillName} className="px-4 py-3 text-body">
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-fg">{g.skillName}</span>
              <Badge tone={SEVERITY_TONE[g.severity]}>{SEVERITY_LABEL[g.severity]}</Badge>
            </div>
            {g.note && <p className="mt-0.5 text-footnote text-muted">{g.note}</p>}
          </li>
        ))}
      </ul>
      <Link to="/evidence" className="block border-t border-border px-4 py-3.5 text-body font-semibold text-accent-fg">
        Have experience here? Add evidence
      </Link>
    </Section>
  );
}

// Risks besides missing skills and red flags, which have their own cards.
export function Risks({ risks }: { risks: string[] }) {
  const other = risks.filter((r) => !r.startsWith('Missing') && !r.startsWith('Red flag'));
  if (other.length === 0) return null;
  return (
    <Section id="risks" icon={<CircleAlert className="size-5 text-danger" strokeWidth={1.75} />} title="Risks">
      <ul className="divide-y divide-border border-t border-border">
        {other.map((r) => (
          <li key={r} className="flex items-start gap-2.5 px-4 py-3 text-body text-fg">
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-stretch" />
            {r}
          </li>
        ))}
      </ul>
    </Section>
  );
}
