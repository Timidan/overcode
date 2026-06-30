import { useEffect, useState } from "react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  explainCodeSelectionStructured,
  type CodeExplainPayload,
} from "../../lib/ai-features";
import type { CodeExplanationData, AIEnvelope } from "../../lib/ai-structured";
import { CodeExplanationResult } from "./AIResultViews";
import "./ImpactAnalysis.css";

interface Props {
  payload?: CodeExplainPayload | null;
}

export function CodeExplain({ payload: explicitPayload }: Props) {
  const { payload: storePayload } = useAIPanel();
  const payload = explicitPayload ?? storePayload;
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] =
    useState<AIEnvelope<CodeExplanationData> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function explain() {
      const data = payload as CodeExplainPayload;
      if (!data || (!data.content && !data.unavailableReason)) return;

      setIsLoading(true);
      setError(null);
      setResponse(null);

      try {
        setResponse(await explainCodeSelectionStructured(data));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Code explanation failed");
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
      {response && <CodeExplanationResult result={response} />}
    </div>
  );
}
