import { useEffect, useState } from "react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  explainStashStructured,
  type StashExplainPayload,
} from "../../lib/ai-features";
import type { GraniteEnvelope, StashExplainData } from "../../lib/ai-structured";
import { StashExplainResult } from "./AIResultViews";
import "./ImpactAnalysis.css";

interface Props {
  payload?: StashExplainPayload | null;
}

export function StashExplain({ payload: explicitPayload }: Props) {
  const { payload: storePayload } = useAIPanel();
  const payload = explicitPayload ?? storePayload;
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] =
    useState<GraniteEnvelope<StashExplainData> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function explain() {
      const data = payload as StashExplainPayload;
      if (!data || (!data.ref && !data.unavailableReason)) return;

      setIsLoading(true);
      setError(null);
      setResponse(null);

      try {
        setResponse(await explainStashStructured(data));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Stash explanation failed");
      } finally {
        setIsLoading(false);
      }
    }

    void explain();
  }, [payload]);

  return (
    <div className="impact-analysis">
      {isLoading && (
        <div className="impact-loading">
          <span className="impact-dot" style={{ animationDelay: "0ms" }} />
          <span className="impact-dot" style={{ animationDelay: "150ms" }} />
          <span className="impact-dot" style={{ animationDelay: "300ms" }} />
        </div>
      )}
      {error && <div className="impact-error">{error}</div>}
      {response && <StashExplainResult result={response} />}
    </div>
  );
}
