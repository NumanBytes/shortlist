import { useEffect } from 'react';
import { api } from '../api';

// Opening the app is reading the news: clear the app icon's badge (set by the service worker
// from a push) and mark the notifications read, so the next push counts from zero.
export function useClearNotificationBadge() {
  useEffect(() => {
    if ('clearAppBadge' in navigator) void navigator.clearAppBadge().catch(() => undefined);
    void api('/notifications/read-all', { method: 'POST' }).catch(() => undefined);
  }, []);
}
