import { Briefcase, ChevronRight, LogOut, Mail, Radar, ShieldCheck, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { elapsed } from '../lib/format';
import { useActiveTailoring, useGmail, useSkills } from '../lib/queries';
import { useNow } from '../lib/useNow';
import { InstallPrompt } from './InstallPrompt';
import { Logo } from './Logo';
import { setTheme, useTheme, type ThemeChoice } from '../lib/theme';
import { Segmented, Sheet } from './ui';

const LINKS: { to: string; label: string; icon: ReactNode; end: boolean }[] = [
  { to: '/', label: 'Jobs', icon: <Briefcase className="size-6 sm:size-5" strokeWidth={1.75} />, end: false },
  { to: '/evidence', label: 'Evidence', icon: <ShieldCheck className="size-6 sm:size-5" strokeWidth={1.75} />, end: false },
  { to: '/sources', label: 'Sources', icon: <Radar className="size-6 sm:size-5" strokeWidth={1.75} />, end: false },
];

// "/" owns the jobs list and "/jobs/:id"; both count as the Jobs tab.
const isJobsPath = (path: string) => path === '/' || path.startsWith('/jobs');

function useToReview(): number {
  const skills = useSkills();
  return (skills.data ?? []).flatMap((s) => s.evidence).filter((e) => !e.isVerified).length;
}

// The Jobs tab returns to where you were: leave a job (say, while its resume is being
// tailored) for Evidence, tap Jobs, and you're back on that job — not the top of the list.
// Tapping Jobs while already in Jobs goes to the list, keeping its tab and filters.
function useJobsHref(): string {
  const { pathname, search } = useLocation();
  const [last, setLast] = useState('/');
  // Adjusting state while rendering (React's documented pattern for "remember the previous
  // value"): no effect, so the link is right on the very first render after navigating.
  if (isJobsPath(pathname) && last !== pathname + search) setLast(pathname + search);
  return isJobsPath(pathname) ? `/${search}` : last;
}

function NavItem({ link, mobile, badge, to }: { link: (typeof LINKS)[number]; mobile: boolean; badge?: number; to?: string }) {
  const { pathname } = useLocation();
  return (
    <NavLink
      to={to ?? link.to}
      end={link.end}
      className={({ isActive }) => {
        const active = link.to === '/' ? isJobsPath(pathname) : isActive;
        return mobile
          ? `flex h-[49px] flex-col items-center justify-center gap-[3px] text-[11px] font-medium ${active ? 'text-accent-fg' : 'text-muted'}`
          : `relative inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium ${active ? 'bg-accent-soft text-accent-fg' : 'text-muted hover:text-fg'}`;
      }}
    >
      <span className="relative flex">
        {link.icon}
        {badge ? (
          <span
            className={`${mobile ? 'absolute -top-[5px] left-[15px]' : 'absolute -top-2 -right-3'} h-[18px] min-w-[18px] rounded-full bg-danger px-[5px] text-center text-[11px] leading-[18px] font-semibold text-white tabular-nums`}
            aria-label={`${badge} to review`}
          >
            {badge}
          </span>
        ) : null}
      </span>
      <span className={mobile ? '' : badge ? 'ml-2' : ''}>{link.label}</span>
    </NavLink>
  );
}

// Initials in an accent circle; opens the account sheet.
export function AccountButton() {
  const { state } = useAuth();
  const [open, setOpen] = useState(false);
  if (state.status !== 'signedIn') return null;
  const initials =
    state.user.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || '?';
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Account"
        onClick={() => setOpen(true)}
        className="grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent-fg">{initials}</span>
      </button>
      <AccountSheet open={open} onClose={() => setOpen(false)} initials={initials} />
    </>
  );
}

function AccountSheet({ open, onClose, initials }: { open: boolean; onClose: () => void; initials: string }) {
  const { state, logout } = useAuth();
  const gmail = useGmail();
  const theme = useTheme();
  if (state.status !== 'signedIn') return null;
  const row = 'flex min-h-14 w-full items-center gap-3 px-1 text-left text-base font-medium';
  const icon = 'grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-muted';
  return (
    <Sheet open={open} onClose={onClose} title="Account">
      <div className="flex items-center gap-3 pb-4">
        <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-[15px] font-semibold text-accent-fg">{initials}</span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-fg">{state.user.name}</p>
          <p className="truncate text-[13px] text-muted">{state.user.email}</p>
        </div>
      </div>
      <div className="mb-4 space-y-2">
        <p className="px-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">Appearance</p>
        <Segmented<ThemeChoice>
          label="Appearance"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>
      <nav aria-label="Account" className="divide-y divide-border rounded-2xl border border-border px-3">
        <Link to="/profile" onClick={onClose} className={row}>
          <span className={icon}>
            <UserRound className="size-[18px]" />
          </span>
          <span className="flex-1">Profile</span>
          <ChevronRight className="size-4 text-muted" />
        </Link>
        <Link to="/sources" onClick={onClose} className={row}>
          <span className={icon}>
            <Mail className="size-[18px]" />
          </span>
          <span className="flex-1">Gmail</span>
          <span className="text-[13px] font-normal text-muted">{gmail.data?.connection ? 'Connected' : 'Not connected'}</span>
          <ChevronRight className="size-4 text-muted" />
        </Link>
        <button type="button" onClick={() => void logout()} className={`${row} text-danger-fg`}>
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-danger-bg">
            <LogOut className="size-[18px]" />
          </span>
          Sign out
        </button>
      </nav>
    </Sheet>
  );
}

// A page's large title (30px, as in the design), with the account button beside it on
// phones — on wider screens the account button lives in the top bar instead.
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <h1 className="text-[30px] leading-9 font-bold tracking-[-0.025em] text-fg">{title}</h1>
      <div className="flex items-center gap-1">
        {children}
        <div className="sm:hidden">
          <AccountButton />
        </div>
      </div>
    </header>
  );
}

// Tailoring runs in the worker, so leaving the job's page never stops it. This pill keeps
// it visible on every other page and leads back to the job (Agents.md §13.1).
function TailoringPill() {
  const active = useActiveTailoring();
  const { pathname } = useLocation();
  const now = useNow();
  const first = active.data?.[0];
  if (!first || pathname === `/jobs/${first.jobId}`) return null;
  const more = active.data!.length - 1;
  return (
    <Link
      to={`/jobs/${first.jobId}`}
      className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-30 flex h-11 max-w-[calc(100vw-32px)] -translate-x-1/2 animate-rise-in items-center gap-2.5 rounded-full bg-fg py-0 pr-2.5 pl-4 text-[13px] font-medium text-bg shadow-[0_8px_24px_rgb(15_23_42/0.25)] sm:bottom-6 print:hidden"
    >
      <span aria-hidden="true" className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-toast-accent border-r-transparent" />
      <span className="min-w-0 truncate">
        Tailoring resume · {first.company}
        {more > 0 && ` +${more}`} · <span className="tabular-nums">{elapsed(first.queuedAt, now)}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 opacity-60" />
    </Link>
  );
}

// A job (or its resume) is a pushed screen on phones: it has its own back link and bottom
// action bar, so the tab bar steps aside (design board 2).
const isPushedScreen = (path: string) => /^\/jobs\/[^/]+/.test(path);

export function AppShell() {
  const { pathname } = useLocation();
  const toReview = useToReview();
  const jobsHref = useJobsHref();
  const badge = (l: (typeof LINKS)[number]) => (l.to === '/evidence' ? toReview : undefined);
  return (
    <div className="min-h-dvh">
      {/* Wider screens: a top bar with the navigation and the account button. */}
      <header className="sticky top-0 z-20 hidden border-b border-border bg-glass backdrop-blur-xl sm:block print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Logo />
          <nav className="flex items-center gap-1" aria-label="Main">
            {LINKS.map((l) => (
              <NavItem key={l.to} link={l} mobile={false} to={l.to === '/' ? jobsHref : undefined} badge={badge(l)} />
            ))}
          </nav>
          <AccountButton />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-36 sm:pt-6 sm:pb-12 print:max-w-none print:p-0">
        <Outlet />
      </div>

      <TailoringPill />
      <InstallPrompt />

      {/* Phones: a frosted tab bar at the bottom, within thumb reach. */}
      {!isPushedScreen(pathname) && (
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-border bg-glass px-3 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:hidden print:hidden"
      >
        {LINKS.map((l) => (
          <NavItem key={l.to} link={l} mobile to={l.to === '/' ? jobsHref : undefined} badge={badge(l)} />
        ))}
      </nav>
      )}
    </div>
  );
}
