import { STARTER_DISCOVERY_PREFERENCES } from '@shortlist/shared';
import { Globe, Mail } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Card, Skeleton, buttonStyles } from '../../components/ui';
import { PushLink } from '../../components/PushLink';
import { useAddRemoteBoards, usePreferences } from '../../lib/queries';
import { ResumeImport } from '../profile/ResumeImport';
import { SearchSettingsForm } from '../profile/SearchSettingsForm';

const STEPS = ['resume', 'search', 'sources'] as const;

// Set when onboarding is finished, even with every step skipped, so the gate in App.tsx never
// sends the user back to it. A UI flag on this device only — nothing private.
export const ONBOARDING_DONE_KEY = 'shortlist:onboarding-done';
type Step = (typeof STEPS)[number];

// First run for a new account (docs/discovery.md §9.13): your career from your resume, what
// you're looking for, and where to look. Every step can be skipped and done later from Profile
// or Sources. The step lives in the URL so the phone's back gesture steps back.
export function WelcomePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const step: Step = STEPS.includes(params.get('step') as Step) ? (params.get('step') as Step) : 'resume';
  const go = (s: Step) => setParams({ step: s });
  const finish = () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    void navigate('/', { replace: true });
  };
  const n = STEPS.indexOf(step) + 1;

  return (
    <main className="mx-auto max-w-md space-y-4 pb-8">
      <header className="space-y-1 pt-2">
        <p className="text-[13px] font-medium text-muted tabular-nums">Step {n} of 3</p>
        <h1 className="text-2xl font-bold tracking-[-0.01em] text-fg">
          {step === 'resume'
            ? 'Start from your resume'
            : step === 'search'
              ? "What you're looking for"
              : 'Where to look'}
        </h1>
      </header>

      {step === 'resume' && (
        <>
          <p className="text-[15px] text-muted">
            Shortlist tailors each resume only from things you've confirmed you did. Importing your current resume gives
            you a list to confirm instead of typing it all.
          </p>
          <ResumeImport />
          <Button variant="ghost" className="w-full" onClick={() => go('search')}>
            Next
          </Button>
        </>
      )}

      {step === 'search' && (
        <>
          <SearchStep onDone={() => go('sources')} />
          <Button variant="ghost" className="w-full" onClick={() => go('sources')}>
            Skip for now
          </Button>
        </>
      )}

      {step === 'sources' && <SourcesStep onDone={finish} />}
    </main>
  );
}

function SearchStep({ onDone }: { onDone: () => void }) {
  const prefs = usePreferences();
  if (!prefs.data) return <Skeleton className="h-96" />;
  // A new account starts from neutral settings, not from defaults tuned for someone else.
  const initial = prefs.data.isDefault ? STARTER_DISCOVERY_PREFERENCES : prefs.data.preferences;
  return <SearchSettingsForm initial={initial} onDone={onDone} submitLabel="Save and continue" />;
}

function SourcesStep({ onDone }: { onDone: () => void }) {
  const boards = useAddRemoteBoards();
  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-4">
        <p className="flex items-center gap-2 font-semibold text-fg">
          <Globe className="size-4" aria-hidden="true" /> Remote job boards
        </p>
        <p className="text-[13px] text-muted">
          Remote OK, Remotive, Himalayas, We Work Remotely and others, checked every night and filtered by what you just
          set.
        </p>
        <Button
          className="w-full"
          variant={boards.isSuccess ? 'secondary' : 'primary'}
          disabled={boards.isPending || boards.isSuccess}
          onClick={() => boards.mutate()}
        >
          {boards.isSuccess ? 'Following them' : 'Follow remote boards'}
        </Button>
      </Card>
      <Card className="space-y-2 p-4">
        <p className="flex items-center gap-2 font-semibold text-fg">
          <Mail className="size-4" aria-hidden="true" /> LinkedIn, Indeed and other job alerts
        </p>
        <p className="text-[13px] text-muted">
          Shortlist can read the job-alert emails those sites send you — only from one Gmail label you choose.
        </p>
        <PushLink to="/sources" dir="forward" className={`${buttonStyles('secondary')} w-full`}>
          Set up on Sources
        </PushLink>
      </Card>
      <Button size="lg" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
