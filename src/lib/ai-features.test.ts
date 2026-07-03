import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIEnvelope, RepoBriefData } from "./ai-structured";

const mockIpc = vi.hoisted(() => ({
  callAIModel: vi.fn(),
  getFromStore: vi.fn(),
  setInStore: vi.fn(),
}));

vi.mock("./ipc", () => ({
  ipc: mockIpc,
}));

function briefEnvelope(
  data: Partial<RepoBriefData>,
  warnings: string[] = [],
): AIEnvelope<RepoBriefData> {
  return {
    schemaVersion: 1,
    feature: "brief",
    summary: data.purpose ?? "Repository brief.",
    confidence: warnings.length > 0 ? "low" : "high",
    warnings,
    data: {
      purpose: data.purpose ?? "Repository brief.",
      keyModules: data.keyModules ?? [],
      recentActivity: data.recentActivity ?? [],
      onboardingPath: data.onboardingPath ?? [],
      notableRisks: data.notableRisks ?? [],
    },
  };
}

describe("repo brief structured generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpc.getFromStore.mockResolvedValue({});
    mockIpc.setInStore.mockResolvedValue(undefined);
  });

  it("adds an evidence budget to the repo brief prompt", async () => {
    const rich = briefEnvelope({
      purpose: "Overcode consolidates local Git and provider activity.",
      keyModules: [
        { name: "AI panel", path: "src/components/ai", role: "Renders AI workflows." },
        { name: "IPC", path: "src/lib/ipc.ts", role: "Calls Electron bridge." },
        { name: "Main", path: "electron", role: "Owns provider adapters." },
      ],
      recentActivity: [
        { label: "Add structured checks", evidence: "recent commit" },
        { label: "Improve Cognee dashboard", evidence: "recent commit" },
      ],
      onboardingPath: ["Read README", "Inspect src/components/ai", "Run tests"],
      notableRisks: ["Provider output can be slow."],
    });
    mockIpc.callAIModel.mockResolvedValue(JSON.stringify(rich));

    const { getRepoBriefStructured } = await import("./ai-features");
    await getRepoBriefStructured({
      repoId: "repo-1",
      repoName: "overcode",
      branch: "main",
      tree: ["src/components/ai/RepoBrief.tsx", "src/lib/ai-features.ts"],
      readme: "Overcode is a native desktop hub for Git workspaces and Cognee memory.",
      recentCommits: ["Add in-app structured checks"],
      changedFiles: ["src/lib/ai-features.ts"],
    });

    const prompt = mockIpc.callAIModel.mock.calls[0]?.[1] as string;
    expect(prompt).toContain("EVIDENCE BUDGET:");
    expect(prompt).toContain("File tree entries: 2");
    expect(prompt).toContain("README/package characters:");
    expect(prompt).toContain("Evidence level:");
    expect(prompt).toContain("If the evidence level is sufficient");
  });

  it("retries when a model returns a thin valid brief despite sufficient evidence", async () => {
    const thin = briefEnvelope(
      {
        purpose:
          "Desktop developer workspace hub for Git, pull requests, BYOK AI providers, and Cognee-backed repository memory.",
        keyModules: [],
        recentActivity: [],
        onboardingPath: [],
        notableRisks: [],
      },
      ["Limited repository data provided; details inferred from description only."],
    );
    const rich = briefEnvelope({
      purpose:
        "Overcode is a native Electron workspace that reads local Git state, provider activity, and Cognee memory into one operator console.",
      keyModules: [
        { name: "AI workflows", path: "src/components/ai", role: "Runs repo brief and related AI panels." },
        { name: "Feature prompts", path: "src/lib/ai-features.ts", role: "Builds structured prompts and local fallbacks." },
        { name: "Electron runtime", path: "electron/lib", role: "Handles Git, AI provider, and Cognee adapters." },
      ],
      recentActivity: [
        { label: "Structured model checks", evidence: "recent commit" },
        { label: "Cognee memory dashboard", evidence: "README and recent commit" },
      ],
      onboardingPath: ["Start with README.md", "Inspect src/lib/ai-features.ts", "Run npm test -- --run"],
      notableRisks: ["Model quality varies by provider and must be checked."],
    });
    mockIpc.callAIModel
      .mockResolvedValueOnce(JSON.stringify(thin))
      .mockResolvedValueOnce(JSON.stringify(rich));

    const { getRepoBriefStructured } = await import("./ai-features");
    const result = await getRepoBriefStructured({
      repoId: "repo-1",
      repoName: "overcode",
      branch: "main",
      tree: [
        "src/components/ai/RepoBrief.tsx",
        "src/lib/ai-features.ts",
        "electron/lib/ai-runtime.ts",
        "electron/ipc-handlers.ts",
      ],
      readme:
        "Overcode is a native desktop application that consolidates local Git state, GitHub, GitLab, BYOK AI providers, and Cognee-backed memory.",
      recentCommits: ["Add structured checks", "Improve Cognee dashboard"],
      changedFiles: ["src/lib/ai-features.ts"],
      memoryContext: "Memory memory-1: Repo briefs should show concrete evidence.",
    });

    expect(mockIpc.callAIModel).toHaveBeenCalledTimes(2);
    const retryPrompt = mockIpc.callAIModel.mock.calls[1]?.[1] as string;
    expect(retryPrompt).toContain("Return only valid JSON");
    expect(retryPrompt).toContain("data.keyModules");
    expect(retryPrompt).not.toContain("markdown sections");
    expect(result.data.keyModules).toHaveLength(3);
    expect(result.warnings).not.toContain(
      "Limited repository data provided; details inferred from description only.",
    );
  });

  it("uses the local evidence-backed brief when both model attempts stay thin", async () => {
    const thin = briefEnvelope(
      {
        purpose: "Provide a concise overview to get developers up to speed quickly.",
        keyModules: [],
        recentActivity: [],
        onboardingPath: ["Clone repo", "Install dependencies"],
        notableRisks: ["Repository facts were garbled."],
      },
      ["Repository facts were garbled; details may be incomplete."],
    );
    mockIpc.callAIModel
      .mockResolvedValueOnce(JSON.stringify(thin))
      .mockResolvedValueOnce(JSON.stringify(thin));

    const { getRepoBriefStructured } = await import("./ai-features");
    const result = await getRepoBriefStructured({
      repoId: "repo-1",
      repoName: "overcode",
      branch: "main",
      tree: [
        "README.md",
        "docs/cognee-submission-plan.md",
        "electron/lib/ai-runtime.ts",
        "public/brand/current/overcode-logo-light.svg",
      ],
      readme: [
        '<img src="public/brand/current/overcode-banner-dark-nobg.svg" alt="Overcode banner">',
        "Overcode is a native Electron workspace that consolidates local Git state, provider activity, BYOK AI providers, and Cognee memory for developers.",
      ].join("\n"),
      recentCommits: ["Add structured checks", "Improve Cognee dashboard"],
      changedFiles: ["src/lib/ai-features.ts"],
    });

    expect(mockIpc.callAIModel).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBe("low");
    expect(result.data.keyModules.length).toBeGreaterThanOrEqual(3);
    expect(result.data.recentActivity).toHaveLength(2);
    expect(result.data.keyModules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/",
          role: expect.stringContaining("renderer"),
        }),
        expect.objectContaining({
          path: "electron/",
          role: expect.stringContaining("main process"),
        }),
      ]),
    );
    expect(result.data.purpose).toContain("native Electron workspace");
    expect(result.warnings).toContain(
      "AI returned a shallow brief despite sufficient evidence; Overcode used the local repository evidence instead.",
    );
  });

  it("keeps provider failure reasons on the local fallback", async () => {
    mockIpc.callAIModel.mockRejectedValue(
      new Error("Error invoking remote method 'ai:complete': Error: OpenRouter returned 429"),
    );

    const { getRepoBriefStructured } = await import("./ai-features");
    const result = await getRepoBriefStructured({
      repoId: "repo-1",
      repoName: "overcode",
      branch: "main",
      tree: [
        "README.md",
        "src/lib/ai-features.ts",
        "electron/lib/ai-runtime.ts",
      ],
      readme:
        "Overcode is a native Electron workspace that consolidates local Git state, provider activity, BYOK AI providers, and Cognee memory for developers.",
      recentCommits: ["Add structured checks", "Improve Cognee dashboard"],
      changedFiles: ["src/lib/ai-features.ts"],
    });

    expect(result.summary).toContain("OpenRouter returned 429");
    expect(result.summary).not.toContain("Error invoking remote method");
    expect(result.warnings).toContain("OpenRouter returned 429");
    expect(result.warnings).not.toContain("Structured response validation failed.");
    expect(result.data.keyModules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/" }),
        expect.objectContaining({ path: "electron/" }),
      ]),
    );
  });

  it("ignores a fresh cached brief when it is thin against sufficient evidence", async () => {
    const payload = {
      repoId: "repo-1",
      repoName: "overcode",
      branch: "main",
      tree: [
        "README.md",
        "src/components/ai/RepoBrief.tsx",
        "src/lib/ai-features.ts",
        "electron/lib/ai-runtime.ts",
      ],
      readme:
        "Overcode is a native Electron workspace that consolidates local Git state, provider activity, BYOK AI providers, and Cognee memory for developers.",
      recentCommits: ["Add structured checks", "Improve Cognee dashboard"],
      changedFiles: ["src/lib/ai-features.ts"],
    };
    const rich = briefEnvelope({
      purpose: "Overcode consolidates local Git and Cognee-backed AI workflows.",
      keyModules: [
        { name: "AI workflows", path: "src/components/ai", role: "Runs repo brief panels." },
        { name: "Prompt builders", path: "src/lib/ai-features.ts", role: "Builds structured prompts." },
        { name: "Runtime", path: "electron/lib", role: "Routes provider calls." },
      ],
      recentActivity: [
        { label: "Structured checks", evidence: "recent commit" },
      ],
      onboardingPath: ["Read README", "Inspect AI workflows"],
      notableRisks: ["Provider output varies."],
    });
    mockIpc.callAIModel.mockResolvedValueOnce(JSON.stringify(rich));

    const { getRepoBriefStructured } = await import("./ai-features");
    await getRepoBriefStructured(payload);
    const cache = mockIpc.setInStore.mock.calls[0]?.[1] as Record<string, unknown>;
    const cacheKey = Object.keys(cache)[0];
    const thin = briefEnvelope(
      {
        purpose: "Provide a concise overview to get developers up to speed quickly.",
        keyModules: [],
        recentActivity: [],
        onboardingPath: ["Clone repo"],
        notableRisks: [],
      },
      ["Repository facts were garbled; details may be incomplete."],
    );
    mockIpc.getFromStore.mockResolvedValueOnce({
      [cacheKey]: { content: thin, timestamp: Date.now() },
    });
    mockIpc.callAIModel.mockResolvedValueOnce(JSON.stringify(rich));

    const result = await getRepoBriefStructured(payload);

    expect(mockIpc.callAIModel).toHaveBeenCalledTimes(2);
    expect(result.data.keyModules).toHaveLength(3);
  });
});
