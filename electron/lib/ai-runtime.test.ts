import { afterEach, describe, expect, it, vi } from "vitest";
import { providerAdapters } from "./ai-providers";

const {
  mockStoreValue,
  mockGetAIProviderApiKey,
  mockGetAIProviderBaseUrl,
} = vi.hoisted(() => ({
  mockStoreValue: vi.fn(),
  mockGetAIProviderApiKey: vi.fn(),
  mockGetAIProviderBaseUrl: vi.fn(),
}));

vi.mock("./store", () => ({
  getStoreValue: mockStoreValue,
  getAIProviderApiKey: mockGetAIProviderApiKey,
  getAIProviderBaseUrl: mockGetAIProviderBaseUrl,
  getOpenRouterApiKey: () => mockGetAIProviderApiKey("openrouter"),
  getOpenRouterBaseUrl: () => mockGetAIProviderBaseUrl("openrouter"),
}));

import {
  aiConfigStatus,
  callAIModel,
  configuredModel,
  configuredProvider,
  runStructuredAIModelCheck,
} from "./ai-runtime";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function resetAIEnv(): void {
  delete process.env.OPENROUTER;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NIM_API_KEY;
  delete process.env.NVAPI_KEY;
  delete process.env.NVIDIA_BASE_URL;
  delete process.env.NIM_BASE_URL;
}

afterEach(() => {
  resetAIEnv();
  Object.assign(process.env, originalEnv);
  globalThis.fetch = originalFetch;
  mockStoreValue.mockReset();
  mockGetAIProviderApiKey.mockReset();
  mockGetAIProviderBaseUrl.mockReset();
  vi.restoreAllMocks();
});

describe("OpenRouter AI runtime", () => {
  it("defaults to OpenRouter when a stored OpenRouter key exists without an explicit active provider", () => {
    mockStoreValue.mockImplementation((key: string) =>
      key === "settings" ? undefined : undefined);
    mockGetAIProviderApiKey.mockImplementation((providerId: string) =>
      providerId === "openrouter" ? "stored-openrouter-key" : undefined);

    expect(configuredProvider()).toBe("openrouter");
  });

  it("uses an explicit active provider and that provider's default model", () => {
    mockStoreValue.mockImplementation((key: string) =>
      key === "settings" ? { ai_provider_id: "anthropic" } : undefined);

    expect(configuredProvider()).toBe("anthropic");
    expect(configuredModel()).toBe("claude-sonnet-4-5");
  });

  it("uses NVIDIA NIM as an explicit active provider with a tested default model", () => {
    mockStoreValue.mockImplementation((key: string) =>
      key === "settings" ? { ai_provider_id: "nvidia" } : undefined);

    expect(configuredProvider()).toBe("nvidia");
    expect(configuredModel()).toBe("meta/llama-4-maverick-17b-128e-instruct");
  });

  it("accepts NVIDIA NIM env aliases and base URL overrides", async () => {
    resetAIEnv();
    process.env.NIM_API_KEY = "nim-key";
    process.env.NVIDIA_BASE_URL = "https://nim.example/v1/";
    mockStoreValue.mockImplementation((key: string) =>
      key === "settings" ? { ai_provider_id: "nvidia" } : undefined);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "nim result" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    globalThis.fetch = fetchMock as typeof fetch;

    const status = await aiConfigStatus();
    const result = await callAIModel("system instructions", "user prompt");

    expect(status).toMatchObject({
      configured: true,
      model: "meta/llama-4-maverick-17b-128e-instruct",
      missing: [],
      env: { NVIDIA_API_KEY: "configured" },
    });
    expect(result).toBe("nim result");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://nim.example/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer nim-key",
        }),
      }),
    );
  });

  it("ignores an invalid persisted provider id and falls back to available credentials", async () => {
    mockStoreValue.mockImplementation((key: string) =>
      key === "settings" ? { ai_provider_id: "stale-provider" } : undefined);
    mockGetAIProviderApiKey.mockImplementation((providerId: string) =>
      providerId === "openai" ? "sk-openai" : undefined);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "fallback ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    globalThis.fetch = fetchMock as typeof fetch;

    expect(configuredProvider()).toBe("openai");
    expect(configuredModel()).toBe("gpt-4.1");
    await expect(callAIModel("system instructions", "user prompt")).resolves.toBe("fallback ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-openai",
        }),
      }),
    );
  });

  it("falls back to the active provider default when the saved model is stale for that provider", () => {
    mockStoreValue.mockImplementation((key: string) =>
      key === "settings"
        ? { ai_provider_id: "anthropic", ai_model_id: "gpt-4.1-mini" }
        : undefined);

    expect(configuredModel()).toBe("claude-sonnet-4-5");
  });

  it("reports Anthropic as configured without requiring OpenRouter", async () => {
    mockStoreValue.mockImplementation((key: string) =>
      key === "settings" ? { ai_provider_id: "anthropic" } : undefined);
    mockGetAIProviderApiKey.mockImplementation((providerId: string) =>
      providerId === "anthropic" ? "sk-ant" : undefined);

    const status = await aiConfigStatus();

    expect(status.configured).toBe(true);
    expect(status.model).toBe("claude-sonnet-4-5");
    expect(status.missing).toEqual([]);
    expect(status.env).toEqual({ ANTHROPIC_API_KEY: "configured" });
    expect(status.health[0]).toMatchObject({
      model: "claude-sonnet-4-5",
      status: "unknown",
      checkedAt: null,
    });
    expect(status.env).not.toHaveProperty("OPENROUTER_API_KEY");
  });

  it("keeps passive status local and skips provider health probes", async () => {
    mockStoreValue.mockImplementation((key: string) =>
      key === "settings" ? { ai_provider_id: "anthropic" } : undefined);
    mockGetAIProviderApiKey.mockImplementation((providerId: string) =>
      providerId === "anthropic" ? "sk-ant" : undefined);
    const healthCheckSpy = vi.spyOn(providerAdapters.anthropic, "healthCheck");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const status = await aiConfigStatus();

    expect(status.health.map((entry) => entry.status)).toEqual(["unknown", "unknown"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(healthCheckSpy).not.toHaveBeenCalled();
  });

  it("uses the free OpenRouter router by default", () => {
    resetAIEnv();

    expect(configuredModel()).toBe("openrouter/free");
  });

  it("accepts the existing OPENROUTER env key as an API-key alias", async () => {
    resetAIEnv();
    process.env.OPENROUTER = "test-key";
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const status = await aiConfigStatus();

    expect(status).toMatchObject({
      configured: true,
      model: "openrouter/free",
      missing: [],
      env: { OPENROUTER_API_KEY: "configured" },
    });
  });

  it("calls OpenRouter chat completions with bearer auth", async () => {
    resetAIEnv();
    process.env.OPENROUTER = "test-key";
    process.env.OPENROUTER_MODEL = "minimax/minimax-m3";
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "structured result" } }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await callAIModel("system instructions", "user prompt");

    expect(result).toBe("structured result");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Title": "Overcode",
        }),
        body: JSON.stringify({
          model: "minimax/minimax-m3",
          messages: [
            { role: "system", content: "system instructions" },
            { role: "user", content: "user prompt" },
          ],
          max_tokens: 800,
          temperature: 0,
        }),
      }),
    );
  });

  it("honors OPENROUTER_BASE_URL when calling OpenRouter", async () => {
    resetAIEnv();
    process.env.OPENROUTER = "test-key";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.example/api/v1/";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "custom base" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await callAIModel("system instructions", "user prompt");

    expect(result).toBe("custom base");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.example/api/v1/chat/completions",
      expect.any(Object),
    );
  });

  it("falls back to env credentials and base URL when store helpers throw", async () => {
    resetAIEnv();
    process.env.OPENROUTER = "env-key";
    process.env.OPENROUTER_BASE_URL = "https://fallback.example/api/v1";
    mockStoreValue.mockImplementation(() => {
      throw new Error("store unavailable");
    });
    mockGetAIProviderApiKey.mockImplementation(() => {
      throw new Error("store unavailable");
    });
    mockGetAIProviderBaseUrl.mockImplementation(() => {
      throw new Error("store unavailable");
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "env fallback" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await callAIModel("system instructions", "user prompt");

    expect(result).toBe("env fallback");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://fallback.example/api/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer env-key",
        }),
      }),
    );
  });

  it("passes a selected model when it returns valid Overcode structured JSON", async () => {
    resetAIEnv();
    process.env.OPENROUTER = "test-key";
    mockStoreValue.mockImplementation((key: string) =>
      key === "settings" ? { ai_provider_id: "openrouter" } : undefined);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  feature: "brief",
                  summary: "Probe passed.",
                  confidence: "high",
                  warnings: [],
                  data: {
                    purpose: "Validate structured responses.",
                    keyModules: [{ name: "AI runtime", path: "electron/lib", role: "Runs probes." }],
                    recentActivity: [{ label: "Probe", evidence: "Structured check returned JSON." }],
                    onboardingPath: ["Open settings"],
                    notableRisks: [],
                  },
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runStructuredAIModelCheck({
      providerId: "openrouter",
      modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",
    });

    expect(result).toMatchObject({
      providerId: "openrouter",
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      status: "passed",
      parsedJson: true,
      schemaValid: true,
      generatedLength: expect.any(Number),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining("nvidia/nemotron-3-ultra-550b-a55b:free"),
      }),
    );
  });

  it("fails the structured check when a provider returns prose instead of JSON", async () => {
    resetAIEnv();
    process.env.OPENROUTER = "test-key";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "I should return JSON, but here is prose." } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runStructuredAIModelCheck({
      providerId: "openrouter",
      modelId: "nvidia/nemotron-3-super-120b-a12b:free",
    });

    expect(result).toMatchObject({
      status: "failed",
      parsedJson: false,
      schemaValid: false,
      reason: "Model returned text without a parseable JSON object.",
    });
  });

  it("reports not_configured when the selected provider has no API key", async () => {
    resetAIEnv();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runStructuredAIModelCheck({
      providerId: "openai",
      modelId: "gpt-4.1-mini",
    });

    expect(result).toMatchObject({
      providerId: "openai",
      model: "gpt-4.1-mini",
      status: "not_configured",
      reason: "OpenAI API key is not configured.",
      parsedJson: false,
      schemaValid: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
