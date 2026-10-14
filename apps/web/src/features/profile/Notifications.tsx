import type { NotificationSettingsInput } from '@shortlist/shared';
import { Bell, BellOff, Send, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, INPUT, Switch } from '../../components/ui';
import { disablePush, enablePush, isStandalone, pushState, type PushState } from '../../lib/push';
import {
  useNotificationConfig,
  useNotificationSettings,
  usePushDevices,
  useSaveNotificationSettings,
  useSendTestNotification,
} from '../../lib/queries';
import { Group, Row } from './ListGroup';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

// Push notifications (docs/notifications.md §19): this device on or off, what to be told about,
// quiet hours, and a test. Settings apply to every device; on/off is per device.
export function Notifications() {
  const config = useNotificationConfig();
  const settings = useNotificationSettings();
  const devices = usePushDevices();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  async function toggleDevice() {
    setBusy(true);
    setError(undefined);
    try {
      setState(state === 'on' ? await disablePush() : await enablePush(config.data!.publicKey!));
      void devices.refetch();
    } catch (err) {
      setError((err as Error).message || 'Could not change notifications on this device');
    } finally {
      setBusy(false);
    }
  }

  if (config.data && !config.data.configured) {
    return (
      <Group label="Notifications">
        <Row
          icon={<BellOff className="size-[18px]" />}
          title="Not set up on this server"
          sub="Add the VAPID keys to the server's settings to turn notifications on (deploy/.env.example)."
        />
      </Group>
    );
  }

  return (
    <Group label="Notifications">
      <div className="space-y-3 px-4 py-3.5">
        <DeviceStatus state={state} busy={busy || !config.data} onToggle={() => void toggleDevice()} />
        {error && <p className="text-sm text-danger-fg">{error}</p>}
        {(devices.data?.length ?? 0) > 0 && (
          <p className="flex items-center gap-1.5 text-[13px] text-muted">
            <Smartphone className="size-3.5" aria-hidden="true" />
            On {devices.data!.length} {devices.data!.length === 1 ? 'device' : 'devices'}:{' '}
            {devices.data!.map((d) => d.userAgent ?? 'a device').join(', ')}
          </p>
        )}
      </div>
      {settings.data && <SettingsForm initial={settings.data} />}
      {state === 'on' && <TestButton />}
    </Group>
  );
}

function DeviceStatus({ state, busy, onToggle }: { state: PushState | null; busy: boolean; onToggle: () => void }) {
  if (state === 'unsupported') {
    return (
      <p className="text-sm text-muted">
        {isStandalone()
          ? "This browser can't receive push notifications."
          : 'To get notifications, add Shortlist to your home screen and open it from there.'}
      </p>
    );
  }
  if (state === 'denied') {
    return (
      <p className="text-sm text-muted">
        Notifications are blocked for Shortlist. Allow them in your browser's site settings, then come back.
      </p>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span>
        <span className="block text-[15px] font-semibold text-fg">On this device</span>
        <span className="block text-[13px] text-muted">
          {state === 'on'
            ? 'New matches, your morning digest and ready resumes.'
            : 'Off — you only see news when you open the app.'}
        </span>
      </span>
      <Button
        size="sm"
        variant={state === 'on' ? 'secondary' : 'primary'}
        disabled={busy || state === null}
        onClick={onToggle}
      >
        {state === 'on' ? <BellOff className="size-4" /> : <Bell className="size-4" />}
        {state === 'on' ? 'Turn off' : 'Turn on'}
      </Button>
    </div>
  );
}

function SettingsForm({ initial }: { initial: NotificationSettingsInput }) {
  const save = useSaveNotificationSettings();
  const [v, setV] = useState(initial);
  // Saved as it changes: each switch is one decision, no Save button to forget.
  const set = (patch: Partial<NotificationSettingsInput>) => {
    const next = { ...v, ...patch };
    setV(next);
    save.mutate(next);
  };
  const quiet = v.quietStart !== null;
  const toggle = (key: 'digest' | 'strongMatch' | 'resumeReady' | 'problems', title: string, sub: string) => (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span>
        <span className="block text-[15px] text-fg">{title}</span>
        <span className="block text-[13px] text-muted">{sub}</span>
      </span>
      <Switch checked={v[key]} onChange={(on) => set({ [key]: on })} label={title} />
    </div>
  );
  return (
    <>
      {toggle('digest', 'Morning digest', 'What the night found, at 08:00.')}
      {toggle('strongMatch', 'Strong matches', 'A job from your email alerts that fits well, right away.')}
      {v.strongMatch && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <label htmlFor="strong-min" className="text-[15px] text-fg">
            Strong means a score of at least
          </label>
          <select
            id="strong-min"
            value={v.strongMatchMin}
            onChange={(e) => set({ strongMatchMin: Number(e.target.value) })}
            className={`${INPUT} h-10 w-24 px-2`}
          >
            {[60, 70, 75, 80, 85, 90].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}
      {toggle('resumeReady', 'Resume ready', 'When a tailored resume is ready to review.')}
      {toggle('problems', 'Problems', 'Gmail needs reconnecting, a source keeps failing, the AI budget ran out.')}
      <div className="space-y-2 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-[15px] text-fg">Quiet hours</span>
            <span className="block text-[13px] text-muted">Hold instant notifications; the digest covers them.</span>
          </span>
          <Switch
            checked={quiet}
            onChange={(on) => set(on ? { quietStart: 23, quietEnd: 8 } : { quietStart: null, quietEnd: null })}
            label="Quiet hours"
          />
        </div>
        {quiet && (
          <div className="flex items-center gap-2 text-[15px] text-fg">
            <label htmlFor="quiet-start" className="sr-only">
              Quiet from
            </label>
            <select
              id="quiet-start"
              value={v.quietStart!}
              onChange={(e) => set({ quietStart: Number(e.target.value) })}
              className={`${INPUT} h-10 w-24 px-2`}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
            to
            <label htmlFor="quiet-end" className="sr-only">
              Quiet until
            </label>
            <select
              id="quiet-end"
              value={v.quietEnd!}
              onChange={(e) => set({ quietEnd: Number(e.target.value) })}
              className={`${INPUT} h-10 w-24 px-2`}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {save.isError && <p className="px-4 pb-2 text-sm text-danger-fg">Couldn't save — try again.</p>}
    </>
  );
}

function TestButton() {
  const test = useSendTestNotification();
  return (
    <div className="px-4 py-3">
      <Button variant="secondary" className="w-full" disabled={test.isPending} onClick={() => test.mutate()}>
        <Send className="size-4" /> {test.isSuccess ? 'Sent — check your notifications' : 'Send a test'}
      </Button>
    </div>
  );
}
