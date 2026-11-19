import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AdminCode, AdminNote } from '../../components/AdminNote';
import { Logo } from '../../components/Logo';
import { PolicyLinks } from '../../components/PolicyLinks';
import { Skeleton } from '../../components/ui';
import { useLegal } from '../../lib/queries';
import type { LegalInfo } from '../../lib/types';

// The public pages Paddle reviews before it takes real payments, and anyone can read before
// signing up (docs/security.md §8.9): no sign-in, no app chrome. Who runs the server comes
// from its LEGAL_* settings, so no one's name or address is in the code.

export type Operator = NonNullable<LegalInfo['operator']>;

export function PolicyPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: (legal: LegalInfo, operator: Operator | null) => ReactNode;
}) {
  const legal = useLegal();
  return (
    <div className="min-h-dvh bg-bg">
      <main className="mx-auto max-w-2xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
        <Link to="/" className="inline-flex min-h-11 items-center" aria-label="Shortlist home">
          <Logo />
        </Link>
        <h1 className="mt-6 text-large-title font-bold text-fg">{title}</h1>
        <p className="mt-1 text-footnote text-muted">Last updated {updated}</p>
        <div className="mt-6 space-y-4 text-body text-fg">
          {legal.data ? (
            <>
              {!legal.data.operator && (
                <AdminNote>
                  <p>
                    Who runs this server isn&apos;t set, so these pages show placeholders. Set{' '}
                    <AdminCode>LEGAL_NAME</AdminCode>, <AdminCode>LEGAL_ADDRESS</AdminCode>,{' '}
                    <AdminCode>LEGAL_EMAIL</AdminCode> and <AdminCode>LEGAL_JURISDICTION</AdminCode> (docs/security.md
                    §8.9).
                  </p>
                </AdminNote>
              )}
              {children(legal.data, legal.data.operator)}
            </>
          ) : legal.isError ? (
            <p className="text-muted">This page couldn&apos;t load. Check your connection and try again.</p>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          )}
        </div>
        <PolicyLinks className="mt-10 border-t border-border pt-4" />
      </main>
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="pt-4 text-title font-bold text-fg">{children}</h2>;
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}

// The operator's name, or a visible placeholder while the server has none.
export const nameOf = (o: Operator | null) => o?.name ?? '[the operator of this server]';

export function ContactLink({ operator }: { operator: Operator | null }) {
  return operator ? (
    <a className="font-semibold text-accent-fg underline" href={`mailto:${operator.email}`}>
      {operator.email}
    </a>
  ) : (
    <span>[contact email not set]</span>
  );
}
