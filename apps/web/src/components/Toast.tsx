import { Check } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastMessage {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<(t: Omit<ToastMessage, 'id'>) => void>(() => undefined);

// Confirms an action that changes what's on screen (a job leaving the list) and offers
// Undo. One at a time; auto-dismisses; announced politely to screen readers.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [leaving, setLeaving] = useState(false);
  const nextId = useRef(0);
  const show = useCallback((t: Omit<ToastMessage, 'id'>) => {
    setLeaving(false);
    setToast({ ...t, id: ++nextId.current });
  }, []);

  // Motion spec: rises 12 px + fades in (200 ms), stays 5 s, then drops out (200 ms).
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setLeaving(true), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setToast(null), 200);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(72px+env(safe-area-inset-bottom))] z-40 flex justify-center sm:bottom-6 print:hidden"
      >
        {toast && (
          <output
            key={toast.id}
            className={`pointer-events-auto flex min-h-13 w-full max-w-md ${leaving ? 'animate-drop-out' : 'animate-rise-in'} items-center gap-2.5 rounded-[14px] bg-fg py-1 pr-1.5 pl-4 text-[15px] font-medium text-bg shadow-[0_12px_32px_rgb(15_23_42/0.3)]`}
          >
            <Check className="size-4 shrink-0 text-toast-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1">{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                className="min-h-11 rounded-[10px] px-3 font-semibold text-toast-accent"
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
