import { fireEvent, render, screen } from '@testing-library/react';
import { useEdgeSwipeBack } from './useEdgeSwipeBack';

function Screen({ onBack }: { onBack: () => void }) {
  const edge = useEdgeSwipeBack(onBack);
  return (
    <div data-testid="screen" {...edge.handlers} style={edge.style}>
      content
    </div>
  );
}
const standalone = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('standalone'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
const drag = (el: HTMLElement, fromX: number, toX: number) => {
  Object.defineProperty(el, 'offsetWidth', { value: 400, configurable: true });
  fireEvent.pointerDown(el, { button: 0, clientX: fromX, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: fromX + 20, clientY: 301, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: toX, clientY: 302, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: toX, clientY: 302, pointerId: 1 });
};

describe('edge swipe back (installed app)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('goes back when a drag from the left edge passes 40% of the width', async () => {
    standalone(true);
    const onBack = vi.fn();
    render(<Screen onBack={onBack} />);
    drag(screen.getByTestId('screen'), 5, 220); // 54%
    await new Promise((r) => setTimeout(r, 250));
    expect(onBack).toHaveBeenCalled();
  });

  it('springs back when the drag is short, or does not start at the edge', async () => {
    standalone(true);
    const onBack = vi.fn();
    render(<Screen onBack={onBack} />);
    drag(screen.getByTestId('screen'), 5, 50); // 11% — short, even if fast
    drag(screen.getByTestId('screen'), 150, 390); // starts mid-screen
    await new Promise((r) => setTimeout(r, 250));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('is off in a browser tab, which has its own edge swipe', async () => {
    standalone(false);
    const onBack = vi.fn();
    render(<Screen onBack={onBack} />);
    drag(screen.getByTestId('screen'), 5, 300);
    await new Promise((r) => setTimeout(r, 250));
    expect(onBack).not.toHaveBeenCalled();
  });
});
