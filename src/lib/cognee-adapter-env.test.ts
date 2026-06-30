import { afterEach, describe, expect, it, vi } from "vitest";

import { cogneeStatus, forgetMemory, improveMemory, recallMemory } from "../../electron/lib/cognee";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function resetCogneeEnv(): void {
  delete process.env.COGNEE_API_URL;
  delete process.env.COGNEE_SERVICE_URL;
  delete process.env.COGNEE_BASE_URL;
  delete process.env.COGNEE_API_KEY;
}

afterEach(() => {
  resetCogneeEnv();
  Object.assign(process.env, originalEnv);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Cognee adapter environment", () => {
  it("requires one endpoint environment variable", () => {
    resetCogneeEnv();

    expect(cogneeStatus()).toMatchObject({
      enabled: false,
      configured: false,
      missing: ["COGNEE_API_URL"],
      reason: "Missing COGNEE_API_URL or COGNEE_SERVICE_URL or COGNEE_BASE_URL.",
    });
  });

  it("accepts the service URL alias used by local env files", () => {
    resetCogneeEnv();
    process.env.COGNEE_SERVICE_URL = "https://cognee.example.test/";

    expect(cogneeStatus()).toMatchObject({
      enabled: true,
      configured: true,
      missing: [],
      endpoint: "https://cognee.example.test",
      endpointSource: "COGNEE_SERVICE_URL",
      auth: "none",
    });
  });

  it("prefers the canonical API URL when multiple aliases are present", () => {
    resetCogneeEnv();
    process.env.COGNEE_API_URL = "https://canonical.example.test";
    process.env.COGNEE_SERVICE_URL = "https://service.example.test";
    process.env.COGNEE_BASE_URL = "https://base.example.test";
    process.env.COGNEE_API_KEY = "test-key";

    expect(cogneeStatus()).toMatchObject({
      enabled: true,
      endpoint: "https://canonical.example.test",
      endpointSource: "COGNEE_API_URL",
      auth: "api-key",
    });
  });

  it("sends recall requests with Cognee API-key auth and camelCase payload fields", async () => {
    resetCogneeEnv();
    process.env.COGNEE_SERVICE_URL = "https://cognee.example.test";
    process.env.COGNEE_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify([{ id: "result-1", summary: "Stored memory" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await recallMemory({ query: "Recall Overcode memory.", limit: 2 });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cognee.example.test/api/v1/recall",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": "test-key",
        },
        body: JSON.stringify({
          query: "Recall Overcode memory.",
          datasets: ["overcode_memory"],
          searchType: "GRAPH_COMPLETION",
          topK: 2,
          onlyContext: true,
          includeReferences: true,
        }),
      }),
    );
  });

  it("maps improve requests to Cognee cognify", async () => {
    resetCogneeEnv();
    process.env.COGNEE_SERVICE_URL = "https://cognee.example.test";
    process.env.COGNEE_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "running" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await improveMemory({
      datasetName: "overcode_memory",
      feedback: "Focus graph extraction on repo decisions and risk relationships.",
      accepted: true,
    });

    expect(result).toMatchObject({ ok: true, accepted: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cognee.example.test/api/v1/cognify",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": "test-key",
        },
        body: JSON.stringify({
          datasets: ["overcode_memory"],
          runInBackground: true,
          customPrompt: "Focus graph extraction on repo decisions and risk relationships.",
        }),
      }),
    );
  });

  it("sends forget requests with Cognee memoryOnly payload fields", async () => {
    resetCogneeEnv();
    process.env.COGNEE_SERVICE_URL = "https://cognee.example.test";
    process.env.COGNEE_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await forgetMemory({ datasetName: "overcode_memory" });

    expect(result).toMatchObject({ ok: true, forgotten: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cognee.example.test/api/v1/forget",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": "test-key",
        },
        body: JSON.stringify({
          dataset: "overcode_memory",
          memoryOnly: true,
        }),
      }),
    );
  });
});
