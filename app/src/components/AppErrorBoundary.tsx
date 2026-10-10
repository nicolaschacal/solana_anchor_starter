import { Component, type ReactNode } from "react";

const RELOADED = "rebyters-chunk-reload";

/** Reloads once (a new deploy leaves old chunk names behind); otherwise shows what went wrong instead of a blank screen. */
export function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED)) return false;
    sessionStorage.setItem(RELOADED, String(Date.now()));
  } catch { /* storage unavailable: still try once */ }
  location.reload();
  return true;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error("reByters crashed", error);
    if (/dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|Unexpected token '<'/i.test(String(error?.message))) reloadOnce();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ position: "fixed", inset: 0, display: "grid", placeContent: "center", gap: 14, padding: 24, textAlign: "center", background: "#0a1220", color: "#fff7e6", font: "600 16px system-ui,sans-serif" }}>
        <div>Something went wrong loading reByters.</div>
        <small style={{ opacity: .7, fontWeight: 500, maxWidth: 320, wordBreak: "break-word" }}>{this.state.error.message}</small>
        <button style={{ justifySelf: "center", padding: "12px 28px", border: 0, borderRadius: 999, background: "#b63a2b", color: "#fff", font: "700 16px system-ui", cursor: "pointer" }}
          onClick={() => { try { sessionStorage.removeItem(RELOADED); } catch { /* ignore */ } location.reload(); }}>Reload</button>
      </div>
    );
  }
}
