import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';

// Edge swipe back on a pushed screen (design motion spec, "Back"): a drag that starts at
// the left edge moves the screen with the finger; past 40% of the width (or a fast flick)
// it slides away and goes back, otherwise it springs back.
// Only inside the installed app — a browser tab already has its own edge-swipe back, and
// two gestures fighting over one edge would be worse than one.
const EDGE_PX = 24;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

const installed = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function useEdgeSwipeBack(onBack: () => void) {
  const [dx, setDx] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'drag' | 'settle' | 'leave'>('idle');
  const start = useRef<{ x: number; y: number; t: number; id: number; w: number } | null>(null);
  const horizontal = useRef<boolean | null>(null);

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (!installed() || e.clientX > EDGE_PX || e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, w: (e.currentTarget as HTMLElement).offsetWidth || window.innerWidth };
      horizontal.current = null;
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const x = e.clientX - s.x;
      const y = e.clientY - s.y;
      if (horizontal.current === null && Math.hypot(x, y) > 8) {
        horizontal.current = x > Math.abs(y);
        if (horizontal.current) {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          setPhase('drag');
        }
      }
      if (horizontal.current) setDx(Math.max(0, x));
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || !horizontal.current) return;
      const velocity = (e.clientX - s.x) / Math.max(1, e.timeStamp - s.t);
      // A flick counts only with some distance behind it, so a twitch never navigates away.
      if (dx > s.w * 0.4 || (velocity > 0.6 && dx > s.w * 0.15)) {
        setPhase('leave');
        setDx(s.w);
        window.setTimeout(onBack, 200);
      } else {
        setPhase('settle');
        setDx(0);
      }
    },
  };

  const style: CSSProperties = {
    transform: dx ? `translateX(${dx}px)` : undefined,
    transition: phase === 'drag' ? 'none' : phase === 'leave' ? 'transform 200ms ease-in' : `transform 200ms ${EASE}`,
    touchAction: 'pan-y pinch-zoom', // vertical scroll and pinch-zoom stay the browser's
  };
  return { handlers: { ...handlers, onPointerCancel: handlers.onPointerUp }, style };
}
