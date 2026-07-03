import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  curatedModelsForProvider,
  normalizeNvidiaCatalog,
  normalizeOpenRouterCatalog,
  OPENROUTER_FREE_MODEL_ID,
  providerAdapters,
  readOpenRouterKeyStatus,
} from "./ai-providers";

const mockStoreData: Record<string, unknown> = {};

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

vi.mock("electron-store", () => {
  class MockStore<T extends Record<string, unknown>> {
    private data: Record<string, unknown>;

    constructor(options?: { defaults?: Record<string, unknown> }) {
      this.data = structuredClone(options?.defaults ?? {});
      Object.keys(mockStoreData).forEach((key) => {
        delete mockStoreData[key];
      });
      Object.assign(mockStoreData, this.data);
    }

    get<K extends keyof T>(key: K, fallback?: T[K]): T[K] {
      return ((key in mockStoreData ? mockStoreData[key as string] : fallback) as T[K]);
    }

    set<K extends keyof T>(key: K, value: T[K]): void {
      mockStoreData[key as string] = value;
    }

    get store(): Record<string, unknown> {
      return mockStoreData;
    }
  }

  return { default: MockStore };
});

describe("AI provider model catalogs", () => {
  it("classifies OpenRouter free and paid models from pricing", () => {
    const result = normalizeOpenRouterCatalog({
      data: [
        {
          id: "qwen/qwen3-coder:free",
          name: "Qwen: Qwen3 Coder 480B A35B (free)",
          pricing: { prompt: "0", completion: "0" },
          context_length: 1048576,
          architecture: { modality: "text->text" },
        },
        {
          id: "minimax/minimax-m3",
          name: "MiniMax: MiniMax M3",
          pricing: { prompt: "0.0000003", completion: "0.0000012" },
          context_length: 1000000,
          architecture: { modality: "text->text" },
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        providerId: "openrouter",
        id: "qwen/qwen3-coder:free",
        free: true,
        contextLength: 1048576,
        tags: expect.arrayContaining(["free", "coding", "recommended"]),
      }),
      expect.objectContaining({
        providerId: "openrouter",
        id: "minimax/minimax-m3",
        free: false,
        tags: expect.arrayContaining(["paid"]),
      }),
    ]);
  });

  it("returns curated fallback models for every supported provider", () => {
    expect(OPENROUTER_FREE_MODEL_ID).toBe("openrouter/free");
    const openrouterModels = curatedModelsForProvider("openrouter");
    expect(openrouterModels.map((m) => m.id)).toContain("openrouter/free");
    expect(openrouterModels[0]?.tags).toEqual(expect.arrayContaining(["free", "recommended"]));
    expect(openrouterModels[0]?.tags).not.toContain("coding");
    expect(curatedModelsForProvider("openai").length).toBeGreaterThan(0);
    expect(curatedModelsForProvider("anthropic").length).toBeGreaterThan(0);
    expect(curatedModelsForProvider("gemini").length).toBeGreaterThan(0);
    const nvidiaModels = curatedModelsForProvider("nvidia");
    expect(nvidiaModels.map((m) => m.id)).toContain("meta/llama-4-maverick-17b-128e-instruct");
    expect(nvidiaModels[0]).toEqual(expect.objectContaining({
      providerId: "nvidia",
      free: false,
      tags: expect.arrayContaining(["paid", "recommended"]),
    }));
  });

  it("returns curated entries with cloned array fields", () => {
    const curated = curatedModelsForProvider("openrouter");
    curated[0]?.tags.push("coding");
    curated[0]?.modalities.push("audio");

    const fresh = curatedModelsForProvider("openrouter");
    expect(fresh[0]?.tags).not.toContain("coding");
    expect(fresh[0]?.modalities).not.toContain("audio");
  });

  it("normalizes NVIDIA NIM model catalogs without marking trial capacity as free", () => {
    const result = normalizeNvidiaCatalog({
      data: [
        {
          id: "meta/llama-4-maverick-17b-128e-instruct",
          root: "meta/llama-4-maverick-17b-128e-instruct",
        },
        {
          id: "qwen/qwen3-next-80b-a3b-instruct",
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        providerId: "nvidia",
        id: "meta/llama-4-maverick-17b-128e-instruct",
        name: "Meta: Llama 4 Maverick",
        free: false,
        source: "live",
        tags: expect.arrayContaining(["paid", "recommended", "long_context"]),
      }),
      expect.objectContaining({
        providerId: "nvidia",
        id: "qwen/qwen3-next-80b-a3b-instruct",
        name: "Qwen: Qwen3 Next 80B",
        tags: expect.arrayContaining(["paid", "coding", "recommended"]),
      }),
    ]);
  });
});

describe("AI provider adapters", () => {
  it("loads OpenRouter models from the live provider catalog", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [
          {
            id: "anthropic/claude-sonnet-5",
            name: "Anthropic: Claude Sonnet 5",
            pricing: { prompt: "0.000003", completion: "0.000015" },
            context_length: 200000,
            architecture: { modality: "text+image->text" },
          },
          {
            id: "moonshotai/kimi-k2",
            name: "MoonshotAI: Kimi K2",
            pricing: { prompt: "0.0000006", completion: "0.0000025" },
            context_length: 131072,
            architecture: { modality: "text->text" },
          },
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerAdapters.openrouter.listModels({
      apiKey: "sk-openrouter",
      baseUrl: "https://router.example/api/v1/",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://router.example/api/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer sk-openrouter",
        }),
      }),
    );
    expect(result.map((model) => model.id)).toEqual([
      "anthropic/claude-sonnet-5",
      "moonshotai/kimi-k2",
    ]);
    expect(result[0]).toEqual(expect.objectContaining({
      providerId: "openrouter",
      source: "live",
      free: false,
      tags: expect.arrayContaining(["paid", "long_context", "vision"]),
    }));
  });

  it("reads OpenRouter key status without making a model request", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        data: {
          is_free_tier: true,
          limit: null,
          limit_remaining: null,
          usage: 0,
          usage_daily: 0,
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await readOpenRouterKeyStatus({
      apiKey: "sk-openrouter",
      baseUrl: "https://router.example/api/v1/",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://router.example/api/v1/key",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer sk-openrouter",
        }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      plan: "free",
      isFreeTier: true,
      freeModelDailyLimit: 50,
      freeModelNote: "Free-tier OpenRouter keys are capped at 50 free-model requests per day. Add 10 credits to unlock 1000 free-model requests per day.",
    }));
  });

  it("sends OpenAI chat completions with Bearer auth", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerAdapters.openai.completeChat({
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 20,
      temperature: 0,
    });

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("loads NVIDIA NIM models from its OpenAI-compatible catalog", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        data: [
          { id: "meta/llama-4-maverick-17b-128e-instruct" },
          { id: "mistralai/mistral-large-3-675b-instruct-2512" },
        ],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerAdapters.nvidia.listModels({
      apiKey: "nvapi-test",
      baseUrl: "https://nim.example/v1/",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://nim.example/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer nvapi-test",
        }),
      }),
    );
    expect(result.map((model) => model.id)).toEqual([
      "meta/llama-4-maverick-17b-128e-instruct",
      "mistralai/mistral-large-3-675b-instruct-2512",
    ]);
    expect(result[0]).toEqual(expect.objectContaining({
      providerId: "nvidia",
      source: "live",
      free: false,
      tags: expect.arrayContaining(["paid", "recommended"]),
    }));
  });

  it("shows curated NVIDIA NIM models before credentials are configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerAdapters.nvidia.listModels({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result[0]).toEqual(expect.objectContaining({
      providerId: "nvidia",
      id: "meta/llama-4-maverick-17b-128e-instruct",
      source: "curated",
      tags: expect.arrayContaining(["paid", "recommended"]),
    }));
  });

  it("sends NVIDIA NIM chat completions with Bearer auth", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "nim ok" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerAdapters.nvidia.completeChat({
      apiKey: "nvapi-test",
      model: "meta/llama-4-maverick-17b-128e-instruct",
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 20,
      temperature: 0,
    });

    expect(result).toBe("nim ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer nvapi-test",
        }),
      }),
    );
  });

  it("includes OpenRouter error details when a free model is quota-blocked", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
        },
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(providerAdapters.openrouter.completeChat({
      apiKey: "sk-openrouter",
      model: "openrouter/free",
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 20,
      temperature: 0,
    })).rejects.toThrow(
      "OpenRouter returned 429: Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
    );
  });

  it("sends Anthropic messages with x-api-key auth", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerAdapters.anthropic.completeChat({
      apiKey: "sk-ant",
      model: "claude-sonnet-4-5",
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 20,
      temperature: 0,
    });

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "sk-ant",
          "anthropic-version": expect.any(String),
        }),
      }),
    );
  });

  it("uses provider health checks to issue a minimal Anthropic chat request", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await providerAdapters.anthropic.healthCheck(
      { apiKey: "sk-ant" },
      "claude-sonnet-4-5",
    );

    expect(result).toMatchObject({
      model: "claude-sonnet-4-5",
      status: "available",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          system: "Health check.",
          messages: [{ role: "user", content: "Reply with ok." }],
          max_tokens: 1,
          temperature: 0,
        }),
      }),
    );
  });
});

describe("AI provider credential storage", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.keys(mockStoreData).forEach((key) => {
      delete mockStoreData[key];
    });
    delete process.env.OPENROUTER;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.NIM_API_KEY;
    delete process.env.NVAPI_KEY;
    delete process.env.NVIDIA_BASE_URL;
    delete process.env.NIM_BASE_URL;
  });

  it("stores provider credentials by provider id", async () => {
    const store = await import("./store") as typeof import("./store") & {
      getAIProviderApiKey(providerId: string): string | undefined;
      getAIProviderBaseUrl(providerId: string): string | undefined;
      saveAIProviderCredentials(update: {
        providerId: string;
        apiKey?: string | null;
        baseUrl?: string | null;
      }): void;
    };

    store.saveAIProviderCredentials({
      providerId: "openai",
      apiKey: "sk-openai",
      baseUrl: "https://api.openai.com/v1",
    });

    expect(store.getAIProviderApiKey("openai")).toBe("sk-openai");
    expect(store.getAIProviderBaseUrl("openai")).toBe("https://api.openai.com/v1");
    expect(store.getAIProviderApiKey("anthropic")).toBeUndefined();
  });

  it("migrates legacy openrouter settings to the generic provider store on save", async () => {
    const store = await import("./store") as typeof import("./store") & {
      getAIProviderApiKey(providerId: string): string | undefined;
      getAIProviderBaseUrl(providerId: string): string | undefined;
      saveAIProviderCredentials(update: {
        providerId: string;
        apiKey?: string | null;
        baseUrl?: string | null;
      }): void;
      setStoreValue(key: string, value: unknown): void;
      getStoreValue(key: string): unknown;
    };

    store.setStoreValue("settings", {
      watch_directories: [],
      openrouter_api_key: "legacy-openrouter-key",
      openrouter_base_url: "https://openrouter.ai/api/v1",
    });

    expect(store.getAIProviderApiKey("openrouter")).toBe("legacy-openrouter-key");
    expect(store.getAIProviderBaseUrl("openrouter")).toBe("https://openrouter.ai/api/v1");

    store.saveAIProviderCredentials({
      providerId: "openrouter",
      apiKey: "new-openrouter-key",
      baseUrl: "https://openrouter.example/api/v1",
    });

    expect(store.getAIProviderApiKey("openrouter")).toBe("new-openrouter-key");
    expect(store.getAIProviderBaseUrl("openrouter")).toBe("https://openrouter.example/api/v1");
    expect(store.getStoreValue("settings")).toEqual(
      expect.objectContaining({
        watch_directories: [],
        ai_provider_secrets: {
          openrouter: { value: "new-openrouter-key" },
        },
        ai_provider_base_urls: {
          openrouter: "https://openrouter.example/api/v1",
        },
      }),
    );
    expect(store.getStoreValue("settings")).not.toEqual(
      expect.objectContaining({
        openrouter_api_key: expect.anything(),
        openrouter_base_url: expect.anything(),
      }),
    );
  });

  it("migrates the legacy openrouter key when saving only a new base URL", async () => {
    const store = await import("./store") as typeof import("./store") & {
      getAIProviderApiKey(providerId: string): string | undefined;
      getAIProviderBaseUrl(providerId: string): string | undefined;
      saveAIProviderCredentials(update: {
        providerId: string;
        apiKey?: string | null;
        baseUrl?: string | null;
      }): void;
      setStoreValue(key: string, value: unknown): void;
      getStoreValue(key: string): unknown;
    };

    store.setStoreValue("settings", {
      watch_directories: [],
      openrouter_api_key: "legacy-openrouter-key",
      openrouter_base_url: "https://openrouter.ai/api/v1",
    });

    store.saveAIProviderCredentials({
      providerId: "openrouter",
      baseUrl: "https://openrouter.example/api/v1",
    });

    expect(store.getAIProviderApiKey("openrouter")).toBe("legacy-openrouter-key");
    expect(store.getAIProviderBaseUrl("openrouter")).toBe("https://openrouter.example/api/v1");
    expect(store.getStoreValue("settings")).toEqual(
      expect.objectContaining({
        watch_directories: [],
        ai_provider_secrets: {
          openrouter: { value: "legacy-openrouter-key" },
        },
        ai_provider_base_urls: {
          openrouter: "https://openrouter.example/api/v1",
        },
      }),
    );
    expect(store.getStoreValue("settings")).not.toEqual(
      expect.objectContaining({
        openrouter_api_key: expect.anything(),
        openrouter_base_url: expect.anything(),
      }),
    );
  });

  it("clears only the explicitly nulled openrouter key and keeps the legacy base URL", async () => {
    const store = await import("./store") as typeof import("./store") & {
      getAIProviderApiKey(providerId: string): string | undefined;
      getAIProviderBaseUrl(providerId: string): string | undefined;
      saveAIProviderCredentials(update: {
        providerId: string;
        apiKey?: string | null;
        baseUrl?: string | null;
      }): void;
      setStoreValue(key: string, value: unknown): void;
      getStoreValue(key: string): unknown;
    };

    store.setStoreValue("settings", {
      watch_directories: [],
      openrouter_api_key: "legacy-openrouter-key",
      openrouter_base_url: "https://openrouter.ai/api/v1",
    });

    store.saveAIProviderCredentials({
      providerId: "openrouter",
      apiKey: null,
    });

    expect(store.getAIProviderApiKey("openrouter")).toBeUndefined();
    expect(store.getAIProviderBaseUrl("openrouter")).toBe("https://openrouter.ai/api/v1");
    expect(store.getStoreValue("settings")).toEqual(
      expect.objectContaining({
        watch_directories: [],
        ai_provider_secrets: {},
        ai_provider_base_urls: {
          openrouter: "https://openrouter.ai/api/v1",
        },
      }),
    );
    expect(store.getStoreValue("settings")).not.toEqual(
      expect.objectContaining({
        openrouter_api_key: expect.anything(),
        openrouter_base_url: expect.anything(),
      }),
    );
  });

  it("reports stored and env credential sources per provider", async () => {
    process.env.OPENROUTER_BASE_URL = "https://openrouter.example/api/v1";
    process.env.OPENAI_API_KEY = "env-openai-key";
    process.env.GOOGLE_API_KEY = "env-gemini-key";
    process.env.NIM_API_KEY = "env-nvidia-key";
    process.env.NVIDIA_BASE_URL = "https://nim.example/v1";

    const store = await import("./store") as typeof import("./store") & {
      saveAIProviderCredentials(update: {
        providerId: string;
        apiKey?: string | null;
        baseUrl?: string | null;
      }): void;
      aiProviderCredentialStatus(providerId?: string): Record<
        string,
        { api_key: string; base_url: string }
      >;
    };

    store.saveAIProviderCredentials({
      providerId: "anthropic",
      apiKey: "stored-anthropic-key",
    });

    expect(store.aiProviderCredentialStatus()).toEqual({
      openrouter: { api_key: "none", base_url: "env" },
      openai: { api_key: "env", base_url: "default" },
      anthropic: { api_key: "stored", base_url: "default" },
      gemini: { api_key: "env", base_url: "default" },
      nvidia: { api_key: "env", base_url: "env" },
    });
  });
});
