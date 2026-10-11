import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Broken({ broken }: { broken: boolean }) {
  if (broken) throw new Error('boom');
  return <p>Fine</p>;
}

describe('ErrorBoundary', () => {
  // React logs every caught render error; keep the test output readable.
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('shows a way out instead of a blank screen', () => {
    render(
      <ErrorBoundary>
        <Broken broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Jobs' })).toHaveAttribute('href', '/');
  });

  it('recovers when the reset key changes (the user navigated away)', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/jobs/1">
        <Broken broken />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKey="/sources">
        <Broken broken={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Fine')).toBeInTheDocument();
  });
});
