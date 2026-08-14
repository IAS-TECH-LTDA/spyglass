import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Wraps the whole app. Every envelope payload rendered anywhere in the tree
 * ultimately traces back to an unauthenticated LAN WebSocket frame — a single
 * malformed one (bad shape, unexpected type) throwing during render would
 * otherwise unmount React's entire root (React 18 default behavior) and
 * leave a blank window with no way back short of restarting the app. This
 * catches that and offers a reload instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Spyglass] render crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-body">
            <h2>{t("errorBoundary.title")}</h2>
            <p className="empty-hint">{t("errorBoundary.body")}</p>
            <pre className="error-boundary-message">{this.state.error.message}</pre>
            <button type="button" className="btn-accent" onClick={() => window.location.reload()}>
              {t("errorBoundary.reload")}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
