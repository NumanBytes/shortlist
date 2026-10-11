import { TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState, buttonStyles } from '../components/ui';

type Props = { children: ReactNode; resetKey?: string };
type State = { error: Error | null; resetKey?: string };

// A component that throws while rendering unmounts the whole React tree: an installed app
// would show a blank screen with no way back. This catches the error and offers a way out
// (docs/web-design.md §8.4.4). Error boundaries must still be class components in React.
// `resetKey` clears the error when it changes — the shell passes the path, so leaving the
// broken screen through the navigation brings the app back without a reload.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  // Derived before render, so the recovered screen renders once (not error, then again).
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center">
        <EmptyState icon={<TriangleAlert className="size-7" aria-hidden />} title="Something went wrong">
          This screen hit an error. Reloading usually fixes it — often it's a new version of the app.
        </EmptyState>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          {/* A full page load, so it works even if the router itself is what broke. */}
          <a href="/" className={buttonStyles('secondary')}>
            Go to Jobs
          </a>
        </div>
      </div>
    );
  }
}
