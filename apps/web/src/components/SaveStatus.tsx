import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

// Quiet confirmation for settings that save on change (UI audit G13): "Saving…", then
// "Saved" for a moment. Pass the mutation's state; `submittedAt` tells one save from the next.
export function SaveStatus({
  isPending,
  isSuccess,
  submittedAt,
  className = '',
}: {
  isPending: boolean;
  isSuccess: boolean;
  submittedAt: number;
  className?: string;
}) {
  const [faded, setFaded] = useState(0); // the save whose "Saved" has already faded
  useEffect(() => {
    if (!isSuccess) return;
    const t = setTimeout(() => setFaded(submittedAt), 2500);
    return () => clearTimeout(t);
  }, [isSuccess, submittedAt]);
  const saved = isSuccess && faded !== submittedAt;
  return (
    // The same live region stays mounted (so the change is announced) but takes no room when idle.
    <output
      aria-live="polite"
      className={isPending || saved ? `flex items-center gap-1 text-footnote text-muted ${className}` : 'sr-only'}
    >
      {isPending && 'Saving…'}
      {!isPending && saved && (
        <>
          <Check className="size-3.5 text-accent-fg" aria-hidden="true" /> Saved
        </>
      )}
    </output>
  );
}
