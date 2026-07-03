import type { WorktreeComparePayload } from "../../lib/ai-features";
import type { AIEnvelope, WorktreeCompareData } from "../../lib/ai-structured";
import type { MemoryRememberInput } from "../../lib/ipc";
import { buildCogneeSummaryMemoryInput } from "../../lib/cognee-workflow-memory";

const MAX_TAG_PATHS = 8;

export function buildWorktreeCompareMemoryInput(
  payload: WorktreeComparePayload,
  result: AIEnvelope<WorktreeCompareData>,
): MemoryRememberInput {
  const repo = payload.repoName?.trim() || payload.repoId.trim();
  const changedPaths = uniqueStrings(payload.changedFiles ?? []).slice(0, MAX_TAG_PATHS);
  const moduleSummary = result.data.moduleMap
    .slice(0, 6)
    .map((module) => `${module.module} [${module.risk}]`)
    .join(", ");
  const nextActions = result.data.nextActions.slice(0, 4).join(" | ");
  const summary = [
    result.summary,
    result.data.intent ? `Intent: ${result.data.intent}` : "",
    `Readiness: ${result.data.readiness}`,
    moduleSummary ? `Modules: ${moduleSummary}` : "",
    nextActions ? `Next actions: ${nextActions}` : "",
  ].filter(Boolean).join(" ");

  return {
    ...buildCogneeSummaryMemoryInput({
      source: "worktree compare",
      repoId: payload.repoId,
      repoName: payload.repoName,
      branch: payload.branch ?? payload.target,
      paths: changedPaths,
      subject: `${payload.base} -> ${payload.target}`,
      title: `Cognee worktree memory for ${repo}`,
      summary,
      tags: ["worktree"],
      data: {
        base: payload.base,
        target: payload.target,
        readiness: result.data.readiness,
        confidence: result.confidence,
        module_count: result.data.moduleMap.length,
        ahead: payload.ahead,
        behind: payload.behind,
        dirty_files: payload.dirtyFiles,
      },
    }),
    nodeSet: [`repo:${boundText(repo, 70)}`],
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function boundText(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}
