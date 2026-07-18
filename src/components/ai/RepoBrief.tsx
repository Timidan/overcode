import { useState, useEffect } from "react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  getRepoBriefStructured,
  type BriefPayload,
} from "../../lib/ai-features";
import type { AIEnvelope, RepoBriefData } from "../../lib/ai-structured";
import { cogneeRepositoryMemory } from "../../lib/cognee-repository-memory";
import { RepoBriefResult } from "./AIResultViews";
import "./RepoBrief.css";

interface Props {
  payload?: BriefPayload | null;
}

export function RepoBrief({ payload: explicitPayload }: Props) {
  const { payload: storePayload } = useAIPanel();
  const payload = explicitPayload ?? storePayload;
  const [isLoading, setIsLoading] = useState(false);
  const [content, setContent] =
    useState<AIEnvelope<RepoBriefData> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function generate() {
      const data = payload as BriefPayload;
      if (!data?.repoId) return;

      setIsLoading(true);
      setError(null);
      setContent(null);

      try {
        const memory = await cogneeRepositoryMemory.recall({
          source: "repo brief",
          repoId: data.repoId,
          repoName: data.repoName,
          branch: data.branch,
          paths: [...(data.changedFiles ?? []), ...(data.tree ?? [])].slice(0, 16),
          tags: ["onboarding", "repo"],
        });
        const result = await getRepoBriefStructured(
          memory?.context ? { ...data, memoryContext: memory.context } : data,
        );
        setContent(result);
        void cogneeRepositoryMemory.remember({
          source: "repo brief",
          repoId: data.repoId,
          repoName: data.repoName,
          branch: data.branch,
          paths: result.data.keyModules.map((module) => module.path).filter(Boolean),
          title: `Repo brief for ${data.repoName ?? data.repoId}`,
          summary: [
            result.summary,
            result.data.purpose,
            result.data.notableRisks.length
              ? `Risks: ${result.data.notableRisks.slice(0, 4).join(" | ")}`
              : "",
          ].filter(Boolean).join(" "),
          tags: ["repo", "onboarding"],
          data: {
            key_module_count: result.data.keyModules.length,
            risk_count: result.data.notableRisks.length,
            confidence: result.confidence,
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate brief");
      } finally {
        setIsLoading(false);
      }
    }

    generate();
  }, [payload]);

  return (
    <div className="repo-brief">
      {isLoading && (
        <div className="brief-loading">
          <span className="brief-dot" style={{ animationDelay: "0ms" }} />
          <span className="brief-dot" style={{ animationDelay: "150ms" }} />
          <span className="brief-dot" style={{ animationDelay: "300ms" }} />
        </div>
      )}
      {error && <div className="brief-error">{error}</div>}
      {content && (
        <RepoBriefResult result={content} />
      )}
    </div>
  );
}
