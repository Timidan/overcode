import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  curatedModelsForProvider,
  normalizeOpenRouterCatalog,
  OPENROUTER_FREE_MODEL_ID,
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
  });

  it("returns curated entries with cloned array fields", () => {
    const curated = curatedModelsForProvider("openrouter");
    curated[0]?.tags.push("coding");
    curated[0]?.modalities.push("audio");

    const fresh = curatedModelsForProvider("openrouter");
    expect(fresh[0]?.tags).not.toContain("coding");
    expect(fresh[0]?.modalities).not.toContain("audio");
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
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
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

  it("reports stored and env credential sources per provider", async () => {
    process.env.OPENAI_API_KEY = "env-openai-key";
    process.env.GOOGLE_API_KEY = "env-gemini-key";

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
      openrouter: { api_key: "none", base_url: "default" },
      openai: { api_key: "env", base_url: "default" },
      anthropic: { api_key: "stored", base_url: "default" },
      gemini: { api_key: "env", base_url: "default" },
    });
  });
});
