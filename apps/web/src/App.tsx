import { Navigate, Outlet, Route, Routes } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { AuthForm } from './pages/AuthForm';
import { ReviewPage } from './pages/ReviewPage';

// Signed-in pages. While the session is being restored from the refresh cookie we
// don't know yet, so render nothing rather than flashing the login page.
function RequireAuth() {
  const { state } = useAuth();
  if (state.status === 'loading') return <FullPageMessage>Loading…</FullPageMessage>;
  if (state.status === 'signedOut') return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RedirectIfSignedIn() {
  const { state } = useAuth();
  if (state.status === 'loading') return <FullPageMessage>Loading…</FullPageMessage>;
  if (state.status === 'signedIn') return <Navigate to="/" replace />;
  return <Outlet />;
}

function FullPageMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center text-slate-500">{children}</div>;
}

export function App() {
  return (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route index element={<ReviewPage />} />
      </Route>
      <Route element={<RedirectIfSignedIn />}>
        <Route path="login" element={<AuthForm mode="login" />} />
        <Route path="register" element={<AuthForm mode="register" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
