import { describe, expect, it } from "vitest";
import {
  COGNEE_WORKSPACE_DATASET,
  buildCogneeMemoryPromptSection,
  buildCogneeRecallRequest,
  buildCogneeSummaryMemoryInput,
  extractCogneeMemoryHighlight,
  extractCogneeMemoryHighlights,
  extractCogneeMemoryReferences,
  formatCogneeRecallContext,
} from "./cognee-workflow-memory";
import type { MemoryRecallItem } from "./ipc";

describe("Cognee workflow memory helpers", () => {
  it("builds a focused recall request for a workflow and repo context", () => {
    const request = buildCogneeRecallRequest({
      source: "issue triage",
      repoId: "repo-1",
      repoName: "overcode",
      branch: "feature/memory",
      paths: ["src/App.tsx", "src/App.tsx", " src/lib/ipc.ts "],
      issueNumber: 42,
      tags: ["bug", "regression"],
      limit: 7,
    });

    expect(request).toEqual({
      query:
        "Recall Overcode memory for issue triage in repo overcode on branch feature/memory touching src/App.tsx, src/lib/ipc.ts for issue #42 tagged bug, regression.",
      datasets: [COGNEE_WORKSPACE_DATASET],
      limit: 7,
      filters: { repo: "repo-1", branch: "feature/memory" },
    });
  });

  it("skips recall requests without a source or repo scope", () => {
    expect(buildCogneeRecallRequest({ source: " ", repoName: " " })).toBeNull();
    expect(buildCogneeRecallRequest({ source: "repo brief" })).toBeNull();
  });

  it("formats bounded recall context with memory references", () => {
    const items: MemoryRecallItem[] = [
      {
        id: "memory-1",
        title: "Past issue triage",
        summary: "Use the settings IPC sanitizer before saving provider credentials.",
        metadata: {
          changed_paths: "electron/lib/settings-ipc-sanitizer.ts, src/screens/Settings.tsx",
          url: "https://github.com/Timidan/overcode/issues/42",
        },
      },
    ];

    const context = formatCogneeRecallContext(items, { maxChars: 220 });

    expect(context).toContain("Memory memory-1: Past issue triage");
    expect(context).toContain("Use the settings IPC sanitizer");
    expect(context).toContain("References: electron/lib/settings-ipc-sanitizer.ts");
    expect(context.length).toBeLessThanOrEqual(220);
  });

  it("wraps recalled memory as an explicit Cognee prompt section", () => {
    expect(buildCogneeMemoryPromptSection("prior decisions")).toBe(
      "COGNEE MEMORY CONTEXT:\nprior decisions",
    );
    expect(
      buildCogneeMemoryPromptSection("OPENROUTER_API_KEY=sk-or-secret-value-123456789"),
    ).not.toContain("sk-or-secret");
    expect(buildCogneeMemoryPromptSection("   ")).toBe("");
  });

  it("builds a sanitized remember payload with source metadata and bounded tags", () => {
    const memory = buildCogneeSummaryMemoryInput({
      source: "pr review",
      repoId: "repo-1",
      repoName: "overcode",
      branch: "feature/memory",
      prNumber: 8,
      subject: "Review Authorization: Bearer abcdefghijklmnopqrst",
      title: "PR review for overcode #8",
      summary:
        "AI found a missing test around the memory ledger source breakdown. OPENROUTER_API_KEY=sk-or-secret-value-123456789",
      paths: [
        "src/lib/cognee-memory-ledger.ts",
        "src/lib/cognee-memory-ledger.test.ts",
        "src/lib/cognee-memory-ledger.ts",
      ],
      tags: ["review", "testing"],
      data: {
        readiness: "needs_review",
        risk: "ANTHROPIC_API_KEY=sk-ant-secret-value-123456789",
        risk_count: 1,
        rawDiff: "diff --git a/secret b/secret\n+OPENROUTER_API_KEY=leak",
        sourceCode: "const token = 'secret';",
        patch: "diff --git a/private b/private\n+secret",
        body: "user supplied issue body with private context",
      },
    });

    expect(memory.datasetName).toBe(COGNEE_WORKSPACE_DATASET);
    expect(memory.documents).toHaveLength(1);
    expect(memory.documents[0]).toMatchObject({
      kind: "pull_request",
      title: "PR review for overcode #8",
      tags: [
        "cognee",
        "pr-review",
        "ai-output",
        "src/lib/cognee-memory-ledger.ts",
        "src/lib/cognee-memory-ledger.test.ts",
        "review",
        "testing",
      ],
      metadata: {
        source: "pr review",
        repo: "repo-1",
        repository: "overcode",
        branch: "feature/memory",
        pull_request: 8,
        readiness: "needs_review",
        risk: "[redacted secret]",
        risk_count: 1,
        subject: "Review Authorization: [redacted secret]",
      },
    });
    expect(JSON.stringify(memory)).not.toContain("OPENROUTER_API_KEY");
    expect(JSON.stringify(memory)).not.toContain("sk-or-secret");
    expect(JSON.stringify(memory)).not.toContain("sk-ant-secret");
    expect(JSON.stringify(memory)).not.toContain("abcdefghijklmnopqrst");
    expect(JSON.stringify(memory)).not.toContain("const token");
    expect(JSON.stringify(memory)).not.toContain("user supplied issue body");
    expect(JSON.stringify(memory)).not.toContain("a/private");
  });

  it("keeps path tags before optional tags when the tag budget is tight", () => {
    const memory = buildCogneeSummaryMemoryInput({
      source: "code inspector",
      repoId: "repo-1",
      repoName: "overcode",
      title: "Code memory",
      summary: "Explains a changed module.",
      paths: Array.from({ length: 10 }, (_, index) => `src/file-${index}.ts`),
      tags: Array.from({ length: 20 }, (_, index) => `label-${index}`),
    });

    expect(memory.documents[0].tags).toEqual([
      "cognee",
      "code-inspector",
      "ai-output",
      "src/file-0.ts",
      "src/file-1.ts",
      "src/file-2.ts",
      "src/file-3.ts",
      "src/file-4.ts",
      "src/file-5.ts",
      "src/file-6.ts",
      "src/file-7.ts",
      "src/file-8.ts",
      "src/file-9.ts",
      "label-0",
      "label-1",
      "label-2",
    ]);
  });

  it("extracts every content block for the full memory view", () => {
    const context = [
      "Memory cognee:0: Memory result 1 Nodes:",
      "Node: brief... [overcode]",
      "__node_content_start__",
      "The repository brief describes Overcode.",
      "__node_content_end__",
      "Node: risks... [auth]",
      "__node_content_start__",
      "Impact analysis flagged auth/session.ts as risky.",
      "__node_content_end__",
    ].join("\n");

    expect(extractCogneeMemoryHighlights(context)).toEqual([
      "The repository brief describes Overcode.",
      "Impact analysis flagged auth/session.ts as risky.",
    ]);
  });

  it("drops raw record JSON blocks when prose blocks exist", () => {
    const context = [
      "__node_content_start__",
      "The repository brief describes Overcode.",
      "__node_content_end__",
      "__node_content_start__",
      '{ "id": "repo-brief:gr4dk5", "kind": "repository", "summary": "..." }',
      "__node_content_end__",
    ].join("\n");

    expect(extractCogneeMemoryHighlights(context)).toEqual([
      "The repository brief describes Overcode.",
    ]);
  });

  it("keeps a JSON block when it is the only content", () => {
    const context = [
      "__node_content_start__",
      '{ "id": "repo-brief:gr4dk5" }',
      "__node_content_end__",
    ].join("\n");

    expect(extractCogneeMemoryHighlights(context)).toEqual(['{ "id": "repo-brief:gr4dk5" }']);
  });

  it("extracts a human sentence from a graph-completion context dump", () => {
    const context = [
      "Memory cognee:0: Memory result 1 Nodes:",
      "Node: The repository brief describes Overcode,... [overcode, repository, brief]",
      "__node_content_start__",
      "The repository brief describes Overcode, a desktop developer workspace hub, and",
      "provides details about its stack and memory integration.",
      "__node_content_end__",
    ].join("\n");

    expect(extractCogneeMemoryHighlight(context)).toBe(
      "The repository brief describes Overcode, a desktop developer workspace hub, and provides details about its stack and memory integration.",
    );
  });

  it("falls back to stripping graph markers when no content block exists", () => {
    expect(
      extractCogneeMemoryHighlight(
        "Memory cognee:0: Memory result 1 Nodes:\nNode: Impact analysis flagged auth/session.ts as risky. [auth]",
      ),
    ).toBe("Impact analysis flagged auth/session.ts as risky. [auth]");
  });

  it("returns null for empty or marker-only context", () => {
    expect(extractCogneeMemoryHighlight("")).toBeNull();
    expect(extractCogneeMemoryHighlight("Nodes:\n__node_content_start__\n__node_content_end__")).toBeNull();
  });

  it("extracts memory references from string and array metadata fields", () => {
    expect(
      extractCogneeMemoryReferences({
        id: "memory-1",
        title: "Memory",
        summary: "Summary",
        metadata: {
          changed_paths: ["src/App.tsx", "src/App.tsx"],
          paths: "src/lib/ipc.ts, src/lib/ai-features.ts",
        },
      }),
    ).toEqual(["src/App.tsx", "src/lib/ipc.ts", "src/lib/ai-features.ts"]);
  });
});
