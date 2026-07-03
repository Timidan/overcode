import type { MemoryRecallQuery, MemoryRecallResult, MemoryRememberInput } from "./ipc";
import {
  buildCogneeRecallRequest,
  buildCogneeSummaryMemoryInput,
  extractCogneeMemoryReferences,
  formatCogneeRecallContext,
  type CogneeSummaryMemoryInput,
  type CogneeWorkflowSubject,
} from "./cognee-workflow-memory";

export interface CogneeWorkflowMemoryClient {
  recallMemory(payload: MemoryRecallQuery): Promise<MemoryRecallResult>;
  rememberMemory(payload: MemoryRememberInput): Promise<unknown>;
}

export interface RecalledCogneeWorkflowMemory {
  context: string;
  itemCount: number;
  summary: string;
  references: string[];
}

export interface RecallCogneeWorkflowMemoryOptions {
  /** Retry once when the first attempt yields nothing. The first recall after
   * an idle period regularly comes back empty on Cognee Cloud while warm
   * recalls succeed, so unprompted surfaces (morning brief, repo strip)
   * should opt in. */
  retryOnEmpty?: boolean;
  retryDelayMs?: number;
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
      const context = formatCogneeRecallContext(result.items);
      if (!context) return null;
      const references = Array.from(
        new Set(result.items.flatMap(extractCogneeMemoryReferences)),
      ).slice(0, 12);
      return {
        context,
        itemCount: result.items.length,
        summary: `${result.items.length} recalled Cognee memory item${
          result.items.length === 1 ? "" : "s"
        }`,
        references,
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
