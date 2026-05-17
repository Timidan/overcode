import type {
  GitHubIssue,
  GitHubIssueDetail,
  GitHubIssueLabel,
  GitHubMilestoneSummary,
  PullRequestCheck,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestFile,
  ReviewThreadItem,
} from "./github";
import {
  requestJson,
  requestPaginated,
  requestVoid,
} from "./provider-http";

// GitLab issue summaries and details conform to the same shape used by the
// GitHub backend (see `GitHubIssue` / `GitHubIssueDetail`), so the UI can be
// provider-agnostic. We re-export those names as `GitLabIssue` /
// `GitLabIssueDetail` for read-site clarity in the IPC layer.
export type GitLabIssue = GitHubIssue;
export type GitLabIssueDetail = GitHubIssueDetail;

const BASE = "https://gitlab.com/api/v4";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string | null;
  web_url: string;
  last_activity_at: string;
}

export interface GitLabMR {
  iid: number;
  title: string;
  author: string;
  source_branch: string;
  target_branch: string;
  updated_at: string;
  web_url: string;
  draft: boolean;
  state: string;
}

export interface GitLabPipeline {
  id: number;
  status: string;
  ref: string;
  sha: string;
  web_url: string;
  updated_at: string;
}

interface GitLabProjectResponse {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string | null;
  web_url: string;
  last_activity_at: string;
}

interface GitLabMRResponse {
  iid: number;
  title: string;
  author?: { username?: string };
  source_branch: string;
  target_branch: string;
  updated_at: string;
  web_url: string;
  draft?: boolean;
  work_in_progress?: boolean;
  state: string;
}

interface GitLabPipelineResponse {
  id: number;
  status: string;
  ref: string;
  sha: string;
  web_url: string;
  updated_at: string;
}

interface GitLabMRDetailResponse extends GitLabMRResponse {
  description: string | null;
  project_id: number;
  references?: { full?: string };
  changes?: GitLabChangeResponse[];
}

interface GitLabChangeResponse {
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  diff: string;
}

interface GitLabCommitResponse {
  id: string;
  title: string;
  message: string;
  author_name: string;
  authored_date: string;
  web_url: string;
}

interface GitLabNoteResponse {
  id: number;
  body: string;
  author?: { username?: string };
  created_at: string;
  updated_at?: string;
  position?: {
    new_path?: string;
    new_line?: number;
  };
  system?: boolean;
}

interface GitLabApprovalResponse {
  user_has_approved: boolean;
  approved_by?: Array<{ user?: { username?: string } }>;
  approvals_required?: number;
  approvals_left?: number;
}

interface GitLabUser {
  username?: string;
}

interface GitLabLabelObjectResponse {
  name?: string;
  color?: string;
  description?: string;
}

interface GitLabMilestoneResponse {
  id?: number;
  title?: string;
  due_date?: string | null;
  start_date?: string | null;
  state?: string;
  web_url?: string;
}

interface GitLabIssueResponse {
  iid: number;
  title: string;
  author?: GitLabUser | null;
  state: string;
  labels?: unknown[];
  assignees?: GitLabUser[] | null;
  user_notes_count?: number;
  updated_at: string | null;
  web_url: string;
  description?: string | null;
  discussion_locked?: boolean;
  milestone?: GitLabMilestoneResponse | null;
  references?: { full?: string };
  project_id?: number;
  merge_requests_count?: number;
}

interface GitLabRelatedMRResponse {
  iid: number;
  title: string;
  state: string;
  web_url: string;
}

interface GitLabIssueStatisticsResponse {
  statistics?: {
    counts?: {
      all?: number;
      closed?: number;
      opened?: number;
    };
  };
}

export async function listProjects(token: string): Promise<GitLabProject[]> {
  const data = await gitlabPaginated<GitLabProjectResponse>(
    token,
    "/projects?membership=true&per_page=100&order_by=last_activity_at",
  );
  return data.map((project) => ({
    id: project.id,
    name: project.name,
    path_with_namespace: project.path_with_namespace,
    default_branch: project.default_branch,
    web_url: project.web_url,
    last_activity_at: project.last_activity_at,
  }));
}

export async function listMRs(
  token: string,
  projectId: number | string,
): Promise<GitLabMR[]> {
  const project = encodeURIComponent(String(projectId));
  const data = await gitlabPaginated<GitLabMRResponse>(
    token,
    `/projects/${project}/merge_requests?state=opened&per_page=100`,
  );
  return data.map(mapMR);
}

export async function listPipelines(
  token: string,
  projectId: number | string,
): Promise<GitLabPipeline[]> {
  const project = encodeURIComponent(String(projectId));
  const data = await gitlabPaginated<GitLabPipelineResponse>(
    token,
    `/projects/${project}/pipelines?per_page=100`,
    5,
  );
  return data.map((pipeline) => ({
    id: pipeline.id,
    status: pipeline.status,
    ref: pipeline.ref,
    sha: pipeline.sha,
    web_url: pipeline.web_url,
    updated_at: pipeline.updated_at,
  }));
}

export async function commentOnMR(
  token: string,
  projectId: number | string,
  mrIid: number,
  body: string,
): Promise<void> {
  await requestVoid(
    "gitlab",
    `${BASE}/projects/${encodeURIComponent(String(projectId))}/merge_requests/${mrIid}/notes`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    },
  );
}

export async function fetchMRDetail(
  token: string,
  projectId: number | string,
  mrIid: number,
): Promise<PullRequestDetail> {
  const project = encodeURIComponent(String(projectId));
  const [mrDetail, commits, notes, approval, pipelines] = await Promise.all([
    gitlabJson<GitLabMRDetailResponse>(
      token,
      `/projects/${project}/merge_requests/${mrIid}/changes`,
    ),
    gitlabPaginated<GitLabCommitResponse>(
      token,
      `/projects/${project}/merge_requests/${mrIid}/commits?per_page=100`,
    ).catch(() => []),
    gitlabPaginated<GitLabNoteResponse>(
      token,
      `/projects/${project}/merge_requests/${mrIid}/notes?per_page=100&sort=asc&order_by=created_at`,
    ).catch(() => []),
    gitlabJson<GitLabApprovalResponse>(
      token,
      `/projects/${project}/merge_requests/${mrIid}/approvals`,
    ).catch(() => null),
    gitlabPaginated<GitLabPipelineResponse>(
      token,
      `/projects/${project}/merge_requests/${mrIid}/pipelines?per_page=100`,
      5,
    ).catch(() => []),
  ]);

  const files: PullRequestFile[] = (mrDetail.changes ?? []).map((change) => {
    const counts = diffAdditionsAndDeletions(change.diff);
    return {
      path: change.new_path || change.old_path,
      status: mapChangeStatus(change),
      additions: counts.additions,
      deletions: counts.deletions,
      patch: change.diff,
      previous_path: change.renamed_file ? change.old_path : undefined,
    };
  });

  const comments: ReviewThreadItem[] = [];
  const reviewComments: ReviewThreadItem[] = [];
  for (const note of notes) {
    if (note.system) continue;
    const item: ReviewThreadItem = {
      id: String(note.id),
      author: note.author?.username ?? "unknown",
      body: note.body,
      created_at: note.created_at,
      updated_at: note.updated_at,
    };
    if (note.position?.new_path) {
      reviewComments.push({
        ...item,
        file_path: note.position.new_path,
        line: note.position.new_line,
      });
    } else {
      comments.push(item);
    }
  }

  const reviews: ReviewThreadItem[] = approval
    ? [
        {
          id: `approval:${mrIid}`,
          author: "approvals",
          body: [
            approval.user_has_approved ? "Approved by current user." : null,
            approval.approved_by?.length
              ? `Approved by: ${approval.approved_by
                  .map((entry) => entry.user?.username)
                  .filter(Boolean)
                  .join(", ")}`
              : null,
            approval.approvals_required !== undefined
              ? `Required: ${approval.approvals_required}, remaining: ${approval.approvals_left ?? 0}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
          created_at: mrDetail.updated_at,
        },
      ].filter((item) => item.body.length > 0)
    : [];

  const checks: PullRequestCheck[] = pipelines.map((pipeline) => ({
    id: String(pipeline.id),
    name: `Pipeline ${pipeline.ref}`,
    status: pipeline.status,
    conclusion: pipeline.status,
    url: pipeline.web_url,
    updated_at: pipeline.updated_at,
  }));

  const repoFullName = mrDetail.references?.full?.replace(/!\d+$/, "") ?? String(projectId);

  return {
    id: `gitlab:${repoFullName}:${mrIid}`,
    provider: "gitlab",
    repoFullName,
    number: mrIid,
    numberPrefix: "!",
    title: mrDetail.title,
    body: mrDetail.description ?? "",
    author: mrDetail.author?.username ?? "unknown",
    source_branch: mrDetail.source_branch,
    target_branch: mrDetail.target_branch,
    status: mrDetail.state,
    draft: !!mrDetail.draft || !!mrDetail.work_in_progress,
    url: mrDetail.web_url,
    updated_at: mrDetail.updated_at,
    files,
    commits: mapCommits(commits),
    comments,
    reviewComments,
    reviews,
    checks,
  };
}

function gitlabJson<T>(token: string, path: string): Promise<T> {
  return requestJson<T>("gitlab", `${BASE}${path}`, {
    headers: authHeaders(token),
  });
}

function gitlabPaginated<T>(
  token: string,
  path: string,
  maxPages = 10,
): Promise<T[]> {
  return requestPaginated<T>(
    "gitlab",
    `${BASE}${path}`,
    { headers: authHeaders(token) },
    { maxPages },
  );
}

// -----------------------------------------------------------------------
// GitLab issues — list + detail.
//
// Returns shapes identical to the GitHub backend so the UI can stay
// provider-agnostic. State is normalised ("opened" → "open"), label
// payloads tolerate both string and object forms, and milestone counts
// are hydrated via /issues_statistics — see maybeLoadMilestoneCounts.
// -----------------------------------------------------------------------

export async function listGitLabIssues(
  token: string,
  projectId: number | string,
): Promise<GitLabIssue[]> {
  const project = encodeURIComponent(String(projectId));
  // `state=all` returns opened+closed in one round trip, mirroring the
  // GitHub `state=all` listing. Sorted descending by updated_at for parity
  // with the GitHub flow.
  const issues = await gitlabPaginated<GitLabIssueResponse>(
    token,
    `/projects/${project}/issues?scope=all&state=all&per_page=100&order_by=updated_at&sort=desc`,
  );
  return issues.map((issue) =>
    mapGitLabIssue(issue, projectPathFrom(issue, String(projectId))),
  );
}

export async function fetchGitLabIssueDetail(
  token: string,
  projectId: number | string,
  issueIid: number,
): Promise<GitLabIssueDetail> {
  const project = encodeURIComponent(String(projectId));
  const [issue, notes, relatedMRs] = await Promise.all([
    gitlabJson<GitLabIssueResponse>(token, `/projects/${project}/issues/${issueIid}`),
    gitlabPaginated<GitLabNoteResponse>(
      token,
      `/projects/${project}/issues/${issueIid}/notes?per_page=100&sort=asc&order_by=created_at`,
    ).catch(() => []),
    // `related_merge_requests` is a single-call enrichment that mirrors the
    // GitHub timeline-derived `linkedPullRequests`. Fails open on older
    // self-hosted GitLab versions that don't surface the endpoint.
    gitlabPaginated<GitLabRelatedMRResponse>(
      token,
      `/projects/${project}/issues/${issueIid}/related_merge_requests?per_page=100`,
    ).catch(() => []),
  ]);

  const repoFullName = projectPathFrom(issue, String(projectId));
  const milestone = await maybeLoadMilestoneCounts(token, projectId, issue.milestone);

  const commentsData: ReviewThreadItem[] = notes
    .filter((note) => !note.system)
    .map((note) => ({
      id: String(note.id),
      author: note.author?.username ?? "unknown",
      body: note.body,
      created_at: note.created_at,
      updated_at: note.updated_at,
    }));

  return {
    ...mapGitLabIssue(issue, repoFullName),
    body: issue.description ?? "",
    locked: !!issue.discussion_locked,
    milestone,
    commentsData,
    linkedPullRequests: relatedMRs.map((mr) => ({
      number: mr.iid,
      title: mr.title,
      state: mr.state,
      url: mr.web_url,
    })),
  };
}

// In-process cache keyed by `${projectId}:${milestoneId}`. GitLab milestone
// payloads don't carry open/closed issue counts inline, so we hit
// /issues_statistics?milestone=<title> once per milestone and reuse the
// counts for 5 minutes. Avoids hammering the API during rapid back/forth
// navigation while keeping data fresh enough for triage workflows.
interface MilestoneCacheEntry {
  expiresAt: number;
  open: number;
  closed: number;
}

const MILESTONE_CACHE_TTL_MS = 5 * 60 * 1000;
const milestoneCountsCache = new Map<string, MilestoneCacheEntry>();

async function maybeLoadMilestoneCounts(
  token: string,
  projectId: number | string,
  milestone: GitLabMilestoneResponse | null | undefined,
): Promise<GitHubMilestoneSummary | null> {
  if (!milestone) return null;
  const title = milestone.title?.trim();
  if (!title) return null;

  const summary: GitHubMilestoneSummary = { title };
  if (typeof milestone.due_date === "string" && milestone.due_date.length > 0) {
    summary.dueOn = milestone.due_date;
  }

  if (typeof milestone.id !== "number") return summary;

  const cacheKey = `${projectId}:${milestone.id}`;
  const now = Date.now();
  const cached = milestoneCountsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    summary.openIssues = cached.open;
    summary.closedIssues = cached.closed;
    return summary;
  }

  try {
    const project = encodeURIComponent(String(projectId));
    const stats = await gitlabJson<GitLabIssueStatisticsResponse>(
      token,
      `/projects/${project}/issues_statistics?milestone=${encodeURIComponent(title)}`,
    );
    const open = stats.statistics?.counts?.opened;
    const closed = stats.statistics?.counts?.closed;
    if (typeof open === "number" && typeof closed === "number") {
      milestoneCountsCache.set(cacheKey, {
        open,
        closed,
        expiresAt: now + MILESTONE_CACHE_TTL_MS,
      });
      summary.openIssues = open;
      summary.closedIssues = closed;
    }
  } catch {
    // Older self-hosted GitLab versions, missing token scopes, or transient
    // network issues — degrade to title + dueOn only. MilestoneBlock
    // already handles missing counts.
  }

  return summary;
}

function mapGitLabIssue(issue: GitLabIssueResponse, repoFullName: string): GitLabIssue {
  return {
    repoFullName,
    number: issue.iid,
    title: issue.title,
    author: issue.author?.username ?? "unknown",
    // GitLab uses "opened" — normalise to "open" so existing UI filters
    // (open/closed) work without provider awareness.
    state: issue.state === "opened" ? "open" : issue.state,
    labels: mapGitLabLabels(issue.labels ?? []),
    assignees: (issue.assignees ?? [])
      .map((assignee) => assignee?.username ?? "")
      .filter(Boolean),
    comments: typeof issue.user_notes_count === "number" ? issue.user_notes_count : 0,
    updated_at: issue.updated_at,
    html_url: issue.web_url,
  };
}

function mapGitLabLabels(labels: unknown[]): GitHubIssueLabel[] {
  return labels
    .map((label): GitHubIssueLabel | null => {
      if (typeof label === "string") {
        return { name: label, color: null, description: null };
      }
      if (!label || typeof label !== "object") return null;
      const item = label as GitLabLabelObjectResponse;
      const name = typeof item.name === "string" ? item.name : "";
      if (!name) return null;
      return {
        name,
        // GitLab ships label colors with a leading "#" (e.g. "#428BCA").
        // Strip it to match the GitHub shape so downstream sanitizers
        // don't have to branch on provider.
        color: typeof item.color === "string"
          ? item.color.replace(/^#/, "").toLowerCase()
          : null,
        description: typeof item.description === "string" ? item.description : null,
      };
    })
    .filter((label): label is GitHubIssueLabel => label !== null);
}

// `references.full` looks like "group/project#42"; strip the trailing
// "#<iid>" segment to recover the project path. Falls back to the raw
// projectId when references aren't returned.
function projectPathFrom(issue: GitLabIssueResponse, fallback: string): string {
  const ref = issue.references?.full;
  if (typeof ref === "string" && ref.includes("#")) {
    return ref.split("#")[0];
  }
  return fallback;
}

function mapMR(mr: GitLabMRResponse): GitLabMR {
  return {
    iid: mr.iid,
    title: mr.title,
    author: mr.author?.username ?? "unknown",
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    updated_at: mr.updated_at,
    web_url: mr.web_url,
    draft: !!mr.draft || !!mr.work_in_progress,
    state: mr.state,
  };
}

function mapCommits(commits: GitLabCommitResponse[]): PullRequestCommit[] {
  return commits.map((commit) => ({
    sha: commit.id,
    message: commit.message || commit.title,
    author: commit.author_name,
    date: commit.authored_date,
    url: commit.web_url,
  }));
}

function mapChangeStatus(change: GitLabChangeResponse): PullRequestFile["status"] {
  if (change.new_file) return "added";
  if (change.deleted_file) return "removed";
  if (change.renamed_file) return "renamed";
  return "modified";
}

function diffAdditionsAndDeletions(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}
