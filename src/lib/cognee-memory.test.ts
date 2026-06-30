import { describe, expect, it } from "vitest";

import {
  buildImpactMemoryContext,
  buildWorktreeMemoryDocument,
  buildWorktreeRecallQuery,
  moduleKeyFromPath,
  normalizeModulePath,
} from "./cognee-memory";
import type { MemoryEdgeKind, MemoryEntityKind } from "./cognee-memory-types";

const expectedEntityKinds: MemoryEntityKind[] = [
  "repo",
  "worktree",
  "commit",
  "pull_request",
  "issue",
  "stash",
  "module",
  "ai_output",
  "risk",
  "decision",
  "convention",
];

const expectedEdgeKinds: MemoryEdgeKind[] = [
  "ADDRESSES",
  "MOTIVATED_BY",
  "TOUCHES",
  "MODIFIES",
  "FLAGS",
  "LOCATED_IN",
  "ANALYZES",
  "SUPERSEDES",
  "APPLIES_TO",
  "RELATED_TO",
];

describe("Cognee memory schema", () => {
  it("exposes the app-level entity and edge kinds", () => {
    expect(expectedEntityKinds).toContain("worktree");
    expect(expectedEntityKinds).toContain("decision");
    expect(expectedEdgeKinds).toContain("MODIFIES");
    expect(expectedEdgeKinds).toContain("APPLIES_TO");
  });
});

describe("module path helpers", () => {
  it("normalizes module paths deterministically", () => {
    expect(normalizeModulePath(" ./src\\lib//cognee-memory.ts ")).toBe(
      "src/lib/cognee-memory.ts",
    );
    expect(normalizeModulePath("/src/lib/../app.ts")).toBe("src/app.ts");
    expect(normalizeModulePath("")).toBe(".");
  });

  it("builds stable module keys from normalized paths", () => {
    expect(moduleKeyFromPath(" ./src\\lib//cognee-memory.ts ")).toBe(
      "module:src/lib/cognee-memory.ts",
    );
  });
});

describe("worktree recall query", () => {
  it("builds a deterministic query from bounded worktree metadata", () => {
    expect(
      buildWorktreeRecallQuery({
        repo: "overcode",
        branch: "feature/cognee-memory",
        modules: ["src/lib/cognee-memory.ts", "src/lib/cognee-memory-types.ts"],
        issueIds: ["42"],
        riskKinds: ["source-leakage"],
      }),
    ).toBe(
      "Recall Overcode memory for repo overcode on branch feature/cognee-memory touching modules src/lib/cognee-memory-types.ts, src/lib/cognee-memory.ts addressing issues 42 with risks source-leakage.",
    );
  });
});

describe("impact memory context", () => {
  it("renders compact impact context from memory documents", () => {
    const context = buildImpactMemoryContext([
      {
        id: "memory:overcode:wt-1",
        metadata: {
          repo: "overcode",
          branch: "feature/cognee-memory",
          createdAt: "2026-06-30T10:00:00.000Z",
          summary: "Adds bounded memory helpers.",
        },
        entities: [
          {
            id: "module:src/lib/cognee-memory.ts",
            kind: "module",
            label: "src/lib/cognee-memory.ts",
            summary: "Pure memory query and document builders.",
            refs: [{ kind: "file", value: "src/lib/cognee-memory.ts" }],
          },
          {
            id: "risk:raw-source",
            kind: "risk",
            label: "Raw source leakage",
            summary: "Memory must store summaries and references only.",
          },
        ],
        edges: [
          {
            from: "memory:overcode:wt-1",
            to: "module:src/lib/cognee-memory.ts",
            kind: "TOUCHES",
            summary: "Adds helper coverage.",
          },
        ],
      },
    ]);

    expect(context).toBe(
      [
        "Memory memory:overcode:wt-1: Adds bounded memory helpers.",
        "- module src/lib/cognee-memory.ts: Pure memory query and document builders. [file:src/lib/cognee-memory.ts]",
        "- risk Raw source leakage: Memory must store summaries and references only.",
        "- TOUCHES: memory:overcode:wt-1 -> module:src/lib/cognee-memory.ts (Adds helper coverage.)",
      ].join("\n"),
    );
  });
});

describe("worktree memory document", () => {
  it("builds deterministic app-level memory without raw diff or source content", () => {
    const document = buildWorktreeMemoryDocument({
      repo: "overcode",
      worktreeId: "wt-1",
      branch: "feature/cognee-memory",
      createdAt: "2026-06-30T10:00:00.000Z",
      summary: "Adds bounded memory helpers.",
      modules: [
        {
          path: "src/lib/cognee-memory.ts",
          summary: "Pure memory query and document builders.",
        },
      ],
      decisions: [{ id: "bounded-memory", summary: "Store summaries and refs only." }],
      risks: [{ id: "raw-source", summary: "Raw source leakage is avoided." }],
      issues: [{ id: "42", summary: "Need local recall for worktree context." }],
      aiOutputs: [
        {
          id: "review-summary",
          summary: "Summarized review findings.",
          refs: [{ kind: "artifact", value: "review.md" }],
        },
      ],
      sourceSnippets: [
        "export const secret = 'do-not-store';",
        "@@ -1,2 +1,2 @@\n- raw diff\n+ raw patch",
      ],
      diff: "@@ -1,2 +1,2 @@\n- raw diff\n+ raw patch",
    });

    expect(document).toMatchObject({
      id: "memory:overcode:wt-1",
      metadata: {
        repo: "overcode",
        branch: "feature/cognee-memory",
        createdAt: "2026-06-30T10:00:00.000Z",
        summary: "Adds bounded memory helpers.",
      },
    });
    expect(document.entities.map((entity) => [entity.kind, entity.id])).toEqual([
      ["repo", "repo:overcode"],
      ["worktree", "worktree:overcode:wt-1"],
      ["module", "module:src/lib/cognee-memory.ts"],
      ["issue", "issue:42"],
      ["decision", "decision:bounded-memory"],
      ["risk", "risk:raw-source"],
      ["ai_output", "ai_output:review-summary"],
    ]);
    expect(document.edges.map((edge) => [edge.kind, edge.from, edge.to])).toEqual([
      ["LOCATED_IN", "worktree:overcode:wt-1", "repo:overcode"],
      ["TOUCHES", "worktree:overcode:wt-1", "module:src/lib/cognee-memory.ts"],
      ["ADDRESSES", "worktree:overcode:wt-1", "issue:42"],
      ["MOTIVATED_BY", "decision:bounded-memory", "worktree:overcode:wt-1"],
      ["FLAGS", "risk:raw-source", "worktree:overcode:wt-1"],
      ["ANALYZES", "ai_output:review-summary", "worktree:overcode:wt-1"],
    ]);

    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("do-not-store");
    expect(serialized).not.toContain("@@ -1,2 +1,2 @@");
    expect(serialized).not.toContain("raw patch");
  });

  it("bounds stored summaries instead of preserving arbitrarily long content", () => {
    const document = buildWorktreeMemoryDocument({
      repo: "overcode",
      worktreeId: "wt-2",
      createdAt: "2026-06-30T10:00:00.000Z",
      summary: "b".repeat(500),
      modules: [
        {
          path: "src/lib/large.ts",
          summary: "a".repeat(500),
        },
      ],
    });

    expect(document.metadata.summary).toHaveLength(280);
    expect(document.metadata.summary.endsWith("...")).toBe(true);
    expect(document.entities.find((entity) => entity.kind === "module")?.summary).toHaveLength(
      280,
    );
  });
});
