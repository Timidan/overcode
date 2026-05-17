import { mapConcurrent } from "./concurrency";
import {
  ipc,
  type GitHubPR,
  type GitHubRepo,
  type GitHubRun,
  type GitLabMR,
  type GitLabPipeline,
  type GitLabProject,
  type Repository,
  type WorkspaceCandidate,
} from "./ipc";

const REPOSITORIES_STORE_KEY = "repositories";
const DISCOVERED_STORE_KEY = "discovered_workspaces";
const IGNORED_STORE_KEY = "ignored_workspaces";
const ACTIVITY_STORE_KEY = "activity";
const REPO_STATUS_HISTORY_STORE_KEY = "repo_status_history";
export const WORKSPACE_REPOSITORIES_CHANGED_EVENT = "overcode:repositories-changed";

/**
 * One persisted dirty-count snapshot for a single repo at a single point in
 * time. Additive payload — older stored entries without `conflict` still
 * load. Lives under the `repo_status_history` store key alongside
 * `repositories` / `activity`, no schema migration needed.
 */
export interface RepoStatusSnapshot {
  repoId: string;
  ts: number; // epoch ms when the snapshot was taken
  dirty_count: number;
  conflict?: boolean;
}

export type RepoStatusHistory = RepoStatusSnapshot[];

const COMMIT_ACTIVITY_TYPES = new Set(["commit", "push"]);
const PR_ACTIVITY_TYPES = new Set(["pr_opened", "pr_merged"]);
const LOCAL_CHANGE_ACTIVITY_TYPES = new Set(["stash", "fs_change"]);

export type WorkspaceRepository = Repository;

export interface WorkspaceActivity {
  id: string;
  repo_id: string;
  type: string;
  title: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export type ActivityFilter = "ALL" | "LOCAL" | "REMOTE";

export interface WorkspaceData {
  repositories: WorkspaceRepository[];
  activity: WorkspaceActivity[];
}

export interface DashboardStats {
  commits: number;
  prs: number;
  repos: number;
  localChanges: number;
  /**
   * Per-day buckets for the last 7 days, oldest at index 0, newest at index 6.
   * Optional so legacy callers / persisted stats without this field still load.
   */
  byDay?: {
    commits: number[];
    prs: number[];
    repos: number[];
    localChanges: number[];
  };
}

export interface LocalScanMergeResult {
  found: WorkspaceRepository[];
  repositories: WorkspaceRepository[];
}

export interface WorkspaceDiscoveryResult {
  discovered: WorkspaceCandidate[];
  pinned: WorkspaceRepository[];
  ignored: string[];
}

interface WorkspaceSettings {
  watch_directories?: string[];
}

const DEFAULT_SCAN_PATHS = ["~/projects", "~/Desktop/persona", "~/Desktop"];
const MAX_PROVIDER_REPOS = 10;
const MAX_PROVIDER_ITEMS_PER_REPO = 3;

export const EMPTY_DASHBOARD_STATS: DashboardStats = {
  commits: 0,
  prs: 0,
  repos: 0,
  localChanges: 0,
};

export async function loadRepositories(): Promise<WorkspaceRepository[]> {
  const repositories = await ipc.getFromStore(REPOSITORIES_STORE_KEY);
  return Array.isArray(repositories)
    ? (repositories as WorkspaceRepository[])
    : [];
}

export async function loadDiscoveredWorkspaces(): Promise<WorkspaceCandidate[]> {
  const discovered = await ipc.getFromStore(DISCOVERED_STORE_KEY);
  return Array.isArray(discovered)
    ? (discovered as WorkspaceCandidate[])
    : [];
}

export async function loadIgnoredWorkspaces(): Promise<string[]> {
  const ignored = await ipc.getFromStore(IGNORED_STORE_KEY);
  return Array.isArray(ignored)
    ? ignored.filter((value): value is string => typeof value === "string")
    : [];
}

export async function loadActivity(): Promise<WorkspaceActivity[]> {
  const activity = await ipc.getFromStore(ACTIVITY_STORE_KEY);
  return Array.isArray(activity) ? (activity as WorkspaceActivity[]) : [];
}

/**
 * Load the persisted per-repo dirty-count history. Returns an empty array
 * when the key was never written (first run after the upgrade that added
 * this key — callers should seed lazily). Only well-shaped entries are
 * kept; malformed entries from a future schema are dropped silently.
 */
export async function loadRepoStatusHistory(): Promise<RepoStatusHistory> {
  const raw = await ipc.getFromStore(REPO_STATUS_HISTORY_STORE_KEY);
  if (!Array.isArray(raw)) return [];
  const out: RepoStatusHistory = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as RepoStatusSnapshot).repoId === "string" &&
      typeof (entry as RepoStatusSnapshot).ts === "number" &&
      typeof (entry as RepoStatusSnapshot).dirty_count === "number"
    ) {
      out.push(entry as RepoStatusSnapshot);
    }
  }
  return out;
}

export async function loadWorkspaceData(): Promise<WorkspaceData> {
  const [repositories, activity] = await Promise.all([
    loadRepositories(),
    loadActivity(),
  ]);

  return { repositories, activity };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BYDAY_WINDOW = 7;

export function deriveDashboardStats(
  activity: WorkspaceActivity[],
  repositories: WorkspaceRepository[] = [],
  history: RepoStatusHistory = [],
): DashboardStats {
  const repoIds = new Set<string>();
  let commits = 0;
  let prs = 0;
  let localChanges = 0;

  for (const item of activity) {
    repoIds.add(item.repo_id);
    if (COMMIT_ACTIVITY_TYPES.has(item.type)) commits += 1;
    if (PR_ACTIVITY_TYPES.has(item.type)) prs += 1;
    if (LOCAL_CHANGE_ACTIVITY_TYPES.has(item.type)) localChanges += 1;
  }

  return {
    commits,
    prs,
    repos: repoIds.size,
    localChanges,
    byDay: buildDailyBuckets(activity, repositories, history),
  };
}

/**
 * Bucket the recent activity feed (and repo dirty snapshots) into 7-day series
 * for the dashboard sparklines. Index 0 is the oldest day, index 6 is today.
 *
 * `localChanges[d]` is computed from the persisted `repo_status_history`
 * stream: for each repo we pick the *latest* snapshot whose `ts` falls in
 * day d's window. If the repo has no snapshot in day d, we carry forward
 * its most-recent snapshot from any earlier day inside the window. The day
 * total sums these per-repo values.
 *
 * Fallback chain when persisted history is unavailable (e.g. first run
 * after upgrade before `populateActivityFromRepos` has written):
 *   1. Sum cached `dirty_count` per repo into the bucket matching
 *      `checked_at`.
 *   2. If no `checked_at` lands in the window, dump the total-of-totals
 *      into the newest slot so the chart isn't blank on day one.
 */
function buildDailyBuckets(
  activity: WorkspaceActivity[],
  repositories: WorkspaceRepository[],
  history: RepoStatusHistory = [],
): NonNullable<DashboardStats["byDay"]> {
  const commits = new Array<number>(BYDAY_WINDOW).fill(0);
  const prs = new Array<number>(BYDAY_WINDOW).fill(0);
  const repos = new Array<number>(BYDAY_WINDOW).fill(0);
  const localChanges = new Array<number>(BYDAY_WINDOW).fill(0);

  // Anchor the buckets to the start of *today* so all entries from the same
  // local-day collapse into the same slot regardless of the time of day.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const windowStartMs = todayStartMs - (BYDAY_WINDOW - 1) * DAY_MS;

  function dayIndex(ts: number): number {
    if (ts < windowStartMs) return -1;
    const idx = Math.floor((ts - windowStartMs) / DAY_MS);
    return idx >= 0 && idx < BYDAY_WINDOW ? idx : -1;
  }

  const reposByDay: Array<Set<string>> = Array.from(
    { length: BYDAY_WINDOW },
    () => new Set<string>(),
  );

  for (const item of activity) {
    const idx = dayIndex(item.timestamp);
    if (idx < 0) continue;
    reposByDay[idx].add(item.repo_id);
    if (COMMIT_ACTIVITY_TYPES.has(item.type)) commits[idx] += 1;
    if (PR_ACTIVITY_TYPES.has(item.type)) prs[idx] += 1;
  }
  for (let i = 0; i < BYDAY_WINDOW; i += 1) {
    repos[i] = reposByDay[i].size;
  }

  const fromHistory = localChangesByDayFromHistory(history, windowStartMs);
  if (fromHistory) {
    for (let i = 0; i < BYDAY_WINDOW; i += 1) {
      localChanges[i] = fromHistory[i];
    }
  } else {
    // Best-effort fallback: sum each repo's cached dirty_count into the
    // bucket matching its checked_at. If nothing lands in the window dump
    // the total-of-totals in the newest slot.
    let bucketed = false;
    for (const repo of repositories) {
      if (typeof repo.checked_at !== "number" || typeof repo.dirty_count !== "number") {
        continue;
      }
      const idx = dayIndex(repo.checked_at);
      if (idx < 0) continue;
      localChanges[idx] += repo.dirty_count;
      bucketed = true;
    }
    if (!bucketed) {
      const total = repositories.reduce(
        (sum, repo) => sum + (repo.dirty_count ?? 0),
        0,
      );
      if (total > 0) localChanges[BYDAY_WINDOW - 1] = total;
    }
  }

  return { commits, prs, repos, localChanges };
}

/**
 * Replay `history` into BYDAY_WINDOW daily buckets. For each repo, we sort
 * its snapshots by ts and walk the window day-by-day: the per-day value is
 * the latest snapshot whose ts <= end-of-that-day (so a snapshot from an
 * earlier day carries forward until a newer snapshot lands).
 *
 * Returns `null` when the history has no snapshots inside the window, so
 * the caller can fall back to the cached-`dirty_count` path.
 */
function localChangesByDayFromHistory(
  history: RepoStatusHistory,
  windowStartMs: number,
): number[] | null {
  if (history.length === 0) return null;

  const windowEndMs = windowStartMs + BYDAY_WINDOW * DAY_MS;
  const byRepo = new Map<string, RepoStatusSnapshot[]>();
  let anyInWindow = false;
  for (const snap of history) {
    if (snap.ts >= windowEndMs) continue;
    const list = byRepo.get(snap.repoId) ?? [];
    list.push(snap);
    byRepo.set(snap.repoId, list);
    if (snap.ts >= windowStartMs) anyInWindow = true;
  }
  if (!anyInWindow) return null;

  const buckets = new Array<number>(BYDAY_WINDOW).fill(0);
  for (const snaps of byRepo.values()) {
    snaps.sort((a, b) => a.ts - b.ts);
    let cursor = 0;
    let current: RepoStatusSnapshot | null = null;
    for (let d = 0; d < BYDAY_WINDOW; d += 1) {
      const dayEndMs = windowStartMs + (d + 1) * DAY_MS;
      while (cursor < snaps.length && snaps[cursor].ts < dayEndMs) {
        current = snaps[cursor];
        cursor += 1;
      }
      if (current) buckets[d] += current.dirty_count;
    }
  }
  return buckets;
}

export async function loadDashboardStats(): Promise<DashboardStats> {
  const [activity, repositories, historyRaw] = await Promise.all([
    loadActivity(),
    loadRepositories(),
    loadRepoStatusHistory(),
  ]);
  // Seed on first run after upgrade so the chart isn't blank on day one.
  // We don't persist the seed here — `populateActivityFromRepos` is the
  // canonical writer; this seeded copy is only used for the current call.
  const history =
    historyRaw.length === 0 ? seedHistoryFromRepositories(repositories) : historyRaw;
  return deriveDashboardStats(activity, repositories, history);
}

/**
 * Synthesize one snapshot per repo from the cached `dirty_count` /
 * `checked_at` already on the Repository record. Used to keep the dashboard
 * sparkline non-blank between app upgrade and the first
 * `populateActivityFromRepos` run.
 */
function seedHistoryFromRepositories(
  repositories: WorkspaceRepository[],
): RepoStatusHistory {
  const out: RepoStatusHistory = [];
  for (const repo of repositories) {
    if (typeof repo.dirty_count !== "number") continue;
    out.push({
      repoId: repo.id,
      ts: typeof repo.checked_at === "number" ? repo.checked_at : Date.now(),
      dirty_count: repo.dirty_count,
      conflict: Boolean(repo.conflict),
    });
  }
  return out;
}

export function buildRepositoryLookup(
  repositories: WorkspaceRepository[],
): Map<string, WorkspaceRepository> {
  const repositoriesById = new Map<string, WorkspaceRepository>();

  for (const repository of repositories) {
    if (!repositoriesById.has(repository.id)) {
      repositoriesById.set(repository.id, repository);
    }
  }

  return repositoriesById;
}

export function findRepository(
  repositories: WorkspaceRepository[],
  repoId: string,
): WorkspaceRepository | undefined {
  return buildRepositoryLookup(repositories).get(repoId);
}

export async function loadRepositoryById(
  repoId: string,
): Promise<WorkspaceRepository | undefined> {
  const pinned = findRepository(await loadRepositories(), repoId);
  if (pinned) return pinned;

  const candidate = (await loadDiscoveredWorkspaces()).find((item) => item.id === repoId);
  if (!candidate) return undefined;

  return {
    id: candidate.id,
    name: candidate.name,
    platform: candidate.platform,
    remote_url: candidate.remote_url,
    local_path: candidate.local_path,
    last_synced: candidate.last_seen_at,
  };
}

export function filterActivityByWorkspace(
  activity: WorkspaceActivity[],
  repositoriesById: Map<string, WorkspaceRepository>,
  filter: ActivityFilter,
): WorkspaceActivity[] {
  if (filter === "ALL") return activity;

  return activity.filter((item) => {
    const repository = repositoriesById.get(item.repo_id);
    if (!repository) {
      return filter === "REMOTE" && isRemoteActivity(item);
    }
    if (filter === "LOCAL") return repository.platform === "local";
    return repository.platform === "github" || repository.platform === "gitlab";
  });
}

export async function scanAndMergeLocalRepositories(
  scanPath: string | string[],
): Promise<LocalScanMergeResult> {
  const scanPaths = Array.isArray(scanPath) ? scanPath : [scanPath];
  const found = await ipc.scanRepositories(scanPaths);
  const repositories = mergeRepositories(await loadRepositories(), found);

  await ipc.setInStore(REPOSITORIES_STORE_KEY, repositories);
  notifyWorkspaceRepositoriesChanged();
  // After a scan we have fresh repos; rebuild the activity feed from real git logs.
  await populateActivityFromRepos(repositories);

  return { found, repositories };
}

export async function autoScanLocalRepositoriesIfEmpty(
  existing: WorkspaceRepository[],
): Promise<LocalScanMergeResult | null> {
  if (existing.length > 0) return null;
  const settings = asWorkspaceSettings(await ipc.getFromStore("settings"));
  const scanPaths = normalizeScanPaths(settings.watch_directories);
  if (scanPaths.length === 0) return null;
  return scanAndMergeLocalRepositories(scanPaths);
}

// Discovery flow: find candidate workspaces, write them to discovered_workspaces.
// Already-pinned repositories and previously-ignored paths are excluded so the
// "discovered" bucket only contains items the user hasn't decided about yet.
export async function discoverWorkspaces(
  scanPath?: string | string[],
): Promise<WorkspaceDiscoveryResult> {
  const settings = asWorkspaceSettings(await ipc.getFromStore("settings"));
  const scanPaths = Array.isArray(scanPath)
    ? scanPath
    : scanPath
      ? [scanPath]
      : normalizeScanPaths(settings.watch_directories);

  const [pinned, ignored, candidates] = await Promise.all([
    loadRepositories(),
    loadIgnoredWorkspaces(),
    ipc.scanWorkspaceCandidates(scanPaths),
  ]);

  const ignoredSet = new Set(ignored);
  const pinnedPaths = new Set(pinned.map((repo) => repo.local_path));
  const discovered = candidates.filter(
    (candidate) =>
      !ignoredSet.has(candidate.local_path) &&
      !pinnedPaths.has(candidate.local_path),
  );

  await ipc.setInStore(DISCOVERED_STORE_KEY, discovered);
  return { discovered, pinned, ignored };
}

// Auto-discovery on app start / Repositories screen load. Runs the discovery
// pass in the background; cache-first behavior is preserved because the
// existing repositories list renders immediately while this resolves.
export async function autoDiscoverWorkspaces(): Promise<WorkspaceDiscoveryResult | null> {
  try {
    return await discoverWorkspaces();
  } catch {
    return null;
  }
}

export async function pinDiscoveredWorkspace(
  candidate: WorkspaceCandidate,
): Promise<{ repositories: WorkspaceRepository[]; discovered: WorkspaceCandidate[] }> {
  const [pinned, discovered] = await Promise.all([
    loadRepositories(),
    loadDiscoveredWorkspaces(),
  ]);
  const repository: WorkspaceRepository = {
    id: candidate.id,
    name: candidate.name,
    platform: candidate.platform,
    remote_url: candidate.remote_url,
    local_path: candidate.local_path,
    last_synced: candidate.last_seen_at,
  };

  const repositories = mergeRepositories(pinned, [repository]);
  const remainingDiscovered = discovered.filter(
    (item) => item.local_path !== candidate.local_path,
  );

  await Promise.all([
    ipc.setInStore(REPOSITORIES_STORE_KEY, repositories),
    ipc.setInStore(DISCOVERED_STORE_KEY, remainingDiscovered),
  ]);
  notifyWorkspaceRepositoriesChanged();
  // Newly pinned repo should appear in the activity feed alongside others.
  await populateActivityFromRepos(repositories).catch(() => undefined);
  return { repositories, discovered: remainingDiscovered };
}

export async function ignoreDiscoveredWorkspace(
  candidate: WorkspaceCandidate,
): Promise<{ ignored: string[]; discovered: WorkspaceCandidate[] }> {
  const [ignored, discovered] = await Promise.all([
    loadIgnoredWorkspaces(),
    loadDiscoveredWorkspaces(),
  ]);
  const nextIgnored = Array.from(new Set([...ignored, candidate.local_path]));
  const remainingDiscovered = discovered.filter(
    (item) => item.local_path !== candidate.local_path,
  );
  await Promise.all([
    ipc.setInStore(IGNORED_STORE_KEY, nextIgnored),
    ipc.setInStore(DISCOVERED_STORE_KEY, remainingDiscovered),
  ]);
  return { ignored: nextIgnored, discovered: remainingDiscovered };
}

export async function unpinRepository(
  repository: WorkspaceRepository,
): Promise<WorkspaceRepository[]> {
  const pinned = await loadRepositories();
  const repositories = pinned.filter((item) => item.id !== repository.id);
  await ipc.setInStore(REPOSITORIES_STORE_KEY, repositories);
  notifyWorkspaceRepositoriesChanged();
  return repositories;
}

export async function restoreIgnoredWorkspace(path: string): Promise<string[]> {
  const ignored = await loadIgnoredWorkspaces();
  const nextIgnored = ignored.filter((item) => item !== path);
  await ipc.setInStore(IGNORED_STORE_KEY, nextIgnored);
  return nextIgnored;
}

export function findLinkedGitHubRepository(
  remote: GitHubRepo,
  repositories: WorkspaceRepository[],
): WorkspaceRepository | undefined {
  const fullName = remote.full_name.toLowerCase();
  const direct = repositories.find((repo) => remoteOwnerRepoKey(repo.remote_url) === fullName);
  if (direct) return direct;

  const candidates = repositories.filter(
    (repo) =>
      repo.platform === "github" &&
      repo.name.toLowerCase() === remote.name.toLowerCase(),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function findLinkedGitLabRepository(
  remote: GitLabProject,
  repositories: WorkspaceRepository[],
): WorkspaceRepository | undefined {
  const fullName = remote.path_with_namespace.toLowerCase();
  const direct = repositories.find((repo) => remoteOwnerRepoKey(repo.remote_url) === fullName);
  if (direct) return direct;

  const candidates = repositories.filter(
    (repo) =>
      repo.platform === "gitlab" &&
      repo.name.toLowerCase() === remote.name.toLowerCase(),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

const MAX_ACTIVITY_PER_REPO = 12;
const MAX_ACTIVITY_TOTAL = 250;
const MAX_LOCAL_ACTIVITY_CONCURRENCY = 6;
const HISTORY_WINDOW_DAYS = 30;
const HISTORY_MIN_REPOS = 20;

// Build a real activity feed from each repo's recent commits and uncommitted
// state. Writes to the activity store key so consumers (ActivityFeed, dashboard
// stats) read the same shape they always have.
export async function populateActivityFromRepos(
  repositoriesArg?: WorkspaceRepository[],
): Promise<WorkspaceActivity[]> {
  const repositories = repositoriesArg ?? (await loadRepositories());
  const activities: WorkspaceActivity[] = [];
  // Per-repo status snapshot collected from the same `getGitStatus` call the
  // activity feed already needs — no extra IPC fan-out.
  const statusSnapshots = new Map<
    string,
    { dirty_count: number; conflict: boolean; checked_at: number }
  >();

  await mapConcurrent(
    repositories,
    MAX_LOCAL_ACTIVITY_CONCURRENCY,
    async (repo) => {
      try {
        const [status, log] = await Promise.all([
          ipc.getGitStatus(repo.local_path, { mode: "lite" }).catch(() => null),
          ipc
            .getGitLog(repo.local_path, MAX_ACTIVITY_PER_REPO)
            .catch(() => [] as Awaited<ReturnType<typeof ipc.getGitLog>>),
        ]);
        const branch = status?.branch ?? "main";

        if (status) {
          statusSnapshots.set(repo.id, {
            dirty_count: status.files.length,
            conflict: status.files.some((file) => file.status === "U"),
            checked_at: Date.now(),
          });
        }

        for (const commit of log) {
          activities.push({
            id: `commit:${repo.id}:${commit.hash}`,
            repo_id: repo.id,
            type: "commit",
            title: (commit.message ?? "").split("\n")[0] || "(no message)",
            metadata: {
              hash: commit.hash,
              branch,
              author: commit.author,
            },
            timestamp: Date.parse(commit.date) || Date.now(),
          });
        }

        if (status && status.files.length > 0) {
          activities.push({
            id: `dirty:${repo.id}`,
            repo_id: repo.id,
            type: "stash",
            title: `${status.files.length} uncommitted file${status.files.length === 1 ? "" : "s"} on ${branch}`,
            metadata: { branch, files: status.files.length },
            timestamp: Date.now(),
          });
        }
      } catch {
        // skip individual repo failures so one bad path doesn't break the feed
      }
    },
  );

  activities.push(...(await collectProviderActivity(repositories)));

  activities.sort((a, b) => b.timestamp - a.timestamp);
  const capped = activities.slice(0, MAX_ACTIVITY_TOTAL);

  // Merge the cached status back into the repositories list so the sidebar
  // and any other consumer reads dirty/conflict state without extra IPC.
  // Only persist when we actually have new snapshots to avoid spurious writes
  // on, say, an offline run that returned no statuses.
  if (statusSnapshots.size > 0) {
    let mutated = false;
    const nextRepositories = repositories.map((repo) => {
      const snapshot = statusSnapshots.get(repo.id);
      if (!snapshot) return repo;
      if (
        repo.dirty_count === snapshot.dirty_count &&
        Boolean(repo.conflict) === snapshot.conflict
      ) {
        // Counts unchanged — only bump `checked_at` on the in-memory copy so
        // freshness telemetry stays accurate without a store write.
        repo.checked_at = snapshot.checked_at;
        return repo;
      }
      mutated = true;
      return {
        ...repo,
        dirty_count: snapshot.dirty_count,
        conflict: snapshot.conflict,
        checked_at: snapshot.checked_at,
      };
    });
    if (mutated) {
      await ipc.setInStore(REPOSITORIES_STORE_KEY, nextRepositories);
      // Mutate the array we were handed so the caller (e.g. Dashboard) reads
      // the updated snapshot from the same reference it already holds.
      for (let i = 0; i < repositories.length; i += 1) {
        repositories[i] = nextRepositories[i];
      }
      notifyWorkspaceRepositoriesChanged();
    }
  }

  // Persist a rolling per-repo dirty-count history so the dashboard
  // sparkline can show a real series across app restarts. One batched write
  // per invocation regardless of how many repos were polled.
  if (statusSnapshots.size > 0) {
    const existing = await loadRepoStatusHistory().catch(() => [] as RepoStatusHistory);
    const seeded =
      existing.length === 0 ? seedHistoryFromRepositories(repositories) : existing;
    const additions: RepoStatusHistory = [];
    for (const [repoId, snapshot] of statusSnapshots) {
      additions.push({
        repoId,
        ts: snapshot.checked_at,
        dirty_count: snapshot.dirty_count,
        conflict: snapshot.conflict,
      });
    }
    const next = trimRepoStatusHistory(
      [...seeded, ...additions],
      repositories.length,
    );
    await ipc.setInStore(REPO_STATUS_HISTORY_STORE_KEY, next);
  }

  await ipc.setInStore(ACTIVITY_STORE_KEY, capped);
  return capped;
}

/**
 * Drop entries older than HISTORY_WINDOW_DAYS, then trim to the soft cap
 * (HISTORY_WINDOW_DAYS × max(repoCount, HISTORY_MIN_REPOS)) keeping the
 * newest entries. Pure / exported only for testing within the module.
 */
function trimRepoStatusHistory(
  entries: RepoStatusHistory,
  repoCount: number,
): RepoStatusHistory {
  const cutoff = Date.now() - HISTORY_WINDOW_DAYS * DAY_MS;
  const fresh = entries.filter((entry) => entry.ts >= cutoff);
  const cap = HISTORY_WINDOW_DAYS * Math.max(repoCount, HISTORY_MIN_REPOS);
  if (fresh.length <= cap) return fresh;
  fresh.sort((a, b) => a.ts - b.ts);
  return fresh.slice(fresh.length - cap);
}

async function collectProviderActivity(
  repositories: WorkspaceRepository[],
): Promise<WorkspaceActivity[]> {
  const auth = await ipc.getAuthStatus().catch(() => ({
    github: false,
    gitlab: false,
  }));
  const [githubActivity, gitlabActivity] = await Promise.all([
    auth.github ? collectGitHubActivity(repositories) : Promise.resolve([]),
    auth.gitlab ? collectGitLabActivity(repositories) : Promise.resolve([]),
  ]);
  return [...githubActivity, ...gitlabActivity];
}

async function collectGitHubActivity(
  repositories: WorkspaceRepository[],
): Promise<WorkspaceActivity[]> {
  const repos = await ipc.getGitHubRepos().catch(() => [] as GitHubRepo[]);
  const selectedRepos = repos.slice(0, MAX_PROVIDER_REPOS);
  const byRepo = await Promise.all(
    selectedRepos.map(async (remote) => {
      const linked = findLinkedGitHubRepository(remote, repositories);
      const repoId = linked?.id ?? `remote:github:${remote.full_name.toLowerCase()}`;
      const metadataBase = {
        platform: "github",
        repo: remote.full_name,
        url: remote.html_url,
      };
      const [prs, runs] = await Promise.all([
        ipc.getGitHubPRs(remote.full_name).catch(() => [] as GitHubPR[]),
        ipc.getGitHubPipelines(remote.full_name).catch(() => [] as GitHubRun[]),
      ]);
      const activities: WorkspaceActivity[] = [];

      for (const pr of prs.slice(0, MAX_PROVIDER_ITEMS_PER_REPO)) {
        activities.push({
          id: `github-pr:${remote.full_name}:${pr.number}`,
          repo_id: repoId,
          type: "pr_opened",
          title: `PR #${pr.number}: ${pr.title}`,
          metadata: {
            ...metadataBase,
            number: pr.number,
            author: pr.author,
            branch: pr.head,
            base: pr.base,
            draft: pr.draft,
            url: pr.html_url,
          },
          timestamp: parseTimestamp(pr.updated_at, remote.updated_at),
        });
      }

      for (const run of runs.slice(0, MAX_PROVIDER_ITEMS_PER_REPO)) {
        activities.push(githubPipelineActivity(remote, repoId, run, metadataBase));
      }

      return activities;
    }),
  );
  return byRepo.flat();
}

function githubPipelineActivity(
  repo: GitHubRepo,
  repoId: string,
  run: GitHubRun,
  metadataBase: Record<string, unknown>,
): WorkspaceActivity {
  const conclusion = run.conclusion ?? run.status ?? "unknown";
  const type =
    conclusion === "success"
      ? "ci_pass"
      : conclusion === "failure" ||
          conclusion === "cancelled" ||
          conclusion === "timed_out"
        ? "ci_fail"
        : "pipeline";
  const label = run.name?.trim() || "GitHub Actions";
  return {
    id: `github-run:${repo.full_name}:${run.id}`,
    repo_id: repoId,
    type,
    title: `${label}: ${conclusion}`,
    metadata: {
      ...metadataBase,
      runId: run.id,
      status: run.status,
      conclusion: run.conclusion,
      hash: run.head_sha,
      url: run.html_url,
    },
    timestamp: parseTimestamp(run.updated_at, repo.updated_at),
  };
}

async function collectGitLabActivity(
  repositories: WorkspaceRepository[],
): Promise<WorkspaceActivity[]> {
  const projects = await ipc.getGitLabProjects().catch(() => [] as GitLabProject[]);
  const selectedProjects = projects.slice(0, MAX_PROVIDER_REPOS);
  const byProject = await Promise.all(
    selectedProjects.map(async (project) => {
      const linked = findLinkedGitLabRepository(project, repositories);
      const repoId =
        linked?.id ?? `remote:gitlab:${project.path_with_namespace.toLowerCase()}`;
      const metadataBase = {
        platform: "gitlab",
        repo: project.path_with_namespace,
        url: project.web_url,
      };
      const projectId = String(project.id);
      const [mrs, pipelines] = await Promise.all([
        ipc.getGitLabMRs(projectId).catch(() => [] as GitLabMR[]),
        ipc.getGitLabPipelines(projectId).catch(() => [] as GitLabPipeline[]),
      ]);
      const activities: WorkspaceActivity[] = [];

      for (const mr of mrs.slice(0, MAX_PROVIDER_ITEMS_PER_REPO)) {
        activities.push({
          id: `gitlab-mr:${project.id}:${mr.iid}`,
          repo_id: repoId,
          type: mr.state === "merged" ? "pr_merged" : "pr_opened",
          title: `MR !${mr.iid}: ${mr.title}`,
          metadata: {
            ...metadataBase,
            iid: mr.iid,
            author: mr.author,
            branch: mr.source_branch,
            base: mr.target_branch,
            draft: mr.draft,
            state: mr.state,
            url: mr.web_url,
          },
          timestamp: parseTimestamp(mr.updated_at, project.last_activity_at),
        });
      }

      for (const pipeline of pipelines.slice(0, MAX_PROVIDER_ITEMS_PER_REPO)) {
        activities.push(
          gitlabPipelineActivity(project, repoId, pipeline, metadataBase),
        );
      }

      return activities;
    }),
  );
  return byProject.flat();
}

function gitlabPipelineActivity(
  project: GitLabProject,
  repoId: string,
  pipeline: GitLabPipeline,
  metadataBase: Record<string, unknown>,
): WorkspaceActivity {
  const type =
    pipeline.status === "success"
      ? "ci_pass"
      : pipeline.status === "failed" || pipeline.status === "canceled"
        ? "ci_fail"
        : "pipeline";
  return {
    id: `gitlab-pipeline:${project.id}:${pipeline.id}`,
    repo_id: repoId,
    type,
    title: `Pipeline ${pipeline.ref}: ${pipeline.status}`,
    metadata: {
      ...metadataBase,
      pipelineId: pipeline.id,
      status: pipeline.status,
      branch: pipeline.ref,
      hash: pipeline.sha,
      url: pipeline.web_url,
    },
    timestamp: parseTimestamp(pipeline.updated_at, project.last_activity_at),
  };
}

function mergeRepositories(
  existing: WorkspaceRepository[],
  found: WorkspaceRepository[],
): WorkspaceRepository[] {
  const repositoriesById = new Map<string, WorkspaceRepository>();

  for (const repository of existing) {
    repositoriesById.set(repository.id, repository);
  }

  for (const repository of found) {
    repositoriesById.set(repository.id, repository);
  }

  return [...repositoriesById.values()];
}

function asWorkspaceSettings(value: unknown): WorkspaceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as WorkspaceSettings;
}

function isRemoteActivity(item: WorkspaceActivity): boolean {
  return (
    item.metadata.platform === "github" ||
    item.metadata.platform === "gitlab"
  );
}

function parseTimestamp(...values: Array<string | null | undefined>): number {
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeScanPaths(paths: unknown): string[] {
  const configured = Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === "string")
    : [];
  const merged = [...DEFAULT_SCAN_PATHS, ...configured];
  return Array.from(new Set(merged.map((path) => path.trim()).filter(Boolean)));
}

function notifyWorkspaceRepositoriesChanged(): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_REPOSITORIES_CHANGED_EVENT));
}

function remoteOwnerRepoKey(remoteUrl: string | undefined): string | null {
  if (!remoteUrl) return null;
  const value = remoteUrl.trim();
  if (!value) return null;

  const sshMatch = value.match(/^[\w-]+@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1]) return cleanOwnerRepo(sshMatch[1]);

  try {
    const parsed = new URL(value);
    return cleanOwnerRepo(parsed.pathname);
  } catch {
    return cleanOwnerRepo(value);
  }
}

function cleanOwnerRepo(value: string): string | null {
  const trimmed = value
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-2).join("/").toLowerCase();
}
