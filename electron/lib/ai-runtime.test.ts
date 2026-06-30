import { afterEach, describe, expect, it, vi } from "vitest";

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

import { aiConfigStatus, callAIModel, configuredModel, configuredProvider } from "./ai-runtime";

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
});
