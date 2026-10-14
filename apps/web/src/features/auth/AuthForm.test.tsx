import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render';
import { AuthForm } from './AuthForm';

const login = vi.fn(() => Promise.resolve());
vi.mock('./AuthProvider', () => ({ useAuth: () => ({ login, register: vi.fn() }) }));

describe('AuthForm', () => {
  it('switches between Sign in and Register, and can show the password', async () => {
    renderWithProviders(<AuthForm mode="login" />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/register');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
  });

  // UI audit A2: the password rule shows before a failed submit, tied to the field.
  it('states the password rule up front when registering', () => {
    renderWithProviders(<AuthForm mode="register" />);
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('At least 8 characters.');
  });

  it('checks the fields with the shared schema before sending anything', async () => {
    renderWithProviders(<AuthForm mode="login" />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).not.toHaveBeenCalled();
    expect(screen.getAllByText(/./, { selector: '.text-danger-fg' }).length).toBeGreaterThan(0);
  });
});
