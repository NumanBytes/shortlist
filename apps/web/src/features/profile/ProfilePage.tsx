import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Segmented, Sheet, Skeleton } from '../../components/ui';
import { pushNavigate } from '../../lib/navigation';
import { useProfile } from '../../lib/queries';
import type { PublicUser } from '../../lib/types';
import { Account } from './Account';
import { Budget } from './Budget';
import { EducationList, Projects, Roles } from './CareerLists';
import { ImportFromResume, JobSearch } from './JobSearch';
import { ContactForm } from './ContactForm';
import { NeverClaimList } from './NeverClaimList';
import { Notifications } from './Notifications';

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('') || '?';

type Tab = 'career' | 'settings';

// Profile (design board 6), in two parts (UI audit N2): Career is what resumes are built
// from — the header, roles, projects, education, import and the never-claim list; Settings
// is how Shortlist behaves — the job search, notifications, AI budget and account. The part
// lives in the URL (`?tab=settings`). Personal details live only in the database — never in
// committed files. The sections live in ./profile/.
export function ProfilePage() {
  const profile = useProfile();
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'settings' ? 'settings' : 'career';
  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        if (t === 'settings') p.set('tab', t);
        else p.delete('tab');
        p.delete('open');
        return p;
      },
      { replace: true },
    );
  // Back returns to wherever Profile was opened from (UI audit N1); opened directly (a
  // bookmark, a fresh tab) there is no in-app history, so it goes to Jobs.
  const navigate = useNavigate();
  const hasHistory = useLocation().key !== 'default';
  return (
    <main className="mx-auto max-w-2xl space-y-3 pb-6">
      <nav className="grid grid-cols-[1fr_auto_1fr] items-center">
        <button
          type="button"
          onClick={() => pushNavigate(navigate, hasHistory ? -1 : '/', 'back')}
          className="-ml-1 inline-flex min-h-11 items-center gap-0.5 justify-self-start text-headline font-medium text-accent-fg"
        >
          <ChevronLeft className="size-6" /> {hasHistory ? 'Back' : 'Jobs'}
        </button>
        <h1 className="text-body font-semibold text-fg">Profile</h1>
        {tab === 'career' && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-11 justify-self-end px-1 text-body font-semibold text-accent-fg"
          >
            Edit
          </button>
        )}
      </nav>

      <Segmented<Tab>
        label="Profile section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'career', label: 'Career' },
          { value: 'settings', label: 'Settings' },
        ]}
      />

      {tab === 'career' ? (
        <>
          {profile.data ? <Identity profile={profile.data} /> : <Skeleton className="mx-auto h-40 w-64" />}
          <Roles />
          <Projects />
          <EducationList />
          <ImportFromResume />
          <NeverClaimList />
        </>
      ) : (
        <>
          <JobSearch />
          <Notifications />
          <Budget />
          <Account />
        </>
      )}

      {profile.data && (
        <Sheet open={editing} onClose={() => setEditing(false)} title="Edit profile">
          <ContactForm profile={profile.data} onDone={() => setEditing(false)} />
        </Sheet>
      )}
    </main>
  );
}

function Identity({ profile: p }: { profile: PublicUser }) {
  return (
    <header className="flex flex-col items-center gap-1 px-4 pt-2 pb-2 text-center">
      <span className="mb-2 grid size-[72px] place-items-center rounded-full bg-accent-soft text-title font-semibold text-accent-fg">
        {initialsOf(p.name)}
      </span>
      <p className="text-title font-bold tracking-[-0.01em] text-fg">{p.name}</p>
      {p.headline && <p className="text-body text-muted">{p.headline}</p>}
      <p className="text-footnote text-muted">{[p.location, p.email].filter(Boolean).join(' · ')}</p>
    </header>
  );
}
