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
  const nextId = useRef(0);
  const show = useCallback((t: Omit<ToastMessage, 'id'>) => setToast({ ...t, id: ++nextId.current }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 sm:bottom-6 print:hidden">
        {toast && (
          <output className="pointer-events-auto flex items-center gap-4 rounded-xl bg-fg px-4 py-3 text-sm text-bg shadow-lg">
            {toast.text}
            {toast.action && (
              <button
                type="button"
                className="font-semibold text-accent underline-offset-2 hover:underline"
                onClick={() => {
                  toast.action!.onClick();
                  setToast(null);
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
