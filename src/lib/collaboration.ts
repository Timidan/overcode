import { mapConcurrent } from "./concurrency";
import {
  ipc,
  type AuthStatus,
  type GitHubPR,
  type GitHubRepo,
  type GitHubRun,
  type GitLabMR,
  type GitLabPipeline,
  type GitLabProject,
  type PullRequestCheckSummary,
} from "./ipc";
import {
  mapRemotePrToLocalWorkspace,
  type PrLocalMappingConfidence,
  type PrLocalMappingState,
} from "./pr-local-mapping";
import { loadRepositories } from "./workspace-data";

export type CollaborationProvider = "github" | "gitlab";

export type PRStatus =
  | "open"
  | "approved"
  | "changes-requested"
  | "merged"
  | "draft"
  | "closed";

interface GitHubCommentTarget {
  platform: "github";
  repoFullName: string;
  number: number;
}

interface GitLabCommentTarget {
  platform: "gitlab";
  projectId: string;
  number: number;
}

type CommentTarget = GitHubCommentTarget | GitLabCommentTarget;

export interface PRCardData {
  id: string;
  platform: CollaborationProvider;
  repoFullName: string;
  number: number;
  numberPrefix: string;
  platformColor: string;
  title: string;
  author: string;
  source_branch: string;
  target_branch: string;
  status: PRStatus;
  updated_at: string;
  url: string;
  localMapping?: PRLocalMappingStatus;
  commentTarget: CommentTarget;
  // Rollup of CI checks for the PR's head branch, computed from the
  // per-repo pipeline fetch we already run. Optional so older cached
  // entries stay valid.
  checks?: PullRequestCheckSummary;
}

export interface PRLocalMappingStatus {
  state: PrLocalMappingState;
  confidence: PrLocalMappingConfidence;
  branchLikelyLocal: boolean;
  needsGitStatus: boolean;
  localRepoId: string | null;
  localPath: string | null;
}

interface ProviderLoadResult {
  items: PRCardData[];
  error: string | null;
}

export interface CollaborationLoadResult {
  auth: AuthStatus;
  items: PRCardData[];
  error: string | null;
}

const PROVIDER_PAGE_SIZE = 10;
const FALLBACK_UPDATED_AT = "1970-01-01T00:00:00.000Z";
const COLLABORATION_CACHE_TTL_MS = 60_000;
// Cap concurrent provider fan-out so workspaces with many connected repos
// don't saturate the GitHub/GitLab API rate limits in a single tick.
const MAX_PROVIDER_REPO_CONCURRENCY = 6;

let collaborationCache:
  | { timestamp: number; result: CollaborationLoadResult }
  | null = null;

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function deriveStatus(args: { draft: boolean; state?: string }): PRStatus {
  if (args.state === "merged") return "merged";
  if (args.state === "closed") return "closed";
  if (args.draft) return "draft";
  return "open";
}

function sortByUpdatedDesc(items: PRCardData[]): PRCardData[] {
  return [...items].sort((a, b) => updatedTime(b) - updatedTime(a));
}

function updatedTime(item: PRCardData): number {
  const time = new Date(item.updated_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

async function addLocalMappings(items: PRCardData[]): Promise<PRCardData[]> {
  if (items.length === 0) return items;

  try {
    const repositories = await loadRepositories();

    return items.map((item) => {
      const mapping =
        item.platform === "github"
          ? mapRemotePrToLocalWorkspace(repositories, {
              provider: "github",
              repoFullName: item.repoFullName,
              head: item.source_branch,
              base: item.target_branch,
              updated_at: item.updated_at,
            })
          : mapRemotePrToLocalWorkspace(repositories, {
              provider: "gitlab",
              projectPath: item.repoFullName,
              source_branch: item.source_branch,
              target_branch: item.target_branch,
              updated_at: item.updated_at,
            });
      const status = mapping.status;

      return {
        ...item,
        localMapping: {
          state: status.state,
          confidence: status.confidence,
          branchLikelyLocal: status.branchLikelyLocal,
          needsGitStatus: status.needsGitStatus,
          localRepoId: status.localRepoId,
          localPath: status.localPath,
        },
      };
    });
  } catch {
    return items;
  }
}

function githubItem(
  repo: GitHubRepo,
  pr: GitHubPR,
  checks?: PullRequestCheckSummary,
): PRCardData {
  return {
    id: `github:${repo.full_name}:${pr.number}`,
    platform: "github",
    repoFullName: repo.full_name,
    number: pr.number,
    numberPrefix: "#",
    platformColor: "var(--color-text-secondary)",
    title: pr.title,
    author: pr.author,
    source_branch: pr.head,
    target_branch: pr.base,
    status: deriveStatus({ draft: pr.draft }),
    updated_at: pr.updated_at ?? FALLBACK_UPDATED_AT,
    url: pr.html_url,
    commentTarget: {
      platform: "github",
      repoFullName: repo.full_name,
      number: pr.number,
    },
    checks,
  };
}

function gitlabItem(
  project: GitLabProject,
  mr: GitLabMR,
  checks?: PullRequestCheckSummary,
): PRCardData {
  return {
    id: `gitlab:${project.path_with_namespace}:${mr.iid}`,
    platform: "gitlab",
    repoFullName: project.path_with_namespace,
    number: mr.iid,
    numberPrefix: "!",
    platformColor: "var(--color-accent-purple)",
    title: mr.title,
    author: mr.author,
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    status: deriveStatus({ draft: mr.draft, state: mr.state }),
    updated_at: mr.updated_at,
    url: mr.web_url,
    commentTarget: {
      platform: "gitlab",
      projectId: String(project.id),
      number: mr.iid,
    },
    checks,
  };
}

/**
 * Reduce a stream of GitHub Actions workflow runs into one bucket-summary
 * per branch. We keep only the latest run per workflow name on each branch
 * (workflow runs come ordered newest-first from the API) to avoid double
 * counting historical runs.
 */
function summarizeGitHubRuns(runs: GitHubRun[]): Map<string, PullRequestCheckSummary> {
  const byBranch = new Map<string, Map<string, GitHubRun>>();
  for (const run of runs) {
    const branch = run.head_branch?.trim();
    if (!branch) continue;
    const name = run.name?.trim() || `run:${run.id}`;
    const inner = byBranch.get(branch) ?? new Map<string, GitHubRun>();
    if (!inner.has(name)) inner.set(name, run);
    byBranch.set(branch, inner);
  }
  const out = new Map<string, PullRequestCheckSummary>();
  for (const [branch, inner] of byBranch) {
    let passing = 0;
    let failing = 0;
    let pending = 0;
    for (const run of inner.values()) {
      const bucket = classifyGitHubRun(run);
      if (bucket === "passing") passing += 1;
      else if (bucket === "failing") failing += 1;
      else if (bucket === "pending") pending += 1;
    }
    out.set(branch, {
      passing,
      failing,
      pending,
      total: inner.size,
    });
  }
  return out;
}

function classifyGitHubRun(run: GitHubRun): "passing" | "failing" | "pending" | "unknown" {
  const conclusion = (run.conclusion ?? "").toLowerCase();
  if (conclusion === "success") return "passing";
  if (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "cancelled" ||
    conclusion === "canceled"
  ) {
    return "failing";
  }
  const status = (run.status ?? "").toLowerCase();
  if (
    status === "queued" ||
    status === "in_progress" ||
    status === "pending" ||
    status === "waiting"
  ) {
    return "pending";
  }
  return "unknown";
}

/**
 * GitLab pipelines come as a flat list per project; keep only the latest
 * pipeline per branch (the API returns them newest-first) so the rollup
 * matches what the user sees in the GitLab UI.
 */
function summarizeGitLabPipelines(
  pipelines: GitLabPipeline[],
): Map<string, PullRequestCheckSummary> {
  const latestByBranch = new Map<string, GitLabPipeline>();
  for (const pipeline of pipelines) {
    const branch = pipeline.ref?.trim();
    if (!branch) continue;
    if (!latestByBranch.has(branch)) latestByBranch.set(branch, pipeline);
  }
  const out = new Map<string, PullRequestCheckSummary>();
  for (const [branch, pipeline] of latestByBranch) {
    const bucket = classifyGitLabPipeline(pipeline);
    out.set(branch, {
      passing: bucket === "passing" ? 1 : 0,
      failing: bucket === "failing" ? 1 : 0,
      pending: bucket === "pending" ? 1 : 0,
      total: 1,
    });
  }
  return out;
}

function classifyGitLabPipeline(
  pipeline: GitLabPipeline,
): "passing" | "failing" | "pending" | "unknown" {
  const status = (pipeline.status ?? "").toLowerCase();
  if (status === "success") return "passing";
  if (status === "failed" || status === "canceled" || status === "cancelled") {
    return "failing";
  }
  if (
    status === "pending" ||
    status === "running" ||
    status === "created" ||
    status === "waiting_for_resource" ||
    status === "preparing" ||
    status === "scheduled"
  ) {
    return "pending";
  }
  return "unknown";
}

async function loadGitHubItems(): Promise<ProviderLoadResult> {
  try {
    const repos = await ipc.getGitHubRepos();
    const selected = repos.slice(0, PROVIDER_PAGE_SIZE);
    // mapConcurrent caps in-flight per-repo fetches so workspaces with many
    // connected repos don't burst against the API rate limit.
    const byRepo = await mapConcurrent(
      selected,
      MAX_PROVIDER_REPO_CONCURRENCY,
      async (repo): Promise<PRCardData[]> => {
        try {
          // PRs + workflow runs share one round-trip per repo; the runs
          // payload already powers the Dashboard activity feed, so this is
          // not a new fetch shape. We never call per-PR endpoints here —
          // that would explode the request count on accounts with many PRs.
          const [prs, runs] = await Promise.all([
            ipc.getGitHubPRs(repo.full_name),
            ipc.getGitHubPipelines(repo.full_name).catch(() => [] as GitHubRun[]),
          ]);
          const checksByBranch = summarizeGitHubRuns(runs);
          return prs.map((pr) => githubItem(repo, pr, checksByBranch.get(pr.head)));
        } catch {
          // A single unreadable repository should not hide the rest of the feed.
          return [];
        }
      },
    );

    return { items: byRepo.flat(), error: null };
  } catch (error) {
    return {
      items: [],
      error: `GitHub: ${toErrorMessage(error, "request failed")}`,
    };
  }
}

async function loadGitLabItems(): Promise<ProviderLoadResult> {
  try {
    const projects = await ipc.getGitLabProjects();
    const selected = projects.slice(0, PROVIDER_PAGE_SIZE);
    // Same concurrency cap as GitHub — bounds the worst-case burst on
    // workspaces with many connected projects.
    const byProject = await mapConcurrent(
      selected,
      MAX_PROVIDER_REPO_CONCURRENCY,
      async (project): Promise<PRCardData[]> => {
        try {
          const projectId = String(project.id);
          // Pair MR list with the existing per-project pipeline fetch so we
          // can attach a CI rollup without firing per-MR requests.
          const [mrs, pipelines] = await Promise.all([
            ipc.getGitLabMRs(projectId),
            ipc.getGitLabPipelines(projectId).catch(() => [] as GitLabPipeline[]),
          ]);
          const checksByBranch = summarizeGitLabPipelines(pipelines);
          return mrs.map((mr) =>
            gitlabItem(project, mr, checksByBranch.get(mr.source_branch)),
          );
        } catch {
          // A single unreadable project should not hide the rest of the feed.
          return [];
        }
      },
    );

    return { items: byProject.flat(), error: null };
  } catch (error) {
    return {
      items: [],
      error: `GitLab: ${toErrorMessage(error, "request failed")}`,
    };
  }
}

export async function loadCollaborationItems(
  options: { force?: boolean } = {},
): Promise<CollaborationLoadResult> {
  if (
    !options.force &&
    collaborationCache &&
    Date.now() - collaborationCache.timestamp < COLLABORATION_CACHE_TTL_MS
  ) {
    return collaborationCache.result;
  }

  const auth = await ipc.getAuthStatus();
  const providerResults: ProviderLoadResult[] = [];

  if (auth.github) {
    providerResults.push(await loadGitHubItems());
  }

  if (auth.gitlab) {
    providerResults.push(await loadGitLabItems());
  }

  const items = await addLocalMappings(
    sortByUpdatedDesc(providerResults.flatMap((result) => result.items)),
  );

  const result = {
    auth,
    items,
    error: providerResults
      .map((result) => result.error)
      .filter((error): error is string => error !== null)
      .join("; ") || null,
  };
  collaborationCache = { timestamp: Date.now(), result };
  return result;
}

export async function commentOnCollaborationItem(
  pr: Pick<PRCardData, "commentTarget">,
  body: string,
): Promise<void> {
  const target = pr.commentTarget;

  if (target.platform === "github") {
    await ipc.commentOnGitHubPR(target.repoFullName, target.number, body);
    collaborationCache = null;
    return;
  }

  await ipc.commentOnGitLabMR(target.projectId, target.number, body);
  collaborationCache = null;
}
