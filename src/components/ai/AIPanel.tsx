import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { ArrowLeft, ArrowsClockwise, X } from "@phosphor-icons/react";
import { useAIPanel } from "../../store/useAIPanel";
import { useNav } from "../../store/useNav";
import { ipc, type AIModelHealth, type AIStatus } from "../../lib/ipc";
import type {
  AIFeature,
  BriefPayload,
  CodeExplainPayload,
  CommitPayload,
  ImpactPayload,
  IssueTriagePayload,
  StashExplainPayload,
  StandupPayload,
  WorktreeComparePayload,
} from "../../lib/ai-features";
import { ImpactAnalysis } from "./ImpactAnalysis";
import { CommitAssistant } from "./CommitAssistant";
import { RepoBrief } from "./RepoBrief";
import { WorktreeCompare } from "./WorktreeCompare";
import { IssueTriage } from "./IssueTriage";
import { DailyStandup } from "./DailyStandup";
import { StashExplain } from "./StashExplain";
import { CodeExplain } from "./CodeExplain";
import "./AIPanel.css";

const FEATURE_LABELS: Record<AIFeature, string> = {
  impact: "Impact analysis",
  commit: "Commit assistant",
  brief: "Repo brief",
  code: "File explanation",
  worktree: "Worktree compare",
  issue_triage: "Issue triage",
  standup: "Daily standup",
  stash: "Stash explanation",
};

interface FeatureErrorBoundaryProps {
  children: ReactNode;
  feature: AIFeature | null;
}

interface FeatureErrorBoundaryState {
  error: Error | null;
}

class FeatureErrorBoundary extends Component<
  FeatureErrorBoundaryProps,
  FeatureErrorBoundaryState
> {
  state: FeatureErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): FeatureErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[overcode-ai-feature-error]", error, info.componentStack);
  }

  componentDidUpdate(prevProps: FeatureErrorBoundaryProps) {
    if (prevProps.feature !== this.props.feature && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    const { feature } = this.props;
    if (!error) return this.props.children;
    return (
      <div className="ai-feature-error">
        <p>
          Failed to render {feature ? FEATURE_LABELS[feature] : "AI feature"}
        </p>
        <p className="ai-feature-error-detail">{error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

export function AIPanel() {
  const { isOpen, feature, payload, open, close } = useAIPanel();

  // Esc closes the modal. The backdrop also dismisses on click.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const featureLabel = feature ? FEATURE_LABELS[feature] : "OpenRouter AI";
  const goHome = useCallback(() => {
    // Returning to home view without closing the panel: clear feature + payload.
    useAIPanel.setState({ feature: null, payload: null });
  }, []);

  return (
    <>
      <div
        className={`ai-panel-backdrop${isOpen ? " is-open" : ""}`}
        aria-hidden="true"
        onClick={close}
      />
      <aside
        className={`ai-panel${isOpen ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="AI assistant"
        aria-hidden={!isOpen}
      >
        <header className="ai-panel-header">
          {feature ? (
            <button
              type="button"
              className="ai-panel-iconbtn"
              onClick={goHome}
              title="Back to AI home"
              aria-label="Back to AI home"
            >
              <ArrowLeft size={14} />
            </button>
          ) : (
            <span className="ai-panel-brand">AI</span>
          )}
          <span className="ai-panel-feature">{featureLabel}</span>
          <div className="ai-panel-spacer" />
          <button
            type="button"
            className="ai-panel-iconbtn"
            onClick={close}
            title="Close AI panel"
            aria-label="Close AI panel"
          >
            <X size={14} />
          </button>
        </header>
        <div className="ai-panel-body">
          <FeatureErrorBoundary feature={feature}>
            {!feature && (
              <AIHome
                onPickFeature={(next) => {
                  // For features that need a payload, we still allow the home view
                  // to delegate to existing entry points elsewhere. The shortcuts
                  // here open the feature with no payload so the feature component
                  // can render its own picker / empty state.
                  open(next);
                }}
              />
            )}
            {feature === "impact" && (
              <ImpactAnalysis
                payload={payload as ImpactPayload | null}
              />
            )}
            {feature === "commit" && (
              <CommitAssistant
                payload={payload as CommitPayload | null}
              />
            )}
            {feature === "brief" && (
              <RepoBrief
                payload={payload as BriefPayload | null}
              />
            )}
            {feature === "code" && (
              <CodeExplain
                payload={payload as CodeExplainPayload | null}
              />
            )}
            {feature === "worktree" && (
              <WorktreeCompare
                payload={payload as WorktreeComparePayload | null}
              />
            )}
            {feature === "issue_triage" && (
              <IssueTriage
                payload={payload as IssueTriagePayload | null}
              />
            )}
            {feature === "standup" && (
              <DailyStandup
                payload={payload as StandupPayload | null}
              />
            )}
            {feature === "stash" && (
              <StashExplain
                payload={payload as StashExplainPayload | null}
              />
            )}
          </FeatureErrorBoundary>
        </div>
      </aside>
    </>
  );
}

interface AIHomeProps {
  onPickFeature: (feature: AIFeature) => void;
}

function latencyBadgeClass(ms: number): string {
  if (ms < 200) return "is-fast";
  if (ms < 800) return "is-medium";
  return "is-slow";
}

interface ShortcutDef {
  feature: AIFeature;
  label: string;
}

const SHORTCUTS: ShortcutDef[] = [
  { feature: "impact", label: "Analyze impact" },
  { feature: "commit", label: "Draft commit" },
  { feature: "brief", label: "Repo brief" },
  { feature: "issue_triage", label: "Triage issue" },
  { feature: "worktree", label: "Worktree compare" },
  { feature: "standup", label: "Daily standup" },
];

function AIHome({ onPickFeature }: AIHomeProps) {
  const navigate = useNav((s) => s.navigate);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const ai = await ipc.getAIStatus().catch(() => null);
      setStatus(ai);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const activeHealth: AIModelHealth | undefined = status?.health.find(
    (entry) => entry.model === status.model,
  );
  const healthStatus = !status
    ? "unknown"
    : !status.configured
      ? "not_configured"
      : (activeHealth?.status ?? "unknown");

  return (
    <div className="ai-home">
      <section className="ai-home-status" aria-live="polite">
        <div className="ai-home-status-row">
          <span
            className={`ai-health-dot ${healthDotClass(healthStatus)}`}
            aria-hidden="true"
          />
          <code className="ai-home-model">
            {status?.model ?? "openrouter/free"}
          </code>
          <span className={`ai-status-pill ${healthDotClass(healthStatus)}`}>
            {healthLabel(healthStatus)}
          </span>
          {typeof activeHealth?.latencyMs === "number" && (
            <span
              className={`ai-status-latency ${latencyBadgeClass(activeHealth.latencyMs)}`}
              title={`Last probe round-trip: ${Math.round(activeHealth.latencyMs)}ms`}
            >
              {Math.round(activeHealth.latencyMs)}ms
            </span>
          )}
          <button
            type="button"
            className="ai-panel-iconbtn ai-home-refresh"
            onClick={() => void loadStatus()}
            disabled={refreshing}
            title="Re-check OpenRouter status"
            aria-label="Re-check OpenRouter status"
          >
            <ArrowsClockwise
              size={12}
              className={refreshing ? "motion-spin" : undefined}
            />
          </button>
        </div>
      </section>

      {status && !status.configured && (
        <button
          type="button"
          className="ai-home-banner"
          onClick={() => navigate("settings")}
        >
          <span>OpenRouter not configured — open Settings</span>
          <span aria-hidden="true">→</span>
        </button>
      )}

      <nav className="ai-home-shortcuts" aria-label="AI features">
        {SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.feature}
            type="button"
            className="ai-shortcut"
            onClick={() => onPickFeature(shortcut.feature)}
          >
            <span>{shortcut.label}</span>
            <span aria-hidden="true" className="ai-shortcut-arrow">
              →
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function healthLabel(
  status: "available" | "unavailable" | "not_configured" | "unknown",
): string {
  switch (status) {
    case "available":
      return "Available";
    case "unavailable":
      return "Unavailable";
    case "not_configured":
      return "Not configured";
    case "unknown":
    default:
      return "Unknown";
  }
}

function healthDotClass(
  status: "available" | "unavailable" | "not_configured" | "unknown",
): string {
  switch (status) {
    case "available":
      return "is-available";
    case "unavailable":
      return "is-unavailable";
    case "not_configured":
      return "is-not-configured";
    case "unknown":
    default:
      return "is-unknown";
  }
}
