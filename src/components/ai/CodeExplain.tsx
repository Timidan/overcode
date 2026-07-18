import { useEffect, useState } from "react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  explainCodeSelectionStructured,
  type CodeExplainPayload,
} from "../../lib/ai-features";
import type { CodeExplanationData, AIEnvelope } from "../../lib/ai-structured";
import { cogneeRepositoryMemory } from "../../lib/cognee-repository-memory";
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
        const path = extractSubjectPath(data.subject);
        const memory = await cogneeRepositoryMemory.recall({
          source: "code inspector",
          repoId: data.repoId,
          repoName: data.repoName,
          branch: data.branch,
          paths: path ? [path] : undefined,
          subject: data.subject,
          tags: ["code", data.kind],
        });
        const result = await explainCodeSelectionStructured(
          memory?.context ? { ...data, memoryContext: memory.context } : data,
        );
        setResponse(result);
        void cogneeRepositoryMemory.remember({
          source: "code inspector",
          repoId: data.repoId,
          repoName: data.repoName,
          branch: data.branch,
          paths: path ? [path] : undefined,
          subject: data.subject,
          title: `Code explanation for ${data.subject}`,
          summary: [
            result.summary,
            result.data.purpose,
            result.data.keyPoints.slice(0, 4).join(" | "),
          ].filter(Boolean).join(" "),
          tags: ["code", data.kind],
          data: {
            risk_count: result.data.risks.length,
            check_count: result.data.suggestedChecks.length,
            confidence: result.confidence,
          },
        });
        if (result.data.suggestedChecks.length > 0) {
          void cogneeRepositoryMemory.remember({
            source: "testing memory",
            repoId: data.repoId,
            repoName: data.repoName,
            branch: data.branch,
            paths: path ? [path] : undefined,
            subject: data.subject,
            title: `Testing memory for ${data.subject}`,
            summary: [
              `Suggested checks from code inspection for ${data.subject}.`,
              result.data.suggestedChecks.slice(0, 6).join(" | "),
            ].filter(Boolean).join(" "),
            tags: ["testing", "code", data.kind],
            data: {
              check_count: result.data.suggestedChecks.length,
              confidence: result.confidence,
            },
          });
        }
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

function extractSubjectPath(subject: string): string | undefined {
  const match = subject.match(/(?:added|modified|deleted|renamed|changed)?\s*([^\s]+\.[^\s]+)/i);
  return match?.[1];
}
