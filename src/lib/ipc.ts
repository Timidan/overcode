import {
  clearCogneeMemoryLedger,
  exportCogneeMemoryLedgerStore,
  loadCogneeMemoryLedger,
  mergeCogneeMemoryLedgerStore,
  recordCogneeMemoryEvent,
  type CogneeMemoryLedgerSnapshot,
  type CogneeMemoryLedgerStore,
  type CogneeMemoryOperation,
} from "./cognee-memory-ledger";

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

export type RequiredAIEnv =
  | "OPENROUTER_API_KEY"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "GEMINI_API_KEY"
  | "NVIDIA_API_KEY";

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
  missing: RequiredAIEnv[];
  env: Record<RequiredAIEnv, AIEnvStatus>;
  health: AIModelHealth[];
}

export type AIModelStructuredCheckStatus = "passed" | "failed" | "not_configured";

export interface AIModelStructuredCheckResult {
  providerId: AIProviderId;
  model: string;
  status: AIModelStructuredCheckStatus;
  reason?: string;
  checkedAt: number;
  latencyMs?: number;
  generatedLength: number;
  parsedJson: boolean;
  schemaValid: boolean;
  rawSample?: string;
}

export type AIProviderId = "openrouter" | "openai" | "anthropic" | "gemini" | "nvidia";
export type AIProviderCredentialSource = "stored" | "env" | "none";
type LegacyAIProviderCredentialUpdate = {
  api_key?: string | null;
  base_url?: string | null;
};

export interface AIProviderCredentialUpdate {
  providerId: AIProviderId;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export interface AIProviderCredentialSourceStatus {
  api_key: AIProviderCredentialSource;
  base_url: AIProviderCredentialSource | "default";
}

interface LegacyAIProviderCredentialSourceStatus {
  api_key: AIProviderCredentialSource;
  base_url: AIProviderCredentialSource;
}

function isLegacyAIProviderCredentialUpdate(
  update: AIProviderCredentialUpdate | LegacyAIProviderCredentialUpdate,
): update is LegacyAIProviderCredentialUpdate {
  return !("providerId" in update);
}

export interface AIProviderStatus {
  providerId: AIProviderId;
  configured: boolean;
  active: boolean;
  credentialSource: AIProviderCredentialSource;
  baseUrlSource?: "stored" | "env" | "default" | "none";
  health: AIModelHealthStatus;
  reason?: string;
  account?: AIProviderAccountStatus;
}

export interface AIProviderAccountStatus {
  plan: "free" | "paid" | "unknown";
  isFreeTier?: boolean;
  freeModelDailyLimit?: number;
  freeModelNote?: string;
  limit?: number | null;
  limitRemaining?: number | null;
  usage?: number;
  usageDaily?: number;
  checkedAt: number;
}

export interface AIModelCatalogEntry {
  providerId: AIProviderId;
  id: string;
  name: string;
  free?: boolean;
  pricing?: { prompt?: string; completion?: string };
  contextLength?: number;
  modalities: string[];
  tags: Array<"recommended" | "coding" | "long_context" | "vision" | "paid" | "free">;
  source: "live" | "curated" | "manual";
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

export type MemoryDocumentKind =
  | "repository"
  | "pull_request"
  | "issue"
  | "summary"
  | "fact"
  | "note";

export interface MemoryDocument {
  id: string;
  kind: MemoryDocumentKind;
  title: string;
  summary: string;
  tags?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface MemoryRememberInput {
  documents: MemoryDocument[];
  datasetName?: string;
  sessionId?: string;
  nodeSet?: string[];
}

export interface MemoryRecallQuery {
  query: string;
  datasets?: string[];
  limit?: number;
  filters?: Record<string, string | number | boolean | null>;
  nodeSet?: string[];
}

export interface MemoryImproveInput {
  datasetName?: string;
  documentId?: string;
  feedback: string;
  accepted?: boolean;
}

export interface MemoryForgetInput {
  datasetName?: string;
  id?: string;
}

export interface MemoryStatus {
  enabled: boolean;
  configured: boolean;
  endpointVerified: boolean;
  missing: "COGNEE_API_URL"[];
  auth: "api-key" | "none";
  endpoint?: string;
  endpointSource?: "COGNEE_API_URL" | "COGNEE_SERVICE_URL" | "COGNEE_BASE_URL";
  requestTimeoutMs: number;
  reason?: string;
}

export interface MemoryResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  error?: string;
}

export interface MemoryRememberResult extends MemoryResult {
  stored: number;
}

export interface MemoryRecallItem {
  id: string;
  title: string;
  summary: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryRecallResult extends MemoryResult {
  items: MemoryRecallItem[];
}

export interface MemoryImproveResult extends MemoryResult {
  accepted: boolean;
}

export interface MemoryForgetResult extends MemoryResult {
  forgotten: boolean;
}

export interface MemoryUsageResult extends MemoryResult {
  storageUsedInBytes: number;
  storageLimitInBytes: number;
}

async function trackCogneeMemoryOperation<TResult>(
  operation: CogneeMemoryOperation,
  payload: unknown,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  try {
    const result = await run();
    recordCogneeMemoryEvent({
      operation,
      payload,
      result,
      startedAt,
      durationMs: Date.now() - startedMs,
    });
    void persistCogneeMemoryLedger();
    return result;
  } catch (error) {
    recordCogneeMemoryEvent({
      operation,
      payload,
      result: {
        ok: false,
        skipped: false,
        error: error instanceof Error ? error.message : "Cognee memory operation failed.",
      },
      startedAt,
      durationMs: Date.now() - startedMs,
    });
    void persistCogneeMemoryLedger();
    throw error;
  }
}

async function persistCogneeMemoryLedger(): Promise<void> {
  try {
    await window.api.memory.ledgerSet(exportCogneeMemoryLedgerStore());
  } catch {
    // Cognee dashboard telemetry is best-effort and must not affect workflows.
  }
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

  async callAIModel(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.api.ai.complete(systemPrompt, userPrompt);
  }

  async getAIStatus(): Promise<AIStatus> {
    return this.api.ai.status();
  }

  async listAIProviders(): Promise<AIProviderStatus[]> {
    return this.api.ai.providers();
  }

  async runStructuredAIModelCheck(
    providerId?: AIProviderId,
    modelId?: string,
  ): Promise<AIModelStructuredCheckResult> {
    return this.api.ai.structuredCheck(providerId, modelId);
  }

  async listAIModels(
    providerId: AIProviderId,
    options?: { force?: boolean },
  ): Promise<AIModelCatalogEntry[]> {
    return this.api.ai.models(providerId, options);
  }

  async setActiveAIProvider(
    providerId: AIProviderId,
    modelId?: string,
  ): Promise<void> {
    return this.api.ai.setActiveProvider(providerId, modelId);
  }

  async rememberMemory(
    payload: MemoryRememberInput,
  ): Promise<MemoryRememberResult> {
    return trackCogneeMemoryOperation("remember", payload, () =>
      this.api.memory.remember(payload),
    );
  }

  async recallMemory(payload: MemoryRecallQuery): Promise<MemoryRecallResult> {
    return trackCogneeMemoryOperation("recall", payload, () =>
      this.api.memory.recall(payload),
    );
  }

  async improveMemory(
    payload: MemoryImproveInput,
  ): Promise<MemoryImproveResult> {
    return trackCogneeMemoryOperation("improve", payload, () =>
      this.api.memory.improve(payload),
    );
  }

  async forgetMemory(payload: MemoryForgetInput): Promise<MemoryForgetResult> {
    return trackCogneeMemoryOperation("forget", payload, () =>
      this.api.memory.forget(payload),
    );
  }

  async getMemoryStatus(): Promise<MemoryStatus> {
    return this.api.memory.status();
  }

  async getMemoryUsage(): Promise<MemoryUsageResult> {
    return this.api.memory.usage();
  }

  async hydrateMemoryLedger(): Promise<CogneeMemoryLedgerSnapshot> {
    try {
      const durable = (await this.api.memory.ledgerGet()) as CogneeMemoryLedgerStore;
      const snapshot = mergeCogneeMemoryLedgerStore(durable);
      await this.api.memory.ledgerSet(exportCogneeMemoryLedgerStore());
      return snapshot;
    } catch {
      void persistCogneeMemoryLedger();
      return loadCogneeMemoryLedger();
    }
  }

  async clearMemoryLedger(): Promise<CogneeMemoryLedgerSnapshot> {
    clearCogneeMemoryLedger();
    try {
      await this.api.memory.ledgerClear();
    } catch {
      // Local telemetry clear should still work in browser fallback/test mode.
    }
    return loadCogneeMemoryLedger();
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

  async saveAIProviderCredentials(
    update: AIProviderCredentialUpdate | LegacyAIProviderCredentialUpdate,
  ): Promise<void> {
    const legacy = isLegacyAIProviderCredentialUpdate(update);
    const providerId = legacy ? "openrouter" : update.providerId;
    const apiKey = legacy ? update.api_key : update.apiKey;
    const baseUrl = legacy ? update.base_url : update.baseUrl;
    const payload: {
      providerId: AIProviderId;
      api_key?: string | null;
      base_url?: string | null;
    } = { providerId };
    if (apiKey !== undefined) payload.api_key = apiKey;
    if (baseUrl !== undefined) payload.base_url = baseUrl;
    return this.api.settings.saveAIProvider(payload);
  }

  async getAIProviderCredentialStatus(): Promise<LegacyAIProviderCredentialSourceStatus>;
  async getAIProviderCredentialStatus(
    providerId: AIProviderId | undefined,
  ): Promise<Record<AIProviderId, AIProviderCredentialSourceStatus>>;
  async getAIProviderCredentialStatus(
    providerId?: AIProviderId,
  ): Promise<
    | LegacyAIProviderCredentialSourceStatus
    | Record<AIProviderId, AIProviderCredentialSourceStatus>
  > {
    const result = await this.api.settings.aiProviderStatus(providerId);
    if (providerId !== undefined) return result;
    return {
      api_key: result.openrouter.api_key,
      base_url: result.openrouter.base_url === "default" ? "none" : result.openrouter.base_url,
    };
  }
}

export const ipc = new IPC();
