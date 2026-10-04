import { getTheme, setTheme } from './theme';

describe('theme choice', () => {
  afterEach(() => setTheme('system'));

  it('forces Dark or Light on <html> and remembers it on this device', () => {
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(getTheme()).toBe('dark');
    setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('System removes the override and follows the phone again', () => {
    setTheme('dark');
    setTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(getTheme()).toBe('system');
  });
});
