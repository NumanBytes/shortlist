import { Link } from 'react-router';

// Links to the public policy pages (docs/security.md §8.9), on the sign-in screens and under
// every policy page.
export const POLICY_LINKS = [
  { to: '/pricing', label: 'Pricing' },
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/refunds', label: 'Refunds' },
] as const;

export function PolicyLinks({ className = '' }: { className?: string }) {
  return (
    <nav
      aria-label="Policies"
      className={`flex flex-wrap justify-center gap-x-4 text-footnote text-muted ${className}`}
    >
      {POLICY_LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="inline-flex min-h-11 items-center hover:text-fg">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
