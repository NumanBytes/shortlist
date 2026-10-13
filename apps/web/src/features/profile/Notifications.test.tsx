import { DEFAULT_NOTIFICATION_SETTINGS } from '@shortlist/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithProviders } from '../../test/render';
import { Notifications } from './Notifications';

const PUBLIC_KEY = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';

const routes =
  (configured = true) =>
  (url: string) =>
    url.endsWith('/notifications/config')
      ? { configured, publicKey: configured ? PUBLIC_KEY : null }
      : url.endsWith('/notifications/settings')
        ? DEFAULT_NOTIFICATION_SETTINGS
        : url.endsWith('/notifications/devices')
          ? []
          : { id: 'sub1' };

// What a browser with Web Push looks like: permission granted, no subscription yet.
function stubPushBrowser() {
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
  const pushManager = { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => subscription) };
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'granted') });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  return pushManager;
}

describe('Notifications', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('says so when the server has no VAPID keys', async () => {
    mockFetch(undefined, routes(false));
    renderWithProviders(<Notifications />);
    expect(await screen.findByText('Not set up on this server')).toBeInTheDocument();
  });

  it('explains how to get notifications where push is unavailable (iPhone outside the home screen)', async () => {
    mockFetch(undefined, routes());
    renderWithProviders(<Notifications />);
    expect(await screen.findByText(/add Shortlist to your home screen/)).toBeInTheDocument();
  });

  it('turns this device on: asks permission, subscribes with the server key, and registers it', async () => {
    const pushManager = stubPushBrowser();
    const fetchMock = mockFetch(undefined, routes());
    renderWithProviders(<Notifications />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    const [{ applicationServerKey, userVisibleOnly }] = pushManager.subscribe.mock.calls[0] as unknown as [
      { applicationServerKey: Uint8Array; userVisibleOnly: boolean },
    ];
    expect(userVisibleOnly).toBe(true);
    expect(applicationServerKey).toHaveLength(65); // the P-256 public key, decoded
    const post = fetchMock.mock.calls.find(([u]) => u === '/api/v1/notifications/subscriptions')!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p', auth: 'a' },
    });
  });

  it('saves a setting as soon as it changes', async () => {
    const fetchMock = mockFetch(undefined, routes());
    renderWithProviders(<Notifications />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Morning digest' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/v1/notifications/settings' && i?.method === 'PUT');
      expect(JSON.parse(put![1]!.body as string)).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, digest: false });
    });
  });
});
