"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { err: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("Vessel crash", err, info.componentStack);
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <p className="num text-[11px] uppercase tracking-[0.28em] text-ballast">Vessel</p>
        <h1 className="display mt-4 text-3xl">Something broke in the deck</h1>
        <p className="mt-3 text-sm text-dim">
          The UI crashed. Your on-chain position is unchanged. Reload, or switch to mock
          stage with NEXT_PUBLIC_USE_MOCK=1.
        </p>
        <pre className="num mt-6 overflow-auto border border-line bg-bg2 p-3 text-left text-xs text-red">
          {this.state.err.message}
        </pre>
        <button
          type="button"
          className="num mt-6 border border-ink/20 px-5 py-3 text-[12px] uppercase tracking-[0.14em] text-ink hover:border-ink"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
