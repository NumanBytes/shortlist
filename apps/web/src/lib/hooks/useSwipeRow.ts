import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

// Swipe a row to act on it (design motion spec, "Swipe → toast with Undo"):
// - the row follows the finger; only a mostly-horizontal drag counts, so vertical scrolling
//   is untouched (the row sets `touch-action: pan-y`);
// - past 35% of its width it "arms": the icon grows 1 → 1.15 with a light haptic;
// - released armed, the row exits (180 ms, ease-in), its gap closes (200 ms), then the
//   action runs; released early, it springs back (200 ms);
// - reduced motion: the row fades out (150 ms) instead of sliding.
export type SwipeDir = 'right' | 'left';

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const ARM = 0.35;
const EXIT_MS = 180;
const COLLAPSE_MS = 200;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Rows the user brought back with Undo: when one re-mounts, it slides back in (200 ms).
export const returningRows = new Map<string, SwipeDir>();

export function useSwipeRow({
  id,
  allowed,
  onCommit,
}: {
  id: string;
  allowed: Partial<Record<SwipeDir, boolean>>;
  onCommit: (dir: SwipeDir) => Promise<unknown>;
}) {
  const [dx, setDx] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'drag' | 'settle' | 'exit' | 'collapse'>('idle');
  const [height, setHeight] = useState<number | null>(null);
  const [returning] = useState(() => {
    const dir = returningRows.get(id);
    returningRows.delete(id);
    return dir ?? null;
  });
  const row = useRef<HTMLLIElement>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const intent = useRef<'h' | 'v' | null>(null);
  const moved = useRef(false); // suppresses the click that ends a drag
  const armedRef = useRef(false);
  const [armed, setArmed] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const width = () => row.current?.offsetWidth || 1;
  const dir: SwipeDir | null = dx > 0 ? 'right' : dx < 0 ? 'left' : null;

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  // Exit, close the gap, then act — the swipe's own action, or a button's (`action`). On
  // failure the row comes back.
  const commit = (d: SwipeDir, action: (d: SwipeDir) => Promise<unknown> = onCommit) => {
    const reduced = reducedMotion();
    setHeight(row.current?.offsetHeight ?? null);
    setPhase('exit');
    setDx(reduced ? 0 : (d === 'right' ? 1.1 : -1.1) * width());
    later(
      () => {
        setPhase('collapse');
        later(
          () => {
            action(d).catch(() => {
              setPhase('settle');
              setDx(0);
              setHeight(null);
            });
          },
          reduced ? 0 : COLLAPSE_MS,
        );
      },
      reduced ? 150 : EXIT_MS,
    );
  };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0 || phase === 'exit' || phase === 'collapse') return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      intent.current = null;
      moved.current = false;
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const x = e.clientX - s.x;
      const y = e.clientY - s.y;
      if (!intent.current && Math.hypot(x, y) > 8) {
        intent.current = Math.abs(x) > Math.abs(y) * 1.2 ? 'h' : 'v';
        if (intent.current === 'h') {
          moved.current = true;
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          setPhase('drag');
        }
      }
      if (intent.current !== 'h') return;
      const d: SwipeDir = x > 0 ? 'right' : 'left';
      const next = allowed[d] ? x : x * 0.15; // a direction with no action resists
      setDx(next);
      const isArmed = !!allowed[d] && Math.abs(next) >= ARM * width();
      if (isArmed && !armedRef.current) navigator.vibrate?.(10); // light haptic (Android)
      armedRef.current = isArmed;
      setArmed(isArmed);
    },
    onPointerUp: () => {
      const wasDrag = intent.current === 'h';
      start.current = null;
      intent.current = null;
      if (!wasDrag) return;
      if (armedRef.current && dir) commit(dir);
      else {
        setPhase('settle');
        setDx(0);
      }
      armedRef.current = false;
      setArmed(false);
    },
    onPointerCancel: () => {
      start.current = null;
      intent.current = null;
      setPhase('settle');
      setDx(0);
    },
    // A drag ends with a click on whatever is under the finger — swallow it.
    onClickCapture: (e: React.MouseEvent) => {
      if (moved.current) {
        e.preventDefault();
        e.stopPropagation();
        moved.current = false;
      }
    },
  };

  const reduced = reducedMotion();
  const cardStyle: CSSProperties = {
    transform: dx ? `translateX(${dx}px)` : undefined,
    transition:
      phase === 'drag'
        ? 'none'
        : phase === 'exit'
          ? reduced
            ? 'opacity 150ms linear'
            : `transform ${EXIT_MS}ms ease-in`
          : `transform 200ms ${EASE}`,
    opacity: phase === 'exit' && reduced ? 0 : undefined,
    animation: returning && phase === 'idle' && !reduced ? `row-return-${returning} 200ms ${EASE}` : undefined,
    touchAction: 'pan-y pinch-zoom', // vertical scroll and pinch-zoom stay the browser's
  };
  const rowStyle: CSSProperties =
    phase === 'collapse'
      ? {
          height: 0,
          marginTop: 0,
          opacity: 0,
          overflow: 'hidden',
          transition: `height ${COLLAPSE_MS}ms ${EASE}, margin ${COLLAPSE_MS}ms ${EASE}, opacity ${COLLAPSE_MS}ms`,
        }
      : height !== null && phase === 'exit'
        ? { height }
        : {};

  return { row, dx, dir, armed, phase, handlers, cardStyle, rowStyle, commit };
}
