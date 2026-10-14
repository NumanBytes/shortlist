import { useCallback } from 'react';

// Things fixed to the bottom of a phone screen stack instead of overlapping (UI audit G7,
// docs/web-design.md §8.5). The bottom bar (the tab bar, or a pushed screen's action bar)
// is the base; above it the tailoring pill, then the toast, then Evidence's "Add skill".
// Each layer that takes room publishes its height (plus a gap) as a CSS variable on <html>,
// and the ones above add those variables to their `bottom` with `bottomAbove()`.
export type BottomLayer = 'bar' | 'pill' | 'toast';

const GAP = 8;

// A callback ref: attach it to the layer's fixed element. A layer counts only while it is
// `position: fixed` — on wide screens the action bars sit in the page flow and take no room —
// and an empty layer (a toast wrapper with no toast) publishes 0.
export function useBottomInset(layer: BottomLayer) {
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const root = document.documentElement;
      const prop = `--bottom-${layer}`;
      const measure = () => {
        const h = getComputedStyle(el).position === 'fixed' ? el.offsetHeight : 0;
        root.style.setProperty(prop, h ? `${h + (layer === 'bar' ? 0 : GAP)}px` : '0px');
      };
      measure();
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
      ro?.observe(el);
      window.addEventListener('resize', measure);
      return () => {
        ro?.disconnect();
        window.removeEventListener('resize', measure);
        root.style.removeProperty(prop);
      };
    },
    [layer],
  );
}

// The `bottom` for a fixed element above the bar and the given layers. Without a bar it
// still clears the home indicator (safe area).
export const bottomAbove = (...layers: Exclude<BottomLayer, 'bar'>[]) =>
  `calc(max(var(--bottom-bar, 0px), env(safe-area-inset-bottom)) + 12px${layers.map((l) => ` + var(--bottom-${l}, 0px)`).join('')})`;
