import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Логируем в консоль — в prod можно подключить Sentry/аналог.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="card max-w-md p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold">Что-то пошло не так</h2>
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
          Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу — если повторится, напишите в поддержку.
        </p>
        <details className="mb-4 rounded-lg bg-neutral-50 p-2 text-left text-xs text-neutral-500 dark:bg-neutral-800">
          <summary className="cursor-pointer select-none">Детали</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{error.message}</pre>
        </details>
        <div className="flex justify-center gap-2">
          <button className="btn-secondary" onClick={reset}>
            Попробовать снова
          </button>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </div>
      </div>
    </div>
  );
}
