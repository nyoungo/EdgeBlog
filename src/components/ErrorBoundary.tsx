import { Component, type ErrorInfo, type ReactNode } from 'react';
import { buttonStyles } from './ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence: without this, a throw during render unmounts the whole
 * React tree and the visitor gets a blank white page. Error boundaries only
 * catch render/lifecycle errors (not async ones), which is exactly the failure
 * mode that used to white-screen the site.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] render error', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="container-page flex flex-col items-center py-28 text-center" role="alert">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/10 text-warning">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-fg">页面出错了</h1>
        <p className="mt-2 max-w-md text-sm text-muted">
          这个页面在渲染时遇到问题。你可以重试,或回到首页继续浏览。
        </p>
        <pre className="mt-4 max-w-lg overflow-auto rounded-lg bg-surface-2 p-3 text-left text-xs text-faint">
          {this.state.error.message}
        </pre>
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={this.reset} className={buttonStyles({ variant: 'secondary' })}>
            重试
          </button>
          <a href="/" className={buttonStyles({})}>
            回到首页
          </a>
        </div>
      </div>
    );
  }
}