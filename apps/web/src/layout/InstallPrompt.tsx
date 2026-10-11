import { Share, SquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from '../components/Logo';
import { Button, Sheet } from '../components/ui';

// "Add Shortlist to your Home Screen" (design pattern board). The app is a PWA: installing
// it gives a home-screen icon and a full-screen window, no app store. Two paths:
// - Chrome/Android/desktop fire `beforeinstallprompt`: we keep the event and the button
//   triggers the browser's own install dialog.
// - iPhone Safari has no such event: the sheet shows the two taps instead.
// Never shown inside the installed app; "Not now" is remembered on this device.
const KEY = 'shortlist-install-dismissed';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIosSafari = () => /iP(hone|ad|od)/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export function InstallPrompt({ delayMs = 4000 }: { delayMs?: number }) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [open, setOpen] = useState(false);
  const ios = isIosSafari();

  useEffect(() => {
    if (standalone() || dismissed()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our button instead of the browser's mini-bar
      setEvent(e as InstallEvent);
      setOpen(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    // Safari never fires the event — offer the manual steps after a moment.
    const timer = ios ? setTimeout(() => setOpen(true), delayMs) : undefined;
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      clearTimeout(timer);
    };
  }, [ios, delayMs]);

  const notNow = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Not remembered; it may ask again next visit.
    }
    setOpen(false);
  };
  const install = async () => {
    await event?.prompt();
    setOpen(false);
  };

  return (
    <Sheet open={open} onClose={notNow} title="Add Shortlist to your Home Screen">
      <div className="flex items-center gap-3">
        <Logo withName={false} size="md" />
        <div>
          <p className="text-[17px] font-semibold text-fg">Add Shortlist to your Home Screen</p>
          <p className="text-[13px] text-muted">Opens full-screen, like an app. No App Store.</p>
        </div>
      </div>
      {!event && (
        <ol className="mt-4 space-y-3 text-[15px] text-fg">
          <li className="flex items-center gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold">1</span>
            Tap <Share className="size-5 text-accent-fg" aria-label="Share" /> in Safari's toolbar
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] font-semibold">2</span>
            Choose <b className="font-semibold">Add to Home Screen</b> <SquarePlus className="size-5 text-accent-fg" aria-hidden="true" />
          </li>
        </ol>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button size="lg" variant="ghost" onClick={notNow}>
          Not now
        </Button>
        {event ? (
          <Button size="lg" onClick={() => void install()}>
            Install
          </Button>
        ) : (
          <Button size="lg" onClick={notNow}>
            Got it
          </Button>
        )}
      </div>
    </Sheet>
  );
}
