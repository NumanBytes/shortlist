import { useQueryClient } from '@tanstack/react-query';
import type { LoginInput, RegisterInput } from '@shortlist/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from '../lib/api';
import type { AuthResponse, PublicUser } from '../lib/types';

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: PublicUser };

interface AuthContextValue {
  state: AuthState;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const signOutLocally = useCallback(() => {
    setAccessToken(null);
    queryClient.clear(); // drop the previous user's cached data
    setState({ status: 'signedOut' });
  }, [queryClient]);

  // On load there's no access token (it only lives in memory), so try to restore the
  // session from the httpOnly refresh cookie. refreshSession() is single-flight, so
  // StrictMode's double-mount in development doesn't fire two rotating refreshes.
  useEffect(() => {
    setSessionExpiredHandler(signOutLocally);
    let cancelled = false;
    void refreshSession().then((session) => {
      if (cancelled) return;
      setState(session ? { status: 'signedIn', user: session.user } : { status: 'signedOut' });
    });
    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, [signOutLocally]);

  const start = useCallback((session: AuthResponse) => {
    setAccessToken(session.accessToken);
    setState({ status: 'signedIn', user: session.user });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login: async (input) => start(await api<AuthResponse>('/auth/login', { method: 'POST', body: input })),
      register: async (input) => start(await api<AuthResponse>('/auth/register', { method: 'POST', body: input })),
      logout: async () => {
        // Revoke server-side first; sign out locally even if the request fails.
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        signOutLocally();
      },
    }),
    [state, start, signOutLocally],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
