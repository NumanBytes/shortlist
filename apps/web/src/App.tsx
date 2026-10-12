import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthForm } from './features/auth/AuthForm';
import { useAuth } from './features/auth/AuthProvider';
import { ReviewPage } from './features/evidence/ReviewPage';
import { JobsLayout, NoJobSelected } from './features/jobs/JobsPage';
import { JobDetailPage } from './features/jobs/job-detail/JobDetailPage';
import { WelcomePage } from './features/onboarding/WelcomePage';
import { ProfilePage } from './features/profile/ProfilePage';
import { ResumePage } from './features/resume/ResumePage';
import { SourcesPage } from './features/sources/SourcesPage';
import { AppShell } from './layout/AppShell';
import { useOnboarding } from './lib/queries';

// Signed-in pages. While the session is being restored from the refresh cookie we
// don't know yet, so render nothing rather than flashing the login page.
function RequireAuth() {
  const { state } = useAuth();
  if (state.status === 'loading') return <FullPageMessage>Loading…</FullPageMessage>;
  if (state.status === 'signedOut') return <Navigate to="/login" replace />;
  return <Outlet />;
}

// A brand-new account (nothing saved yet) starts at /welcome, once (docs/discovery.md §9.13).
function OnboardingGate() {
  const onboarding = useOnboarding();
  const { pathname } = useLocation();
  if (onboarding.data?.needed && pathname !== '/welcome') return <Navigate to="/welcome" replace />;
  return <Outlet />;
}

function RedirectIfSignedIn() {
  const { state } = useAuth();
  if (state.status === 'loading') return <FullPageMessage>Loading…</FullPageMessage>;
  if (state.status === 'signedIn') return <Navigate to="/" replace />;
  return <Outlet />;
}

function FullPageMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center text-muted">{children}</div>;
}

export function App() {
  return (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route element={<OnboardingGate />}>
          <Route element={<AppShell />}>
            <Route element={<JobsLayout />}>
              <Route index element={<NoJobSelected />} />
              <Route path="jobs/:jobId" element={<JobDetailPage />} />
            </Route>
            <Route path="jobs/:jobId/resume" element={<ResumePage />} />
            <Route path="evidence" element={<ReviewPage />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="welcome" element={<WelcomePage />} />
          </Route>
        </Route>
      </Route>
      <Route element={<RedirectIfSignedIn />}>
        <Route path="login" element={<AuthForm mode="login" />} />
        <Route path="register" element={<AuthForm mode="register" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
