import { Share, SquarePlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Logo } from '../components/Logo';
import { Button, IconButton } from '../components/ui';

// "Add Shortlist to your Home Screen" (design pattern board). The app is a PWA: installing
// it gives a home-screen icon and a full-screen window, no app store. Two paths:
// - Chrome/Android/desktop fire `beforeinstallprompt`: we keep the event and Install
//   triggers the browser's own install dialog.
// - iPhone Safari has no such event: the banner shows the two taps instead.
// A banner at the top of a tab, not a modal, and only after a meaningful moment — a second
// visit, or after opening a job — so it never interrupts a first look or onboarding (UI
// audit I1). Never shown inside the installed app; "Not now" is remembered on this device.
const KEY = 'shortlist-install-dismissed';
const VISITS_KEY = 'shortlist-visits';
const OPENED_JOB_KEY = 'shortlist-opened-job';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIosSafari = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) &&
  /Safari/.test(navigator.userAgent) &&
  !/CriOS|FxiOS/.test(navigator.userAgent);
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // Not remembered; it may ask again next visit.
  }
};

// Counted once per browser session (a new tab or a relaunch is a new visit).
let visitCounted = false;
function countVisit() {
  if (visitCounted) return;
  visitCounted = true;
  try {
    if (sessionStorage.getItem(VISITS_KEY)) return;
    sessionStorage.setItem(VISITS_KEY, '1');
  } catch {
    return;
  }
  write(VISITS_KEY, String(Number(read(VISITS_KEY) ?? 0) + 1));
}

// Always mounted by the shell (it notices a job being opened); `show` is false during
// onboarding and on a pushed job screen.
export function InstallPrompt({ show = true }: { show?: boolean }) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(() => standalone() || read(KEY) === '1');
  const { pathname } = useLocation();
  const ios = isIosSafari();

  useEffect(() => {
    countVisit();
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our button instead of the browser's mini-bar
      setEvent(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  // Opening a job is the moment the app has shown its value.
  const [openedJob, setOpenedJob] = useState(() => read(OPENED_JOB_KEY) === '1');
  if (!openedJob && /^\/jobs\/[^/]+/.test(pathname)) setOpenedJob(true);
  useEffect(() => {
    if (openedJob) write(OPENED_JOB_KEY, '1');
  }, [openedJob]);

  const earned = openedJob || Number(read(VISITS_KEY) ?? 0) >= 2;
  if (!show || hidden || !earned || !(event || ios)) return null;

  const notNow = () => {
    write(KEY, '1');
    setHidden(true);
  };
  const install = async () => {
    await event?.prompt();
    setHidden(true);
  };

  return (
    <aside
      aria-label="Install Shortlist"
      className="mb-3 flex items-start gap-3 rounded-lg border border-border bg-surface py-3 pr-1 pl-3 shadow-card print:hidden"
    >
      <Logo withName={false} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-fg">Add Shortlist to your Home Screen</p>
        <p className="text-footnote text-muted">Opens full-screen, like an app. No App Store.</p>
        {event ? (
          <Button size="sm" className="mt-2" onClick={() => void install()}>
            Install
          </Button>
        ) : (
          <ol className="mt-2 space-y-1 text-footnote text-fg">
            <li className="flex items-center gap-1.5">
              1. Tap <Share className="size-4 text-accent-fg" aria-label="Share" /> in Safari's toolbar
            </li>
            <li className="flex items-center gap-1.5">
              2. Choose <b className="font-semibold">Add to Home Screen</b>
              <SquarePlus className="size-4 text-accent-fg" aria-hidden="true" />
            </li>
          </ol>
        )}
      </div>
      <IconButton label="Not now" onClick={notNow}>
        <X className="size-5" />
      </IconButton>
    </aside>
  );
}
