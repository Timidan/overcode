// Git Worker - Utility Process
// Handles all git operations via simple-git to prevent UI freezing

import chokidar, { type FSWatcher } from "chokidar";
import * as gitOps from "../lib/git-ops";

const gitChannels = [
  "git:scan",
  "git:status",
  "git:log",
  "git:stashes",
  "git:stash-show",
  "git:worktrees",
  "git:file",
  "git:divergence",
  "git:push",
  "git:pull",
  "git:commit",
  "git:stash-pop",
  "git:stash-drop",
] as const;

type GitChannel = (typeof gitChannels)[number];

interface WorkerMessage {
  id: string;
  channel: string;
  args: unknown[];
}

interface WatchedRepository {
  local_path: string;
}

const watchDebounceMs = 500;
const watchersByRepoPath = new Map<string, FSWatcher>();
const pendingChangeTimers = new Map<string, NodeJS.Timeout>();

function isGitChannel(channel: string): channel is GitChannel {
  return (gitChannels as readonly string[]).includes(channel);
}

function isWorkerMessage(message: unknown): message is WorkerMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.channel === "string" &&
    Array.isArray(candidate.args)
  );
}

function unwrapMessageData(message: unknown): unknown {
  if (message && typeof message === "object" && "data" in message) {
    return (message as { data: unknown }).data;
  }
  return message;
}

function requireString(args: unknown[], index: number, name: string): string {
  const value = args[index];
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function requireStringArray(
  args: unknown[],
  index: number,
  name: string,
): string[] {
  const value = args[index];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

function optionalNumber(
  args: unknown[],
  index: number,
  name: string,
): number | undefined {
  const value = args[index];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function optionalPositiveInteger(
  args: unknown[],
  index: number,
  name: string,
  max: number,
): number | undefined {
  const value = optionalNumber(args, index, name);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Math.min(value, max);
}

function readScanMode(value: unknown): "list" | "candidates" {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const mode = (value as { mode?: unknown }).mode;
    if (mode === "candidates") return "candidates";
  }
  return "list";
}

function readWorktreeOptions(value: unknown): gitOps.WorktreeOptions {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const options = value as {
    mode?: unknown;
    targetPath?: unknown;
    base?: unknown;
  };
  if (options.mode === "summary-input") {
    return {
      mode: "summary-input",
      targetPath:
        typeof options.targetPath === "string" ? options.targetPath : undefined,
      base: typeof options.base === "string" ? options.base : undefined,
    };
  }
  return { mode: "list" };
}

function readFileOptions(value: unknown): gitOps.RepoFileReadOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const options = value as { ref?: unknown; maxBytes?: unknown };
  return {
    ref: typeof options.ref === "string" ? options.ref : undefined,
    maxBytes:
      typeof options.maxBytes === "number" ? options.maxBytes : undefined,
  };
}

function readStatusOptions(value: unknown): gitOps.GitStatusOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const mode = (value as { mode?: unknown }).mode;
  if (
    mode === "lite" ||
    mode === "diff" ||
    mode === "health" ||
    mode === "full"
  ) {
    return { mode };
  }
  return {};
}

function optionalString(
  args: unknown[],
  index: number,
  name: string,
): string | undefined {
  const value = args[index];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function isWatchedRepository(value: unknown): value is WatchedRepository {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Partial<WatchedRepository>).local_path === "string"
  );
}

function shouldIgnoreWatchPath(pathToCheck: string): boolean {
  return /(^|[/\\])(\.git|node_modules|bower_components|jspm_packages|dist|dist-electron|build|out|coverage|target|vendor|third_party|\.next|\.nuxt|\.output|\.cache|\.turbo|\.pnpm|\.yarn|\.npm|\.venv|venv|env)([/\\]|$)/.test(
    pathToCheck,
  );
}

function clearPendingChangeTimer(repoPath: string): void {
  const pending = pendingChangeTimers.get(repoPath);
  if (pending) clearTimeout(pending);
  pendingChangeTimers.delete(repoPath);
}

function emitRepoChange(repoPath: string): void {
  const pending = pendingChangeTimers.get(repoPath);
  if (pending) clearTimeout(pending);
  pendingChangeTimers.set(
    repoPath,
    setTimeout(() => {
      pendingChangeTimers.delete(repoPath);
      process.parentPort?.postMessage({
        event: "git:changed",
        repoPath,
        timestamp: Date.now(),
      });
    }, watchDebounceMs),
  );
}

function watchRepositories(repositories: unknown): void {
  if (!Array.isArray(repositories)) return;

  // Build set of current repo paths
  const currentPaths = new Set<string>();
  for (const repository of repositories) {
    if (!isWatchedRepository(repository)) continue;
    currentPaths.add(repository.local_path);
  }

  // Clean up watchers for repos that no longer exist
  for (const [repoPath, watcher] of watchersByRepoPath.entries()) {
    if (!currentPaths.has(repoPath)) {
      void watcher.close();
      watchersByRepoPath.delete(repoPath);
      clearPendingChangeTimer(repoPath);
    }
  }

  // Add watchers for new repos
  for (const repository of repositories) {
    if (!isWatchedRepository(repository)) continue;
    const repoPath = repository.local_path;
    if (watchersByRepoPath.has(repoPath)) continue;
    const watcher = chokidar.watch(repoPath, {
      ignored: shouldIgnoreWatchPath,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });
    watcher.on("all", () => emitRepoChange(repoPath));
    watcher.on("error", () => {
      void watcher.close();
      watchersByRepoPath.delete(repoPath);
      clearPendingChangeTimer(repoPath);
    });
    watchersByRepoPath.set(repoPath, watcher);
  }
}

async function handleGitMessage({
  channel,
  args,
}: WorkerMessage): Promise<unknown> {
  if (!isGitChannel(channel)) {
    throw new Error(`Unknown channel: ${channel}`);
  }

  switch (channel) {
    case "git:scan": {
      const directories = requireStringArray(args, 0, "directories");
      const mode = readScanMode(args[1]);
      if (mode === "candidates") {
        return gitOps.scanWorkspaceCandidates(directories);
      }
      const repositories = await gitOps.scanRepos(directories);
      watchRepositories(repositories);
      return repositories;
    }

    case "git:status":
      return gitOps.getStatus(
        requireString(args, 0, "repoPath"),
        readStatusOptions(args[1]),
      );

    case "git:log": {
      const repoPath = requireString(args, 0, "repoPath");
      const hash = optionalString(args, 2, "hash");
      const opts = args[3];
      if (
        hash &&
        opts &&
        typeof opts === "object" &&
        !Array.isArray(opts) &&
        (opts as { mode?: unknown }).mode === "stat"
      ) {
        return gitOps.getCommitStat(repoPath, hash);
      }
      if (hash) return gitOps.showCommit(repoPath, hash);
      return gitOps.getLog(
        repoPath,
        optionalPositiveInteger(args, 1, "maxCount", 500),
      );
    }

    case "git:stashes":
      return gitOps.getStashes(requireString(args, 0, "repoPath"));

    case "git:stash-show":
      return gitOps.getStashShow(
        requireString(args, 0, "repoPath"),
        requireString(args, 1, "stashRef"),
      );

    case "git:worktrees":
      return gitOps.getWorktrees(
        requireString(args, 0, "repoPath"),
        readWorktreeOptions(args[1]),
      );

    case "git:file":
      return gitOps.readRepoFile(
        requireString(args, 0, "repoPath"),
        requireString(args, 1, "filePath"),
        readFileOptions(args[2]),
      );

    case "git:divergence":
      return gitOps.getDivergence(
        requireString(args, 0, "repoPath"),
        requireString(args, 1, "branch"),
      );

    case "git:push":
      return gitOps.gitPush(
        requireString(args, 0, "repoPath"),
        requireString(args, 1, "remote"),
        requireString(args, 2, "branch"),
      );

    case "git:pull":
      return gitOps.gitPull(
        requireString(args, 0, "repoPath"),
        requireString(args, 1, "remote"),
        requireString(args, 2, "branch"),
      );

    case "git:commit":
      return gitOps.gitCommit(
        requireString(args, 0, "repoPath"),
        requireString(args, 1, "message"),
      );

    case "git:stash-pop":
      return gitOps.stashPop(
        requireString(args, 0, "repoPath"),
        requireString(args, 1, "stashRef"),
      );

    case "git:stash-drop":
      return gitOps.stashDrop(
        requireString(args, 0, "repoPath"),
        requireString(args, 1, "stashRef"),
      );

    default: {
      const exhaustive: never = channel;
      throw new Error(`Unknown channel: ${exhaustive}`);
    }
  }
}

// Message handler - receives commands from main process
process.parentPort?.on("message", async (message: unknown) => {
  const payload = unwrapMessageData(message);
  const workerMessage = isWorkerMessage(payload) ? payload : null;
  const id = workerMessage?.id ?? "unknown";
  try {
    if (!workerMessage) {
      throw new Error("Invalid worker message");
    }
    const result = await handleGitMessage(workerMessage);
    process.parentPort?.postMessage({ id, result });
  } catch (error) {
    process.parentPort?.postMessage({
      id,
      error: error instanceof Error ? error.message : "Worker command failed",
    });
  }
});
