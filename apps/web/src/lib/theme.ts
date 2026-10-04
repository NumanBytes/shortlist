import { useSyncExternalStore } from 'react';

// Appearance: follow the system, or force Light / Dark. The choice is a per-device
// convenience, so it lives in localStorage (never sensitive, never synced). index.html
// applies it before the first paint so the app never flashes the wrong theme.
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'shortlist-theme';
const listeners = new Set<() => void>();

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system'; // storage blocked (private mode): just follow the system
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  // The phone's status-bar colour follows the app, not just the system.
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', dark ? '#0a0e16' : '#f5f6f8');
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Not persisted, but still applied for this visit.
  }
  applyTheme(choice);
  for (const l of listeners) l();
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTheme,
    () => 'system',
  );
}
