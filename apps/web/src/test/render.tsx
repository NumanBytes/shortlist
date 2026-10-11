import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '../components/Toast';

// Renders a component inside the providers it needs (React Query + router).
export function renderWithProviders(
  ui: ReactElement,
  { path = '/', route = '/' }: { path?: string; route?: string } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// fetch stub: returns `body` (or `byUrl(url)`) as JSON and records calls.
export function mockFetch(body: unknown = {}, byUrl?: (url: string) => unknown) {
  const fn = vi.fn((url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(byUrl ? byUrl(url) : body), { status: 200 })),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}
