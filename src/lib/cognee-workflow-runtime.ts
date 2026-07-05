import type {
  MemoryRecallItem,
  MemoryRecallQuery,
  MemoryRecallResult,
  MemoryRememberInput,
} from "./ipc";
import {
  buildCogneeRecallRequest,
  buildCogneeSummaryMemoryInput,
  extractCogneeMemoryReferences,
  filterCogneeMemoryItemsForSubject,
  formatCogneeRecallContext,
  type CogneeSummaryMemoryInput,
  type CogneeWorkflowSubject,
} from "./cognee-workflow-memory";

export const COGNEE_WORKFLOW_MEMORY_UPDATED_EVENT = "overcode:cognee-memory-updated";

export interface CogneeWorkflowMemoryClient {
  recallMemory(payload: MemoryRecallQuery): Promise<MemoryRecallResult>;
  rememberMemory(payload: MemoryRememberInput): Promise<unknown>;
}

export interface RecalledCogneeWorkflowMemory {
  context: string;
  itemCount: number;
  summary: string;
  references: string[];
  items: MemoryRecallItem[];
}

export interface RecallCogneeWorkflowMemoryOptions {
  /** Retry once when the first attempt yields nothing. The first recall after
   * an idle period regularly comes back empty on Cognee Cloud while warm
   * recalls succeed, so unprompted surfaces (morning brief, repo strip)
   * should opt in. */
  retryOnEmpty?: boolean;
  retryDelayMs?: number;
  /** Keep only memories whose repo metadata/name matches the requested repo.
   * Repo-level teasers use this so a strong memory from another workspace does
   * not masquerade as context for the current repo. */
  requireRepoMatch?: boolean;
}

export async function recallCogneeWorkflowMemory(
  subject: CogneeWorkflowSubject,
  client?: CogneeWorkflowMemoryClient,
  options?: RecallCogneeWorkflowMemoryOptions,
): Promise<RecalledCogneeWorkflowMemory | null> {
  const request = buildCogneeRecallRequest(subject);
  if (!request) return null;

  async function attempt(): Promise<RecalledCogneeWorkflowMemory | null> {
    try {
      const memoryClient = client ?? (await getDefaultCogneeMemoryClient());
      const result = await memoryClient.recallMemory(request as MemoryRecallQuery);
      if (!result.ok || result.skipped || result.items.length === 0) return null;
      const items = options?.requireRepoMatch
        ? filterCogneeMemoryItemsForSubject(result.items, subject)
        : result.items;
      if (items.length === 0) return null;
      const context = formatCogneeRecallContext(items);
      if (!context) return null;
      const references = Array.from(
        new Set(items.flatMap(extractCogneeMemoryReferences)),
      ).slice(0, 12);
      return {
        context,
        itemCount: items.length,
        summary: `${items.length} recalled Cognee memory item${
          items.length === 1 ? "" : "s"
        }`,
        references,
        items,
      };
    } catch (error) {
      console.warn("[cognee-workflow-recall-failed]", error);
      return null;
    }
  }

  const first = await attempt();
  if (first || !options?.retryOnEmpty) return first;
  await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 4_000));
  return attempt();
}

export async function rememberCogneeWorkflowSummary(
  input: CogneeSummaryMemoryInput,
  client?: CogneeWorkflowMemoryClient,
): Promise<boolean> {
  if (!input.summary.trim()) return false;

  try {
    const memoryClient = client ?? await getDefaultCogneeMemoryClient();
    await memoryClient.rememberMemory(buildCogneeSummaryMemoryInput(input));
    emitCogneeWorkflowMemoryUpdated(input);
    return true;
  } catch (error) {
    console.warn("[cognee-workflow-remember-failed]", error);
    return false;
  }
}

async function getDefaultCogneeMemoryClient(): Promise<CogneeWorkflowMemoryClient> {
  const module = await import("./ipc");
  return module.ipc;
}

function emitCogneeWorkflowMemoryUpdated(input: CogneeSummaryMemoryInput): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent(COGNEE_WORKFLOW_MEMORY_UPDATED_EVENT, {
    detail: {
      repoId: input.repoId,
      repoName: input.repoName,
      source: input.source,
    },
  }));
}
