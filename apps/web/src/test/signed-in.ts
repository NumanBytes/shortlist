// A stand-in for AuthProvider's useAuth: a signed-in user. For tests of pages that show the
// account button (PageHeader) without the real auth flow:
//   vi.mock('../auth/AuthProvider', () => import('../test/signed-in'));
export const logout = vi.fn();
export const useAuth = () => ({
  state: { status: 'signedIn', user: { id: 'u1', name: 'Numan Razzaq', email: 'numan@example.com' } },
  logout,
});
