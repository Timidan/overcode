import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCogneeRepositoryMemory,
  type CogneeRepositoryMemoryClient,
} from "./cognee-repository-memory";

afterEach(() => {
  vi.unstubAllGlobals();
});

function createClient(
  overrides: Partial<CogneeRepositoryMemoryClient> = {},
): CogneeRepositoryMemoryClient {
  return {
    recallMemory: vi.fn(async () => ({
      ok: true,
      skipped: false,
      items: [],
    })),
    rememberMemory: vi.fn(async () => ({
      ok: true,
      skipped: false,
      stored: 1,
    })),
    forgetMemory: vi.fn(async () => ({
      ok: true,
      skipped: false,
      forgotten: true,
    })),
    hydrateMemoryLedger: vi.fn(async () => ({
      events: [],
      summary: {
        totalEvents: 0,
        remembered: 0,
        recalled: 0,
        improved: 0,
        forgotten: 0,
        skipped: 0,
        failed: 0,
        ingestedRecords: 0,
        sanitizedBytesIngested: 0,
        estimatedTokensIngested: 0,
        recallQueries: 0,
        recallHits: 0,
        recallHitRate: 0,
      },
      breakdownBySource: [],
      breakdownByDataset: [],
    })),
    clearMemoryLedger: vi.fn(async () => ({
      events: [],
      summary: {
        totalEvents: 0,
        remembered: 0,
        recalled: 0,
        improved: 0,
        forgotten: 0,
        skipped: 0,
        failed: 0,
        ingestedRecords: 0,
        sanitizedBytesIngested: 0,
        estimatedTokensIngested: 0,
        recallQueries: 0,
        recallHits: 0,
        recallHitRate: 0,
      },
      breakdownBySource: [],
      breakdownByDataset: [],
    })),
    ...overrides,
  };
}

describe("Cognee repository memory lifecycle", () => {
  it("filters recall to the requested repository and formats safe context", async () => {
    const client = createClient({
      recallMemory: vi.fn(async () => ({
        ok: true,
        skipped: false,
        items: [
          {
            id: "overcode-memory",
            title: "Overcode convention",
            summary: "Use feat(memory); OPENROUTER_API_KEY=sk-or-secret-value-123456789.",
            metadata: {
              repo: "repo-overcode",
              changed_paths: "src/lib/cognee-repository-memory.ts",
            },
          },
          {
            id: "other-memory",
            title: "Other repository",
            summary: "This memory must not cross repository boundaries.",
            metadata: { repo: "repo-other" },
          },
        ],
      })),
    });
    const memory = createCogneeRepositoryMemory({ client });

    const recalled = await memory.recall({
      source: "repo brief",
      repoId: "repo-overcode",
      repoName: "overcode",
    });

    expect(recalled?.items.map((item) => item.id)).toEqual(["overcode-memory"]);
    expect(recalled?.references).toEqual(["src/lib/cognee-repository-memory.ts"]);
    expect(recalled?.context).toContain("[redacted secret]");
    expect(recalled?.context).not.toContain("sk-or-secret");
  });

  it("does not retry a skipped or disabled recall", async () => {
    const recallMemory = vi.fn(async () => ({
      ok: false,
      skipped: true,
      reason: "Cognee repository memory is disabled.",
      items: [],
    }));
    const wait = vi.fn(async () => undefined);
    const memory = createCogneeRepositoryMemory({
      client: createClient({ recallMemory }),
      wait,
    });

    await expect(
      memory.recall(
        { source: "repo detail", repoId: "repo-1", repoName: "overcode" },
        { coldStartRetry: true },
      ),
    ).resolves.toBeNull();
    expect(recallMemory).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("exposes disabled recall state for an inspectable repository surface", async () => {
    const memory = createCogneeRepositoryMemory({
      client: createClient({
        recallMemory: vi.fn(async () => ({
          ok: false,
          skipped: true,
          reason: "Cognee is not configured.",
          items: [],
        })),
      }),
    });

    await expect(
      memory.recallWithStatus({
        source: "worktree inspection",
        repoId: "repo-1",
        repoName: "overcode",
      }),
    ).resolves.toEqual({
      status: "disabled",
      message: "Cognee is not configured.",
    });
  });

  it("retries once after an empty cold recall", async () => {
    const recallMemory = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, skipped: false, items: [] })
      .mockResolvedValueOnce({
        ok: true,
        skipped: false,
        items: [
          {
            id: "warm-memory",
            title: "Warm repository memory",
            summary: "The second recall found the approved summary.",
            metadata: { repo: "repo-1" },
          },
        ],
      });
    const wait = vi.fn(async () => undefined);
    const memory = createCogneeRepositoryMemory({
      client: createClient({ recallMemory }),
      wait,
    });

    const recalled = await memory.recall(
      { source: "repo detail", repoId: "repo-1", repoName: "overcode" },
      { coldStartRetry: true, retryDelayMs: 25 },
    );

    expect(recalled?.itemCount).toBe(1);
    expect(recallMemory).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(25);
  });

  it("reuses cold-recall behavior for workspace item recall", async () => {
    const recallMemory = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, skipped: false, items: [] })
      .mockResolvedValueOnce({
        ok: true,
        skipped: false,
        items: [
          { id: "workspace-memory", title: "Workspace", summary: "Ready." },
        ],
      });
    const memory = createCogneeRepositoryMemory({
      client: createClient({ recallMemory }),
      wait: async () => undefined,
    });

    const recalled = await memory.recallWorkspace(
      { query: "Recall Overcode workspace memory.", datasets: ["overcode_memory"] },
      { coldStartRetry: true },
    );

    expect(recalled?.items).toHaveLength(1);
    expect(recallMemory).toHaveBeenCalledTimes(2);
  });

  it("remembers only the sanitized approved summary and returns its identity", async () => {
    const rememberMemory: CogneeRepositoryMemoryClient["rememberMemory"] = vi.fn(
      async () => ({
        ok: true,
        skipped: false,
        stored: 1,
      }),
    );
    const memory = createCogneeRepositoryMemory({
      client: createClient({ rememberMemory }),
    });

    const result = await memory.remember({
      source: "worktree compare",
      repoId: "repo-1",
      repoName: "overcode",
      title: "Worktree decision",
      summary: "Keep the module boundary. TOKEN=secret-value-123456789",
      paths: ["src/lib/cognee-repository-memory.ts"],
    });

    const payload = vi.mocked(rememberMemory).mock.calls[0]?.[0];
    expect(result).toMatchObject({
      ok: true,
      skipped: false,
      stored: 1,
      datasetName: "overcode_memory",
    });
    expect(result.id).toBe(payload?.documents[0]?.id);
    expect(JSON.stringify(payload)).toContain("[redacted secret]");
    expect(JSON.stringify(payload)).not.toContain("secret-value");
  });

  it("skips an empty approved summary before IPC", async () => {
    const rememberMemory = vi.fn();
    const memory = createCogneeRepositoryMemory({
      client: createClient({ rememberMemory }),
    });

    await expect(
      memory.remember({
        source: "repo brief",
        repoName: "overcode",
        title: "Empty",
        summary: "   ",
      }),
    ).resolves.toMatchObject({ ok: false, skipped: true, stored: 0 });
    expect(rememberMemory).not.toHaveBeenCalled();
  });

  it("forgets the requested memory through the same lifecycle", async () => {
    const forgetMemory = vi.fn(async () => ({
      ok: true,
      skipped: false,
      forgotten: true,
    }));
    const memory = createCogneeRepositoryMemory({
      client: createClient({ forgetMemory }),
    });

    await expect(
      memory.forget(
        { id: "memory-1", datasetName: "overcode_memory" },
        { source: "worktree compare", repoId: "repo-1", repoName: "overcode" },
      ),
    ).resolves.toEqual({ ok: true, skipped: false, forgotten: true });
    expect(forgetMemory).toHaveBeenCalledWith({
      id: "memory-1",
      datasetName: "overcode_memory",
    });
  });

  it("notifies repository surfaces after a successful memory update", async () => {
    const dispatchEvent = installMemoryUpdateEvents();
    const memory = createCogneeRepositoryMemory({ client: createClient() });

    await memory.remember({
      source: "repo brief",
      repoId: "repo-1",
      repoName: "overcode",
      title: "Repo brief",
      summary: "A bounded repository summary.",
    });
    await memory.forget(
      { id: "memory-1", datasetName: "overcode_memory" },
      { source: "repo brief", repoId: "repo-1", repoName: "overcode" },
    );

    expect(dispatchEvent).toHaveBeenCalledTimes(2);
    expect(dispatchEvent.mock.calls.map(([event]) => event.detail)).toEqual([
      {
        action: "remember",
        repoId: "repo-1",
        repoName: "overcode",
        source: "repo brief",
      },
      {
        action: "forget",
        repoId: "repo-1",
        repoName: "overcode",
        source: "repo brief",
      },
    ]);
  });

  it("hydrates the ledger through the lifecycle facade", async () => {
    const client = createClient();
    const memory = createCogneeRepositoryMemory({ client });

    const ledger = await memory.hydrateLedger();

    expect(ledger.summary.totalEvents).toBe(0);
    expect(client.hydrateMemoryLedger).toHaveBeenCalledTimes(1);
  });
});

function installMemoryUpdateEvents() {
  class MemoryUpdateEvent {
    constructor(
      readonly type: string,
      readonly init: { detail: Record<string, unknown> },
    ) {}

    get detail() {
      return this.init.detail;
    }
  }
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { dispatchEvent });
  vi.stubGlobal("CustomEvent", MemoryUpdateEvent);
  return dispatchEvent;
}
