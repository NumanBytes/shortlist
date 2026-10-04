import { ListChecks } from 'lucide-react';

// The Shortlist mark: a checklist on an accent tile (mobile design, 2026-10-04).
export function Logo({ withName = true, size = 'sm' }: { withName?: boolean; size?: 'sm' | 'lg' }) {
  const tile = size === 'lg' ? 'size-16 rounded-[18px] shadow-[0_10px_24px_-8px_rgb(5_150_105/0.5)]' : 'size-8 rounded-[9px]';
  return (
    <span className={`inline-flex items-center ${size === 'lg' ? 'flex-col gap-4' : 'gap-2'}`}>
      <span className={`grid place-items-center bg-accent text-on-accent ${tile}`} aria-hidden="true">
        <ListChecks className={size === 'lg' ? 'size-8' : 'size-[18px]'} strokeWidth={2.25} />
      </span>
      {withName && (
        <span className={`font-bold tracking-tight text-fg ${size === 'lg' ? 'text-[28px] leading-none' : 'text-base'}`}>Shortlist</span>
      )}
    </span>
  );
}
