"use client";

import { Component, type ReactNode } from "react";

/**
 * One section that fails to render shows that it failed, with the reason, and
 * the rest of the page keeps working (review APP-7). Rule 0: a broken section is
 * marked unavailable, never left blank or filled with a guess.
 */
export class SectionBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="rounded-[2px] border border-amber/40 p-5" data-live="unavailable">
        <p className="num text-[10.5px] uppercase tracking-[0.16em] text-amber">{this.props.name} — unavailable</p>
        <p className="mt-2 text-sm text-dim">This section could not be shown: {error.message || "render failed"}.</p>
        <button
          type="button"
          className="num mt-3 min-h-11 text-[11px] uppercase tracking-[0.18em] text-hull"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
