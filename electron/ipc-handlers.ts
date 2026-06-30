import { ipcMain } from "electron";
import type { UtilityProcess } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import * as storeLib from "./lib/store";
import { callAIModel, aiConfigStatus, configuredModel } from "./lib/ai-runtime";
import { startOAuthFlow, fetchProfile } from "./oauth-server";
import * as github from "./lib/github";
import * as gitlab from "./lib/gitlab";
import { getProviderRateLimitSnapshots } from "./lib/provider-http";
import {
  cogneeStatus,
  forgetMemory,
  improveMemory,
  recallMemory,
  rememberMemory,
} from "./lib/cognee";

const execFileAsync = promisify(execFile);

/**
 * Resolve a friendly name for the local user when no remote auth is connected.
 * Tries `git config --global user.name` first (typically the developer's full
 * name), then `git config --global user.email` local-part, then the OS username
 * as a last resort. Returns `null` only if all three lookups fail.
 */
async function readLocalIdentity(): Promise<{ name: string | null }> {
  // 1. Try git global user.name. Most developers have this set to their name.
  try {
    const { stdout } = await execFileAsync("git", [
      "config",
      "--global",
      "user.name",
    ]);
    const name = stdout.trim();
    if (name) return { name };
  } catch {
    // Git not installed or no global user.name — fall through.
  }

  // 2. Try the local-part of git global user.email.
  try {
    const { stdout } = await execFileAsync("git", [
      "config",
      "--global",
      "user.email",
    ]);
    const email = stdout.trim();
    if (email.includes("@")) {
      const localPart = email.split("@")[0];
      if (localPart) return { name: localPart };
    }
  } catch {
    // No email configured — fall through.
  }

  // 3. OS username as a final fallback.
  try {
    const info = os.userInfo();
    if (info.username) return { name: info.username };
  } catch {
    // Some sandboxes block userInfo — return null.
  }

  return { name: null };
}

interface WorkerReply {
  id: string;
  result?: unknown;
  error?: string;
}

interface WorkerEvent {
  event: string;
  repoPath?: string;
  timestamp?: number;
}

interface RemoteCacheEntry<T> {
  value: T;
  timestamp: number;
}

type Provider = "github" | "gitlab";

type GitChannel =
  | "git:scan"
  | "git:status"
  | "git:log"
  | "git:stashes"
  | "git:stash-show"
  | "git:worktrees"
  | "git:file"
  | "git:divergence"
  | "git:push"
  | "git:pull"
  | "git:commit"
  | "git:stash-pop"
  | "git:stash-drop";

function asWorkerReply(message: unknown): WorkerReply | null {
  if (!message || typeof message !== "object") return null;
  const reply = message as Partial<WorkerReply>;
  return typeof reply.id === "string" ? (reply as WorkerReply) : null;
}

function unwrapMessageData(message: unknown): unknown {
  if (message && typeof message === "object" && "data" in message) {
    return (message as { data: unknown }).data;
  }
  return message;
}

function asWorkerEvent(message: unknown): WorkerEvent | null {
  if (!message || typeof message !== "object") return null;
  const event = message as Partial<WorkerEvent>;
  return typeof event.event === "string" ? (event as WorkerEvent) : null;
}

function readPRDetailOption(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const opts = value as { mode?: unknown; number?: unknown };
  if (opts.mode !== "detail") return null;
  return typeof opts.number === "number" &&
    Number.isInteger(opts.number) &&
    opts.number > 0
    ? opts.number
    : null;
}

function readForceOption(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as { force?: unknown }).force === true;
}

function readMRDetailOption(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const opts = value as { mode?: unknown; iid?: unknown };
  if (opts.mode !== "detail") return null;
  return typeof opts.iid === "number" &&
    Number.isInteger(opts.iid) &&
    opts.iid > 0
    ? opts.iid
    : null;
}

function readIssueDetailOption(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const opts = value as { mode?: unknown; number?: unknown };
  if (opts.mode !== "detail") return null;
  return typeof opts.number === "number" &&
    Number.isInteger(opts.number) &&
    opts.number > 0
    ? opts.number
    : null;
}

function assertProvider(value: unknown): Provider {
  if (value === "github" || value === "gitlab") return value;
  throw new Error("Provider must be 'github' or 'gitlab'.");
}

function assertPositiveInteger(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0)
    return value;
  throw new Error(`${name} must be a positive integer.`);
}

function assertBoundedCommentBody(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Comment body must be a string.");
  }
  const body = value.trim();
  if (!body) throw new Error("Comment body cannot be empty.");
  if (body.length > 20_000) {
    throw new Error("Comment body is too large.");
  }
  return body;
}

function assertStoreKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/.test(value)) {
    throw new Error("Store key contains unsupported characters.");
  }
  return value;
}

function assertGitLabProjectId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300) {
    throw new Error("GitLab project id must be a non-empty string.");
  }
  if (/[\0\r\n]/.test(value)) {
    throw new Error("GitLab project id contains unsupported characters.");
  }
  return value;
}

function recordGitWorkerChange(event: WorkerEvent): void {
  if (event.event !== "git:changed" || !event.repoPath) return;
  // Validate timestamp: must be positive, not in future (with 1min tolerance), and not NaN
  const now = Date.now();
  const rawTimestamp = event.timestamp;
  const timestamp =
    typeof rawTimestamp === "number" &&
    rawTimestamp > 0 &&
    rawTimestamp <= now + 60000 &&
    !Number.isNaN(rawTimestamp)
      ? rawTimestamp
      : now;
  const repositories = storeLib.getStoreValue("repositories");
  if (!Array.isArray(repositories)) return;

  const nextRepositories = repositories.map((repo) => {
    if (
      repo &&
      typeof repo === "object" &&
      (repo as Partial<storeLib.Repository>).local_path === event.repoPath
    ) {
      return { ...repo, last_synced: timestamp };
    }
    return repo;
  }) as storeLib.Repository[];

  const changedRepo = nextRepositories.find(
    (repo) => repo.local_path === event.repoPath,
  );
  storeLib.setStoreValue("repositories", nextRepositories);
  if (!changedRepo) return;

  const activity = storeLib.getStoreValue("activity");
  const existing = Array.isArray(activity)
    ? (activity as storeLib.ActivityItem[])
    : [];
  const id = `fs-change:${changedRepo.id}`;
  const nextActivity: storeLib.ActivityItem[] = [
    {
      id,
      repo_id: changedRepo.id,
      type: "fs_change",
      title: "Workspace files changed",
      metadata: { path: event.repoPath },
      timestamp,
    },
    ...existing.filter((item) => item.id !== id),
  ].slice(0, 500);
  storeLib.setStoreValue("activity", nextActivity);
}

const REMOTE_DATA_CACHE_KEY = "remote_data_cache";
const AI_AUDIT_LOG_KEY = "ai_audit_log";
const REMOTE_LIST_TTL_MS = 2 * 60 * 1000;
const REMOTE_DETAIL_TTL_MS = 5 * 60 * 1000;
const MAX_REMOTE_CACHE_ENTRIES = 200;
const MAX_AI_AUDIT_ENTRIES = 120;
const revalidatingRemoteKeys = new Set<string>();

function remoteCache(): Record<string, unknown> {
  const cache = storeLib.getStoreValue(REMOTE_DATA_CACHE_KEY);
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return {};
  return cache as Record<string, unknown>;
}

async function withRemoteCache<T>(
  key: string,
  ttlMs: number,
  force: boolean,
  fetchFresh: () => Promise<T>,
): Promise<T> {
  const cache = remoteCache();
  const cached = cache[key] as Partial<RemoteCacheEntry<T>> | undefined;
  if (
    !force &&
    cached &&
    typeof cached.timestamp === "number" &&
    "value" in cached
  ) {
    if (Date.now() - cached.timestamp >= ttlMs) {
      revalidateRemoteCache(key, fetchFresh);
    }
    return cached.value as T;
  }

  const value = await fetchFresh();
  storeLib.setStoreValue(
    REMOTE_DATA_CACHE_KEY,
    pruneRemoteCache({
      ...cache,
      [key]: { value, timestamp: Date.now() },
    }),
  );
  return value;
}

function revalidateRemoteCache<T>(
  key: string,
  fetchFresh: () => Promise<T>,
): void {
  if (revalidatingRemoteKeys.has(key)) return;
  revalidatingRemoteKeys.add(key);
  void fetchFresh()
    .then((value) => {
      const cache = remoteCache();
      storeLib.setStoreValue(
        REMOTE_DATA_CACHE_KEY,
        pruneRemoteCache({
          ...cache,
          [key]: { value, timestamp: Date.now() },
        }),
      );
    })
    .catch(() => {
      // Stale cache remains usable; transient provider failures are surfaced on forced refresh.
    })
    .finally(() => {
      revalidatingRemoteKeys.delete(key);
    });
}

function pruneRemoteCache(
  cache: Record<string, unknown>,
): Record<string, unknown> {
  const now = Date.now();
  const entries = Object.entries(cache)
    .filter(([, entry]) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return false;
      const timestamp = (entry as Partial<RemoteCacheEntry<unknown>>).timestamp;
      return (
        typeof timestamp === "number" &&
        now - timestamp <= REMOTE_DETAIL_TTL_MS * 4
      );
    })
    .sort((a, b) => {
      const aTimestamp =
        (a[1] as Partial<RemoteCacheEntry<unknown>>).timestamp ?? 0;
      const bTimestamp =
        (b[1] as Partial<RemoteCacheEntry<unknown>>).timestamp ?? 0;
      return bTimestamp - aTimestamp;
    })
    .slice(0, MAX_REMOTE_CACHE_ENTRIES);
  return Object.fromEntries(entries);
}

function recordAIAudit(entry: {
  feature: string;
  model: string;
  status: "ok" | "error";
  promptChars: number;
  responseChars: number;
  durationMs: number;
  error?: string;
}): void {
  const existing = storeLib.getStoreValue(AI_AUDIT_LOG_KEY);
  const audit = Array.isArray(existing) ? existing : [];
  storeLib.setStoreValue(
    AI_AUDIT_LOG_KEY,
    [
      {
        id: `ai:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        ...entry,
      },
      ...audit,
    ].slice(0, MAX_AI_AUDIT_ENTRIES),
  );
}

function inferAIFeature(systemPrompt: string): string {
  const prompt = systemPrompt.toLowerCase();
  if (prompt.includes("daily standup")) return "standup";
  if (prompt.includes("single pull request file patch"))
    return "pr_file_change";
  if (prompt.includes("diff hunks")) return "pr_hunk_review";
  if (prompt.includes("pull request")) return "pr_review";
  if (prompt.includes("github issue")) return "issue_triage";
  if (prompt.includes("worktree")) return "worktree_compare";
  if (prompt.includes("repository onboarding") || prompt.includes("repo brief"))
    return "repo_brief";
  if (prompt.includes("conventional commit")) return "commit_assistant";
  if (prompt.includes("code diff")) return "impact_analysis";
  if (prompt.includes("code or diff selection")) return "code_explain";
  if (prompt.includes("stash")) return "stash_annotator";
  if (prompt.includes("repair")) return "json_repair";
  return "ai";
}

export function registerIPCHandlers(gitWorker: UtilityProcess) {
  let nextGitMessageId = 0;
  const pendingGitMessages = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  gitWorker.on("message", (message) => {
    const payload = unwrapMessageData(message);
    const reply = asWorkerReply(payload);
    if (!reply) {
      const event = asWorkerEvent(payload);
      if (event) recordGitWorkerChange(event);
      return;
    }
    const pending = pendingGitMessages.get(reply.id);
    if (!pending) return;
    pendingGitMessages.delete(reply.id);
    if (reply.error) {
      pending.reject(new Error(reply.error));
      return;
    }
    pending.resolve(reply.result);
  });

  gitWorker.once("exit", () => {
    for (const pending of pendingGitMessages.values()) {
      pending.reject(
        new Error("Git worker exited before completing the request."),
      );
    }
    pendingGitMessages.clear();
  });

  function invokeGit<T>(channel: GitChannel, args: unknown[]): Promise<T> {
    const id = `git-${nextGitMessageId++}`;
    return new Promise((resolve, reject) => {
      pendingGitMessages.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      gitWorker.postMessage({ id, channel, args });
    });
  }
  // ============================================================
  // AUTH CHANNELS (3)
  // ============================================================

  ipcMain.handle("auth:connect", async (_, provider: unknown) => {
    const safeProvider = assertProvider(provider);
    const token = await startOAuthFlow(safeProvider);
    const profile = await fetchProfile(safeProvider, token);
    storeLib.setAccount(safeProvider, {
      username: profile.username,
      token,
      avatar_url: profile.avatar_url,
    });
    // Token stays main-process only. Renderer gets non-sensitive profile data.
    return { username: profile.username, avatar_url: profile.avatar_url };
  });

  ipcMain.handle("auth:disconnect", async (_, provider: unknown) => {
    storeLib.deleteAccount(assertProvider(provider));
  });

  ipcMain.handle("auth:status", async () => {
    const githubAccount = storeLib.getAccount("github");
    const gitlabAccount = storeLib.getAccount("gitlab");
    return {
      github: !!githubAccount,
      gitlab: !!gitlabAccount,
      profiles: {
        github: githubAccount
          ? {
              username: githubAccount.username,
              avatar_url: githubAccount.avatar_url,
            }
          : null,
        gitlab: gitlabAccount
          ? {
              username: gitlabAccount.username,
              avatar_url: gitlabAccount.avatar_url,
            }
          : null,
        local: await readLocalIdentity(),
      },
      rateLimits: getProviderRateLimitSnapshots(),
    };
  });

  // ============================================================
  // GIT CHANNELS (12)
  // ============================================================

  ipcMain.handle(
    "git:scan",
    async (_, directories: string[], options?: unknown) =>
      invokeGit("git:scan", [directories, options]),
  );
  ipcMain.handle("git:status", async (_, repoPath: string, options?: unknown) =>
    invokeGit("git:status", [repoPath, options]),
  );
  ipcMain.handle(
    "git:log",
    async (
      _,
      repoPath: string,
      maxCount: number,
      hash?: string,
      options?: unknown,
    ) => invokeGit("git:log", [repoPath, maxCount, hash, options]),
  );
  ipcMain.handle("git:stashes", async (_, repoPath: string) =>
    invokeGit("git:stashes", [repoPath]),
  );
  ipcMain.handle(
    "git:stash-show",
    async (_, repoPath: string, stashRef: string) =>
      invokeGit("git:stash-show", [repoPath, stashRef]),
  );
  ipcMain.handle(
    "git:worktrees",
    async (_, repoPath: string, options?: unknown) =>
      invokeGit("git:worktrees", [repoPath, options]),
  );
  ipcMain.handle(
    "git:file",
    async (_, repoPath: string, filePath: string, options?: unknown) =>
      invokeGit("git:file", [repoPath, filePath, options]),
  );
  ipcMain.handle(
    "git:divergence",
    async (_, repoPath: string, branch: string) =>
      invokeGit("git:divergence", [repoPath, branch]),
  );
  ipcMain.handle(
    "git:push",
    async (_, repoPath: string, remote: string, branch: string) =>
      invokeGit("git:push", [repoPath, remote, branch]),
  );
  ipcMain.handle(
    "git:pull",
    async (_, repoPath: string, remote: string, branch: string) =>
      invokeGit("git:pull", [repoPath, remote, branch]),
  );
  ipcMain.handle("git:commit", async (_, repoPath: string, message: string) =>
    invokeGit("git:commit", [repoPath, message]),
  );
  ipcMain.handle(
    "git:stash-pop",
    async (_, repoPath: string, stashRef: string) =>
      invokeGit("git:stash-pop", [repoPath, stashRef]),
  );
  ipcMain.handle(
    "git:stash-drop",
    async (_, repoPath: string, stashRef: string) =>
      invokeGit("git:stash-drop", [repoPath, stashRef]),
  );

  // ============================================================
  // GITHUB CHANNELS (4)
  // ============================================================

  function githubToken(): string {
    const acct = storeLib.getAccount("github");
    if (!acct?.token)
      throw new Error("GitHub not connected. Use auth:connect first.");
    return acct.token;
  }

  ipcMain.handle("github:repos", async () =>
    withRemoteCache("github:repos", REMOTE_LIST_TTL_MS, false, () =>
      github.listRepos(githubToken()),
    ),
  );

  ipcMain.handle(
    "github:issues",
    async (_, repoFullName?: string, options?: unknown) => {
      const selectedRepo =
        typeof repoFullName === "string" ? repoFullName.trim() : "";
      const token = githubToken();
      const detail = readIssueDetailOption(options);
      const force = readForceOption(options);
      if (detail !== null) {
        const { owner, repo } = github.parseFullName(selectedRepo);
        return withRemoteCache(
          `github:issue-detail:${selectedRepo}:${detail}`,
          REMOTE_DETAIL_TTL_MS,
          force,
          () => github.fetchIssueDetail(token, owner, repo, detail),
        );
      }
      if (!selectedRepo) {
        return withRemoteCache(
          "github:issues:all",
          REMOTE_LIST_TTL_MS,
          force,
          () => github.listUserIssues(token),
        );
      }
      const { owner, repo } = github.parseFullName(selectedRepo);
      return withRemoteCache(
        `github:issues:${selectedRepo}`,
        REMOTE_LIST_TTL_MS,
        force,
        () => github.listIssues(token, owner, repo),
      );
    },
  );

  ipcMain.handle(
    "github:prs",
    async (_, repoFullName: string, options?: unknown) => {
      const { owner, repo } = github.parseFullName(repoFullName);
      const token = githubToken();
      const detail = readPRDetailOption(options);
      const force = readForceOption(options);
      if (detail !== null) {
        return withRemoteCache(
          `github:pr-detail:${repoFullName}:${detail}`,
          REMOTE_DETAIL_TTL_MS,
          force,
          () => github.fetchPRDetail(token, owner, repo, detail),
        );
      }
      return withRemoteCache(
        `github:prs:${repoFullName}`,
        REMOTE_LIST_TTL_MS,
        force,
        () => github.listPRs(token, owner, repo),
      );
    },
  );

  ipcMain.handle("github:pipelines", async (_, repoFullName: string) => {
    const { owner, repo } = github.parseFullName(repoFullName);
    return withRemoteCache(
      `github:pipelines:${repoFullName}`,
      REMOTE_LIST_TTL_MS,
      false,
      () => github.listPipelineRuns(githubToken(), owner, repo),
    );
  });

  ipcMain.handle(
    "github:comment",
    async (_, repoFullName: string, prNumber: number, body: unknown) => {
      const { owner, repo } = github.parseFullName(repoFullName);
      await github.commentOnPR(
        githubToken(),
        owner,
        repo,
        assertPositiveInteger(prNumber, "PR number"),
        assertBoundedCommentBody(body),
      );
    },
  );

  // ============================================================
  // GITLAB CHANNELS (4)
  // ============================================================

  function gitlabToken(): string {
    const acct = storeLib.getAccount("gitlab");
    if (!acct?.token)
      throw new Error("GitLab not connected. Use auth:connect first.");
    return acct.token;
  }

  ipcMain.handle("gitlab:projects", async () =>
    withRemoteCache("gitlab:projects", REMOTE_LIST_TTL_MS, false, () =>
      gitlab.listProjects(gitlabToken()),
    ),
  );

  ipcMain.handle(
    "gitlab:mrs",
    async (_, projectId: string, options?: unknown) => {
      const safeProjectId = assertGitLabProjectId(projectId);
      const token = gitlabToken();
      const detail = readMRDetailOption(options);
      const force = readForceOption(options);
      if (detail !== null) {
        return withRemoteCache(
          `gitlab:mr-detail:${safeProjectId}:${detail}`,
          REMOTE_DETAIL_TTL_MS,
          force,
          () => gitlab.fetchMRDetail(token, safeProjectId, detail),
        );
      }
      return withRemoteCache(
        `gitlab:mrs:${safeProjectId}`,
        REMOTE_LIST_TTL_MS,
        force,
        () => gitlab.listMRs(token, safeProjectId),
      );
    },
  );

  // GitLab issues mirror the GitHub channel: a single handler that returns
  // either a list or a detail payload depending on the `mode` option. The
  // detail payload conforms to GitHubIssueDetail so the UI layer doesn't
  // need provider-specific branching.
  ipcMain.handle(
    "gitlab:issues",
    async (_, projectId: string, options?: unknown) => {
      const safeProjectId = assertGitLabProjectId(projectId);
      const token = gitlabToken();
      const detail = readIssueDetailOption(options);
      const force = readForceOption(options);
      if (detail !== null) {
        return withRemoteCache(
          `gitlab:issue-detail:${safeProjectId}:${detail}`,
          REMOTE_DETAIL_TTL_MS,
          force,
          () => gitlab.fetchGitLabIssueDetail(token, safeProjectId, detail),
        );
      }
      return withRemoteCache(
        `gitlab:issues:${safeProjectId}`,
        REMOTE_LIST_TTL_MS,
        force,
        () => gitlab.listGitLabIssues(token, safeProjectId),
      );
    },
  );

  ipcMain.handle("gitlab:pipelines", async (_, projectId: string) => {
    const safeProjectId = assertGitLabProjectId(projectId);
    return withRemoteCache(
      `gitlab:pipelines:${safeProjectId}`,
      REMOTE_LIST_TTL_MS,
      false,
      () => gitlab.listPipelines(gitlabToken(), safeProjectId),
    );
  });

  ipcMain.handle(
    "gitlab:comment",
    async (_, projectId: string, mrIid: number, body: unknown) => {
      await gitlab.commentOnMR(
        gitlabToken(),
        assertGitLabProjectId(projectId),
        assertPositiveInteger(mrIid, "MR IID"),
        assertBoundedCommentBody(body),
      );
    },
  );

  // ============================================================
  // AI CHANNELS (2)
  // ============================================================

  ipcMain.handle(
    "ai:complete",
    async (_, systemPrompt: string, userPrompt: string) => {
      const started = Date.now();
      const promptChars = systemPrompt.length + userPrompt.length;
      const feature = inferAIFeature(systemPrompt);
      const model = configuredModel();
      try {
        const response = await callAIModel(systemPrompt, userPrompt);
        recordAIAudit({
          feature,
          model,
          status: "ok",
          promptChars,
          responseChars: response.length,
          durationMs: Date.now() - started,
        });
        return response;
      } catch (error) {
        recordAIAudit({
          feature,
          model,
          status: "error",
          promptChars,
          responseChars: 0,
          durationMs: Date.now() - started,
          error:
            error instanceof Error
              ? error.message.slice(0, 180)
              : "AI request failed",
        });
        throw error;
      }
    },
  );

  ipcMain.handle("ai:status", () => aiConfigStatus());

  // ============================================================
  // MEMORY CHANNELS (5)
  // ============================================================

  ipcMain.handle("memory:remember", async (_, payload: unknown) =>
    rememberMemory(payload),
  );
  ipcMain.handle("memory:recall", async (_, payload: unknown) =>
    recallMemory(payload),
  );
  ipcMain.handle("memory:improve", async (_, payload: unknown) =>
    improveMemory(payload),
  );
  ipcMain.handle("memory:forget", async (_, payload: unknown) =>
    forgetMemory(payload),
  );
  ipcMain.handle("memory:status", () => cogneeStatus());

  // ============================================================
  // STORE CHANNELS (3)
  // ============================================================
  // 'accounts' holds OAuth tokens — must never traverse the renderer boundary.
  const FORBIDDEN_KEYS = new Set(["accounts"]);
  // Fields inside 'settings' that hold secrets — stripped on the way out,
  // and never accepted from a `store:set` write (use settings:save-ai-provider).
  const SETTINGS_SECRETS = new Set([
    "openrouter_api_key",
    "openrouter_api_key_secret",
  ]);

  function sanitize(key: string, value: unknown): unknown {
    if (key === "settings" && value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (!SETTINGS_SECRETS.has(k)) out[k] = v;
      }
      return out;
    }
    return value;
  }

  ipcMain.handle("store:get", async (_, rawKey: unknown) => {
    const key = assertStoreKey(rawKey);
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Access to '${key}' is restricted to the main process.`);
    }
    return sanitize(key, storeLib.getStoreValue(key));
  });

  ipcMain.handle("store:set", async (_, rawKey: unknown, value: unknown) => {
    const key = assertStoreKey(rawKey);
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Access to '${key}' is restricted to the main process.`);
    }
    if (key === "settings" && value && typeof value === "object") {
      // Renderer cannot write secret settings fields. Preserve any existing secret values
      // so a partial settings write from the renderer doesn't wipe them.
      const existing =
        (storeLib.getStoreValue("settings") as Record<string, unknown>) ?? {};
      const merged: Record<string, unknown> = { ...value };
      for (const secret of SETTINGS_SECRETS) {
        if (existing[secret] !== undefined) merged[secret] = existing[secret];
        else delete merged[secret];
      }
      storeLib.setStoreValue(key, merged);
      return;
    }
    storeLib.setStoreValue(key, value);
  });

  ipcMain.handle("store:list", async () => {
    return storeLib.listStoreKeys().filter((k) => !FORBIDDEN_KEYS.has(k));
  });

  // ============================================================
  // AI PROVIDER CREDENTIALS (dedicated channels — secrets never echo back)
  // ============================================================
  ipcMain.handle("settings:save-ai-provider", async (_, raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid credentials payload.");
    }
    const payload = raw as Record<string, unknown>;
    const update: storeLib.AIProviderCredentialUpdate = {};
    const CAPS = { api_key: 8192, base_url: 2048 } as const;
    for (const field of ["api_key", "base_url"] as const) {
      if (!(field in payload)) continue;
      const v = payload[field];
      if (v === null) {
        update[field] = null;
        continue;
      }
      if (typeof v !== "string") {
        throw new Error(`Field '${field}' must be a string or null.`);
      }
      if (v.length > CAPS[field]) {
        throw new Error(`Field '${field}' exceeds maximum length (${CAPS[field]}).`);
      }
      if (field === "base_url" && v.trim() !== "") {
        let parsed: URL;
        try {
          parsed = new URL(v);
        } catch {
          throw new Error("Base URL must be a valid URL.");
        }
        if (parsed.protocol !== "https:") {
          throw new Error("Base URL must use https://.");
        }
      }
      update[field] = v;
    }
    storeLib.saveAIProviderCredentials(update);
    return storeLib.aiProviderCredentialStatus();
  });

  ipcMain.handle("settings:ai-provider-status", async () => {
    const stored = storeLib.aiProviderCredentialStatus();
    // Source-of-truth: tell the renderer whether each credential is satisfied
    // via the encrypted-store path, the process.env fallback, or neither.
    return {
      api_key: stored.api_key
        ? "stored"
        : process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER?.trim()
          ? "env"
          : "none",
      base_url: stored.base_url
        ? "stored"
        : process.env.OPENROUTER_BASE_URL?.trim()
          ? "env"
          : "none",
    } as const;
  });
}
