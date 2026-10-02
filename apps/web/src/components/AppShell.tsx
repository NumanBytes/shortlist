import { Briefcase, LogOut, Radar, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useSkills } from '../lib/queries';
import { Logo } from './Logo';

const LINKS: { to: string; label: string; icon: ReactNode; end: boolean }[] = [
  { to: '/', label: 'Jobs', icon: <Briefcase className="size-5" />, end: false },
  { to: '/evidence', label: 'Evidence', icon: <ShieldCheck className="size-5" />, end: false },
  { to: '/sources', label: 'Sources', icon: <Radar className="size-5" />, end: false },
];

// "/" owns the jobs list and "/jobs/:id"; both count as the Jobs tab.
const isJobsPath = (path: string) => path === '/' || path.startsWith('/jobs');

function useToReview(): number {
  const skills = useSkills();
  return (skills.data ?? []).flatMap((s) => s.evidence).filter((e) => !e.isVerified).length;
}

function NavItem({ link, mobile, badge }: { link: (typeof LINKS)[number]; mobile: boolean; badge?: number }) {
  const { pathname } = useLocation();
  return (
    <NavLink
      to={link.to}
      end={link.end}
      className={({ isActive }) => {
        const active = link.to === '/' ? isJobsPath(pathname) : isActive;
        return mobile
          ? `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? 'text-fg' : 'text-subtle'}`
          : `relative inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium ${active ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`;
      }}
    >
      {link.icon}
      {link.label}
      {badge ? (
        <span
          className={`${mobile ? 'absolute top-1 left-1/2 ml-2' : ''} rounded-full bg-stretch px-1.5 text-[10px] leading-4 font-semibold text-white`}
          aria-label={`${badge} to review`}
        >
          {badge}
        </span>
      ) : null}
    </NavLink>
  );
}

function AccountMenu() {
  const { state, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (state.status !== 'signedIn') return null;
  const initial = state.user.name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((o) => !o)}
        className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-border bg-surface p-1 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-fg">{state.user.name}</p>
            <p className="truncate text-xs text-muted">{state.user.email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg hover:bg-surface-2"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const toReview = useToReview();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Logo />
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
            {LINKS.map((l) => (
              <NavItem key={l.to} link={l} mobile={false} badge={l.to === '/evidence' ? toReview : undefined} />
            ))}
          </nav>
          <AccountMenu />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-4 pb-28 sm:pb-12">
        <Outlet />
      </div>

      {/* Phone: navigation at the bottom, within thumb reach. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        {LINKS.map((l) => (
          <NavItem key={l.to} link={l} mobile badge={l.to === '/evidence' ? toReview : undefined} />
        ))}
      </nav>
    </div>
  );
}
