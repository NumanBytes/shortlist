import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BillingInfo } from '../../lib/types';
import { renderWithProviders } from '../../test/render';
import { logout } from '../../test/signed-in';
import { YourData } from './YourData';

vi.mock('../auth/AuthProvider', () => import('../../test/signed-in'));

const noBilling: BillingInfo = { enabled: false, client: null, plan: 'FREE', subscription: null };
const proBilling: BillingInfo = {
  enabled: true,
  client: { environment: 'sandbox', token: 'test_x' },
  plan: 'PRO',
  subscription: { plan: 'PRO', status: 'ACTIVE', currentPeriodEndsAt: null, cancelsAt: null },
};

function setup(billing: BillingInfo = noBilling, deleteResponse?: () => Response) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/account') && init?.method === 'DELETE') {
      return Promise.resolve(deleteResponse ? deleteResponse() : new Response(null, { status: 204 }));
    }
    const body = url.endsWith('/billing') ? billing : url.endsWith('/account/export') ? { account: { id: 'u1' } } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('YourData', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    logout.mockClear();
  });

  it('downloads the export as a file', async () => {
    const fetchMock = setup();
    const createObjectURL = vi.fn(() => 'blob:export');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderWithProviders(<YourData />);
    await userEvent.click(screen.getByRole('button', { name: /Download my data/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/account/export'))).toBe(true);
    expect(createObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });

  it('deletes the account with the password, then signs out', async () => {
    const fetchMock = setup();
    renderWithProviders(<YourData />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByText('Enter your password')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Your password/), 'my password');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url, i]) => String(url).endsWith('/account') && i?.method === 'DELETE');
    expect(JSON.parse(call![1]!.body as string)).toEqual({ password: 'my password' });
  });

  it('shows a wrong password on the field and stays signed in', async () => {
    setup(
      noBilling,
      () =>
        new Response(
          JSON.stringify({
            message: 'That password is not right',
            errors: [{ path: 'password', message: 'That password is not right' }],
          }),
          { status: 400 },
        ),
    );
    renderWithProviders(<YourData />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await userEvent.type(screen.getByLabelText(/Your password/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('That password is not right')).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it('warns that a paid subscription is cancelled with the account', async () => {
    setup(proBilling);
    renderWithProviders(<YourData />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText(/Your Pro subscription is cancelled now/)).toBeInTheDocument();
  });
});
