import { useState, useEffect } from "react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  analyzeImpactStructured,
  type ImpactPayload,
} from "../../lib/ai-features";
import type { AIEnvelope, ImpactData } from "../../lib/ai-structured";
import { COGNEE_WORKSPACE_DATASET } from "../../lib/cognee-workflow-memory";
import { rememberCogneeWorkflowSummary } from "../../lib/cognee-workflow-runtime";
import { ipc } from "../../lib/ipc";
import { ImpactResult } from "./AIResultViews";
import "./ImpactAnalysis.css";

interface Props {
  payload?: ImpactPayload | null;
}

interface MemoryRecallItem {
  id: string;
  title: string;
  summary: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface MemoryRecallResult {
  ok: boolean;
  skipped?: boolean;
  items?: MemoryRecallItem[];
}

interface OptionalMemoryIPC {
  recallMemory?: (query: {
    query: string;
    limit?: number;
    filters?: Record<string, string | number | boolean | null>;
  }) => Promise<MemoryRecallResult>;
  rememberMemory?: (input: {
    datasetName?: string;
    documents: Array<{
      id: string;
      kind: "summary" | "fact" | "note";
      title: string;
      summary: string;
      tags?: string[];
      metadata?: Record<string, string | number | boolean | null>;
    }>;
  }) => Promise<unknown>;
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
  const memoryIpc = ipc as unknown as OptionalMemoryIPC;
  if (typeof memoryIpc.recallMemory !== "function") {
    return null;
  }

  const changedPaths = boundedPaths(payload.fileTree);
  const repo = payload.repoName?.trim() || payload.repoId?.trim() || "current repository";
  const branch = payload.branch?.trim();
  const queryParts = [
    `Recall Overcode memory for ${repo}`,
    branch ? `on branch ${branch}` : "",
    changedPaths.length > 0 ? `touching ${changedPaths.join(", ")}` : "",
  ].filter(Boolean);

  if (queryParts.length === 1 && changedPaths.length === 0) {
    return null;
  }

  try {
    const recalled = await memoryIpc.recallMemory({
      query: `${queryParts.join(" ")}.`,
      limit: MAX_MEMORY_ITEMS,
      filters: payload.repoId ? { repo: payload.repoId } : undefined,
    });
    const items = recalled.ok ? (recalled.items ?? []).slice(0, MAX_MEMORY_ITEMS) : [];
    if (items.length === 0) {
      return null;
    }

    const context = truncateMemoryText(
      items
        .map((item) => {
          const refs = extractMemoryReferences(item);
          return [
            `Memory ${item.id}: ${item.title}`,
            item.summary,
            refs.length > 0 ? `References: ${refs.join(", ")}` : "",
          ].filter(Boolean).join("\n");
        })
        .join("\n\n"),
      MAX_MEMORY_CONTEXT_CHARS,
    );

    return {
      context,
      used: {
        summary: `${items.length} recalled memory item${items.length === 1 ? "" : "s"}`,
        graphPath: items.map((item) => `${repo} -> memory:${item.id}`),
        references: uniqueStrings(items.flatMap(extractMemoryReferences)).slice(
          0,
          MAX_MEMORY_PATHS,
        ),
      },
    };
  } catch (error) {
    console.warn("[impact-memory-recall-failed]", error);
    return null;
  }
}

async function rememberImpactResult(
  payload: ImpactPayload,
  result: AIEnvelope<ImpactData>,
) {
  if (payload.unavailableReason || !payload.diff?.trim()) {
    return;
  }

  const memoryIpc = ipc as unknown as OptionalMemoryIPC;
  if (typeof memoryIpc.rememberMemory !== "function") {
    return;
  }

  const changedPaths = boundedPaths(payload.fileTree).slice(0, MAX_REMEMBER_PATHS);
  const risks = result.data.risks.slice(0, 4);
  const riskSummary = risks
    .map((risk) => `${risk.severity}: ${risk.area} - ${risk.reason}`)
    .join(" | ");
  const repo = payload.repoName?.trim() || payload.repoId?.trim() || "current repository";
  const id = `impact:${hashMemoryId(
    `${repo}:${payload.branch ?? ""}:${changedPaths.join(",")}:${result.summary}`,
  )}`;

  try {
    await memoryIpc.rememberMemory({
      datasetName: COGNEE_WORKSPACE_DATASET,
      documents: [
        {
          id,
          kind: "summary",
          title: `Impact analysis for ${repo}`,
          summary: [
            result.summary,
            result.data.intent ? `Intent: ${result.data.intent}` : "",
            riskSummary ? `Risks: ${riskSummary}` : "",
            result.data.recommendation ? `Recommendation: ${result.data.recommendation}` : "",
          ].filter(Boolean).join(" "),
          tags: ["impact", "ai-output", ...changedPaths],
          metadata: {
            source: "impact analysis",
            repo: payload.repoId ?? payload.repoName ?? null,
            branch: payload.branch ?? null,
            changed_paths: changedPaths.join(","),
            risk_count: result.data.risks.length,
            confidence: result.confidence,
          },
        },
      ],
    });
  } catch (error) {
    console.warn("[impact-memory-remember-failed]", error);
  }
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
  await rememberCogneeWorkflowSummary({
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

function extractMemoryReferences(item: MemoryRecallItem): string[] {
  const metadata = item.metadata ?? {};
  const refs = [
    metadata.file,
    metadata.path,
    metadata.ref,
    metadata.url,
    metadata.changed_paths,
  ];
  return uniqueStrings(
    refs
      .flatMap((value) => (typeof value === "string" ? value.split(",") : []))
      .map((value) => value.trim())
      .filter(Boolean),
  ).slice(0, MAX_MEMORY_PATHS);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function truncateMemoryText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3)}...`;
}

function hashMemoryId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
