// The Shortlist mark: the app icon's check, drawn in the current theme.
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 64 64" className="size-7" aria-hidden="true">
        <rect width="64" height="64" rx="14" className="fill-primary" />
        <path d="M18 33l9 9 19-20" fill="none" stroke="#34d399" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withName && <span className="text-base font-semibold tracking-tight text-fg">Shortlist</span>}
    </span>
  );
}
