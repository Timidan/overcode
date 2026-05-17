import { ipc, type EnvironmentWarning, type Worktree } from "./ipc";
import { loadRepositories, type WorkspaceRepository } from "./workspace-data";

export interface SecretWarning {
  kind: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  paths: string[];
}

export interface TestCommand {
  command: string;
  kind: string;
  confidence: "low" | "medium" | "high";
  reason: string;
  paths: string[];
}

type GitStatusHealthSignals = {
  environmentWarnings?: EnvironmentWarning[];
  secretWarnings?: SecretWarning[];
  testCommands?: TestCommand[];
};

export interface WorkspaceHealthItem {
  repo: WorkspaceRepository;
  branch: string;
  score: number;
  priority: "clear" | "watch" | "attention" | "blocked";
  dirtyFiles: number;
  stashes: number;
  worktrees: number;
  ahead: number;
  behind: number;
  warnings: EnvironmentWarning[];
  secretWarnings: SecretWarning[];
  testCommands: TestCommand[];
  reasons: string[];
}

export interface WorkspaceHealthRadar {
  items: WorkspaceHealthItem[];
  totals: {
    repos: number;
    attention: number;
    dirtyFiles: number;
    stashes: number;
    warnings: number;
    validationCommands: number;
  };
}

const MAX_RADAR_REPOS = 18;
const MAX_RADAR_CONCURRENCY = 4;

export async function loadWorkspaceHealthRadar(): Promise<WorkspaceHealthRadar> {
  const repositories = (await loadRepositories()).slice(0, MAX_RADAR_REPOS);
  const items = await mapConcurrent(repositories, MAX_RADAR_CONCURRENCY, loadWorkspaceHealthItem);
  items.sort((a, b) => b.score - a.score || a.repo.name.localeCompare(b.repo.name));
  const totals = items.reduce(
    (acc, item) => {
      if (item.priority !== "clear") acc.attention += 1;
      acc.dirtyFiles += item.dirtyFiles;
      acc.stashes += item.stashes;
      acc.warnings += item.warnings.length + item.secretWarnings.length;
      acc.validationCommands += item.testCommands.length;
      return acc;
    },
    {
      repos: items.length,
      attention: 0,
      dirtyFiles: 0,
      stashes: 0,
      warnings: 0,
      validationCommands: 0,
    },
  );
  return {
    items,
    totals,
  };
}

async function loadWorkspaceHealthItem(
  repo: WorkspaceRepository,
): Promise<WorkspaceHealthItem> {
  const [status, stashes, worktrees] = await Promise.all([
    ipc.getGitStatus(repo.local_path, { mode: "health" }).catch(() => null),
    ipc.getStashes(repo.local_path).catch(() => []),
    ipc.getWorktrees(repo.local_path).catch(() => [] as Worktree[]),
  ]);

  const dirtyFiles = status?.files.length ?? 0;
  const signals = status as GitStatusHealthSignals | null;
  const warnings = signals?.environmentWarnings ?? [];
  const secretWarnings = signals?.secretWarnings ?? [];
  const testCommands = signals?.testCommands ?? [];
  let highWarnings = 0;
  let mediumWarnings = 0;
  for (const warning of warnings) {
    if (warning.severity === "high") highWarnings += 1;
    if (warning.severity === "medium") mediumWarnings += 1;
  }
  let highSecrets = 0;
  let mediumSecrets = 0;
  for (const warning of secretWarnings) {
    if (warning.severity === "high") highSecrets += 1;
    if (warning.severity === "medium") mediumSecrets += 1;
  }
  let highConfidenceCommands = 0;
  for (const command of testCommands) {
    if (command.confidence === "high") highConfidenceCommands += 1;
  }
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const score =
    dirtyFiles * 8 +
    stashes.length * 5 +
    Math.max(0, worktrees.length - 1) * 3 +
    ahead * 2 +
    behind * 4 +
    highWarnings * 12 +
    mediumWarnings * 6 +
    warnings.length +
    highSecrets * 18 +
    mediumSecrets * 10 +
    secretWarnings.length * 3 +
    highConfidenceCommands * 2 +
    testCommands.length;

  return {
    repo,
    branch: status?.branch ?? "HEAD",
    score,
    priority: priorityForScore(score),
    dirtyFiles,
    stashes: stashes.length,
    worktrees: worktrees.length,
    ahead,
    behind,
    warnings,
    secretWarnings,
    testCommands,
    reasons: buildReasons({
      dirtyFiles,
      stashes: stashes.length,
      worktrees: worktrees.length,
      ahead,
      behind,
      warnings,
      secretWarnings,
      testCommands,
    }),
  };
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  let nextIndex = 0;
  const results = new Array<R>(items.length);
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

function priorityForScore(score: number): WorkspaceHealthItem["priority"] {
  if (score >= 35) return "blocked";
  if (score >= 18) return "attention";
  if (score > 0) return "watch";
  return "clear";
}

function buildReasons(input: {
  dirtyFiles: number;
  stashes: number;
  worktrees: number;
  ahead: number;
  behind: number;
  warnings: EnvironmentWarning[];
  secretWarnings: SecretWarning[];
  testCommands: TestCommand[];
}): string[] {
  const reasons: string[] = [];
  if (input.dirtyFiles > 0) reasons.push(`${input.dirtyFiles} dirty files`);
  if (input.stashes > 0) reasons.push(`${input.stashes} stashes`);
  if (input.worktrees > 1) reasons.push(`${input.worktrees} worktrees`);
  if (input.ahead > 0 || input.behind > 0) {
    reasons.push(`+${input.ahead}/-${input.behind} remote divergence`);
  }
  const important = input.warnings.find(
    (warning) => warning.severity === "high" || warning.severity === "medium",
  );
  const secret = input.secretWarnings.find(
    (warning) => warning.severity === "high" || warning.severity === "medium",
  );
  if (important) reasons.push(important.title);
  if (secret) reasons.push(`masked secret: ${maskSecretText(secret.title)}`);
  if (input.testCommands.length > 0) {
    reasons.push(`${input.testCommands.length} validation commands`);
  }
  return reasons.slice(0, 4);
}

function maskSecretText(text: string): string {
  const masked = text
    .replace(/([A-Za-z0-9_]*KEY[A-Za-z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, "$1****")
    .replace(/([A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, "$1****")
    .replace(/([A-Za-z0-9_]*SECRET[A-Za-z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, "$1****")
    .replace(/([A-Za-z0-9_]*PASSWORD[A-Za-z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, "$1****");
  return masked === text ? text : masked;
}
