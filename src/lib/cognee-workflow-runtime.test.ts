import { describe, expect, it, vi } from "vitest";
import {
  recallCogneeWorkflowMemory,
  rememberCogneeWorkflowSummary,
  type CogneeWorkflowMemoryClient,
} from "./cognee-workflow-runtime";

describe("Cognee workflow memory runtime", () => {
  it("recalls formatted context through an injected client", async () => {
    const client: CogneeWorkflowMemoryClient = {
      recallMemory: vi.fn(async () => ({
        ok: true,
        skipped: false,
        items: [
          {
            id: "memory-1",
            title: "Commit convention",
            summary: "Use feat(memory) for Cognee dashboard changes.",
            metadata: { changed_paths: "src/screens/CogneeDashboard.tsx" },
          },
        ],
      })),
      rememberMemory: vi.fn(),
    };

    const recalled = await recallCogneeWorkflowMemory(
      {
        source: "commit assistant",
        repoId: "repo-1",
        repoName: "overcode",
        branch: "feature/cognee",
      },
      client,
    );

    expect(client.recallMemory).toHaveBeenCalledWith({
      query:
        "Recall Overcode memory for commit assistant in repo overcode on branch feature/cognee.",
      datasets: ["overcode_memory"],
      limit: 5,
      filters: { repo: "repo-1", branch: "feature/cognee" },
    });
    expect(recalled).toMatchObject({
      itemCount: 1,
      summary: "1 recalled Cognee memory item",
      references: ["src/screens/CogneeDashboard.tsx"],
      items: [
        expect.objectContaining({
          id: "memory-1",
          title: "Commit convention",
        }),
      ],
    });
    expect(recalled?.context).toContain("Use feat(memory)");
  });

  it("can keep repo-level recall scoped to the requested repository", async () => {
    const client: CogneeWorkflowMemoryClient = {
      recallMemory: vi.fn(async () => ({
        ok: true,
        skipped: false,
        items: [
          {
            id: "overcode-memory",
            title: "Repo brief for Overcode",
            summary: "Overcode has a Cognee dashboard and BYOK AI providers.",
            metadata: { repo: "overcode", repository: "overcode" },
          },
          {
            id: "synth-memory",
            title: "Repo brief for synth-x",
            summary: "synth-x needs release preparation and dependency checks.",
            metadata: { repo: "repo-synth", repository: "synth-x" },
          },
        ],
      })),
      rememberMemory: vi.fn(),
    };

    const recalled = await recallCogneeWorkflowMemory(
      {
        source: "repo detail",
        repoId: "repo-synth",
        repoName: "synth-x",
      },
      client,
      { requireRepoMatch: true },
    );

    expect(recalled?.itemCount).toBe(1);
    expect(recalled?.items[0]?.id).toBe("synth-memory");
    expect(recalled?.context).toContain("synth-x needs release preparation");
    expect(recalled?.context).not.toContain("Overcode has a Cognee dashboard");
  });

  it("retries once when the first recall comes back empty and retryOnEmpty is set", async () => {
    vi.useFakeTimers();
    try {
      const recallMemory = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, skipped: false, items: [] })
        .mockResolvedValueOnce({
          ok: true,
          skipped: false,
          items: [
            {
              id: "memory-1",
              title: "Warm answer",
              summary: "Cold recall returned nothing; the retry found it.",
            },
          ],
        });
      const client: CogneeWorkflowMemoryClient = { recallMemory, rememberMemory: vi.fn() };

      const pending = recallCogneeWorkflowMemory(
        { source: "morning brief", repoName: "overcode" },
        client,
        { retryOnEmpty: true, retryDelayMs: 4_000 },
      );
      await vi.advanceTimersByTimeAsync(4_000);
      const recalled = await pending;

      expect(recallMemory).toHaveBeenCalledTimes(2);
      expect(recalled?.itemCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry empty recalls unless asked to", async () => {
    const recallMemory = vi.fn(async () => ({ ok: true, skipped: false, items: [] }));
    const client: CogneeWorkflowMemoryClient = { recallMemory, rememberMemory: vi.fn() };

    await expect(
      recallCogneeWorkflowMemory({ source: "repo brief", repoName: "overcode" }, client),
    ).resolves.toBeNull();
    expect(recallMemory).toHaveBeenCalledTimes(1);
  });

  it("returns null when recall is skipped or unavailable", async () => {
    const client: CogneeWorkflowMemoryClient = {
      recallMemory: vi.fn(async () => ({
        ok: false,
        skipped: true,
        reason: "Cognee is not configured.",
        items: [],
      })),
      rememberMemory: vi.fn(),
    };

    await expect(
      recallCogneeWorkflowMemory({ source: "repo brief", repoName: "overcode" }, client),
    ).resolves.toBeNull();
  });

  it("returns null when recall fails", async () => {
    const client: CogneeWorkflowMemoryClient = {
      recallMemory: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
      rememberMemory: vi.fn(),
    };

    await expect(
      recallCogneeWorkflowMemory({ source: "repo brief", repoName: "overcode" }, client),
    ).resolves.toBeNull();
  });

  it("remembers sanitized workflow summaries through an injected client", async () => {
    const client: CogneeWorkflowMemoryClient = {
      recallMemory: vi.fn(),
      rememberMemory: vi.fn(async () => ({ ok: true, skipped: false, stored: 1 })),
    };

    const remembered = await rememberCogneeWorkflowSummary(
      {
        source: "testing memory",
        repoId: "repo-1",
        repoName: "overcode",
        title: "Testing memory for overcode",
        summary: "Unit tests pass after Cognee prompt wiring.",
        paths: ["src/lib/ai-features.ts"],
      },
      client,
    );

    expect(remembered).toBe(true);
    expect(client.rememberMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetName: "overcode_memory",
        documents: [
          expect.objectContaining({
            title: "Testing memory for overcode",
            metadata: expect.objectContaining({
              source: "testing memory",
              repo: "repo-1",
            }),
          }),
        ],
      }),
    );
  });

  it("returns false when remember fails", async () => {
    const client: CogneeWorkflowMemoryClient = {
      recallMemory: vi.fn(),
      rememberMemory: vi.fn(async () => {
        throw new Error("cognee unavailable");
      }),
    };

    await expect(
      rememberCogneeWorkflowSummary(
        {
          source: "testing memory",
          repoName: "overcode",
          title: "Testing memory",
          summary: "Remember should not break the caller.",
        },
        client,
      ),
    ).resolves.toBe(false);
  });
});
