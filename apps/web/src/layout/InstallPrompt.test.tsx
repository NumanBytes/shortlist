import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';
import { InstallPrompt } from './InstallPrompt';

describe('InstallPrompt', () => {
  afterEach(() => localStorage.clear());

  it("offers the browser's own install when it fires beforeinstallprompt", async () => {
    renderWithProviders(<InstallPrompt />);
    const prompt = vi.fn(() => Promise.resolve());
    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt }));
    });
    expect(screen.getByRole('dialog', { name: 'Add Shortlist to your Home Screen' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(prompt).toHaveBeenCalled();
  });

  it('"Not now" is remembered on this device', async () => {
    const { unmount } = renderWithProviders(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn() }));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    unmount();
    renderWithProviders(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn() }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
