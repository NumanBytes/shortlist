import { CircleAlert, Check } from 'lucide-react';
import { bottomAbove, useBottomInset } from '../lib/hooks/useBottomInset';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastMessage {
  id: number;
  text: string;
  tone?: 'error'; // a failure: an alert icon instead of the check
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<(t: Omit<ToastMessage, 'id'>) => void>(() => undefined);

// Confirms an action that changes what's on screen (a job leaving the list) and offers
// Undo. One at a time; auto-dismisses; announced politely to screen readers. It holds still
// while the pointer, a finger or focus is on it (UI audit G6, WCAG 2.2.1), and one with an
// action stays 8 s so Undo is reachable; the timer restarts when it's let go.
const STAY_MS = 5000;
const STAY_WITH_ACTION_MS = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [held, setHeld] = useState(false);
  const nextId = useRef(0);
  const inset = useBottomInset('toast');
  const show = useCallback((t: Omit<ToastMessage, 'id'>) => {
    setLeaving(false);
    setHeld(false);
    setToast({ ...t, id: ++nextId.current });
  }, []);

  // Motion spec: rises 12 px + fades in (200 ms), stays, then drops out (200 ms).
  useEffect(() => {
    if (!toast || held) return;
    const timer = setTimeout(() => setLeaving(true), toast.action ? STAY_WITH_ACTION_MS : STAY_MS);
    return () => clearTimeout(timer);
  }, [toast, held]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setToast(null), 200);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Above the bottom bar and the tailoring pill, never over them (UI audit G7). */}
      <div
        ref={inset}
        aria-live="polite"
        style={{ bottom: bottomAbove('pill') }}
        className="pointer-events-none fixed inset-x-3 z-40 flex justify-center print:hidden"
      >
        {toast && (
          // Hover, touch and focus only hold the timer — the Undo button stays the control.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <output
            key={toast.id}
            onPointerEnter={() => setHeld(true)}
            onPointerLeave={() => setHeld(false)}
            onPointerDown={() => setHeld(true)}
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
            className={`pointer-events-auto flex min-h-13 w-full max-w-md ${leaving ? 'animate-drop-out' : 'animate-rise-in'} items-center gap-2.5 rounded-md bg-fg py-1 pr-1.5 pl-4 text-body font-medium text-bg shadow-[0_12px_32px_rgb(15_23_42/0.3)]`}
          >
            {toast.tone === 'error' ? (
              <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden="true" />
            ) : (
              <Check className="size-4 shrink-0 text-toast-accent" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                className="min-h-11 rounded-sm px-3 font-semibold text-toast-accent"
                onClick={() => {
                  toast.action!.onClick();
                  setLeaving(true);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </output>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
