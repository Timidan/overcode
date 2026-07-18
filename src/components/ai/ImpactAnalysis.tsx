import { useState, useEffect } from "react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  analyzeImpactStructured,
  type ImpactPayload,
} from "../../lib/ai-features";
import type { AIEnvelope, ImpactData } from "../../lib/ai-structured";
import { cogneeRepositoryMemory } from "../../lib/cognee-repository-memory";
import { ImpactResult } from "./AIResultViews";
import "./ImpactAnalysis.css";

interface Props {
  payload?: ImpactPayload | null;
}

const MAX_MEMORY_ITEMS = 4;
const MAX_MEMORY_CONTEXT_CHARS = 3_500;
const MAX_MEMORY_PATHS = 24;
const MAX_REMEMBER_PATHS = 12;

export function ImpactAnalysis({ payload: explicitPayload }: Props) {
  const { payload: storePayload } = useAIPanel();
  const payload = explicitPayload ?? storePayload;
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] =
    useState<AIEnvelope<ImpactData> | null>(null);
  const [memoryUsed, setMemoryUsed] =
    useState<ImpactPayload["memoryUsed"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function analyze() {
      const data = payload as ImpactPayload;
      if (!data || (!data.diff && !data.unavailableReason)) return;

      setIsLoading(true);
      setError(null);
      setResponse(null);
      setMemoryUsed(null);

      try {
        const memory = await recallImpactMemory(data);
        const dataWithMemory: ImpactPayload = memory?.context
          ? {
              ...data,
              memoryContext: memory.context,
              memoryUsed: memory.used,
            }
          : data;
        const result = await analyzeImpactStructured(dataWithMemory);
        if (memory?.used) {
          setMemoryUsed(memory.used);
        }
        setResponse(result);
        void rememberImpactResult(dataWithMemory, result);
        void rememberImpactTestingMemory(dataWithMemory, result);
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
      {response && (
        <ImpactResult result={response} memoryUsed={memoryUsed ?? undefined} />
      )}
    </div>
  );
}

async function recallImpactMemory(payload: ImpactPayload): Promise<{
  context: string;
  used: NonNullable<ImpactPayload["memoryUsed"]>;
} | null> {
  const changedPaths = boundedPaths(payload.fileTree);
  const repo = payload.repoName?.trim() || payload.repoId?.trim() || "current repository";
  const branch = payload.branch?.trim();
  if (!branch && changedPaths.length === 0) {
    return null;
  }

  const recalled = await cogneeRepositoryMemory.recall({
    source: "impact analysis",
    repoId: payload.repoId,
    repoName: repo,
    branch,
    paths: changedPaths,
    tags: ["impact", "analysis"],
    limit: MAX_MEMORY_ITEMS,
  }, { maxContextChars: MAX_MEMORY_CONTEXT_CHARS });
  if (!recalled) return null;

  return {
    context: recalled.context,
    used: {
      summary: recalled.summary,
      graphPath: recalled.items.map((item) => `${repo} -> memory:${item.id}`),
      references: recalled.references.slice(0, MAX_MEMORY_PATHS),
    },
  };
}

async function rememberImpactResult(
  payload: ImpactPayload,
  result: AIEnvelope<ImpactData>,
) {
  if (payload.unavailableReason || !payload.diff?.trim()) {
    return;
  }

  const changedPaths = boundedPaths(payload.fileTree).slice(0, MAX_REMEMBER_PATHS);
  const risks = result.data.risks.slice(0, 4);
  const riskSummary = risks
    .map((risk) => `${risk.severity}: ${risk.area} - ${risk.reason}`)
    .join(" | ");
  const repo = payload.repoName?.trim() || payload.repoId?.trim() || "current repository";
  await cogneeRepositoryMemory.remember({
    source: "impact analysis",
    repoId: payload.repoId,
    repoName: payload.repoName,
    branch: payload.branch,
    paths: changedPaths,
    subject: result.data.intent || repo,
    title: `Impact analysis for ${repo}`,
    summary: [
      result.summary,
      result.data.intent ? `Intent: ${result.data.intent}` : "",
      riskSummary ? `Risks: ${riskSummary}` : "",
      result.data.recommendation ? `Recommendation: ${result.data.recommendation}` : "",
    ].filter(Boolean).join(" "),
    tags: ["impact", "ai-output"],
    data: {
      risk_count: result.data.risks.length,
      confidence: result.confidence,
    },
  });
}

async function rememberImpactTestingMemory(
  payload: ImpactPayload,
  result: AIEnvelope<ImpactData>,
) {
  if (payload.unavailableReason || result.data.checks.length === 0) {
    return;
  }

  const changedPaths = boundedPaths(payload.fileTree).slice(0, MAX_REMEMBER_PATHS);
  const repo = payload.repoName?.trim() || payload.repoId?.trim() || "current repository";
  await cogneeRepositoryMemory.remember({
    source: "testing memory",
    repoId: payload.repoId,
    repoName: payload.repoName,
    branch: payload.branch,
    paths: changedPaths,
    subject: result.data.intent || repo,
    title: `Testing memory for ${repo}`,
    summary: [
      "Suggested checks from impact analysis.",
      result.data.checks.slice(0, 6).map(formatImpactCheck).join(" | "),
    ].filter(Boolean).join(" "),
    tags: ["testing", "impact"],
    data: {
      check_count: result.data.checks.length,
      confidence: result.confidence,
    },
  });
}

function formatImpactCheck(check: ImpactData["checks"][number]): string {
  return [check.command, check.reason].filter(Boolean).join(" - ");
}

function boundedPaths(paths?: string[]): string[] {
  return uniqueStrings(
    (paths ?? [])
      .map((path) => path.trim())
      .filter(Boolean)
      .slice(0, MAX_MEMORY_PATHS),
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
