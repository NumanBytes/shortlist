import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

// Shared UI primitives, built only on the semantic tokens in index.css. Sizes follow the
// mobile design (2026-10-04): 44px touch targets, 12px radius buttons, 16px cards.

type Variant = 'primary' | 'secondary' | 'tinted' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-95',
  secondary: 'border border-border bg-surface text-fg hover:bg-surface-2',
  tinted: 'bg-accent-soft text-accent-fg hover:brightness-95',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger-bg text-danger-fg hover:brightness-95',
};
const SIZES: Record<Size, string> = {
  sm: 'min-h-9 gap-1.5 rounded-[10px] px-3 text-sm',
  md: 'min-h-11 gap-2 rounded-xl px-4 text-[15px]',
  lg: 'min-h-13 gap-2 rounded-[14px] px-5 text-base',
};
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

// The same look for a link that navigates (a real <a>, so it stays a link for screen
// readers and right-click) — e.g. "Review resume", "Open posting".
export const buttonStyles = (variant: Variant = 'primary', size: Size = 'md') =>
  `inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition ${FOCUS} ${VARIANTS[variant]} ${SIZES[size]}`;

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}

// Icon-only button. `label` is required: it's the accessible name and the tooltip.
export function IconButton({
  label,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-45 ${FOCUS} ${className.includes('size-') ? '' : 'size-11'} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export type Tone = 'neutral' | 'apply' | 'stretch' | 'skip' | 'danger' | 'accent';
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  apply: 'bg-apply-bg text-apply-fg',
  stretch: 'bg-stretch-bg text-stretch-fg',
  skip: 'bg-skip-bg text-skip-fg',
  danger: 'bg-danger-bg text-danger-fg',
  accent: 'bg-accent-soft text-accent-fg',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-xs leading-none font-medium whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-surface ${className}`}>{children}</div>;
}

// Small uppercase heading above a group ("NEEDS ATTENTION · 2", "EXPERIENCE").
export function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`px-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase ${className}`}>{children}</h2>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none ${className}`}
    />
  );
}

// An on/off switch with real switch semantics for screen readers.
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition disabled:opacity-45 ${FOCUS} ${checked ? 'bg-accent' : 'bg-border'}`}
    >
      <span
        className={`inline-block size-[27px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2)] transition ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

// A row of mutually exclusive options (aria-pressed), with optional counts. Equal-width
// segments, like an iOS segmented control.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  // Long labels ("Maintenance" in four columns) get slightly smaller text instead of an ellipsis.
  const compact = options.length >= 4 && options.some((o) => o.label.length >= 11);
  return (
    <fieldset
      className="mx-0 grid min-w-0 gap-0.5 rounded-xl border-0 bg-surface-2 p-[3px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`flex h-[38px] min-w-0 items-center justify-center gap-1 rounded-[9px] px-1 ${compact ? 'text-xs tracking-tight' : 'text-[13px]'} font-medium whitespace-nowrap transition ${FOCUS} ${
              active
                ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(15_23_42/0.08),0_0_0_1px_var(--border)]'
                : 'text-muted hover:text-fg'
            }`}
          >
            <span className="truncate">{o.label}</span>
            {o.count !== undefined && <span className="tabular-nums opacity-70">{o.count}</span>}
          </button>
        );
      })}
    </fieldset>
  );
}

// A filter chip (aria-pressed). `dot` shows a verdict colour before the label.
export function Chip({
  pressed,
  onClick,
  children,
  count,
  dot,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  dot?: 'apply' | 'stretch' | 'skip';
}) {
  const dots = { apply: 'bg-apply', stretch: 'bg-stretch', skip: 'bg-skip' };
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition ${FOCUS} ${
        pressed ? 'border-fg bg-fg text-bg' : 'border-border bg-surface text-fg hover:bg-surface-2'
      }`}
    >
      {dot && <span aria-hidden="true" className={`size-2 rounded-full ${dots[dot]}`} />}
      {children}
      {count !== undefined && <span className={`tabular-nums ${pressed ? 'opacity-70' : 'text-muted'}`}>{count}</span>}
    </button>
  );
}

export const INPUT =
  'block w-full rounded-xl border border-border bg-surface px-3.5 text-base text-fg placeholder:text-muted transition focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none aria-invalid:border-danger';

export function TextField({
  label,
  error,
  id,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${INPUT} h-12 ${className}`}
        {...props}
      />
      {error && (
        <p id={`${id}-error`} className="text-[13px] text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-surface-2 text-muted">{icon}</div>
      <p className="mt-4 text-base font-semibold text-fg">{title}</p>
      {children && <div className="mt-1.5 max-w-xs text-sm text-muted">{children}</div>}
    </div>
  );
}

// A bottom sheet on phones, a centred dialog on wider screens. Built on the native
// <dialog>: showModal() gives focus trapping, Escape to close, an inert background and
// focus returned to the trigger — the accessibility a hand-made overlay would have to
// re-implement. Motion (design spec): in 240 ms, out 180 ms ease-in, scrim fades; on
// phones it can be dragged down to dismiss (past 30% of its height, or a fast flick).
const CLOSE_MS = 180;

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rendered, setRendered] = useState(open); // keeps content while it slides out
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; t: number; lastY: number; lastT: number; id: number } | null>(null);
  const [flung, setFlung] = useState(false); // closing from a drag: finish from there
  if (open && !rendered) setRendered(true);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.classList.remove('sheet-closing');
      setDragY(0);
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', ''); // jsdom has no showModal
      return;
    }
    if (!open && d.open) {
      if (!flung) d.classList.add('sheet-closing');
      const t = setTimeout(() => {
        if (typeof d.close === 'function') d.close();
        else d.removeAttribute('open');
        d.classList.remove('sheet-closing');
        setFlung(false);
        setDragY(0);
        setRendered(false);
      }, CLOSE_MS);
      return () => clearTimeout(t);
    }
  }, [open, flung]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { y: e.clientY, t: e.timeStamp, lastY: e.clientY, lastT: e.timeStamp, id: e.pointerId };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    setDragY(Math.max(0, e.clientY - g.y)); // only downwards
    g.lastY = e.clientY;
    g.lastT = e.timeStamp;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = drag.current;
    drag.current = null;
    setDragging(false);
    if (!g) return;
    const height = ref.current?.offsetHeight || 1;
    const velocity =
      (e.clientY - g.lastY) / Math.max(1, e.timeStamp - g.lastT) || (e.clientY - g.y) / Math.max(1, e.timeStamp - g.t);
    // A flick counts only with some distance behind it, so a twitch never closes it.
    if (dragY > height * 0.3 || (velocity > 0.5 && dragY > 40)) {
      setFlung(true);
      setDragY(height); // finish the slide from where the finger let go
      onClose();
    } else setDragY(0); // spring back
  };

  return (
    // Clicking the backdrop closes it; the keyboard equivalent is Escape, which the native
    // dialog handles (onCancel below) — so the click handler needs no key handler of its own.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the dialog element itself (not its content) is a click on the scrim.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        transform: dragY ? `translateY(${dragY}px)` : undefined,
        transition: dragging
          ? 'none'
          : flung
            ? `transform ${CLOSE_MS}ms ease-in`
            : 'transform 200ms cubic-bezier(.2,.8,.2,1)',
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-[28px] bg-surface p-0 text-fg shadow-[0_-12px_40px_rgb(0_0_0/0.18)] backdrop:bg-scrim open:animate-sheet-up sm:m-auto sm:max-w-md sm:rounded-[28px] print:hidden"
    >
      {rendered && (
        // Focus lands on the sheet itself, not its first button: a ring on "Copy posting
        // link" reads as a selection on a phone. Tab still reaches the first action next.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        <div tabIndex={-1} autoFocus className="flex max-h-[92dvh] flex-col outline-none">
          {/* The grab handle: drag it down to dismiss (phones). */}
          <div
            aria-hidden="true"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center sm:hidden"
          >
            <span className="h-[5px] w-9 rounded-full bg-border" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-4 sm:pt-5">{children}</div>
          {footer && <div className="shrink-0 px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
