import { render } from '@testing-library/react';
import { bottomAbove, useBottomInset } from './useBottomInset';

function Layer({ fixed }: { fixed: boolean }) {
  const ref = useBottomInset('pill');
  return <div ref={ref} style={{ position: fixed ? 'fixed' : 'static' }} />;
}

describe('useBottomInset', () => {
  const prop = () => document.documentElement.style.getPropertyValue('--bottom-pill');

  it('publishes a fixed layer as a CSS variable and removes it on unmount', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
    const { unmount } = render(<Layer fixed />);
    expect(prop()).toBe('52px'); // its height plus the gap to the layer above
    unmount();
    expect(prop()).toBe('');
    height.mockRestore();
  });

  it('counts a layer in the page flow (wide screens) as taking no room', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
    render(<Layer fixed={false} />);
    expect(prop()).toBe('0px');
    height.mockRestore();
  });

  it('stacks above the bar, clearing the home indicator when there is none', () => {
    expect(bottomAbove('pill', 'toast')).toBe(
      'calc(max(var(--bottom-bar, 0px), env(safe-area-inset-bottom)) + 12px + var(--bottom-pill, 0px) + var(--bottom-toast, 0px))',
    );
  });
});
