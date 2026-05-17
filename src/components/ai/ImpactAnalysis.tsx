import { useState, useEffect } from "react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  analyzeImpactStructured,
  type ImpactPayload,
} from "../../lib/ai-features";
import type { GraniteEnvelope, ImpactData } from "../../lib/ai-structured";
import { ImpactResult } from "./AIResultViews";
import "./ImpactAnalysis.css";

interface Props {
  payload?: ImpactPayload | null;
}

export function ImpactAnalysis({ payload: explicitPayload }: Props) {
  const { payload: storePayload } = useAIPanel();
  const payload = explicitPayload ?? storePayload;
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] =
    useState<GraniteEnvelope<ImpactData> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function analyze() {
      const data = payload as ImpactPayload;
      if (!data || (!data.diff && !data.unavailableReason)) return;

      setIsLoading(true);
      setError(null);
      setResponse(null);

      try {
        const result = await analyzeImpactStructured(data);
        setResponse(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Analysis failed");
      } finally {
        setIsLoading(false);
      }
    }

    analyze();
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
      {response && <ImpactResult result={response} />}
    </div>
  );
}
