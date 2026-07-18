import { useEffect, useState } from "react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  explainStashStructured,
  type StashExplainPayload,
} from "../../lib/ai-features";
import type { AIEnvelope, StashExplainData } from "../../lib/ai-structured";
import { cogneeRepositoryMemory } from "../../lib/cognee-repository-memory";
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
    useState<AIEnvelope<StashExplainData> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function explain() {
      const data = payload as StashExplainPayload;
      if (!data || (!data.ref && !data.unavailableReason)) return;

      setIsLoading(true);
      setError(null);
      setResponse(null);

      try {
        const memory = await cogneeRepositoryMemory.recall({
          source: "stash explanation",
          repoId: data.repoId,
          repoName: data.repoName ?? data.repoPath,
          branch: data.branch,
          paths: data.files,
          stashRef: data.ref,
          subject: data.message,
          tags: ["stash", "wip"],
        });
        const result = await explainStashStructured(
          memory?.context ? { ...data, memoryContext: memory.context } : data,
        );
        setResponse(result);
        void cogneeRepositoryMemory.remember({
          source: "stash explanation",
          repoId: data.repoId,
          repoName: data.repoName ?? data.repoPath,
          branch: data.branch,
          paths: result.data.files,
          stashRef: data.ref,
          subject: data.message,
          title: `Stash memory for ${data.repoName ?? data.repoId} ${data.ref}`,
          summary: [
            result.summary,
            result.data.intent,
            result.data.suggestedActions.slice(0, 4).join(" | "),
          ].filter(Boolean).join(" "),
          tags: ["stash", "wip"],
          data: {
            label: result.data.label,
            risk_count: result.data.risks.length,
            file_count: result.data.files.length,
            confidence: result.confidence,
          },
        });
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
