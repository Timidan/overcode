import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cogneeUsage,
  forgetMemory,
  recallMemory,
  rememberMemory,
  verifiedCogneeStatus,
} from "./cognee";

const ENDPOINT = "https://tenant-test.example.cognee.ai";
const ENV_KEYS = [
  "COGNEE_API_URL",
  "COGNEE_SERVICE_URL",
  "COGNEE_BASE_URL",
  "COGNEE_API_KEY",
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.ok === false ? "Internal Server Error" : "OK",
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.COGNEE_API_URL = ENDPOINT;
  process.env.COGNEE_API_KEY = "test-key";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("verifiedCogneeStatus", () => {
  it("verifies the endpoint through /health instead of assuming it is online", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "healthy" }));

    const status = await verifiedCogneeStatus();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ENDPOINT}/health`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
    expect(status.configured).toBe(true);
    expect(status.enabled).toBe(true);
    expect(status.endpointVerified).toBe(true);
    expect(status.reason).toBeUndefined();
  });

  it("reports an unreachable endpoint when the health check fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const status = await verifiedCogneeStatus();

    expect(status.configured).toBe(true);
    expect(status.endpointVerified).toBe(false);
    expect(status.reason).toMatch(/unreachable/i);
  });

  it("treats a non-ok health response as unverified", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "down" }, { ok: false, status: 503 }));

    const status = await verifiedCogneeStatus();

    expect(status.endpointVerified).toBe(false);
    expect(status.reason).toMatch(/503/);
  });

  it("does not ping when no endpoint is configured", async () => {
    delete process.env.COGNEE_API_URL;

    const status = await verifiedCogneeStatus();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(status.configured).toBe(false);
    expect(status.enabled).toBe(false);
    expect(status.endpointVerified).toBe(false);
  });
});

describe("forgetMemory by id", () => {
  it("forgets a single memory item matched by document id", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: "ds-1111", name: "overcode_memory" }]))
      .mockResolvedValueOnce(jsonResponse({ "ds-1111": "DATASET_PROCESSING_COMPLETED" }))
      .mockResolvedValueOnce(
        jsonResponse([
          { id: "data-2222", name: "worktree-compare-abc123.json" },
          { id: "data-3333", name: "other-item.json" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse(null));

    const result = await forgetMemory({ id: "worktree-compare-abc123" });

    expect(result).toMatchObject({ ok: true, skipped: false, forgotten: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/api/v1/datasets/`);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${ENDPOINT}/api/v1/datasets/status?dataset_ids=ds-1111`,
    );
    expect(fetchMock.mock.calls[2][0]).toBe(`${ENDPOINT}/api/v1/datasets/ds-1111/data`);
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(deleteUrl).toBe(`${ENDPOINT}/api/v1/datasets/ds-1111/data/data-2222`);
    expect(deleteInit.method).toBe("DELETE");
  });

  it("reports when the dataset is still processing instead of surfacing a server error", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: "ds-1111", name: "overcode_memory" }]))
      .mockResolvedValueOnce(jsonResponse({ "ds-1111": "DATASET_PROCESSING_STARTED" }));

    const result = await forgetMemory({ id: "worktree-compare-abc123" });

    expect(result.ok).toBe(false);
    expect(result.forgotten).toBe(false);
    expect(result.reason).toMatch(/processing/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps a server error during id deletion to a retryable reason", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: "ds-1111", name: "overcode_memory" }]))
      .mockResolvedValueOnce(jsonResponse({ "ds-1111": "DATASET_PROCESSING_COMPLETED" }))
      .mockResolvedValueOnce(
        jsonResponse([{ id: "data-2222", name: "worktree-compare-abc123.json" }]),
      )
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));

    const result = await forgetMemory({ id: "worktree-compare-abc123" });

    expect(result.ok).toBe(false);
    expect(result.forgotten).toBe(false);
    expect(result.reason).toMatch(/retry/i);
  });

  it("reports when no stored memory matches the id and sends no delete request", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: "ds-1111", name: "overcode_memory" }]))
      .mockResolvedValueOnce(jsonResponse({ "ds-1111": "DATASET_PROCESSING_COMPLETED" }))
      .mockResolvedValueOnce(jsonResponse([{ id: "data-3333", name: "other-item.json" }]));

    const result = await forgetMemory({ id: "missing-id" });

    expect(result.ok).toBe(false);
    expect(result.forgotten).toBe(false);
    expect(result.reason).toContain("missing-id");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports when the dataset does not exist on the server", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "ds-9999", name: "unrelated" }]));

    const result = await forgetMemory({ id: "worktree-compare-abc123" });

    expect(result.ok).toBe(false);
    expect(result.forgotten).toBe(false);
    expect(result.reason).toContain("overcode_memory");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still clears the whole dataset when no id is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    const result = await forgetMemory({ datasetName: "overcode_memory" });

    expect(result).toMatchObject({ ok: true, skipped: false, forgotten: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ENDPOINT}/api/v1/forget`);
    expect(JSON.parse(init.body as string)).toEqual({
      dataset: "overcode_memory",
      memoryOnly: true,
    });
  });
});

describe("rememberMemory session and node set", () => {
  it("forwards sessionId and node_set fields to the remember endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    const result = await rememberMemory({
      sessionId: "overcode-demo",
      nodeSet: ["repo:overcode"],
      documents: [{ id: "doc-one", kind: "summary", title: "One", summary: "First" }],
    });

    expect(result.ok).toBe(true);
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("session_id")).toBe("overcode-demo");
    expect(body.getAll("node_set")).toEqual(["repo:overcode"]);
  });

  it("omits session_id unless explicitly provided, keeping items dataset-addressable", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await rememberMemory({
      documents: [{ id: "doc-one", kind: "summary", title: "One", summary: "First" }],
    });

    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("session_id")).toBeNull();
  });
});

describe("recallMemory timeout", () => {
  it("gives recall an LLM-scale timeout instead of the 8s storage timeout", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      );

      const pending = recallMemory({ query: "cold graph completion" });
      let settled: unknown = null;
      void pending.then((value) => {
        settled = value;
      });

      // 8s (the storage timeout) must NOT kill a recall...
      await vi.advanceTimersByTimeAsync(9_000);
      expect(settled).toBeNull();

      // ...but the recall-specific ceiling eventually does.
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/timed out after 30000ms/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("recallMemory node set filter", () => {
  it("passes nodeSet through as the nodeName filter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await recallMemory({ query: "what changed", nodeSet: ["repo:overcode"] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.nodeName).toEqual(["repo:overcode"]);
  });

  it("omits the nodeName filter when no node set is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await recallMemory({ query: "what changed" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.nodeName).toBeUndefined();
  });
});

describe("cogneeUsage", () => {
  it("reads storage usage from the quotas endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ storageLimitInBytes: 536_870_912, storageUsedInBytes: 1_048_576 }),
    );

    const usage = await cogneeUsage();

    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/api/v1/quotas/usage`);
    expect(usage).toMatchObject({
      ok: true,
      skipped: false,
      storageLimitInBytes: 536_870_912,
      storageUsedInBytes: 1_048_576,
    });
  });

  it("skips when Cognee is unconfigured", async () => {
    delete process.env.COGNEE_API_URL;

    const usage = await cogneeUsage();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(usage.ok).toBe(false);
    expect(usage.skipped).toBe(true);
  });
});

describe("rememberMemory upload naming", () => {
  it("uploads each document as its own file named by a sanitized document id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    const result = await rememberMemory({
      documents: [
        { id: "doc-one", kind: "summary", title: "One", summary: "First" },
        { id: "doc/two v2", kind: "note", title: "Two", summary: "Second" },
      ],
    });

    expect(result).toMatchObject({ ok: true, stored: 2 });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    const files = body.getAll("data") as File[];
    expect(files.map((file) => file.name)).toEqual(["doc-one.json", "doc-two-v2.json"]);
    const first = JSON.parse(await files[0].text());
    expect(first.id).toBe("doc-one");
  });
});
