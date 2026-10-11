import type { ComponentProps, MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { pushNavigate } from '../lib/navigation';

// A link that "pushes" (or pops) a screen with the design's transition. Still a real
// link: Cmd/Ctrl/Shift-click and middle-click keep their browser meaning.
// `before`: work to finish (briefly) before the transition starts — e.g. fetching the job,
// so the new screen's score ring is there to grow into.
export function PushLink({
  to,
  dir,
  before,
  onClick,
  ...props
}: ComponentProps<typeof Link> & { to: string; dir: 'forward' | 'back'; before?: () => Promise<unknown> }) {
  const navigate = useNavigate();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!before) return pushNavigate(navigate, to, dir);
    // Wait at most 250 ms: a slow network gets the push without the ring, never a stall.
    void Promise.race([before().catch(() => undefined), new Promise((r) => setTimeout(r, 250))]).then(() =>
      pushNavigate(navigate, to, dir),
    );
  };
  return <Link to={to} onClick={handle} {...props} />;
}
