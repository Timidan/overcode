import {
  loadCogneeMemoryLedger,
  type CogneeMemoryLedgerSnapshot,
} from "./cognee-memory-ledger";
import type {
  MemoryForgetInput,
  MemoryForgetResult,
  MemoryRecallItem,
  MemoryRecallQuery,
  MemoryRecallResult,
  MemoryRememberInput,
  MemoryRememberResult,
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

export const COGNEE_REPOSITORY_MEMORY_UPDATED_EVENT =
  "overcode:cognee-memory-updated";

const DEFAULT_RETRY_DELAY_MS = 4_000;

export interface CogneeRepositoryMemoryClient {
  recallMemory(payload: MemoryRecallQuery): Promise<MemoryRecallResult>;
  rememberMemory(payload: MemoryRememberInput): Promise<MemoryRememberResult>;
  forgetMemory(payload: MemoryForgetInput): Promise<MemoryForgetResult>;
  hydrateMemoryLedger(): Promise<CogneeMemoryLedgerSnapshot>;
  clearMemoryLedger(): Promise<CogneeMemoryLedgerSnapshot>;
}

export interface RecalledCogneeRepositoryMemory {
  context: string;
  itemCount: number;
  summary: string;
  references: string[];
  items: MemoryRecallItem[];
}

export interface RecalledCogneeWorkspaceMemory {
  itemCount: number;
  items: MemoryRecallItem[];
}

export type CogneeRepositoryRecallStatus =
  | { status: "ready"; memory: RecalledCogneeRepositoryMemory }
  | { status: "disabled"; message: string }
  | { status: "empty"; message: string }
  | { status: "error"; message: string };

export interface RememberedCogneeRepositorySummary extends MemoryRememberResult {
  id?: string;
  datasetName: string;
}

export interface RecallCogneeRepositoryMemoryOptions {
  /** Retry once only after a successful-but-empty cold recall. Disabled,
   * skipped, and failed calls are not retried. */
  coldStartRetry?: boolean;
  retryDelayMs?: number;
  maxContextChars?: number;
}

export interface CogneeRepositoryMemory {
  recall(
    subject: CogneeWorkflowSubject,
    options?: RecallCogneeRepositoryMemoryOptions,
  ): Promise<RecalledCogneeRepositoryMemory | null>;
  recallWithStatus(
    subject: CogneeWorkflowSubject,
    options?: RecallCogneeRepositoryMemoryOptions,
  ): Promise<CogneeRepositoryRecallStatus>;
  recallWorkspace(
    request: MemoryRecallQuery,
    options?: RecallCogneeRepositoryMemoryOptions,
  ): Promise<RecalledCogneeWorkspaceMemory | null>;
  remember(
    input: CogneeSummaryMemoryInput,
  ): Promise<RememberedCogneeRepositorySummary>;
  forget(
    input: MemoryForgetInput,
    subject?: CogneeWorkflowSubject,
  ): Promise<MemoryForgetResult>;
  loadLedger(): CogneeMemoryLedgerSnapshot;
  hydrateLedger(): Promise<CogneeMemoryLedgerSnapshot>;
  clearLedger(): Promise<CogneeMemoryLedgerSnapshot>;
}

interface CreateCogneeRepositoryMemoryOptions {
  client?: CogneeRepositoryMemoryClient;
  wait?: (durationMs: number) => Promise<void>;
}

type RecallAttempt =
  | { status: "found"; items: MemoryRecallItem[] }
  | { status: "empty" }
  | { status: "disabled"; message: string }
  | { status: "error"; message: string };

export function createCogneeRepositoryMemory(
  options: CreateCogneeRepositoryMemoryOptions = {},
): CogneeRepositoryMemory {
  const wait = options.wait ?? delay;

  async function getClient(): Promise<CogneeRepositoryMemoryClient> {
    if (options.client) return options.client;
    const module = await import("./ipc");
    return module.ipc;
  }

  async function attemptRecall(
    request: MemoryRecallQuery,
    subject?: CogneeWorkflowSubject,
  ): Promise<RecallAttempt> {
    try {
      const result = await (await getClient()).recallMemory(request);
      if (result.skipped) {
        return {
          status: "disabled",
          message: result.reason ?? result.error ?? "Cognee repository memory is disabled.",
        };
      }
      if (!result.ok) {
        return {
          status: "error",
          message: result.error ?? result.reason ?? "Cognee repository memory recall failed.",
        };
      }
      const items = subject
        ? filterCogneeMemoryItemsForSubject(result.items, subject)
        : result.items;
      return items.length > 0
        ? { status: "found", items }
        : { status: "empty" };
    } catch (error) {
      console.warn("[cognee-repository-recall-failed]", error);
      return {
        status: "error",
        message: error instanceof Error
          ? error.message
          : "Cognee repository memory recall failed.",
      };
    }
  }

  async function runRecall(
    request: MemoryRecallQuery,
    subject: CogneeWorkflowSubject | undefined,
    recallOptions: RecallCogneeRepositoryMemoryOptions | undefined,
  ): Promise<RecallAttempt> {
    const first = await attemptRecall(request, subject);
    if (first.status !== "empty" || !recallOptions?.coldStartRetry) return first;

    await wait(recallOptions.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    return attemptRecall(request, subject);
  }

  async function recallWithStatus(
    subject: CogneeWorkflowSubject,
    recallOptions?: RecallCogneeRepositoryMemoryOptions,
  ): Promise<CogneeRepositoryRecallStatus> {
    const request = buildCogneeRecallRequest(subject);
    if (!request) {
      return { status: "empty", message: "Repository memory needs a source and repository." };
    }
    const recalled = await runRecall(request, subject, recallOptions);
    if (recalled.status === "disabled" || recalled.status === "error") return recalled;
    if (recalled.status === "empty") {
      return { status: "empty", message: "No Cognee memory matched this repository." };
    }

    const context = formatCogneeRecallContext(recalled.items, {
      maxChars: recallOptions?.maxContextChars,
    });
    if (!context) {
      return { status: "empty", message: "Cognee returned no usable repository memory." };
    }
    const references = Array.from(
      new Set(recalled.items.flatMap(extractCogneeMemoryReferences)),
    ).slice(0, 12);
    return {
      status: "ready",
      memory: {
        context,
        itemCount: recalled.items.length,
        summary: `${recalled.items.length} recalled Cognee memory item${
          recalled.items.length === 1 ? "" : "s"
        }`,
        references,
        items: recalled.items,
      },
    };
  }

  return {
    async recall(subject, recallOptions) {
      const result = await recallWithStatus(subject, recallOptions);
      return result.status === "ready" ? result.memory : null;
    },

    recallWithStatus,

    async recallWorkspace(request, recallOptions) {
      const recalled = await runRecall(request, undefined, recallOptions);
      return recalled.status === "found"
        ? { itemCount: recalled.items.length, items: recalled.items }
        : null;
    },

    async remember(input) {
      if (!input.summary.trim()) {
        return {
          ok: false,
          skipped: true,
          stored: 0,
          datasetName: "overcode_memory",
          reason: "Approved repository summary is empty.",
        };
      }

      try {
        const payload = buildCogneeSummaryMemoryInput(input);
        const result = await (await getClient()).rememberMemory(payload);
        if (result.ok && !result.skipped && result.stored > 0) {
          emitMemoryUpdated("remember", input);
        }
        return {
          ...result,
          id: payload.documents[0]?.id,
          datasetName: payload.datasetName ?? "overcode_memory",
        };
      } catch (error) {
        console.warn("[cognee-repository-remember-failed]", error);
        return {
          ok: false,
          skipped: false,
          stored: 0,
          datasetName: "overcode_memory",
          error: error instanceof Error
            ? error.message
            : "Cognee repository memory failed.",
        };
      }
    },

    async forget(input, subject) {
      try {
        const result = await (await getClient()).forgetMemory(input);
        if (result.ok && !result.skipped && result.forgotten) {
          emitMemoryUpdated("forget", subject);
        }
        return result;
      } catch (error) {
        console.warn("[cognee-repository-forget-failed]", error);
        return {
          ok: false,
          skipped: false,
          forgotten: false,
          error: error instanceof Error
            ? error.message
            : "Cognee repository memory forget failed.",
        };
      }
    },

    loadLedger() {
      return loadCogneeMemoryLedger();
    },

    async hydrateLedger() {
      return (await getClient()).hydrateMemoryLedger();
    },

    async clearLedger() {
      return (await getClient()).clearMemoryLedger();
    },
  };
}

export const cogneeRepositoryMemory = createCogneeRepositoryMemory();

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function emitMemoryUpdated(
  action: "remember" | "forget",
  subject?: CogneeWorkflowSubject,
): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent(COGNEE_REPOSITORY_MEMORY_UPDATED_EVENT, {
    detail: {
      action,
      repoId: subject?.repoId,
      repoName: subject?.repoName,
      source: subject?.source,
    },
  }));
}
