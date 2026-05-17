import { loadCollaborationItems } from "./collaboration";
import { ipc, type AuthStatus, type Commit, type GitStatus } from "./ipc";
import {
  loadRepositories,
  type WorkspaceRepository,
} from "./workspace-data";
import type { StandupPayload } from "./ai-features";

export type StandupRange = "today" | "yesterday" | "last24h";

const MAX_REPOS = 24;
const MAX_COMMITS_PER_REPO = 60;
const MAX_STATUS_REPOS = 18;

export async function buildStandupPayload(
  range: StandupRange,
): Promise<StandupPayload> {
  const [auth, repositories, collaboration] = await Promise.all([
    ipc.getAuthStatus().catch(() => ({ github: false, gitlab: false } as AuthStatus)),
    loadRepositories().catch(() => [] as WorkspaceRepository[]),
    loadCollaborationItems().catch(() => ({ items: [] })),
  ]);
  const bounds = rangeBounds(range);
  const userName = auth.profiles?.github?.username || "developer";
  const greeting = `${dayGreeting(new Date())}, ${userName}`;
  const localRepos = repositories
    .filter((repo) => Boolean(repo.local_path))
    .slice(0, MAX_REPOS);

  const commitGroups = await Promise.all(
    localRepos.map(async (repo) => {
      const commits = await ipc
        .getGitLog(repo.local_path, MAX_COMMITS_PER_REPO)
        .catch(() => [] as Commit[]);
      return commits
        .filter((commit) => inRange(commit.date, bounds.start, bounds.end))
        .map((commit) => ({
          repo: repo.name,
          hash: commit.hash,
          message: commit.message,
          author: commit.author,
          date: commit.date,
        }));
    }),
  );

  const localStatuses = await Promise.all(
    localRepos.slice(0, MAX_STATUS_REPOS).map(async (repo) => {
      const status = await ipc
        .getGitStatus(repo.local_path, { mode: "lite" })
        .catch(() => null as GitStatus | null);
      if (!status || status.files.length === 0) return null;
      return {
        repo: repo.name,
        branch: status.branch,
        changedFiles: status.files.length,
        ahead: status.ahead,
        behind: status.behind,
      };
    }),
  );

  const pullRequests = collaboration.items
    .filter((pr) => inRange(pr.updated_at, bounds.start, bounds.end))
    .map((pr) => ({
      repo: pr.repoFullName,
      number: pr.number,
      title: pr.title,
      status: pr.status,
      source: pr.source_branch,
      target: pr.target_branch,
      updated_at: pr.updated_at,
    }));

  return {
    userName,
    greeting,
    rangeLabel: bounds.label,
    startIso: bounds.start.toISOString(),
    endIso: bounds.end.toISOString(),
    commits: commitGroups.flat().sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    pullRequests,
    localChanges: localStatuses.filter((item): item is NonNullable<typeof item> => item !== null),
  };
}

function rangeBounds(range: StandupRange): {
  label: string;
  start: Date;
  end: Date;
} {
  const now = new Date();
  if (range === "last24h") {
    return {
      label: "last 24 hours",
      start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      end: now,
    };
  }
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  if (range === "today") {
    return { label: "today", start: startToday, end: now };
  }
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  return { label: "yesterday", start: startYesterday, end: startToday };
}

function inRange(value: string | null, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  return time >= start.getTime() && time <= end.getTime();
}

function dayGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}
