import { requestJson, requestPaginated, requestVoid } from "./provider-http";

const BASE = "https://api.github.com";
const GITHUB_ACCEPT = "application/vnd.github+json";

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: GITHUB_ACCEPT,
    "User-Agent": "overcode",
  };
}

export interface ReviewThreadItem {
  id: string;
  author: string;
  body: string;
  created_at: string;
  updated_at?: string;
  file_path?: string;
  line?: number;
  url?: string;
}

export interface PullRequestFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed" | "unknown";
  additions: number;
  deletions: number;
  patch?: string;
  previous_path?: string;
}

export interface PullRequestCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url?: string;
}

export interface PullRequestCheck {
  id: string;
  name: string;
  status: string;
  conclusion?: string | null;
  url?: string;
  updated_at?: string | null;
}

export interface PullRequestDetail {
  id: string;
  provider: "github" | "gitlab";
  repoFullName: string;
  number: number;
  numberPrefix: "#" | "!";
  title: string;
  body: string;
  author: string;
  source_branch: string;
  target_branch: string;
  status: string;
  draft: boolean;
  url: string;
  updated_at: string;
  files: PullRequestFile[];
  commits: PullRequestCommit[];
  comments: ReviewThreadItem[];
  reviewComments: ReviewThreadItem[];
  reviews: ReviewThreadItem[];
  checks: PullRequestCheck[];
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  updated_at: string | null;
  html_url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  author: string;
  head: string;
  base: string;
  updated_at: string | null;
  html_url: string;
  draft: boolean;
}

export interface GitHubRun {
  id: number;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  head_sha: string;
  // GitHub Actions workflow runs expose `head_branch`; we surface it so
  // callers can correlate runs to PRs by branch when SHA isn't on hand
  // (the cheap PR list payload doesn't carry head_sha).
  head_branch?: string | null;
  html_url: string;
  updated_at: string | null;
}

export interface GitHubIssueLabel {
  name: string;
  color: string | null;
  description: string | null;
}

export interface GitHubLinkedPullRequest {
  number: number;
  title: string;
  state: string;
  url: string;
}

export interface GitHubIssue {
  repoFullName: string;
  number: number;
  title: string;
  author: string;
  state: string;
  labels: GitHubIssueLabel[];
  assignees: string[];
  comments: number;
  updated_at: string | null;
  html_url: string;
}

export interface GitHubMilestoneSummary {
  title: string;
  // open/closed/dueOn are optional because some milestone payloads (e.g. an
  // older REST shape or a custom proxy) may not surface them. UI must render
  // gracefully with title only.
  openIssues?: number;
  closedIssues?: number;
  dueOn?: string;
}

export interface GitHubIssueDetail extends GitHubIssue {
  body: string;
  locked: boolean;
  milestone: GitHubMilestoneSummary | null;
  commentsData: ReviewThreadItem[];
  linkedPullRequests: GitHubLinkedPullRequest[];
}

interface GitHubUser {
  login?: string;
  avatar_url?: string;
}

interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  updated_at: string | null;
  html_url: string;
}

interface GitHubIssueResponse {
  number: number;
  title: string;
  user?: GitHubUser | null;
  state: string;
  labels: unknown[];
  assignees?: GitHubUser[] | null;
  comments: number;
  updated_at: string | null;
  html_url: string;
  body?: string | null;
  locked?: boolean;
  milestone?: {
    title?: string | null;
    open_issues?: number | null;
    closed_issues?: number | null;
    due_on?: string | null;
  } | null;
  pull_request?: unknown;
  repository?: {
    full_name?: string;
    name?: string;
    owner?: GitHubUser | null;
  } | null;
}

interface GitHubPullResponse {
  number: number;
  title: string;
  body?: string | null;
  user?: GitHubUser | null;
  head?: { ref?: string };
  base?: { ref?: string };
  updated_at: string;
  html_url: string;
  draft?: boolean;
  merged?: boolean;
  state?: string;
}

interface GitHubFileResponse {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  patch?: string;
  previous_filename?: string;
}

interface GitHubCommitResponse {
  sha: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
    committer?: { date?: string };
  };
  author?: GitHubUser | null;
  html_url?: string;
}

interface GitHubCommentResponse {
  id: number;
  user?: GitHubUser | null;
  body?: string | null;
  created_at: string;
  updated_at?: string;
  html_url?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
}

interface GitHubReviewResponse {
  id: number;
  user?: GitHubUser | null;
  state: string;
  body?: string | null;
  submitted_at?: string | null;
  html_url?: string;
}

interface GitHubCheckRunResponse {
  id: number;
  name: string;
  status: string;
  conclusion?: string | null;
  html_url?: string | null;
  completed_at?: string | null;
  started_at?: string | null;
}

interface GitHubRunResponse {
  id: number;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  head_sha?: string;
  head_branch?: string | null;
  html_url: string;
  updated_at?: string | null;
}

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const repos = await githubPaginated<GitHubRepoResponse>(
    token,
    "/user/repos?per_page=100&sort=updated",
  );
  return repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    default_branch: repo.default_branch,
    updated_at: repo.updated_at,
    html_url: repo.html_url,
  }));
}

export async function listIssues(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubIssue[]> {
  const repoFullName = `${owner}/${repo}`;
  const issues = await githubPaginated<GitHubIssueResponse>(
    token,
    `/repos/${owner}/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100`,
  );
  return issues
    .filter((issue) => !issue.pull_request)
    .map((issue) => mapIssue(issue, repoFullName));
}

export async function listUserIssues(token: string): Promise<GitHubIssue[]> {
  const issues = await githubPaginated<GitHubIssueResponse>(
    token,
    "/issues?filter=all&state=all&sort=updated&direction=desc&per_page=100",
  );
  return issues
    .filter((issue) => !issue.pull_request)
    .map((issue) => mapIssue(issue, readIssueRepoFullName(issue)));
}

export async function listPRs(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubPR[]> {
  const prs = await githubPaginated<GitHubPullResponse>(
    token,
    `/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
  );
  return prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? "unknown",
    head: pr.head?.ref ?? "",
    base: pr.base?.ref ?? "",
    updated_at: pr.updated_at,
    html_url: pr.html_url,
    draft: !!pr.draft,
  }));
}

export async function listPipelineRuns(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubRun[]> {
  const runs = await githubPaginated<GitHubRunResponse>(
    token,
    `/repos/${owner}/${repo}/actions/runs?per_page=100`,
    (value) => readArrayProperty<GitHubRunResponse>(value, "workflow_runs"),
    5,
  );
  return runs.map((run) => ({
    id: run.id,
    name: run.name ?? null,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    head_sha: run.head_sha ?? "",
    head_branch: run.head_branch ?? null,
    html_url: run.html_url,
    updated_at: run.updated_at ?? null,
  }));
}

export async function commentOnPR(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  await requestVoid(
    "github",
    `${BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
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

export function parseFullName(fullName: string): {
  owner: string;
  repo: string;
} {
  const trimmed = fullName.trim();
  const parts = trimmed.split("/");
  const segmentPattern = /^[A-Za-z0-9_.-]{1,100}$/;
  if (
    parts.length !== 2 ||
    !segmentPattern.test(parts[0]) ||
    !segmentPattern.test(parts[1]) ||
    parts.some((part) => part === "." || part === ".." || part.startsWith("-"))
  ) {
    throw new Error("Repository name must be a valid owner/repo pair.");
  }
  const [owner, repo] = parts;
  return { owner, repo };
}

export async function fetchIssueDetail(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GitHubIssueDetail> {
  const [issue, comments, timeline] = await Promise.all([
    githubJson<GitHubIssueResponse>(
      token,
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
    ),
    githubPaginated<GitHubCommentResponse>(
      token,
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
    ),
    githubPaginated<unknown>(
      token,
      `/repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=100`,
    ).catch(() => []),
  ]);

  if (issue.pull_request) {
    throw new Error(`GitHub #${issueNumber} is a pull request, not an issue.`);
  }

  return {
    repoFullName: `${owner}/${repo}`,
    number: issue.number,
    title: issue.title,
    author: issue.user?.login ?? "unknown",
    state: issue.state,
    labels: mapIssueLabels(issue.labels),
    assignees:
      issue.assignees
        ?.map((assignee) => assignee.login ?? "")
        .filter(Boolean) ?? [],
    comments: issue.comments,
    updated_at: issue.updated_at,
    html_url: issue.html_url,
    body: issue.body ?? "",
    locked: !!issue.locked,
    milestone: mapMilestoneSummary(issue.milestone),
    commentsData: comments.map(mapComment),
    linkedPullRequests: mapTimelineLinkedPRs(timeline),
  };
}

export async function fetchPRDetail(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestDetail> {
  const [pr, files, commits, issueComments, reviewComments, reviews, checks] =
    await Promise.all([
      githubJson<GitHubPullResponse>(
        token,
        `/repos/${owner}/${repo}/pulls/${prNumber}`,
      ),
      githubPaginated<GitHubFileResponse>(
        token,
        `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
      ),
      githubPaginated<GitHubCommitResponse>(
        token,
        `/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=100`,
      ),
      githubPaginated<GitHubCommentResponse>(
        token,
        `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
      ),
      githubPaginated<GitHubCommentResponse>(
        token,
        `/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`,
      ),
      githubPaginated<GitHubReviewResponse>(
        token,
        `/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`,
      ),
      githubPaginated<GitHubCheckRunResponse>(
        token,
        `/repos/${owner}/${repo}/commits/pull/${prNumber}/head/check-runs?per_page=100`,
        (value) =>
          readArrayProperty<GitHubCheckRunResponse>(value, "check_runs"),
        5,
      ).catch((error) => {
        console.warn(
          `[github] Failed to fetch check runs for PR #${prNumber}:`,
          error instanceof Error ? error.message : String(error),
        );
        return [];
      }),
    ]);

  return {
    id: `github:${owner}/${repo}:${prNumber}`,
    provider: "github",
    repoFullName: `${owner}/${repo}`,
    number: prNumber,
    numberPrefix: "#",
    title: pr.title,
    body: pr.body ?? "",
    author: pr.user?.login ?? "unknown",
    source_branch: pr.head?.ref ?? "",
    target_branch: pr.base?.ref ?? "",
    status: pr.merged
      ? "merged"
      : pr.state === "closed"
        ? "closed"
        : pr.draft
          ? "draft"
          : "open",
    draft: !!pr.draft,
    url: pr.html_url,
    updated_at: pr.updated_at,
    files: files.map((file) => ({
      path: file.filename,
      status: mapFileStatus(file.status),
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      patch: file.patch,
      previous_path: file.previous_filename,
    })),
    commits: commits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit?.message ?? "",
      author: commit.author?.login || commit.commit?.author?.name || "unknown",
      date: commit.commit?.author?.date || commit.commit?.committer?.date || "",
      url: commit.html_url,
    })),
    comments: issueComments.map(mapComment),
    reviewComments: reviewComments.map((comment) => ({
      ...mapComment(comment),
      file_path: comment.path,
      line: comment.line ?? comment.original_line ?? undefined,
    })),
    reviews: reviews.map((review) => ({
      id: String(review.id),
      author: review.user?.login ?? "unknown",
      body: `[${review.state}] ${review.body ?? ""}`.trim(),
      created_at: review.submitted_at ?? "",
      url: review.html_url,
    })),
    checks: checks.map((run) => ({
      id: String(run.id),
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url ?? undefined,
      updated_at: run.completed_at ?? run.started_at,
    })),
  };
}

function githubJson<T>(token: string, path: string): Promise<T> {
  return requestJson<T>("github", `${BASE}${path}`, {
    headers: authHeaders(token),
  });
}

function githubPaginated<T>(
  token: string,
  path: string,
  extractItems?: (value: unknown) => T[],
  maxPages = 10,
): Promise<T[]> {
  return requestPaginated<T>(
    "github",
    `${BASE}${path}`,
    { headers: authHeaders(token) },
    { extractItems, maxPages },
  );
}

function mapComment(comment: GitHubCommentResponse): ReviewThreadItem {
  return {
    id: String(comment.id),
    author: comment.user?.login ?? "unknown",
    body: comment.body ?? "",
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    url: comment.html_url,
  };
}

function mapIssue(
  issue: GitHubIssueResponse,
  repoFullName: string,
): GitHubIssue {
  return {
    repoFullName,
    number: issue.number,
    title: issue.title,
    author: issue.user?.login ?? "unknown",
    state: issue.state,
    labels: mapIssueLabels(issue.labels),
    assignees:
      issue.assignees
        ?.map((assignee) => assignee.login ?? "")
        .filter(Boolean) ?? [],
    comments: issue.comments,
    updated_at: issue.updated_at,
    html_url: issue.html_url,
  };
}

function mapMilestoneSummary(
  milestone: GitHubIssueResponse["milestone"],
): GitHubMilestoneSummary | null {
  if (!milestone) return null;
  const title = milestone.title?.trim();
  if (!title) return null;
  const summary: GitHubMilestoneSummary = { title };
  if (typeof milestone.open_issues === "number") {
    summary.openIssues = milestone.open_issues;
  }
  if (typeof milestone.closed_issues === "number") {
    summary.closedIssues = milestone.closed_issues;
  }
  if (typeof milestone.due_on === "string" && milestone.due_on.length > 0) {
    summary.dueOn = milestone.due_on;
  }
  return summary;
}

function readIssueRepoFullName(issue: GitHubIssueResponse): string {
  if (issue.repository?.full_name) return issue.repository.full_name;
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\//.exec(issue.html_url);
  return match?.[1] ?? "unknown/unknown";
}

function mapIssueLabels(labels: unknown[]): GitHubIssueLabel[] {
  return labels
    .map((label) => {
      if (typeof label === "string") {
        return { name: label, color: null, description: null };
      }
      if (!label || typeof label !== "object") return null;
      const item = label as {
        name?: unknown;
        color?: unknown;
        description?: unknown;
      };
      const name = typeof item.name === "string" ? item.name : "";
      if (!name) return null;
      return {
        name,
        color: typeof item.color === "string" ? item.color : null,
        description:
          typeof item.description === "string" ? item.description : null,
      };
    })
    .filter((label): label is GitHubIssueLabel => label !== null);
}

function mapTimelineLinkedPRs(events: unknown[]): GitHubLinkedPullRequest[] {
  const byNumber = new Map<number, GitHubLinkedPullRequest>();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const source = (event as { source?: unknown }).source;
    if (!source || typeof source !== "object") continue;
    const issue = (source as { issue?: unknown }).issue;
    if (!issue || typeof issue !== "object") continue;
    const candidate = issue as {
      number?: unknown;
      title?: unknown;
      state?: unknown;
      html_url?: unknown;
      pull_request?: unknown;
    };
    if (!candidate.pull_request || typeof candidate.number !== "number")
      continue;
    byNumber.set(candidate.number, {
      number: candidate.number,
      title: typeof candidate.title === "string" ? candidate.title : "",
      state: typeof candidate.state === "string" ? candidate.state : "unknown",
      url: typeof candidate.html_url === "string" ? candidate.html_url : "",
    });
  }
  return Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
}

function mapFileStatus(status: string): PullRequestFile["status"] {
  switch (status) {
    case "added":
    case "modified":
    case "removed":
    case "renamed":
      return status;
    default:
      return "unknown";
  }
}

function readArrayProperty<T>(value: unknown, property: string): T[] {
  if (!value || typeof value !== "object") return [];
  const items = (value as Record<string, unknown>)[property];
  return Array.isArray(items) ? (items as T[]) : [];
}
