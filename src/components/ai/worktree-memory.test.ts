import { describe, expect, it } from "vitest";
import type { AIEnvelope, WorktreeCompareData } from "../../lib/ai-structured";
import type { WorktreeComparePayload } from "../../lib/ai-features";
import { buildWorktreeCompareMemoryInput } from "./worktree-memory";

describe("worktree Cognee memory payload", () => {
  it("builds a bounded memory document without raw source or diff payloads", () => {
    const payload: WorktreeComparePayload = {
      repoId: "repo-1",
      repoName: "overcode",
      repoPath: "/workspace/overcode",
      targetPath: "/workspace/overcode-feature",
      base: "origin/main",
      target: "feature/cognee",
      branch: "feature/cognee",
      ahead: 4,
      behind: 1,
      dirtyFiles: 2,
      diffStat: "raw diff stat should not be stored",
      patch: "diff --git a/secret b/secret",
      uncommittedDiff: "secret=true",
      changedFiles: [
        "src/components/WorktreeList.tsx",
        "src/components/ai/WorktreeCompare.tsx",
      ],
      uniqueCommits: ["abc1234"],
    };
    const result: AIEnvelope<WorktreeCompareData> = {
      schemaVersion: 1,
      feature: "worktree_compare",
      confidence: "medium",
      summary: "Cognee memory now captures worktree comparison decisions.",
      warnings: [],
      data: {
        base: "origin/main",
        target: "feature/cognee",
        ahead: 4,
        behind: 1,
        dirtyFiles: 2,
        intent: "Make Cognee memory visible in the worktree workflow.",
        moduleMap: [
          {
            module: "worktree-memory",
            files: ["src/components/ai/WorktreeCompare.tsx"],
            risk: "medium",
          },
        ],
        readiness: "reviewable",
        nextActions: [
          "Run the Cognee recall demo.",
          "Do not store OPENROUTER_API_KEY=sk-or-secret-value-123456789",
        ],
        prDraft: {
          title: "Make Cognee memory visible",
          body: "Adds explicit remember and recall moments.",
        },
      },
    };

    const memory = buildWorktreeCompareMemoryInput(payload, result);
    const document = memory.documents[0];

    expect(memory.datasetName).toBe("overcode_memory");
    expect(document.kind).toBe("summary");
    expect(document.title).toBe("Cognee worktree memory for overcode");
    expect(document.tags).toEqual([
      "cognee",
      "worktree-compare",
      "ai-output",
      "src/components/WorktreeList.tsx",
      "src/components/ai/WorktreeCompare.tsx",
      "worktree",
    ]);
    expect(document.metadata).toMatchObject({
      repo: "repo-1",
      branch: "feature/cognee",
      base: "origin/main",
      target: "feature/cognee",
      readiness: "reviewable",
      confidence: "medium",
      changed_paths: "src/components/WorktreeList.tsx,src/components/ai/WorktreeCompare.tsx",
    });
    expect(document.summary).toContain("Make Cognee memory visible in the worktree workflow.");
    expect(document.summary).toContain("Modules: worktree-memory [medium]");
    expect(JSON.stringify(memory)).not.toContain("diff --git");
    expect(JSON.stringify(memory)).not.toContain("secret=true");
    expect(JSON.stringify(memory)).not.toContain("sk-or-secret");
    expect(memory.nodeSet).toEqual(["repo:overcode"]);
  });
});
