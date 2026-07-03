import { useCallback, useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { ipc, type AIProviderStatus, type AIStatus } from "../lib/ipc";
import { AIProviderLogo } from "./AIProviderLogo";
import {
  ACTIVE_MODEL_CHANGED_EVENT,
  buildActiveModelSummary,
} from "./active-model-badge";
import "./ActiveModelBadge.css";

interface BadgeState {
  aiStatus: AIStatus | null;
  providers: AIProviderStatus[];
  loading: boolean;
  error: string | null;
}

export function ActiveModelBadge() {
  const [state, setState] = useState<BadgeState>({
    aiStatus: null,
    providers: [],
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const [aiStatus, providers] = await Promise.all([
        ipc.getAIStatus(),
        ipc.listAIProviders(),
      ]);
      setState({
        aiStatus,
        providers,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "AI status unavailable.",
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();

    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }

    window.addEventListener("focus", refresh);
    window.addEventListener(ACTIVE_MODEL_CHANGED_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(ACTIVE_MODEL_CHANGED_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const summary = buildActiveModelSummary({
    aiStatus: state.aiStatus,
    providers: state.providers,
    error: state.error,
  });
  const tooltipId = "active-model-badge-tooltip";

  return (
    <div
      className={`active-model-badge is-${summary.tone}`}
      role="status"
      tabIndex={0}
      aria-live="polite"
      aria-describedby={tooltipId}
      title={summary.tooltipLines.join("\n")}
    >
      <span className="active-model-badge-mark" aria-hidden="true">
        {summary.providerId && !state.error ? (
          <AIProviderLogo providerId={summary.providerId} size="sm" decorative />
        ) : (
          <WarningCircle size={15} weight="bold" />
        )}
      </span>
      <span className="active-model-badge-copy">
        <span className="active-model-badge-provider">
          {state.loading ? "AI" : summary.providerLabel}
        </span>
        <span className="active-model-badge-model">
          {state.loading ? "loading" : summary.visibleModel}
        </span>
      </span>
      <span className="active-model-badge-dot" aria-hidden="true" />
      <span id={tooltipId} className="active-model-badge-tooltip" role="tooltip">
        {summary.tooltipLines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    </div>
  );
}
