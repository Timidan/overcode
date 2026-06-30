import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./store", () => ({
  getStoreValue: () => undefined,
  getOpenRouterApiKey: () => undefined,
  getOpenRouterBaseUrl: () => undefined,
}));

import { aiConfigStatus, callAIModel, configuredModel } from "./ai-runtime";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function resetAIEnv(): void {
  delete process.env.OPENROUTER;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_MODEL;
}

afterEach(() => {
  resetAIEnv();
  Object.assign(process.env, originalEnv);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("OpenRouter AI runtime", () => {
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
