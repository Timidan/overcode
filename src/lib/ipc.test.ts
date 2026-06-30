import { beforeEach, describe, expect, it, vi } from "vitest";

function makeApi(saveAIProvider = vi.fn().mockResolvedValue(undefined)) {
  return {
    auth: {},
    git: {},
    github: {},
    gitlab: {},
    ai: {},
    memory: {},
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
});
