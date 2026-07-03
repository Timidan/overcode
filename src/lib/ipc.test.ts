import { beforeEach, describe, expect, it, vi } from "vitest";

function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function makeApi(
  saveAIProvider = vi.fn().mockResolvedValue(undefined),
  memory: Record<string, unknown> = {},
) {
  return {
    auth: {},
    git: {},
    github: {},
    gitlab: {},
    ai: {},
    memory,
    store: {},
    settings: {
      saveAIProvider,
      aiProviderStatus: vi.fn(),
    },
  };
}

describe("renderer IPC wrapper", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("omits undefined provider credential fields before crossing IPC", async () => {
    const saveAIProvider = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { api: makeApi(saveAIProvider) });

    const { IPC } = await import("./ipc");
    const ipc = new IPC();
    await ipc.saveAIProviderCredentials({
      providerId: "openrouter",
      apiKey: "sk-openrouter",
    });

    const payload = saveAIProvider.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toEqual({
      providerId: "openrouter",
      api_key: "sk-openrouter",
    });
    expect(payload).not.toHaveProperty("base_url");
  });

  it("records successful Cognee remember calls in the local memory ledger", async () => {
    const remember = vi.fn().mockResolvedValue({ ok: true, skipped: false, stored: 1 });
    vi.stubGlobal("window", { api: makeApi(undefined, { remember }) });
    vi.stubGlobal("localStorage", makeStorage());

    const { IPC } = await import("./ipc");
    const { loadCogneeMemoryLedger } = await import("./cognee-memory-ledger");

    const ipc = new IPC();
    await ipc.rememberMemory({
      datasetName: "overcode_memory",
      documents: [
        {
          id: "impact:one",
          kind: "summary",
          title: "Impact analysis for overcode",
          summary: "Cognee remembers sanitized impact summaries.",
          tags: ["impact", "ai-output"],
          metadata: { repo: "overcode", branch: "feature/cognee-dashboard" },
        },
      ],
    });

    expect(remember).toHaveBeenCalledTimes(1);
    const snapshot = loadCogneeMemoryLedger(localStorage);
    expect(snapshot.summary.ingestedRecords).toBe(1);
    expect(snapshot.events[0]).toMatchObject({
      operation: "remember",
      status: "succeeded",
      source: "impact analysis",
      repo: "overcode",
    });
  });
});
