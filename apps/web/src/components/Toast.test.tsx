import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { ToastProvider, useToast } from './Toast';

function Shows({ action }: { action?: boolean }) {
  const toast = useToast();
  useEffect(() => {
    toast({ text: 'Moved to Skipped', action: action ? { label: 'Undo', onClick: () => undefined } : undefined });
  }, [toast, action]);
  return null;
}

// UI audit G6 (WCAG 2.2.1): long enough to reach Undo, and still while it's held.
describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The drop-out timer (200 ms) is scheduled only after the re-render that starts it.
  const advance = (ms: number) => {
    act(() => void vi.advanceTimersByTime(ms));
    act(() => void vi.advanceTimersByTime(300));
  };

  it('stays 8 s when it has an action, 5 s otherwise', () => {
    const { unmount } = render(
      <ToastProvider>
        <Shows />
      </ToastProvider>,
    );
    advance(5000);
    expect(screen.queryByText('Moved to Skipped')).not.toBeInTheDocument();
    unmount();

    render(
      <ToastProvider>
        <Shows action />
      </ToastProvider>,
    );
    advance(5000);
    expect(screen.getByText('Moved to Skipped')).toBeInTheDocument();
    advance(2700);
    expect(screen.queryByText('Moved to Skipped')).not.toBeInTheDocument();
  });

  it('holds while the pointer is on it and restarts when let go', () => {
    render(
      <ToastProvider>
        <Shows action />
      </ToastProvider>,
    );
    fireEvent.pointerEnter(screen.getByText('Moved to Skipped').closest('output')!);
    advance(20_000);
    expect(screen.getByText('Moved to Skipped')).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByText('Moved to Skipped').closest('output')!);
    advance(8000);
    expect(screen.queryByText('Moved to Skipped')).not.toBeInTheDocument();
  });
});
