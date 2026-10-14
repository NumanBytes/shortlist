import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/render';
import { InstallPrompt } from './InstallPrompt';

const fireInstallEvent = (prompt = vi.fn(() => Promise.resolve())) => {
  act(() => {
    window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt }));
  });
  return prompt;
};

describe('InstallPrompt', () => {
  afterEach(() => localStorage.clear());

  // UI audit I1: never on a first look — only after a meaningful moment.
  it('waits until a job has been opened', () => {
    renderWithProviders(<InstallPrompt />);
    fireInstallEvent();
    expect(screen.queryByRole('complementary', { name: 'Install Shortlist' })).not.toBeInTheDocument();
  });

  it("offers the browser's own install as a banner once earned", async () => {
    localStorage.setItem('shortlist-opened-job', '1');
    renderWithProviders(<InstallPrompt />);
    const prompt = fireInstallEvent();
    expect(screen.getByRole('complementary', { name: 'Install Shortlist' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(prompt).toHaveBeenCalled();
  });

  it('"Not now" is remembered on this device', async () => {
    localStorage.setItem('shortlist-opened-job', '1');
    const { unmount } = renderWithProviders(<InstallPrompt />);
    fireInstallEvent();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    unmount();
    renderWithProviders(<InstallPrompt />);
    fireInstallEvent();
    expect(screen.queryByRole('complementary', { name: 'Install Shortlist' })).not.toBeInTheDocument();
  });

  it('stays out of onboarding and pushed screens', () => {
    localStorage.setItem('shortlist-opened-job', '1');
    renderWithProviders(<InstallPrompt show={false} />);
    fireInstallEvent();
    expect(screen.queryByRole('complementary', { name: 'Install Shortlist' })).not.toBeInTheDocument();
  });
});
