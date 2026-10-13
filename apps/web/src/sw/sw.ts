/// <reference lib="webworker" />
// The service worker (docs/web-design.md, docs/notifications.md §19.5). Two jobs:
// 1. Offline app shell — precache the built app only. /api is never cached or served from
//    here: it's private, per-user data (a different user could see it).
// 2. Web Push — show what the worker sent (it arrives encrypted; the browser decrypts it before
//    this sees it) and open the right screen when it's tapped.
import { createHandlerBoundToURL, precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import type { PushPayload } from '@shortlist/shared';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }));

// registerType "autoUpdate": a new version takes over at once.
void self.skipWaiting();
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data: PushPayload;
  try {
    data = event.data?.json() as PushPayload;
  } catch {
    return;
  }
  if (!data?.title) return;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        icon: '/pwa-192.png',
        badge: '/pwa-192.png',
        data: { url: data.url },
      }),
      // The app icon's count; the app clears it when opened.
      data.unread && 'setAppBadge' in navigator ? navigator.setAppBadge(data.unread).catch(() => undefined) : undefined,
    ]),
  );
});

// Tapping opens the screen the notification is about — in an open window if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | null)?.url ?? '/', self.location.origin);
  if (url.origin !== self.location.origin) return; // only ever this app's own screens
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === url.origin);
      if (open) {
        await open.focus();
        return open.navigate(url.href);
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
