import type { DashboardStats, WorkspaceRepository } from "./workspace-data";
import type { MemoryRecallItem, MemoryRecallQuery } from "./ipc";
import {
  COGNEE_WORKSPACE_DATASET,
  extractCogneeMemoryHighlights,
  extractCogneeMemoryReferences,
} from "./cognee-workflow-memory";

const MAX_QUERY_REPOS = 12;
const MAX_REPO_SIGNALS = 8;
const MAX_MEMORY_ITEMS = 8;
const MAX_REFERENCES_PER_MEMORY = 4;

const RISK_WORDS =
  /\b(risk|blocker|blocked|failing|failure|failed|unstable|warning|regression|secret|credential|timeout|slow|unavailable|conflict|missing|broken|429)\b/i;

export interface CogneeWorkspaceBriefMemory {
  id: string;
  title: string;
  repo: string;
  summary: string;
  references: string[];
}

export interface CogneeWorkspaceRepoSignal {
  repo: string;
  platform: WorkspaceRepository["platform"];
  hasMemory: boolean;
  note: string;
  dirtyCount: number;
}

export interface CogneeWorkspaceBrief {
  subject: string;
  itemCount: number;
  workspaceCount: number;
  recalledRepoCount: number;
  coverageLabel: string;
  coverageNote: string;
  headline: string;
  memories: CogneeWorkspaceBriefMemory[];
  repoSignals: CogneeWorkspaceRepoSignal[];
  watchpoints: string[];
  nextActions: string[];
}

export function buildCogneeWorkspaceBriefRecallRequest(
  repositories: WorkspaceRepository[],
  stats: DashboardStats,
): MemoryRecallQuery | null {
  if (repositories.length === 0) return null;

  const repoNames = repositories
    .slice()
    .sort(compareReposForBrief)
    .map((repo) => repo.name)
    .filter(Boolean)
    .slice(0, MAX_QUERY_REPOS);

  const signals = [
    `${repositories.length} pinned workspace${repositories.length === 1 ? "" : "s"}`,
    `${stats.localChanges} uncommitted file${stats.localChanges === 1 ? "" : "s"}`,
    `${stats.prs} pull request${stats.prs === 1 ? "" : "s"} updated in the last 24h`,
    `${stats.commits} commit${stats.commits === 1 ? "" : "s"} in the last 24h`,
  ];

  return {
    query: [
      "Recall Overcode workspace memory across all pinned repositories.",
      `Known workspaces: ${repoNames.join(", ")}.`,
      `Current dashboard signals: ${signals.join("; ")}.`,
      "Return a workspace-level brief: active work, cross-repo risks, decisions, integrations, dependencies, and next actions.",
      "Prioritize memories from different repositories; include Overcode only when it is the relevant memory, not as the default.",
    ].join(" "),
    datasets: [COGNEE_WORKSPACE_DATASET],
    limit: Math.min(10, Math.max(6, repositories.length)),
  };
}

export function buildCogneeWorkspaceBrief(
  items: MemoryRecallItem[],
  repositories: WorkspaceRepository[],
  stats: DashboardStats,
): CogneeWorkspaceBrief {
  const memories = items
    .slice(0, MAX_MEMORY_ITEMS)
    .map((item) => normalizeMemoryItem(item, repositories))
    .filter((item) => item.summary || item.title);

  const recalledRepos = new Set(
    memories
      .map((item) => item.repo)
      .filter((repo) => repo !== "Workspace memory"),
  );
  const recalledRepoCount = recalledRepos.size;
  const workspaceCount = repositories.length;
  const coverageLabel = `${recalledRepoCount}/${workspaceCount} workspaces`;
  const coverageNote = buildCoverageNote(recalledRepos, repositories, items.length);
  const repoSignals = buildRepoSignals(repositories, memories);
  const watchpoints = buildWatchpoints(memories, stats);
  const nextActions = buildNextActions(recalledRepoCount, repositories, stats, memories);

  return {
    subject: "workspace",
    itemCount: items.length,
    workspaceCount,
    recalledRepoCount,
    coverageLabel,
    coverageNote,
    headline: buildHeadline(items.length, recalledRepoCount, workspaceCount, stats),
    memories,
    repoSignals,
    watchpoints,
    nextActions,
  };
}

export function buildCogneeWorkspaceBriefTeaser(brief: CogneeWorkspaceBrief): string {
  const noun = brief.itemCount === 1 ? "memory" : "memories";
  const suffix =
    brief.recalledRepoCount <= 1 && brief.memories[0]?.repo
      ? `; strongest signal is ${brief.memories[0].repo}`
      : "";
  return `Cognee workspace brief: ${brief.itemCount} ${noun} across ${brief.coverageLabel}${suffix}`;
}

function normalizeMemoryItem(
  item: MemoryRecallItem,
  repositories: WorkspaceRepository[],
): CogneeWorkspaceBriefMemory {
  const title = boundText(redactSensitiveText(cleanText(item.title) || "Recalled memory"), 120);
  return {
    id: item.id,
    title,
    repo: inferRepoName(item, repositories),
    summary: boundText(redactSensitiveText(cleanSummary(item.summary)), 360),
    references: extractCogneeMemoryReferences(item).slice(0, MAX_REFERENCES_PER_MEMORY),
  };
}

function buildCoverageNote(
  recalledRepos: Set<string>,
  repositories: WorkspaceRepository[],
  itemCount: number,
): string {
  if (itemCount === 0) {
    return "Cognee did not return workspace memory yet. Run repo brief, impact analysis, or worktree compare in a repo to save the first memories.";
  }
  if (repositories.length === 0) {
    return "Cognee returned memory, but no local workspaces are pinned in Overcode yet.";
  }
  if (recalledRepos.size === 0) {
    return `Cognee returned ${itemCount} memory item${itemCount === 1 ? "" : "s"} without repository metadata, so Overcode cannot map coverage yet.`;
  }
  if (recalledRepos.size < repositories.length) {
    const missing = repositories
      .filter((repo) => !recalledRepos.has(repo.name))
      .map((repo) => repo.name)
      .slice(0, 4);
    const missingText = missing.length > 0 ? ` Missing memory: ${missing.join(", ")}.` : "";
    return `Cognee currently recalled memory for ${recalledRepos.size} of ${repositories.length} pinned workspaces.${missingText} Those repos will appear here after their workflows save memory.`;
  }
  return "Cognee returned memory across every pinned workspace in this dashboard.";
}

function buildHeadline(
  itemCount: number,
  recalledRepoCount: number,
  workspaceCount: number,
  stats: DashboardStats,
): string {
  const memoryText =
    itemCount > 0
      ? `${itemCount} recalled Cognee memory item${itemCount === 1 ? "" : "s"}`
      : "No recalled Cognee memory";
  const repoText =
    workspaceCount > 0
      ? `${recalledRepoCount} of ${workspaceCount} workspaces represented`
      : "no pinned workspaces represented";
  const activityText = [
    stats.localChanges > 0 ? `${stats.localChanges} uncommitted files` : "",
    stats.prs > 0 ? `${stats.prs} updated PRs` : "",
    stats.commits > 0 ? `${stats.commits} recent commits` : "",
  ].filter(Boolean);

  return `${memoryText}; ${repoText}.${activityText.length > 0 ? ` Local signals: ${activityText.join(", ")}.` : ""}`;
}

function buildRepoSignals(
  repositories: WorkspaceRepository[],
  memories: CogneeWorkspaceBriefMemory[],
): CogneeWorkspaceRepoSignal[] {
  const memoriesByRepo = new Map<string, CogneeWorkspaceBriefMemory[]>();
  for (const memory of memories) {
    if (memory.repo === "Workspace memory") continue;
    const current = memoriesByRepo.get(memory.repo) ?? [];
    current.push(memory);
    memoriesByRepo.set(memory.repo, current);
  }

  return repositories
    .slice()
    .sort((left, right) => {
      const leftMemory = memoriesByRepo.has(left.name) ? 1 : 0;
      const rightMemory = memoriesByRepo.has(right.name) ? 1 : 0;
      if (rightMemory !== leftMemory) return rightMemory - leftMemory;
      return compareReposForBrief(left, right);
    })
    .slice(0, MAX_REPO_SIGNALS)
    .map((repo) => {
      const repoMemories = memoriesByRepo.get(repo.name) ?? [];
      const dirtyCount = repo.dirty_count ?? 0;
      const note =
        repoMemories[0]?.summary ||
        (dirtyCount > 0
          ? `${dirtyCount} uncommitted file${dirtyCount === 1 ? "" : "s"} in the local working tree; no Cognee memory recalled yet.`
          : "No Cognee memory recalled yet.");
      return {
        repo: repo.name,
        platform: repo.platform,
        hasMemory: repoMemories.length > 0,
        note: boundText(note, 220),
        dirtyCount,
      };
    });
}

function buildWatchpoints(
  memories: CogneeWorkspaceBriefMemory[],
  stats: DashboardStats,
): string[] {
  const fromMemory = unique(
    memories.flatMap((memory) =>
      splitSentences(memory.summary)
        .filter((sentence) => RISK_WORDS.test(sentence))
        .map((sentence) => `${memory.repo}: ${sentence}`),
    ),
  ).slice(0, 4);

  if (fromMemory.length > 0) return fromMemory;

  const fallback: string[] = [];
  if (stats.localChanges > 0) {
    fallback.push(`${stats.localChanges} uncommitted file${stats.localChanges === 1 ? "" : "s"} still need review before they become durable memory.`);
  }
  if (stats.prs > 0) {
    fallback.push(`${stats.prs} pull request${stats.prs === 1 ? "" : "s"} changed recently; run PR review to attach decisions to Cognee memory.`);
  }
  return fallback.slice(0, 3);
}

function buildNextActions(
  recalledRepoCount: number,
  repositories: WorkspaceRepository[],
  stats: DashboardStats,
  memories: CogneeWorkspaceBriefMemory[],
): string[] {
  const actions: string[] = [];
  if (recalledRepoCount < repositories.length) {
    actions.push("Run repo brief, impact analysis, or worktree compare in repos without memory to widen Cognee coverage.");
  }
  const dirtiest = repositories
    .slice()
    .sort((left, right) => (right.dirty_count ?? 0) - (left.dirty_count ?? 0))[0];
  if (dirtiest && (dirtiest.dirty_count ?? 0) > 0) {
    actions.push(`Review ${dirtiest.name}'s ${dirtiest.dirty_count} uncommitted file${dirtiest.dirty_count === 1 ? "" : "s"} and save the resulting decision back to memory.`);
  }
  if (stats.prs > 0) {
    actions.push("Use PR review on the freshest pull requests so Cognee can retain review decisions.");
  }
  if (actions.length === 0 && memories[0]) {
    actions.push(`Open ${memories[0].repo} and continue from the latest recalled memory.`);
  }
  return unique(actions).slice(0, 4);
}

function inferRepoName(item: MemoryRecallItem, repositories: WorkspaceRepository[]): string {
  const metadata = item.metadata ?? {};
  const candidates = [
    metadata.repository,
    metadata.repoName,
    metadata.repo,
    metadata.workspace,
    metadata.project,
  ].flatMap(metadataTextValues);

  for (const candidate of candidates) {
    const matched = matchRepository(candidate, repositories);
    if (matched) return matched.name;
  }

  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  for (const repo of repositories) {
    if (haystack.includes(repo.name.toLowerCase())) return repo.name;
  }

  return candidates[0] ? cleanRepoLabel(candidates[0]) : "Workspace memory";
}

function matchRepository(
  value: string,
  repositories: WorkspaceRepository[],
): WorkspaceRepository | null {
  const cleaned = cleanRepoLabel(value).toLowerCase();
  return (
    repositories.find((repo) => {
      const pathName = lastPathSegment(repo.local_path);
      return [repo.id, repo.name, repo.local_path, pathName]
        .filter(Boolean)
        .some((candidate) => cleanRepoLabel(candidate).toLowerCase() === cleaned);
    }) ?? null
  );
}

function cleanRepoLabel(value: string): string {
  const clean = value.replace(/^local:/i, "").trim();
  return lastPathSegment(clean) || clean;
}

function lastPathSegment(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function cleanSummary(value: string): string {
  const highlights = extractCogneeMemoryHighlights(value);
  const firstHighlight = highlights.find((highlight) => !highlight.trim().startsWith("{"));
  return cleanText(firstHighlight ?? highlights[0] ?? value);
}

function cleanText(value: string): string {
  return value
    .replace(/__node_content_(?:start|end)__/g, " ")
    .replace(/\bMemory\s+(?:cognee:)?[\w:-]+:\s*/gi, " ")
    .replace(/\bNodes?:\s*/gi, " ")
    .replace(/\bNode:\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataTextValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(metadataTextValues);
  return [];
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function compareReposForBrief(
  left: WorkspaceRepository,
  right: WorkspaceRepository,
): number {
  const leftDirty = left.dirty_count ?? 0;
  const rightDirty = right.dirty_count ?? 0;
  if (rightDirty !== leftDirty) return rightDirty - leftDirty;
  return left.name.localeCompare(right.name);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function boundText(value: string, maxChars: number): string {
  const clean = value.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "[redacted secret]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, "Bearer [redacted secret]")
    .replace(/\b(?:sk-(?:or-)?|sk-ant-|AIza)[A-Za-z0-9._~+/=-]{12,}/g, "[redacted secret]");
}
