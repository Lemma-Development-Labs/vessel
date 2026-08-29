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
        <p className="text-[11px] uppercase tracking-[0.28em] text-[#e3b341]">Vessel</p>
        <h1 className="mt-4 text-2xl font-semibold">Something broke in the deck</h1>
        <p className="mt-3 text-sm text-[#8a8880]">
          The UI crashed. Your on-chain position is unchanged. Reload, or switch to mock
          stage with NEXT_PUBLIC_USE_MOCK=1.
        </p>
        <pre className="num mt-6 overflow-auto border border-[#242822] bg-[#121412] p-3 text-left text-xs text-[#e25d5d]">
          {this.state.err.message}
        </pre>
        <button
          type="button"
          className="mt-6 border border-[#c4a36a] px-4 py-2 text-sm text-[#c4a36a]"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
