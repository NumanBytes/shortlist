import { ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { SectionLabel } from '../../components/ui';

// A grouped list in a card (design board 6): icon tile, title, subtitle, optional chevron.
export function Row({
  icon,
  title,
  sub,
  onClick,
  trailing,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold text-fg">{title}</span>
        {/* Two lines before an ellipsis: a status sentence must stay readable (UI audit P2). */}
        {sub && <span className="line-clamp-2 block text-footnote text-muted">{sub}</span>}
      </span>
      {trailing}
      {onClick && <ChevronRight className="size-4 shrink-0 text-muted" />}
    </>
  );
  const cls = 'flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:bg-surface-2`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2 pt-2" aria-label={label}>
      <SectionLabel>{label}</SectionLabel>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

export function AddRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-2 px-4 text-body font-semibold text-accent-fg"
    >
      <Plus className="size-4" /> {children}
    </button>
  );
}
