import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Button } from './ui';

const LINKS = [
  { to: '/', label: 'Jobs', end: true },
  { to: '/evidence', label: 'Evidence', end: false },
  { to: '/sources', label: 'Sources', end: false },
];

export function AppShell() {
  const { state, logout } = useAuth();
  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-2 py-3">
        <nav className="flex gap-1" aria-label="Main">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {state.status === 'signedIn' && (
            <span className="hidden text-sm text-slate-500 sm:inline">{state.user.name}</span>
          )}
          <Button variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
