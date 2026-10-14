import { useLayoutEffect } from 'react';
import { useLocation, type NavigateFunction } from 'react-router';

// Which way a navigation goes, for the "push" transition (design motion spec): forward
// slides the new screen in from the right; back slides it out. index.css reads
// <html data-nav> inside the view transition.
export function setNavDirection(dir: 'forward' | 'back') {
  document.documentElement.dataset.nav = dir;
}

// The shared score ring (motion spec: "Ring — shared element, 44 → 88 px"). Only the
// tapped card's ring may carry the transition name: if every list ring had one, each
// would get its own layer and stay put while the list slides away. The name is set on the
// element itself, before the browser's "old" snapshot, and stays on that ring so the
// back navigation can return to it.
let namedRing: HTMLElement | null = null;
export function nameSharedRing(ring: HTMLElement | null, jobId: string) {
  namedRing?.style.removeProperty('view-transition-name');
  namedRing = ring;
  ring?.style.setProperty('view-transition-name', `ring-${jobId}`);
}

// Resolved by <RouteCommitted> once the new route is on screen.
let committed: (() => void) | null = null;

// Navigate inside a View Transition. The browser snapshots the old screen, runs our
// callback, and snapshots the new screen when the callback's promise resolves — so the
// promise must wait until React has actually rendered the new route. (react-router applies
// navigations as a low-priority update that `flushSync` can't force, and its own
// `viewTransition` option needs the data router this app doesn't use.) <RouteCommitted>
// resolves it from a layout effect: after the DOM is updated, before it's painted.
// `to` may be a history step (-1) for a real "back".
export function pushNavigate(navigate: NavigateFunction, to: string | number, dir: 'forward' | 'back') {
  setNavDirection(dir);
  const go = () => (typeof to === 'number' ? navigate(to) : navigate(to));
  if (typeof document.startViewTransition !== 'function') return void go();
  document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        committed = resolve;
        void go();
        setTimeout(resolve, 300); // never hold the screen frozen
      }),
  );
}

// Mounted once inside the router: tells a pending transition the new route is rendered.
export function RouteCommitted() {
  const { key } = useLocation();
  useLayoutEffect(() => {
    committed?.();
    committed = null;
  }, [key]);
  return null;
}
