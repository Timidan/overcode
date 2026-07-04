import { describe, expect, it } from "vitest";
import {
  buildCogneeWorkspaceBrief,
  buildCogneeWorkspaceBriefRecallRequest,
  buildCogneeWorkspaceBriefTeaser,
} from "./cognee-workspace-brief";
import { COGNEE_WORKSPACE_DATASET } from "./cognee-workflow-memory";
import type { MemoryRecallItem } from "./ipc";
import type { DashboardStats, WorkspaceRepository } from "./workspace-data";

const stats: DashboardStats = {
  commits: 12,
  prs: 2,
  repos: 3,
  localChanges: 7,
};

const repositories: WorkspaceRepository[] = [
  {
    id: "repo-overcode",
    name: "overcode",
    platform: "local",
    local_path: "/home/timidan/Desktop/persona/overcode",
    dirty_count: 5,
  },
  {
    id: "repo-toolkit",
    name: "web3-toolkit",
    platform: "github",
    local_path: "/home/timidan/Desktop/persona/web3-toolkit",
    dirty_count: 2,
  },
  {
    id: "repo-lifi",
    name: "lifi-integration",
    platform: "github",
    local_path: "/home/timidan/Desktop/persona/lifi-integration",
    dirty_count: 0,
  },
];

describe("Cognee workspace brief", () => {
  it("builds a workspace-scoped recall request without narrowing to one repo", () => {
    const request = buildCogneeWorkspaceBriefRecallRequest(repositories, stats);

    expect(request).toEqual({
      query: expect.stringContaining("Recall Overcode workspace memory across all pinned repositories."),
      datasets: [COGNEE_WORKSPACE_DATASET],
      limit: 6,
    });
    expect(request?.query).toContain("overcode");
    expect(request?.query).toContain("web3-toolkit");
    expect(request?.query).toContain("Prioritize memories from different repositories");
    expect(request?.filters).toBeUndefined();
    expect(request?.nodeSet).toBeUndefined();
  });

  it("surfaces narrow Cognee coverage instead of implying the whole workspace is represented", () => {
    const items: MemoryRecallItem[] = [
      {
        id: "memory-1",
        title: "Repo brief for overcode",
        summary:
          "Overcode is the desktop workspace hub. A risk is that Cognee memory coverage is currently concentrated in this repo.",
        metadata: {
          repository: "overcode",
          repo: "repo-overcode",
        },
      },
    ];

    const brief = buildCogneeWorkspaceBrief(items, repositories, stats);

    expect(brief.coverageLabel).toBe("1/3 workspaces");
    expect(brief.coverageNote).toContain("Cognee currently recalled memory for 1 of 3");
    expect(brief.coverageNote).toContain("web3-toolkit");
    expect(brief.watchpoints[0]).toContain("risk");
    expect(brief.repoSignals.find((repo) => repo.repo === "web3-toolkit")?.hasMemory).toBe(false);
    expect(buildCogneeWorkspaceBriefTeaser(brief)).toContain("strongest signal is overcode");
  });

  it("maps local path metadata back to a pinned workspace", () => {
    const items: MemoryRecallItem[] = [
      {
        id: "memory-2",
        title: "LiFi route memory",
        summary: "The route checker depends on quote freshness and allowance validation.",
        metadata: {
          repo: "local:/home/timidan/Desktop/persona/lifi-integration",
        },
      },
    ];

    const brief = buildCogneeWorkspaceBrief(items, repositories, stats);

    expect(brief.memories[0]).toMatchObject({
      repo: "lifi-integration",
      title: "LiFi route memory",
    });
    expect(brief.repoSignals[0].repo).toBe("lifi-integration");
  });
});
