import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Sheet, Skeleton } from '../../components/ui';
import { useProfile } from '../../lib/queries';
import type { PublicUser } from '../../lib/types';
import { Account } from './Account';
import { Budget } from './Budget';
import { EducationList, Projects, Roles } from './CareerLists';
import { ContactForm } from './ContactForm';

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('') || '?';

// Profile (design board 6): the resume header, roles, projects, education, the AI budget
// and the account. Personal details live only in the database — never in committed files.
// The sections live in ./profile/.
export function ProfilePage() {
  const profile = useProfile();
  const [editing, setEditing] = useState(false);
  return (
    <main className="mx-auto max-w-2xl space-y-3 pb-6">
      <nav className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Link to="/" className="-ml-1 inline-flex min-h-11 items-center gap-0.5 text-[17px] font-medium text-accent-fg">
          <ChevronLeft className="size-6" /> Jobs
        </Link>
        <h1 className="text-[15px] font-semibold text-fg">Profile</h1>
        <button type="button" onClick={() => setEditing(true)} className="min-h-11 justify-self-end px-1 text-[15px] font-semibold text-accent-fg">
          Edit
        </button>
      </nav>

      {profile.data ? <Identity profile={profile.data} /> : <Skeleton className="mx-auto h-40 w-64" />}

      <Roles />
      <Projects />
      <EducationList />
      <Budget />
      <Account />

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
      <span className="mb-2 grid size-[72px] place-items-center rounded-full bg-accent-soft text-2xl font-semibold text-accent-fg">{initialsOf(p.name)}</span>
      <p className="text-xl font-bold tracking-[-0.01em] text-fg">{p.name}</p>
      {p.headline && <p className="text-[15px] text-muted">{p.headline}</p>}
      <p className="text-[13px] text-muted">{[p.location, p.email].filter(Boolean).join(' · ')}</p>
    </header>
  );
}
