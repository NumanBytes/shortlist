import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

// Set-up details for whoever runs this Shortlist server (UI audit G12, docs/web-design.md
// §8.5). Users read plain words and get a real next step; env var names, commands and doc
// sections wait behind this disclosure instead of reading like an error.
export function AdminNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <details className={`group text-footnote text-muted ${className}`}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition group-open:rotate-90" aria-hidden="true" />
        For the server admin
      </summary>
      <div className="space-y-1.5 pb-1 pl-5">{children}</div>
    </details>
  );
}

// A command or setting name inside an AdminNote.
export function AdminCode({ children }: { children: ReactNode }) {
  return <code className="rounded-sm bg-surface-2 px-1 font-mono text-caption break-all text-fg">{children}</code>;
}
