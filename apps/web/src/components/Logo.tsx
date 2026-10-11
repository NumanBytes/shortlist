// The Shortlist mark, "the slice" (docs/web-design.md §8.4.3): three list bars ending on one
// diagonal cut, and only the picked one runs past it. Same geometry as public/favicon.svg,
// drawn with theme tokens (accent tile, on-accent bars) so dark mode follows.
const TILE = {
  sm: 'size-8', // header
  md: 'size-12', // install sheet
  lg: 'size-16 rounded-[14px] shadow-[0_10px_24px_-8px_rgb(5_150_105/0.5)]', // sign-in
};

export function Logo({ withName = true, size = 'sm' }: { withName?: boolean; size?: keyof typeof TILE }) {
  const tile = TILE[size];
  return (
    <span className={`inline-flex items-center ${size === 'lg' ? 'flex-col gap-4' : 'gap-2'}`}>
      <svg viewBox="0 0 64 64" className={`shrink-0 ${tile}`} aria-hidden="true">
        <rect width="64" height="64" rx="14" className="fill-accent" />
        <g className="fill-on-accent">
          <path d="M17.5 17H44.75L43 24H17.5a3.5 3.5 0 0 1 0-7Z" fillOpacity={0.5} />
          <path d="M17.5 28.5H52.6L50.85 35.5H17.5a3.5 3.5 0 0 1 0-7Z" />
          <path d="M17.5 40H39L37.25 47H17.5a3.5 3.5 0 0 1 0-7Z" fillOpacity={0.5} />
        </g>
      </svg>
      {withName && (
        <span className={`font-bold tracking-tight text-fg ${size === 'lg' ? 'text-[28px] leading-none' : 'text-base'}`}>Shortlist</span>
      )}
    </span>
  );
}
