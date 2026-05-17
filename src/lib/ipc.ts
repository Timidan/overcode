export interface Repository {
  id: string;
  name: string;
  platform: "github" | "gitlab" | "local";
  remote_url?: string;
  local_path: string;
  last_synced?: number;
  // Cached snapshot of the last `getGitStatus(..., {mode:"lite"})` result so
  // sidebar dots and other UI can render dirty/conflict state without firing
  // their own IPC. Written by `populateActivityFromRepos`.
  dirty_count?: number;
  conflict?: boolean;
  checked_at?: number;
}

export interface WorkspaceCandidate {
  id: string;
  name: string;
  local_path: string;
  platform: "github" | "gitlab" | "local";
  remote_url?: string;
  detected_from: ".git" | ".github" | "remote";
  discovered_at: number;
  last_seen_at: number;
}

export interface GitStatus {
  files: Array<{
    path: string;
    status: "M" | "A" | "D" | "R" | "?" | "U";
    staged: boolean;
    // Per-file LOC from `git diff --numstat`. Undefined for binary files or
    // untracked entries — UI falls back to a `—` placeholder.
    additions?: number;
    deletions?: number;
  }>;
  branch: string;
  ahead: number;
  behind: number;
  diff: string;
  stagedDiff: string;
  fileTree: string[];
  readme: string;
  packageSummary: string;
  environmentWarnings: EnvironmentWarning[];
  secretWarnings: SecretScanWarning[];
  testCommands: TestCommandSuggestion[];
}

export interface GitStatusOptions {
  mode?: "full" | "lite" | "diff" | "health";
}

export interface EnvironmentWarning {
  kind:
    | "env"
    | "port"
    | "dependencies"
    | "lockfile"
    | "docker"
    | "scripts";
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  paths: string[];
}

export interface SecretScanWarning {
  kind: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  paths: string[];
}

export interface TestCommandSuggestion {
  command: string;
  kind:
    | "test"
    | "lint"
    | "build"
    | "typecheck"
    | "format"
    | "dev"
    | "other";
  confidence: "low" | "medium" | "high";
  reason: string;
  paths: string[];
}

export interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface Stash {
  ref: string;
  message: string;
  date: string;
}

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  isMain?: boolean;
  locked?: boolean;
  prunable?: boolean;
  dirtyCount?: number;
  ahead?: number;
  behind?: number;
}

export interface WorktreeSummaryInput {
  repoPath: string;
  targetPath: string;
  base: string;
  target: string;
  baseRef: string;
  targetRef: string;
  branch: string;
  ahead: number;
  behind: number;
  dirtyFiles: number;
  diffStat: string;
  nameStatus: string;
  patch: string;
  uncommittedDiff: string;
  uniqueCommits: string[];
  changedFiles: string[];
  baseCandidates: string[];
  worktreeCandidates: Array<{
    path: string;
    branch: string;
    head: string;
    isMain?: boolean;
  }>;
}

export interface RepoFileReadOptions {
  ref?: string;
  maxBytes?: number;
}

export interface CommitStatFile {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
  status?: string;
  from?: string;
}

export interface CommitStat {
  hash: string;
  files: CommitStatFile[];
  insertions: number;
  deletions: number;
  changed: number;
  isRoot: boolean;
}

export interface RepoFileContent {
  path: string;
  ref?: string;
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  encoding: "utf8" | "binary";
  source: "working-tree" | "git-ref";
  language: string;
}

export interface Divergence {
  ahead: number;
  behind: number;
}

export interface AuthStatus {
  github: boolean;
  gitlab: boolean;
  profiles?: {
    github?: AuthProfile | null;
    gitlab?: AuthProfile | null;
    /**
     * Identity inferred from the local machine — git config user.name first,
     * then the OS username. Used by the morning greeting when neither GitHub
     * nor GitLab is connected. Never authoritative for auth decisions.
     */
    local?: LocalIdentity | null;
  };
}

export interface AuthProfile {
  username: string;
  avatar_url: string;
}

export interface LocalIdentity {
  name: string | null;
}

export type RequiredWatsonxEnv =
  | "WATSONX_API_KEY"
  | "WATSONX_PROJECT_ID"
  | "WATSONX_URL";

export type AIEnvStatus = "configured" | "missing";
export type AIModelHealthStatus =
  | "available"
  | "unavailable"
  | "not_configured"
  | "unknown";

export interface AIModelHealthHistoryEntry {
  status: AIModelHealthStatus;
  checkedAt: number;
  latencyMs?: number;
}

export interface AIModelHealth {
  model: string;
  status: AIModelHealthStatus;
  reason?: string;
  checkedAt: number | null;
  latencyMs?: number;
  history?: AIModelHealthHistoryEntry[];
}

export interface AIStatus {
  configured: boolean;
  model: string;
  missing: RequiredWatsonxEnv[];
  env: Record<RequiredWatsonxEnv, AIEnvStatus>;
  health: AIModelHealth[];
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
  // Optional in IPC for backwards-compat with cached payloads emitted
  // before the field was added to the bridge.
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
  // openIssues / closedIssues / dueOn are optional so the UI can degrade
  // gracefully when only the title is known (e.g. older cached payloads
  // or proxy shapes that don't surface counts).
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

export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string | null;
  web_url: string;
  last_activity_at: string;
}

// GitLab issues and issue details share the GitHub shapes — both providers'
// list/detail backends normalise to the same fields so the UI doesn't have
// to branch on provider. Exposed as named aliases so call sites can read
// `GitLabIssue` / `GitLabIssueDetail` where that's clearer.
export type GitLabIssue = GitHubIssue;
export type GitLabIssueDetail = GitHubIssueDetail;

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

/**
 * Compact CI rollup attached to PR list rows. Computed from the existing
 * GitHub Actions / GitLab pipeline fetches that already run per repo, so
 * adding it costs nothing beyond the bookkeeping. `total` may exceed the
 * sum of the buckets when checks are in unknown states.
 */
export interface PullRequestCheckSummary {
  passing: number;
  failing: number;
  pending: number;
  total: number;
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

export class IPC {
  private api = window.api;

  async connectAuth(provider: "github" | "gitlab"): Promise<AuthProfile> {
    return this.api.auth.connect(provider);
  }

  async disconnectAuth(provider: "github" | "gitlab"): Promise<void> {
    return this.api.auth.disconnect(provider);
  }

  async getAuthStatus(): Promise<AuthStatus> {
    return this.api.auth.status();
  }

  async scanRepositories(directories: string[]): Promise<Repository[]> {
    return this.api.git.scan(directories);
  }

  async scanWorkspaceCandidates(
    directories: string[],
  ): Promise<WorkspaceCandidate[]> {
    return this.api.git.scanCandidates(directories);
  }

  async getGitStatus(
    repoPath: string,
    options?: GitStatusOptions,
  ): Promise<GitStatus> {
    return this.api.git.status(repoPath, options);
  }

  async showCommit(repoPath: string, hash: string): Promise<string> {
    return this.api.git.show(repoPath, hash);
  }

  async getCommitStat(repoPath: string, hash: string): Promise<CommitStat> {
    return this.api.git.commitStat(repoPath, hash);
  }

  async getUnstagedDiff(repoPath: string): Promise<string> {
    return this.api.git.diff(repoPath);
  }

  async getGitLog(repoPath: string, maxCount: number = 100): Promise<Commit[]> {
    return this.api.git.log(repoPath, maxCount);
  }

  async getStashes(repoPath: string): Promise<Stash[]> {
    return this.api.git.stashes(repoPath);
  }

  async getStashDiff(repoPath: string, stashRef: string): Promise<string> {
    return this.api.git.stashShow(repoPath, stashRef);
  }

  async getWorktrees(repoPath: string): Promise<Worktree[]> {
    return this.api.git.worktrees(repoPath);
  }

  async getWorktreeSummaryInput(
    repoPath: string,
    targetPath: string,
    base?: string,
  ): Promise<WorktreeSummaryInput> {
    return this.api.git.worktrees(repoPath, {
      mode: "summary-input",
      targetPath,
      base,
    }) as Promise<WorktreeSummaryInput>;
  }

  async readRepoFile(
    repoPath: string,
    filePath: string,
    options?: RepoFileReadOptions,
  ): Promise<RepoFileContent> {
    return this.api.git.file(repoPath, filePath, options);
  }

  async getDivergence(repoPath: string, branch: string): Promise<Divergence> {
    return this.api.git.divergence(repoPath, branch);
  }

  async gitPush(
    repoPath: string,
    remote: string,
    branch: string,
  ): Promise<void> {
    return this.api.git.push(repoPath, remote, branch);
  }

  async gitPull(
    repoPath: string,
    remote: string,
    branch: string,
  ): Promise<void> {
    return this.api.git.pull(repoPath, remote, branch);
  }

  async gitCommit(repoPath: string, message: string): Promise<void> {
    return this.api.git.commit(repoPath, message);
  }

  async stashPop(repoPath: string, stashRef: string): Promise<void> {
    return this.api.git.stashPop(repoPath, stashRef);
  }

  async stashDrop(repoPath: string, stashRef: string): Promise<void> {
    return this.api.git.stashDrop(repoPath, stashRef);
  }

  async getGitHubRepos(): Promise<GitHubRepo[]> {
    return this.api.github.repos();
  }

  async getGitHubPRs(repoFullName: string): Promise<GitHubPR[]> {
    return this.api.github.prs(repoFullName);
  }

  async getGitHubIssues(repoFullName?: string): Promise<GitHubIssue[]> {
    return this.api.github.issues(repoFullName);
  }

  async getGitHubIssueDetail(
    repoFullName: string,
    issueNumber: number,
  ): Promise<GitHubIssueDetail> {
    return this.api.github.issueDetail(repoFullName, issueNumber);
  }

  async getGitHubPRDetail(
    repoFullName: string,
    prNumber: number,
  ): Promise<PullRequestDetail> {
    return this.api.github.prDetail(repoFullName, prNumber);
  }

  async getGitHubPipelines(repoFullName: string): Promise<GitHubRun[]> {
    return this.api.github.pipelines(repoFullName);
  }

  async commentOnGitHubPR(
    repoFullName: string,
    prNumber: number,
    body: string,
  ): Promise<void> {
    return this.api.github.comment(repoFullName, prNumber, body);
  }

  async getGitLabProjects(): Promise<GitLabProject[]> {
    return this.api.gitlab.projects();
  }

  async getGitLabMRs(projectId: string): Promise<GitLabMR[]> {
    return this.api.gitlab.mrs(projectId);
  }

  async getGitLabMRDetail(
    projectId: string,
    mrIid: number,
  ): Promise<PullRequestDetail> {
    return this.api.gitlab.mrDetail(projectId, mrIid);
  }

  async getGitLabIssues(projectId: string): Promise<GitLabIssue[]> {
    return this.api.gitlab.issues(projectId);
  }

  async getGitLabIssueDetail(
    projectId: string,
    issueIid: number,
  ): Promise<GitLabIssueDetail> {
    return this.api.gitlab.issueDetail(projectId, issueIid);
  }

  async getGitLabPipelines(projectId: string): Promise<GitLabPipeline[]> {
    return this.api.gitlab.pipelines(projectId);
  }

  async commentOnGitLabMR(
    projectId: string,
    mrIid: number,
    body: string,
  ): Promise<void> {
    return this.api.gitlab.comment(projectId, mrIid, body);
  }

  async callGranite(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.api.ai.complete(systemPrompt, userPrompt);
  }

  async getAIStatus(): Promise<AIStatus> {
    return this.api.ai.status();
  }

  async getFromStore(key: string): Promise<unknown> {
    return this.api.store.get(key);
  }

  async setInStore(key: string, value: unknown): Promise<void> {
    return this.api.store.set(key, value);
  }

  async listStoreKeys(): Promise<string[]> {
    return this.api.store.list();
  }

  async saveWatsonxCredentials(update: {
    api_key?: string | null;
    project_id?: string | null;
    url?: string | null;
  }): Promise<WatsonxCredentialStatus> {
    return this.api.settings.saveWatsonx(update);
  }

  async getWatsonxCredentialStatus(): Promise<WatsonxCredentialSourceStatus> {
    return this.api.settings.watsonxStatus();
  }
}

export type WatsonxCredentialSource = "stored" | "env" | "none";

export interface WatsonxCredentialSourceStatus {
  api_key: WatsonxCredentialSource;
  project_id: WatsonxCredentialSource;
  url: WatsonxCredentialSource;
}

export interface WatsonxCredentialStatus {
  api_key: boolean;
  project_id: boolean;
  url: boolean;
}

export const ipc = new IPC();
