import { ipc, type GitHubIssueDetail, type PullRequestDetail, type PullRequestFile } from "./ipc";
import { buildCogneeMemoryPromptSection } from "./cognee-workflow-memory";
import {
  fallbackEnvelope,
  parseAIEnvelope,
  validateCodeExplanationData,
  validateImpactData,
  validateIssueTriageData,
  validatePRFileChangeData,
  validatePRHunkReviewData,
  validatePRReviewData,
  validateRepoBriefData,
  validateStashExplainData,
  validateStandupData,
  validateWorktreeCompareData,
  type AIEnvelope,
  type AIFeature as StructuredAIFeature,
  type CodeExplanationData,
  type ImpactData,
  type IssueTriageData,
  type PRFileChangeData,
  type PRHunkReviewData,
  type PRReviewData,
  type RepoBriefData,
  type StashExplainData,
  type StandupData,
  type WorktreeCompareData,
} from "./ai-structured";

const AI_CACHE_KEY = "ai_cache";
const CACHE_TTL_MS = 24 * 3600 * 1000;
const MAX_DIFF_CHARS = 24_000;
const MAX_DIFF_FILES = 30;
const MAX_STASH_DIFF_CHARS = 8_000;
const MAX_README_CHARS = 6_000;
const MAX_TREE_ITEMS = 80;
const MAX_LIST_ITEMS = 80;
const MAX_PROMPT_CHARS = 14_000;
const MAX_MEMORY_CONTEXT_CHARS = 4_000;
const REPO_BRIEF_CACHE_VERSION = "brief:v6";

const IMPACT_SYSTEM_PROMPT =
  "Analyze this code diff for a developer. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"impact\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"intent\":\"...\",\"modules\":[{\"name\":\"...\",\"paths\":[\"...\"],\"changeType\":\"added|modified|removed|mixed\"}],\"risks\":[{\"severity\":\"low|medium|high\",\"area\":\"...\",\"reason\":\"...\",\"files\":[\"...\"]}],\"checks\":[{\"command\":\"optional command\",\"reason\":\"...\"}],\"recommendation\":\"...\"}}. No markdown fences.";

const COMMIT_SYSTEM_PROMPT =
  "Generate a conventional commit message in the format `type(scope): description` followed by a blank line and a body paragraph. Then on a new line write `---PR---` followed by a PR description paragraph. Use the provided git changes as the source of truth; optional Cognee memory may inform repo conventions and prior reviewer expectations, but must not invent changed code.";

const REPO_BRIEF_SYSTEM_PROMPT =
  "Create a concise repository onboarding brief. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"brief\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"purpose\":\"...\",\"keyModules\":[{\"name\":\"...\",\"path\":\"...\",\"role\":\"...\"}],\"recentActivity\":[{\"label\":\"...\",\"evidence\":\"...\"}],\"onboardingPath\":[\"...\"],\"notableRisks\":[\"...\"]}}. Base every claim only on the repository data and optional Cognee memory context. No markdown fences.";

const REPO_BRIEF_RETRY_SYSTEM_PROMPT =
  "Create a short developer onboarding brief from the repository facts below. Return only valid JSON matching this feature=brief envelope: schemaVersion, feature, summary, confidence, warnings, data.purpose, data.keyModules, data.recentActivity, data.onboardingPath, data.notableRisks. Do not leave the answer blank. No markdown fences.";

const STASH_LABEL_SYSTEM_PROMPT =
  "Generate a one-line plain-English label for this stash. Max 60 characters. Output only the label text - no quotes, no prefix.";

const STASH_EXPLAIN_SYSTEM_PROMPT =
  "Explain this git stash for a developer. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"stash_explain\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"intent\":\"...\",\"files\":[\"...\"],\"added\":[\"short bullet\"],\"removed\":[\"short bullet\"],\"risks\":[{\"severity\":\"low|medium|high\",\"text\":\"...\",\"files\":[\"...\"]}],\"suggestedActions\":[\"...\"],\"label\":\"short stash label\"}}. Use the supplied stash message, files, diff, and optional Cognee memory context. No markdown fences.";

const PR_REVIEW_SYSTEM_PROMPT =
  "Review this pull request for a developer. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"pr_review\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"readiness\":\"blocked|needs_review|ready\",\"changeSummary\":\"...\",\"riskMatrix\":[{\"severity\":\"low|medium|high\",\"file\":\"optional path\",\"concern\":\"...\",\"evidence\":\"...\"}],\"blockers\":[{\"source\":\"conversation|ci|diff\",\"text\":\"...\",\"url\":\"optional url\"}],\"ci\":{\"passing\":0,\"failing\":0,\"pending\":0,\"notable\":[\"...\"]},\"suggestedComment\":\"...\"}}. Base every claim on provided PR data and optional Cognee memory context. No markdown fences.";

const PR_HUNK_REVIEW_SYSTEM_PROMPT =
  "Review these pull request diff hunks like a senior reviewer. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"pr_hunk_review\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"overall\":\"low_risk|needs_attention|blocked\",\"hunks\":[{\"file\":\"...\",\"header\":\"@@ ...\",\"verdict\":\"safe|question|risk|needs_test\",\"note\":\"short reviewer note\",\"suggestedCheck\":\"optional command or manual check\"}],\"questions\":[\"...\"],\"tests\":[\"...\"]}}. Be concise. Use only the supplied hunks. No markdown fences.";

const PR_FILE_CHANGE_SYSTEM_PROMPT =
  "Summarize this single pull request file patch for a developer. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"pr_file_change\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"added\":[\"short bullet\"],\"removed\":[\"short bullet\"],\"changedBehavior\":\"short behavior impact\",\"risk\":\"low|medium|high\",\"reviewFocus\":[\"short bullet\"],\"suggestedChecks\":[\"short command or manual check\"]}}. Explain what this file change added and removed. Use only the supplied file patch and PR context. No markdown fences.";

const ISSUE_TRIAGE_SYSTEM_PROMPT =
  "Triage this GitHub issue for a developer. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"issue_triage\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"priority\":\"low|medium|high\",\"problem\":\"...\",\"likelyModules\":[{\"name\":\"...\",\"paths\":[\"...\"],\"reason\":\"...\"}],\"ambiguities\":[\"...\"],\"suggestedPlan\":[\"...\"],\"acceptanceChecks\":[\"...\"],\"suggestedBranchName\":\"...\"}}. Use only the issue text, labels, comments, linked PRs, repository context, and optional Cognee memory context supplied. No markdown fences.";

const CODE_EXPLAIN_SYSTEM_PROMPT =
  "Explain this read-only code or diff selection for a developer. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"code_explain\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"subject\":\"...\",\"purpose\":\"...\",\"keyPoints\":[\"...\"],\"risks\":[{\"severity\":\"low|medium|high\",\"text\":\"...\"}],\"suggestedChecks\":[\"...\"]}}. Use only the provided file or diff text and optional Cognee memory context. No markdown fences.";

const WORKTREE_COMPARE_SYSTEM_PROMPT =
  "Compare this local git worktree against the selected base. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"worktree_compare\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"base\":\"...\",\"target\":\"...\",\"ahead\":0,\"behind\":0,\"dirtyFiles\":0,\"intent\":\"...\",\"moduleMap\":[{\"module\":\"...\",\"files\":[\"...\"],\"risk\":\"low|medium|high\"}],\"readiness\":\"not_ready|reviewable|ready\",\"nextActions\":[\"...\"],\"prDraft\":{\"title\":\"...\",\"body\":\"...\"}}}. Use the provided diff, commit, status data, and optional Cognee memory context. No markdown fences.";

const STANDUP_SYSTEM_PROMPT =
  "Generate a developer daily standup from real local git and PR activity. Return only valid JSON with this shape: {\"schemaVersion\":1,\"feature\":\"standup\",\"summary\":\"1 short sentence\",\"confidence\":\"low|medium|high\",\"warnings\":[\"...\"],\"data\":{\"greeting\":\"Good morning/afternoon/evening/night, username\",\"headline\":\"...\",\"yesterday\":[\"...\"],\"today\":[\"...\"],\"blockers\":[\"...\"],\"notableRepos\":[{\"repo\":\"...\",\"note\":\"...\"}],\"slackDraft\":\"Slack-ready short message\"}}. Do not invent activity. If data is sparse, say so. No markdown fences.";

const JSON_REPAIR_SYSTEM_PROMPT =
  "Repair the previous model output into valid JSON only. Do not add markdown fences, comments, or prose. Preserve the requested schema and use empty arrays or strings when data is unavailable.";

const MAX_PR_BODY_CHARS = 2_000;
const MAX_PR_FILES = 20;
const MAX_PR_FILE_SUMMARIES = 60;
const MAX_PR_FILE_PATCH_CHARS = 1_200;
const MAX_PR_COMMENTS = 10;
const MAX_PR_REVIEW_COMMENTS = 10;
const MAX_PR_COMMIT_LINES = 12;
const MAX_PR_CHECKS = 12;
const MAX_PR_PROMPT_CHARS = 22_000;
const MAX_PR_HUNKS = 18;
const MAX_PR_HUNK_CHARS = 1_600;
const MAX_PR_FILE_CHANGE_PATCH_CHARS = 9_000;
const MAX_ISSUE_BODY_CHARS = 3_000;
const MAX_ISSUE_COMMENTS = 12;
const MAX_ISSUE_CONTEXT_ITEMS = 80;
const MAX_STANDUP_ITEMS = 80;
const MAX_STANDUP_PROMPT_CHARS = 18_000;

export type AIFeature =
  | "impact"
  | "commit"
  | "brief"
  | "code"
  | "worktree"
  | "issue_triage"
  | "standup"
  | "stash";

export interface ImpactPayload {
  diff?: string;
  fileTree?: string[];
  unavailableReason?: string;
  repoId?: string;
  repoName?: string;
  branch?: string;
  memoryContext?: string;
  memoryUsed?: {
    summary?: string;
    graphPath?: string[];
    references?: string[];
  };
}

export interface CommitPayload {
  repoId?: string;
  repoName?: string;
  stagedDiff?: string;
  repoPath?: string;
  branch?: string;
  changedFiles?: string[];
  unavailableReason?: string;
  memoryContext?: string;
}

export interface BriefPayload {
  repoId: string;
  repoName?: string;
  remoteUrl?: string;
  branch?: string;
  tree?: string[];
  readme?: string;
  recentCommits?: string[];
  openPRs?: string[];
  changedFiles?: string[];
  unavailableReason?: string;
  memoryContext?: string;
}

export interface WorktreeComparePayload {
  repoId: string;
  repoName?: string;
  repoPath?: string;
  targetPath?: string;
  base: string;
  target: string;
  baseRef?: string;
  targetRef?: string;
  branch?: string;
  ahead: number;
  behind: number;
  dirtyFiles: number;
  diffStat?: string;
  nameStatus?: string;
  patch?: string;
  uncommittedDiff?: string;
  uniqueCommits?: string[];
  changedFiles?: string[];
  baseCandidates?: string[];
  worktreeCandidates?: Array<{
    path: string;
    branch: string;
    head: string;
    isMain?: boolean;
  }>;
  unavailableReason?: string;
  memoryContext?: string;
}

export interface IssueTriagePayload {
  issue: GitHubIssueDetail;
  repoName?: string;
  repoTree?: string[];
  packageSummary?: string;
  readme?: string;
  localChangedFiles?: string[];
  unavailableReason?: string;
  memoryContext?: string;
}

export interface CodeExplainPayload {
  repoId?: string;
  repoName?: string;
  branch?: string;
  subject: string;
  language?: string;
  content: string;
  context?: string;
  kind: "file" | "diff-hunk" | "selection";
  unavailableReason?: string;
  memoryContext?: string;
}

export interface StashExplainPayload {
  repoId: string;
  repoName?: string;
  repoPath?: string;
  branch?: string;
  ref: string;
  message?: string;
  diff?: string;
  files?: string[];
  unavailableReason?: string;
  memoryContext?: string;
}

export interface StandupPayload {
  userName: string;
  greeting: string;
  rangeLabel: string;
  startIso: string;
  endIso: string;
  commits: Array<{
    repo: string;
    hash: string;
    message: string;
    author: string;
    date: string;
  }>;
  pullRequests: Array<{
    repo: string;
    number: number;
    title: string;
    status: string;
    source: string;
    target: string;
    updated_at: string;
  }>;
  localChanges: Array<{
    repo: string;
    branch: string;
    changedFiles: number;
    ahead: number;
    behind: number;
  }>;
  unavailableReason?: string;
  memoryContext?: string;
}

export type AIFeaturePayload =
  | ImpactPayload
  | CommitPayload
  | BriefPayload
  | IssueTriagePayload
  | CodeExplainPayload
  | StashExplainPayload
  | StandupPayload
  | WorktreeComparePayload;

export interface CommitAssistantResult {
  commitMessage: string;
  prDescription: string;
}

export interface StashLabelInput {
  ref: string;
  diff: string;
  message?: string;
}

interface StructuredCacheEntry<T> {
  content: AIEnvelope<T>;
  timestamp: number;
}

type AICache = Record<string, unknown>;
type RepoBriefEvidenceLevel = "minimal" | "thin" | "sufficient";

interface RepoBriefEvidenceReport {
  fileTreeEntries: number;
  readmeChars: number;
  recentCommits: number;
  openPRs: number;
  changedFiles: number;
  memoryChars: number;
  level: RepoBriefEvidenceLevel;
}

export async function analyzeImpact(payload: ImpactPayload): Promise<string> {
  const result = await analyzeImpactStructured(payload);
  return [
    result.summary,
    result.data.intent,
    result.data.recommendation,
  ].filter(Boolean).join("\n\n");
}

export async function analyzeImpactStructured(
  payload: ImpactPayload,
): Promise<AIEnvelope<ImpactData>> {
  if (payload.unavailableReason) {
    return fallbackEnvelope("impact", payload.unavailableReason, emptyImpactData(), [
      payload.unavailableReason,
    ]);
  }

  const diff = compactDiff(payload.diff?.trim() ?? "", MAX_DIFF_CHARS);
  if (!diff) {
    const reason = "Impact analysis unavailable: no real git diff was returned for this change.";
    return fallbackEnvelope("impact", reason, emptyImpactData(), [reason]);
  }

  const fileTree = limitList(payload.fileTree?.filter(Boolean) ?? [], MAX_TREE_ITEMS);
  const prompt = [
    `DIFF:\n${diff}`,
    `CHANGED PATHS:\n${formatList(fileTree, "No changed paths were returned.")}`,
    buildCogneeMemoryPromptSection(
      payload.memoryContext?.trim()
        ? truncateText(payload.memoryContext.trim(), MAX_MEMORY_CONTEXT_CHARS)
        : "",
    ),
  ].join("\n\n");
  const structured = await callStructuredAI(
    "impact",
    IMPACT_SYSTEM_PROMPT,
    prompt,
    validateImpactData,
  );
  return structured ?? fallbackEnvelope(
    "impact",
    "AI returned text that could not be converted into structured impact data.",
    buildLocalImpactData(diff, fileTree),
    ["Structured response validation failed."],
  );
}

export async function generateCommitAssistant(
  payload: CommitPayload,
): Promise<CommitAssistantResult> {
  if (payload.unavailableReason) {
    return unavailableCommitResult(payload.unavailableReason);
  }

  const diff = compactDiff(await getCommitDiff(payload), MAX_DIFF_CHARS);
  if (!diff) {
    return unavailableCommitResult(
      "Commit assistant unavailable: no real git changes were returned for this repository.",
    );
  }

  const response = await ipc.callAIModel(
    COMMIT_SYSTEM_PROMPT,
    [
      `GIT CHANGES:\n${diff}`,
      buildCogneeMemoryPromptSection(payload.memoryContext),
    ].filter(Boolean).join("\n\n"),
  );
  return parseCommitAssistantResponse(response);
}

export async function getRepoBrief(payload: BriefPayload): Promise<string> {
  const result = await getRepoBriefStructured(payload);
  return [
    result.summary,
    result.data.purpose,
    result.data.keyModules.map((item) => `${item.path || item.name}: ${item.role}`).join("\n"),
    result.data.recentActivity.map((item) => `${item.label}: ${item.evidence}`).join("\n"),
  ].filter(Boolean).join("\n\n");
}

export async function getRepoBriefStructured(
  payload: BriefPayload,
): Promise<AIEnvelope<RepoBriefData>> {
  if (payload.unavailableReason) {
    return fallbackEnvelope("brief", payload.unavailableReason, emptyRepoBriefData(), [
      payload.unavailableReason,
    ]);
  }

  const prompt = buildRepoBriefPrompt(payload);
  if (!prompt) {
    const reason = "Repo brief unavailable: no real repository data was returned for this workspace.";
    return fallbackEnvelope("brief", reason, emptyRepoBriefData(), [reason]);
  }

  const cache = await getAICache();
  const evidence = buildRepoBriefEvidenceReport(payload);
  const key = `${REPO_BRIEF_CACHE_VERSION}:${payload.repoId}:${hashText(prompt)}`;
  const cached = cache[key];

  if (
    isFreshStructuredCacheEntry<RepoBriefData>(cached) &&
    !isThinRepoBriefResult(cached.content, evidence)
  ) {
    return cached.content;
  }

  const call = await callStructuredAIWithDiagnostics(
    "brief",
    REPO_BRIEF_SYSTEM_PROMPT,
    prompt,
    validateRepoBriefData,
  );
  let resolved = call.result;
  let failureReason = call.failureReason;

  if (!resolved || isThinRepoBriefResult(resolved, evidence)) {
    const retryPrompt = buildCompactRepoBriefPrompt(payload);
    if (retryPrompt) {
      const retryCall = await callStructuredAIWithDiagnostics(
        "brief",
        REPO_BRIEF_RETRY_SYSTEM_PROMPT,
        retryPrompt,
        validateRepoBriefData,
      );
      const retryResolved = retryCall.result;
      if (retryResolved) resolved = retryResolved;
      else failureReason = retryCall.failureReason ?? failureReason;
    }
  }

  if (resolved && isThinRepoBriefResult(resolved, evidence)) {
    resolved = fallbackEnvelope(
      "brief",
      "The AI provider returned a shallow brief despite sufficient evidence, so Overcode prepared a local evidence-backed brief.",
      buildLocalRepoBriefData(payload),
      [
        "AI returned a shallow brief despite sufficient evidence; Overcode used the local repository evidence instead.",
      ],
    );
  }

  if (!resolved) {
    const warning = failureReason ?? "Structured response validation failed.";
    resolved = fallbackEnvelope(
      "brief",
      failureReason
        ? `The AI provider failed: ${failureReason}. Overcode prepared a local brief.`
        : "The AI provider did not return structured brief data, so Overcode prepared a local brief.",
      buildLocalRepoBriefData(payload),
      [warning],
    );
  }

  await setAICache({
    ...cache,
    [key]: { content: resolved, timestamp: Date.now() },
  });

  return resolved;
}

export async function summarizePullRequest(
  detail: PullRequestDetail,
  options: { force?: boolean; memoryContext?: string } = {},
): Promise<string> {
  const result = await summarizePullRequestStructured(detail, options);
  return [
    result.summary,
    result.data.changeSummary,
    result.data.riskMatrix
      .map((risk) => `${risk.severity.toUpperCase()}: ${risk.file ? `${risk.file} - ` : ""}${risk.concern}`)
      .join("\n"),
    result.data.suggestedComment,
  ].filter(Boolean).join("\n\n");
}

export async function summarizePullRequestStructured(
  detail: PullRequestDetail,
  options: { force?: boolean; memoryContext?: string } = {},
): Promise<AIEnvelope<PRReviewData>> {
  const prompt = buildPullRequestPrompt(detail, options.memoryContext);
  if (!prompt) {
    const reason = "PR summary unavailable: no real pull request data was returned.";
    return fallbackEnvelope("pr_review", reason, emptyPRReviewData(), [reason]);
  }

  const cache = await getAICache();
  const key = `pr-review:v1:${detail.provider}:${detail.repoFullName}:${detail.number}:${detail.updated_at}:${hashText(prompt)}`;
  const cached = cache[key];
  if (!options.force && isFreshStructuredCacheEntry<PRReviewData>(cached)) {
    return cached.content;
  }

  const result = await callStructuredAI(
    "pr_review",
    PR_REVIEW_SYSTEM_PROMPT,
    prompt,
    validatePRReviewData,
  ) ?? fallbackEnvelope(
    "pr_review",
    "The AI provider did not return structured PR review data, so Overcode prepared a local review.",
    buildLocalPRReviewData(detail),
    ["Structured response validation failed."],
  );

  await setAICache({
    ...cache,
    [key]: { content: result, timestamp: Date.now() },
  });
  return result;
}

export async function summarizePullRequestHunksStructured(
  detail: PullRequestDetail,
  options: { force?: boolean; memoryContext?: string } = {},
): Promise<AIEnvelope<PRHunkReviewData>> {
  const prompt = buildPullRequestHunkPrompt(detail, options.memoryContext);
  if (!prompt) {
    const reason = "Hunk review unavailable: no patch hunks were returned for this pull request.";
    return fallbackEnvelope("pr_hunk_review", reason, emptyPRHunkReviewData(), [reason]);
  }

  const cache = await getAICache();
  const key = `pr-hunk-review:v1:${detail.provider}:${detail.repoFullName}:${detail.number}:${detail.updated_at}:${hashText(prompt)}`;
  const cached = cache[key];
  if (!options.force && isFreshStructuredCacheEntry<PRHunkReviewData>(cached)) {
    return cached.content;
  }

  const result = await callStructuredAI(
    "pr_hunk_review",
    PR_HUNK_REVIEW_SYSTEM_PROMPT,
    prompt,
    validatePRHunkReviewData,
  ) ?? fallbackEnvelope(
    "pr_hunk_review",
    "The AI provider did not return structured hunk review data, so Overcode prepared a local hunk review.",
    buildLocalPRHunkReviewData(detail),
    ["Structured response validation failed."],
  );

  await setAICache({
    ...cache,
    [key]: { content: result, timestamp: Date.now() },
  });
  return result;
}

export async function summarizePullRequestFileChangeStructured(
  detail: PullRequestDetail,
  file: PullRequestFile,
  options: { force?: boolean; memoryContext?: string } = {},
): Promise<AIEnvelope<PRFileChangeData>> {
  const prompt = buildPullRequestFileChangePrompt(detail, file, options.memoryContext);
  const cache = await getAICache();
  const key = [
    "pr-file-change:v1",
    detail.provider,
    detail.repoFullName,
    detail.number,
    detail.updated_at,
    file.path,
    hashText(prompt),
  ].join(":");
  const cached = cache[key];
  if (!options.force && isFreshStructuredCacheEntry<PRFileChangeData>(cached)) {
    return cached.content;
  }

  const result = await callStructuredAI(
    "pr_file_change",
    PR_FILE_CHANGE_SYSTEM_PROMPT,
    prompt,
    validatePRFileChangeData,
  ) ?? fallbackEnvelope(
    "pr_file_change",
    "The AI provider did not return structured file change data, so Overcode prepared a local file summary.",
    buildLocalPRFileChangeData(file),
    ["Structured response validation failed."],
  );

  await setAICache({
    ...cache,
    [key]: { content: result, timestamp: Date.now() },
  });
  return result;
}

export async function summarizeGitHubIssueStructured(
  payload: IssueTriagePayload,
  options: { force?: boolean } = {},
): Promise<AIEnvelope<IssueTriageData>> {
  if (payload.unavailableReason) {
    return fallbackEnvelope(
      "issue_triage",
      payload.unavailableReason,
      buildLocalIssueTriageData(payload),
      [payload.unavailableReason],
    );
  }

  const prompt = buildIssueTriagePrompt(payload);
  const cache = await getAICache();
  const key = `issue-triage:v1:${payload.issue.number}:${payload.issue.updated_at}:${hashText(prompt)}`;
  const cached = cache[key];
  if (!options.force && isFreshStructuredCacheEntry<IssueTriageData>(cached)) {
    return cached.content;
  }

  const result = await callStructuredAI(
    "issue_triage",
    ISSUE_TRIAGE_SYSTEM_PROMPT,
    prompt,
    validateIssueTriageData,
  ) ?? fallbackEnvelope(
    "issue_triage",
    "The AI provider did not return structured issue triage data, so Overcode prepared a local triage.",
    buildLocalIssueTriageData(payload),
    ["Structured response validation failed."],
  );

  await setAICache({
    ...cache,
    [key]: { content: result, timestamp: Date.now() },
  });
  return result;
}

export async function explainCodeSelectionStructured(
  payload: CodeExplainPayload,
  options: { force?: boolean } = {},
): Promise<AIEnvelope<CodeExplanationData>> {
  if (payload.unavailableReason) {
    return fallbackEnvelope(
      "code_explain",
      payload.unavailableReason,
      buildLocalCodeExplanationData(payload),
      [payload.unavailableReason],
    );
  }

  const prompt = buildCodeExplanationPrompt(payload);
  const cache = await getAICache();
  const key = `code-explain:v1:${payload.kind}:${hashText(prompt)}`;
  const cached = cache[key];
  if (!options.force && isFreshStructuredCacheEntry<CodeExplanationData>(cached)) {
    return cached.content;
  }

  const result = await callStructuredAI(
    "code_explain",
    CODE_EXPLAIN_SYSTEM_PROMPT,
    prompt,
    validateCodeExplanationData,
  ) ?? fallbackEnvelope(
    "code_explain",
    "The AI provider did not return structured code explanation data, so Overcode prepared a local explanation.",
    buildLocalCodeExplanationData(payload),
    ["Structured response validation failed."],
  );

  await setAICache({
    ...cache,
    [key]: { content: result, timestamp: Date.now() },
  });
  return result;
}

export async function explainStashStructured(
  payload: StashExplainPayload,
  options: { force?: boolean } = {},
): Promise<AIEnvelope<StashExplainData>> {
  if (payload.unavailableReason) {
    return fallbackEnvelope(
      "stash_explain",
      payload.unavailableReason,
      buildLocalStashExplainData(payload),
      [payload.unavailableReason],
    );
  }

  const diff = payload.diff?.trim()
    ? payload.diff
    : payload.repoPath
      ? await ipc.getStashDiff(payload.repoPath, payload.ref).catch(() => "")
      : "";
  const prompt = buildStashExplainPrompt({ ...payload, diff });
  const cache = await getAICache();
  const key = `stash-explain:v1:${payload.repoId}:${payload.ref}:${hashText(prompt)}`;
  const cached = cache[key];
  if (!options.force && isFreshStructuredCacheEntry<StashExplainData>(cached)) {
    return cached.content;
  }

  const result = await callStructuredAI(
    "stash_explain",
    STASH_EXPLAIN_SYSTEM_PROMPT,
    prompt,
    validateStashExplainData,
  ) ?? fallbackEnvelope(
    "stash_explain",
    "The AI provider did not return structured stash data, so Overcode prepared a local stash summary.",
    buildLocalStashExplainData({ ...payload, diff }),
    ["Structured response validation failed."],
  );

  await setAICache({
    ...cache,
    [key]: { content: result, timestamp: Date.now() },
  });
  return result;
}

export async function summarizeWorktreeCompare(
  payload: WorktreeComparePayload,
  options: { force?: boolean } = {},
): Promise<AIEnvelope<WorktreeCompareData>> {
  if (payload.unavailableReason) {
    return fallbackEnvelope(
      "worktree_compare",
      payload.unavailableReason,
      buildLocalWorktreeCompareData(payload),
      [payload.unavailableReason],
    );
  }
  const prompt = buildWorktreeComparePrompt(payload);
  const cache = await getAICache();
  const key = `worktree-compare:v1:${payload.repoId}:${hashText(prompt)}`;
  const cached = cache[key];
  if (!options.force && isFreshStructuredCacheEntry<WorktreeCompareData>(cached)) {
    return cached.content;
  }

  const result = await callStructuredAI(
    "worktree_compare",
    WORKTREE_COMPARE_SYSTEM_PROMPT,
    prompt,
    validateWorktreeCompareData,
  ) ?? fallbackEnvelope(
    "worktree_compare",
    "The AI provider did not return structured worktree compare data, so Overcode prepared a local comparison.",
    buildLocalWorktreeCompareData(payload),
    ["Structured response validation failed."],
  );

  await setAICache({
    ...cache,
    [key]: { content: result, timestamp: Date.now() },
  });
  return result;
}

export async function summarizeDailyStandupStructured(
  payload: StandupPayload,
  options: { force?: boolean } = {},
): Promise<AIEnvelope<StandupData>> {
  if (payload.unavailableReason) {
    return fallbackEnvelope(
      "standup",
      payload.unavailableReason,
      buildLocalStandupData(payload),
      [payload.unavailableReason],
    );
  }

  const prompt = buildStandupPrompt(payload);
  const cache = await getAICache();
  const key = `standup:v1:${payload.startIso}:${payload.endIso}:${hashText(prompt)}`;
  const cached = cache[key];
  if (!options.force && isFreshStructuredCacheEntry<StandupData>(cached)) {
    return cached.content;
  }

  const result = await callStructuredAI(
    "standup",
    STANDUP_SYSTEM_PROMPT,
    prompt,
    validateStandupData,
  ) ?? fallbackEnvelope(
    "standup",
    "The AI provider did not return structured standup data, so Overcode prepared a local digest.",
    buildLocalStandupData(payload),
    ["Structured response validation failed."],
  );

  await setAICache({
    ...cache,
    [key]: { content: result, timestamp: Date.now() },
  });
  return result;
}

async function callStructuredAI<T>(
  feature: StructuredAIFeature,
  systemPrompt: string,
  userPrompt: string,
  validateData: (value: unknown) => T | null,
): Promise<AIEnvelope<T> | null> {
  return (await callStructuredAIWithDiagnostics(
    feature,
    systemPrompt,
    userPrompt,
    validateData,
  )).result;
}

async function callStructuredAIWithDiagnostics<T>(
  feature: StructuredAIFeature,
  systemPrompt: string,
  userPrompt: string,
  validateData: (value: unknown) => T | null,
): Promise<{ result: AIEnvelope<T> | null; failureReason?: string }> {
  let failureReason: string | undefined;
  const raw = await ipc.callAIModel(systemPrompt, userPrompt)
    .then((value) => value.trim())
    .catch((error: unknown) => {
      failureReason = aiFailureMessage(error);
      return "";
    });
  if (!raw) return { result: null, failureReason };
  const parsed = parseAIEnvelope(raw, feature, validateData);
  if (parsed) return { result: parsed };

  const repaired = await ipc.callAIModel(
    JSON_REPAIR_SYSTEM_PROMPT,
    [
      `FEATURE: ${feature}`,
      "REQUESTED SYSTEM PROMPT:",
      systemPrompt,
      "INVALID OUTPUT:",
      raw,
    ].join("\n\n"),
  )
    .then((value) => value.trim())
    .catch((error: unknown) => {
      failureReason = aiFailureMessage(error);
      return "";
    });
  if (!repaired) {
    return { result: null, failureReason: failureReason ?? "Structured response validation failed." };
  }
  const repairedParsed = parseAIEnvelope(repaired, feature, validateData);
  return {
    result: repairedParsed,
    failureReason: repairedParsed ? undefined : "Structured response validation failed.",
  };
}

function aiFailureMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message.trim()
    : typeof error === "string"
      ? error.trim()
      : "";
  const remoteMatch = message.match(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?(.+)$/);
  if (remoteMatch?.[1]?.trim()) return remoteMatch[1].trim();
  const errorMatch = message.match(/^Error:\s+(.+)$/);
  if (errorMatch?.[1]?.trim()) return errorMatch[1].trim();
  if (message) return message;
  return "AI request failed.";
}

function buildPullRequestPrompt(
  detail: PullRequestDetail,
  memoryContext?: string,
): string | null {
  if (!detail) return null;

  const fileSummaryLines = detail.files.slice(0, MAX_PR_FILE_SUMMARIES).map((file) =>
    `${file.status.toUpperCase()} ${file.path} (+${file.additions}/-${file.deletions})`,
  );
  if (detail.files.length > MAX_PR_FILE_SUMMARIES) {
    fileSummaryLines.push(`[truncated ${detail.files.length - MAX_PR_FILE_SUMMARIES} file summaries]`);
  }

  const rankedFiles = rankPullRequestFiles(detail.files);
  const fileLines = rankedFiles.slice(0, MAX_PR_FILES).map((file) => {
    const patch = file.patch
      ? compactDiff(file.patch, MAX_PR_FILE_PATCH_CHARS)
      : "(no patch available)";
    return [
      `${file.status.toUpperCase()} ${file.path} (+${file.additions}/-${file.deletions})`,
      patch,
    ].join("\n");
  });
  if (rankedFiles.length > MAX_PR_FILES) {
    fileLines.push(`[truncated ${rankedFiles.length - MAX_PR_FILES} ranked file patches]`);
  }

  const commitLines = detail.commits
    .slice(0, MAX_PR_COMMIT_LINES)
    .map((commit) => `- ${commit.sha.slice(0, 7)} ${commit.author}: ${firstLine(commit.message)}`);
  if (detail.commits.length > MAX_PR_COMMIT_LINES) {
    commitLines.push(`[truncated ${detail.commits.length - MAX_PR_COMMIT_LINES} commits]`);
  }

  const commentLines = detail.comments
    .slice(0, MAX_PR_COMMENTS)
    .map((comment) => formatComment(comment));
  if (detail.comments.length > MAX_PR_COMMENTS) {
    commentLines.push(`[truncated ${detail.comments.length - MAX_PR_COMMENTS} comments]`);
  }

  const reviewCommentLines = detail.reviewComments
    .slice(0, MAX_PR_REVIEW_COMMENTS)
    .map((comment) => formatComment(comment));
  if (detail.reviewComments.length > MAX_PR_REVIEW_COMMENTS) {
    reviewCommentLines.push(
      `[truncated ${detail.reviewComments.length - MAX_PR_REVIEW_COMMENTS} review comments]`,
    );
  }

  const reviewLines = detail.reviews.map((review) => formatComment(review));

  const checkLines = detail.checks.slice(0, MAX_PR_CHECKS).map((check) => {
    const conclusion = check.conclusion ?? "pending";
    return `- ${check.name}: status=${check.status} conclusion=${conclusion}`;
  });
  if (detail.checks.length > MAX_PR_CHECKS) {
    checkLines.push(`[truncated ${detail.checks.length - MAX_PR_CHECKS} checks]`);
  }

  const sections = [
    "PULL REQUEST:",
    `Provider: ${detail.provider}`,
    `Repo: ${detail.repoFullName}`,
    `Number: ${detail.numberPrefix}${detail.number}`,
    `Title: ${detail.title || "(no title)"}`,
    `Author: ${detail.author}`,
    `Branches: ${detail.source_branch} -> ${detail.target_branch}`,
    `Status: ${detail.status}${detail.draft ? " (draft)" : ""}`,
    `Updated: ${detail.updated_at}`,
    "",
    `BODY:\n${truncateText(detail.body?.trim() || "(empty)", MAX_PR_BODY_CHARS)}`,
    "",
    `FILE SUMMARY:\n${formatList(fileSummaryLines, "No changed files reported.")}`,
    "",
    `CHANGED FILES:\n${formatList(fileLines, "No changed files reported.")}`,
    "",
    `COMMITS:\n${formatList(commitLines, "No commits reported.")}`,
    "",
    `ISSUE COMMENTS:\n${formatList(commentLines, "No issue comments.")}`,
    "",
    `REVIEW COMMENTS:\n${formatList(reviewCommentLines, "No inline review comments.")}`,
    "",
    `REVIEWS:\n${formatList(reviewLines, "No reviews submitted.")}`,
    "",
    `CHECKS:\n${formatList(checkLines, "No CI checks reported.")}`,
    "",
    buildCogneeMemoryPromptSection(memoryContext),
  ];

  return truncateText(sections.filter(Boolean).join("\n"), MAX_PR_PROMPT_CHARS);
}

function buildPullRequestHunkPrompt(
  detail: PullRequestDetail,
  memoryContext?: string,
): string | null {
  const hunks = detail.files.flatMap((file) => extractPatchHunks(file.path, file.patch));
  if (hunks.length === 0) return null;
  const ranked = hunks
    .sort((a, b) => hunkPromptScore(b) - hunkPromptScore(a))
    .slice(0, MAX_PR_HUNKS)
    .map((hunk, index) =>
      [
        `HUNK ${index + 1}`,
        `File: ${hunk.file}`,
        `Header: ${hunk.header}`,
        hunk.body,
      ].join("\n"),
    );

  return truncateText([
    "PULL REQUEST HUNK REVIEW:",
    `Provider: ${detail.provider}`,
    `Repo: ${detail.repoFullName}`,
    `Number: ${detail.numberPrefix}${detail.number}`,
    `Title: ${detail.title}`,
    `Branches: ${detail.source_branch} -> ${detail.target_branch}`,
    `Status: ${detail.status}${detail.draft ? " (draft)" : ""}`,
    "",
    `CONVERSATION SIGNALS:\n${formatList(
      [...detail.reviewComments, ...detail.comments]
        .slice(0, 8)
        .map((comment) => formatComment(comment)),
      "No conversation comments supplied.",
    )}`,
    "",
    `HUNKS:\n${formatList(ranked, "No hunks supplied.")}`,
    "",
    buildCogneeMemoryPromptSection(memoryContext),
  ].filter(Boolean).join("\n"), MAX_PR_PROMPT_CHARS);
}

function buildPullRequestFileChangePrompt(
  detail: PullRequestDetail,
  file: PullRequestFile,
  memoryContext?: string,
): string {
  const patch = file.patch?.trim()
    ? compactDiff(file.patch, MAX_PR_FILE_CHANGE_PATCH_CHARS)
    : "(GitHub did not return patch text for this file. Use file status and diff stats only, and state that patch-level details are unavailable.)";
  const sections = [
    "SINGLE PR FILE CHANGE:",
    `Provider: ${detail.provider}`,
    `Repo: ${detail.repoFullName}`,
    `Number: ${detail.numberPrefix}${detail.number}`,
    `Title: ${detail.title}`,
    `Branches: ${detail.source_branch} -> ${detail.target_branch}`,
    `File: ${file.path}`,
    file.previous_path ? `Previous path: ${file.previous_path}` : "",
    `Status: ${file.status}`,
    `Diff stats: +${file.additions}/-${file.deletions}`,
    "",
    `PATCH:\n${patch}`,
    "",
    buildCogneeMemoryPromptSection(memoryContext),
  ].filter(Boolean);
  return truncateText(sections.join("\n"), MAX_PR_PROMPT_CHARS);
}

function extractPatchHunks(
  file: string,
  patch: string | undefined,
): Array<{ file: string; header: string; body: string }> {
  if (!patch?.trim()) return [];
  const lines = patch.split("\n");
  const hunks: Array<{ file: string; header: string; body: string }> = [];
  let header = "";
  let body: string[] = [];
  function flush() {
    if (!header) return;
    hunks.push({
      file,
      header,
      body: truncateText(body.join("\n"), MAX_PR_HUNK_CHARS),
    });
  }
  for (const line of lines) {
    if (line.startsWith("@@")) {
      flush();
      header = line;
      body = [line];
      continue;
    }
    if (header) body.push(line);
  }
  flush();
  return hunks;
}

function hunkPromptScore(hunk: { file: string; body: string }): number {
  const addRemoveLines = hunk.body
    .split("\n")
    .filter((line) => /^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line)).length;
  const sourceWeight = /(^|\/)(src|app|electron|server|api|lib|components|screens|hooks|store)\//.test(hunk.file)
    ? 40
    : 0;
  const configWeight = /(package\.json|lock|config|tsconfig|vite|electron|docker|compose|\.env\.example)$/i.test(hunk.file)
    ? 35
    : 0;
  return addRemoveLines + sourceWeight + configWeight;
}

function buildIssueTriagePrompt(payload: IssueTriagePayload): string {
  const issue = payload.issue;
  const labelLines = issue.labels.map((label) =>
    label.description
      ? `${label.name}: ${label.description}`
      : label.name,
  );
  const commentLines = issue.commentsData
    .slice(0, MAX_ISSUE_COMMENTS)
    .map((comment) => formatComment(comment));
  if (issue.commentsData.length > MAX_ISSUE_COMMENTS) {
    commentLines.push(`[truncated ${issue.commentsData.length - MAX_ISSUE_COMMENTS} comments]`);
  }
  const linkedPRLines = issue.linkedPullRequests.map((pr) =>
    `#${pr.number} ${pr.state}: ${pr.title} ${pr.url}`,
  );
  const repoTree = limitList(
    summarizeBriefTree(payload.repoTree?.filter(Boolean) ?? []),
    MAX_ISSUE_CONTEXT_ITEMS,
  );
  const changedFiles = limitList(
    payload.localChangedFiles?.filter(Boolean) ?? [],
    MAX_ISSUE_CONTEXT_ITEMS,
  );

  return truncateText([
    "GITHUB ISSUE:",
    `Repo: ${payload.repoName || "unknown"}`,
    `Number: #${issue.number}`,
    `Title: ${issue.title}`,
    `Author: ${issue.author}`,
    `State: ${issue.state}`,
    `Updated: ${issue.updated_at ?? "unknown"}`,
    `Assignees: ${issue.assignees.join(", ") || "none"}`,
    `Milestone: ${issue.milestone?.title || "none"}`,
    `Labels:\n${formatList(labelLines, "none")}`,
    "",
    `BODY:\n${truncateText(issue.body?.trim() || "(empty)", MAX_ISSUE_BODY_CHARS)}`,
    "",
    `COMMENTS:\n${formatList(commentLines, "No comments.")}`,
    "",
    `LINKED PRS:\n${formatList(linkedPRLines, "No linked PRs returned by GitHub timeline.")}`,
    "",
    `REPO TREE:\n${formatList(repoTree, "No local repo tree supplied.")}`,
    "",
    `PACKAGE SUMMARY:\n${payload.packageSummary || "Unavailable."}`,
    "",
    `README SUMMARY:\n${summarizeReadme(payload.readme ?? "") || "Unavailable."}`,
    "",
    `LOCAL CHANGED FILES:\n${formatList(changedFiles, "No local changed files supplied.")}`,
    "",
    buildCogneeMemoryPromptSection(payload.memoryContext),
  ].filter(Boolean).join("\n"), MAX_PR_PROMPT_CHARS);
}

function buildCodeExplanationPrompt(payload: CodeExplainPayload): string {
  return truncateText([
    "CODE INSPECTION:",
    `Kind: ${payload.kind}`,
    `Subject: ${payload.subject}`,
    `Language: ${payload.language || "unknown"}`,
    payload.context ? `Context: ${payload.context}` : "",
    "",
    `CONTENT:\n${payload.kind === "diff-hunk" ? compactDiff(payload.content, MAX_DIFF_CHARS) : truncateText(payload.content, MAX_DIFF_CHARS)}`,
    "",
    buildCogneeMemoryPromptSection(payload.memoryContext),
  ].filter(Boolean).join("\n"), MAX_PR_PROMPT_CHARS);
}

function buildStashExplainPrompt(payload: StashExplainPayload): string {
  const diff = compactDiff(payload.diff?.trim() ?? "", MAX_STASH_DIFF_CHARS);
  const files = payload.files?.length
    ? payload.files
    : extractPathsFromDiff(diff);
  return truncateText([
    "STASH:",
    `Ref: ${payload.ref}`,
    `Message: ${payload.message?.trim() || "Unavailable"}`,
    "",
    `FILES:\n${formatList(files, "No file paths were returned.")}`,
    "",
    `DIFF:\n${diff || "Unavailable"}`,
    "",
    buildCogneeMemoryPromptSection(payload.memoryContext),
  ].filter(Boolean).join("\n"), MAX_PR_PROMPT_CHARS);
}

function buildStandupPrompt(payload: StandupPayload): string {
  const commitLines = payload.commits.slice(0, MAX_STANDUP_ITEMS).map((commit) =>
    `- ${commit.repo} ${commit.hash.slice(0, 7)} ${commit.author}: ${firstLine(commit.message)} (${commit.date})`,
  );
  const prLines = payload.pullRequests.slice(0, MAX_STANDUP_ITEMS).map((pr) =>
    `- ${pr.repo} #${pr.number} ${pr.status}: ${pr.title} (${pr.source} -> ${pr.target}, updated ${pr.updated_at})`,
  );
  const changeLines = payload.localChanges.slice(0, MAX_STANDUP_ITEMS).map((change) =>
    `- ${change.repo} on ${change.branch}: ${change.changedFiles} changed files, +${change.ahead}/-${change.behind}`,
  );

  return truncateText([
    "DAILY STANDUP INPUT:",
    `User: ${payload.userName}`,
    `Greeting: ${payload.greeting}`,
    `Range: ${payload.rangeLabel}`,
    `Start: ${payload.startIso}`,
    `End: ${payload.endIso}`,
    "",
    `COMMITS:\n${formatList(commitLines, "No commits found in this range.")}`,
    "",
    `OPEN / RECENT PRS:\n${formatList(prLines, "No pull request activity returned.")}`,
    "",
    `LOCAL WORK IN PROGRESS:\n${formatList(changeLines, "No local dirty workspaces returned.")}`,
    "",
    buildCogneeMemoryPromptSection(payload.memoryContext),
  ].filter(Boolean).join("\n"), MAX_STANDUP_PROMPT_CHARS);
}

function formatComment(item: { author: string; body: string; file_path?: string; line?: number }): string {
  const location = item.file_path
    ? ` (${item.file_path}${item.line ? `:${item.line}` : ""})`
    : "";
  const oneLine = item.body.replace(/\s+/g, " ").trim();
  return `- @${item.author}${location}: ${truncateText(oneLine, 400)}`;
}

function firstLine(value: string): string {
  return value.split("\n")[0]?.trim() ?? "";
}

export async function getStashLabel(
  repoId: string,
  stash: StashLabelInput,
): Promise<string> {
  const diff = truncateText(stash.diff.trim(), MAX_STASH_DIFF_CHARS);
  if (!diff) {
    return stash.message?.trim() || stash.ref;
  }

  const cache = await getAICache();
  const key = `stash:${repoId}:${stash.ref}`;
  const cached = cache[key];

  if (cached && typeof cached === "string") {
    return cached;
  }

  const label = (
    await ipc.callAIModel(STASH_LABEL_SYSTEM_PROMPT, diff)
  ).trim();
  const resolved = label || stash.message?.trim() || stash.ref;

  await setAICache({
    ...cache,
    [key]: resolved,
  });

  return resolved;
}

async function getCommitDiff(payload: CommitPayload): Promise<string> {
  if (payload.repoPath) {
    const status = await ipc.getGitStatus(payload.repoPath, { mode: "diff" }).catch(() => null);
    const diff = [status?.stagedDiff, status?.diff].filter(Boolean).join("\n\n");
    if (diff.trim()) return diff.trim();
  }
  return payload.stagedDiff?.trim() ?? "";
}

function buildRepoBriefPrompt(payload: BriefPayload): string | null {
  const tree = summarizeBriefTree(payload.tree?.filter(Boolean) ?? []);
  const recentCommits = limitList(
    payload.recentCommits?.filter(Boolean) ?? [],
    MAX_LIST_ITEMS,
  );
  const openPRs = limitList(payload.openPRs?.filter(Boolean) ?? [], MAX_LIST_ITEMS);
  const changedFiles = limitList(
    payload.changedFiles?.filter(Boolean) ?? [],
    MAX_LIST_ITEMS,
  );
  const readme = truncateText(
    sanitizeRepositoryEvidenceText(payload.readme?.trim() ?? ""),
    MAX_README_CHARS,
  );

  const hasRealData =
    tree.length > 0 ||
    recentCommits.length > 0 ||
    openPRs.length > 0 ||
    changedFiles.length > 0 ||
    Boolean(readme);

  if (!hasRealData) return null;

  const evidence = buildRepoBriefEvidenceReport(payload);

  return truncateText([
    "REPOSITORY:",
    `Name: ${payload.repoName?.trim() || payload.repoId}`,
    `Remote: ${payload.remoteUrl?.trim() || "Unavailable"}`,
    `Branch: ${payload.branch?.trim() || "Unavailable"}`,
    "",
    formatRepoBriefEvidenceReport(evidence),
    "",
    "QUALITY RULES:",
    "If the evidence level is sufficient, produce concrete module roles, recent activity, onboarding steps, and risks from the supplied evidence.",
    "Only warn about limited repository data when the evidence budget is minimal or thin.",
    "Do not use the repository description as the whole brief when README, tree, commits, changed files, or Cognee memory are available.",
    "",
    `FILE TREE:\n${formatList(tree, "Unavailable through current IPC data.")}`,
    "",
    `README:\n${readme || "Unavailable through current IPC data."}`,
    "",
    `RECENT COMMITS:\n${formatList(recentCommits, "No recent commits were returned.")}`,
    "",
    `OPEN PRS:\n${formatList(openPRs, "No open PRs were returned or the provider is not connected.")}`,
    "",
    `CHANGED FILES:\n${formatList(changedFiles, "No uncommitted files were returned.")}`,
    "",
    buildCogneeMemoryPromptSection(payload.memoryContext),
  ].filter(Boolean).join("\n"), MAX_PROMPT_CHARS);
}

function buildCompactRepoBriefPrompt(payload: BriefPayload): string | null {
  const tree = summarizeBriefTree(payload.tree?.filter(Boolean) ?? []).slice(0, 30);
  const recentCommits = (payload.recentCommits?.filter(Boolean) ?? []).slice(0, 8);
  const changedFiles = (payload.changedFiles?.filter(Boolean) ?? []).slice(0, 12);
  const readme = summarizeReadme(payload.readme ?? "");

  const hasRealData =
    tree.length > 0 ||
    recentCommits.length > 0 ||
    changedFiles.length > 0 ||
    readme.length > 0;

  if (!hasRealData) return null;

  return [
    `Repo: ${payload.repoName?.trim() || payload.repoId}`,
    `Branch: ${payload.branch?.trim() || "unavailable"}`,
    `Remote: ${payload.remoteUrl?.trim() || "unavailable"}`,
    formatRepoBriefEvidenceReport(buildRepoBriefEvidenceReport(payload)),
    "If the evidence level is sufficient, do not answer with a limited-data warning. Use the supplied files, README/package notes, commits, changed files, and Cognee memory.",
    `Files: ${tree.join(", ") || "unavailable"}`,
    `README/package notes: ${readme || "unavailable"}`,
    `Recent commits: ${recentCommits.join(" | ") || "none returned"}`,
    `Changed files: ${changedFiles.join(", ") || "none"}`,
    buildCogneeMemoryPromptSection(payload.memoryContext),
    "",
    "Return only valid JSON. Use schemaVersion=1, feature=\"brief\", summary, confidence, warnings, and data fields: data.purpose, data.keyModules, data.recentActivity, data.onboardingPath, data.notableRisks. No markdown.",
  ].filter(Boolean).join("\n");
}

function buildRepoBriefEvidenceReport(payload: BriefPayload): RepoBriefEvidenceReport {
  const fileTreeEntries = payload.tree?.filter((item) => item.trim()).length ?? 0;
  const readmeChars = payload.readme?.trim().length ?? 0;
  const recentCommits = payload.recentCommits?.filter((item) => item.trim()).length ?? 0;
  const openPRs = payload.openPRs?.filter((item) => item.trim()).length ?? 0;
  const changedFiles = payload.changedFiles?.filter((item) => item.trim()).length ?? 0;
  const memoryChars = payload.memoryContext?.trim().length ?? 0;

  const score = [
    fileTreeEntries >= 3,
    readmeChars >= 120,
    recentCommits >= 2,
    openPRs > 0,
    changedFiles > 0,
    memoryChars >= 80,
  ].filter(Boolean).length;

  return {
    fileTreeEntries,
    readmeChars,
    recentCommits,
    openPRs,
    changedFiles,
    memoryChars,
    level: score >= 2 ? "sufficient" : score === 1 ? "thin" : "minimal",
  };
}

function formatRepoBriefEvidenceReport(evidence: RepoBriefEvidenceReport): string {
  return [
    "EVIDENCE BUDGET:",
    `Evidence level: ${evidence.level}`,
    `File tree entries: ${evidence.fileTreeEntries}`,
    `README/package characters: ${evidence.readmeChars}`,
    `Recent commits: ${evidence.recentCommits}`,
    `Open PRs: ${evidence.openPRs}`,
    `Changed files: ${evidence.changedFiles}`,
    `Cognee memory characters: ${evidence.memoryChars}`,
  ].join("\n");
}

function isThinRepoBriefResult(
  result: AIEnvelope<RepoBriefData>,
  evidence: RepoBriefEvidenceReport,
): boolean {
  if (evidence.level !== "sufficient") return false;
  const warningText = result.warnings.join(" ").toLowerCase();
  const claimsLimitedData =
    warningText.includes("limited repository data") ||
    warningText.includes("inferred from description") ||
    warningText.includes("insufficient repository data");
  const sparseStructuredData =
    result.data.keyModules.length < 2 ||
    result.data.onboardingPath.length < 2 ||
    result.data.recentActivity.length < 1;
  return claimsLimitedData || sparseStructuredData;
}

function emptyImpactData(): ImpactData {
  return {
    intent: "",
    modules: [],
    risks: [],
    checks: [],
    recommendation: "",
  };
}

function emptyRepoBriefData(): RepoBriefData {
  return {
    purpose: "",
    keyModules: [],
    recentActivity: [],
    onboardingPath: [],
    notableRisks: [],
  };
}

function emptyPRReviewData(): PRReviewData {
  return {
    readiness: "needs_review",
    changeSummary: "",
    riskMatrix: [],
    blockers: [],
    ci: { passing: 0, failing: 0, pending: 0, notable: [] },
    suggestedComment: "",
  };
}

function emptyPRHunkReviewData(): PRHunkReviewData {
  return {
    overall: "needs_attention",
    hunks: [],
    questions: [],
    tests: [],
  };
}

function emptyPRFileChangeData(): PRFileChangeData {
  return {
    added: [],
    removed: [],
    changedBehavior: "",
    risk: "medium",
    reviewFocus: [],
    suggestedChecks: [],
  };
}

function emptyIssueTriageData(): IssueTriageData {
  return {
    priority: "medium",
    problem: "",
    likelyModules: [],
    ambiguities: [],
    suggestedPlan: [],
    acceptanceChecks: [],
    suggestedBranchName: "",
  };
}

function emptyCodeExplanationData(): CodeExplanationData {
  return {
    subject: "",
    purpose: "",
    keyPoints: [],
    risks: [],
    suggestedChecks: [],
  };
}

function emptyStashExplainData(): StashExplainData {
  return {
    intent: "",
    files: [],
    added: [],
    removed: [],
    risks: [],
    suggestedActions: [],
    label: "",
  };
}

function emptyStandupData(): StandupData {
  return {
    greeting: "",
    headline: "",
    yesterday: [],
    today: [],
    blockers: [],
    notableRepos: [],
    slackDraft: "",
  };
}

function buildLocalImpactData(diff: string, fileTree: string[]): ImpactData {
  const paths = fileTree.length > 0 ? fileTree : extractPathsFromDiff(diff);
  const modules = groupPathsByTopLevel(paths).map(([name, modulePaths]) => ({
    name,
    paths: modulePaths.slice(0, 8),
    changeType: "mixed" as const,
  }));
  return {
    intent: "Local changes are present, but AI did not return a structured intent.",
    modules,
    risks: paths.length > 0
      ? [
          {
            severity: "medium",
            area: "Changed files",
            reason: "Review the touched paths and run the relevant test/build command before pushing.",
            files: paths.slice(0, 8),
          },
        ]
      : [],
    checks: [
      {
        reason: "Run the test or build command for the modules touched by this diff.",
      },
    ],
    recommendation: "Open the changed files and verify the local diff before committing.",
  };
}

function buildLocalRepoBriefData(payload: BriefPayload): RepoBriefData {
  const recentCommits = limitList(
    payload.recentCommits?.filter(Boolean) ?? [],
    8,
  );
  const changedFiles = limitList(
    payload.changedFiles?.filter(Boolean) ?? [],
    12,
  );
  const tree = summarizeBriefTree([
    ...(payload.tree?.filter(Boolean) ?? []),
    ...changedFiles.filter((item) => !item.startsWith("[truncated ")),
  ]);
  const readme = summarizeReadme(payload.readme ?? "");

  const purpose = buildLocalRepoBriefPurpose(payload, readme, tree);

  return {
    purpose,
    keyModules: tree.slice(0, 12).map((item) => ({
      name: item.replace(/\/$/, ""),
      path: item,
      role: localRepoBriefRole(item),
    })),
    recentActivity: recentCommits.map((item) => ({
      label: item,
      evidence: "Recent commit message",
    })),
    onboardingPath: [
      "Read the README and package summary.",
      "Inspect the main source directories.",
      "Review recent commits before making changes.",
    ],
    notableRisks: [
      `Current branch: ${payload.branch?.trim() || "unavailable"}`,
      changedFiles.length > 0
        ? `Local changes touched: ${changedFiles.join(", ")}`
        : "No uncommitted files were returned.",
    ],
  };
}

function buildLocalRepoBriefPurpose(
  payload: BriefPayload,
  readme: string,
  tree: string[],
): string {
  if (readme.length >= 40) return readme;

  const label = cleanRepositoryLabel(readme || payload.repoName || payload.repoId);
  const modules = tree
    .map((item) => item.replace(/\/+$/, ""))
    .filter(Boolean)
    .slice(0, 6);
  if (label && modules.length > 0) {
    return `${label} repository. Local evidence includes ${formatNaturalList(modules)}.`;
  }
  if (label) {
    return `${label} repository. Purpose is not explicit in the available README/package data.`;
  }
  if (modules.length > 0) {
    return `Purpose is not explicit in README/package data. Local evidence includes ${formatNaturalList(modules)}.`;
  }
  return "Purpose is not explicit in the available README/package data. Start by inspecting the top-level files and primary source directories.";
}

function buildLocalPRReviewData(detail: PullRequestDetail): PRReviewData {
  const failing = detail.checks.filter((check) => check.conclusion === "failure").length;
  const pending = detail.checks.filter((check) => !check.conclusion || check.status !== "completed").length;
  const passing = detail.checks.filter((check) => check.conclusion === "success").length;
  return {
    readiness: failing > 0 ? "blocked" : pending > 0 ? "needs_review" : "ready",
    changeSummary: `${detail.files.length} files changed from ${detail.source_branch} into ${detail.target_branch}.`,
    riskMatrix: detail.files.slice(0, 8).map((file) => ({
      severity: file.deletions > 100 || file.additions > 200 ? "high" : "medium",
      file: file.path,
      concern: `${file.status} file with +${file.additions}/-${file.deletions}.`,
      evidence: file.patch ? "Patch excerpt is available." : "No patch excerpt was returned.",
    })),
    blockers: [
      ...detail.checks
        .filter((check) => check.conclusion && check.conclusion !== "success")
        .slice(0, 5)
        .map((check) => ({
          source: "ci" as const,
          text: `${check.name}: ${check.conclusion ?? check.status}`,
          url: check.url,
        })),
      ...detail.reviewComments.slice(0, 5).map((comment) => ({
        source: "conversation" as const,
        text: comment.body.replace(/\s+/g, " ").slice(0, 220),
        url: comment.url,
      })),
    ],
    ci: {
      passing,
      failing,
      pending,
      notable: detail.checks.slice(0, 6).map((check) => `${check.name}: ${check.conclusion ?? check.status}`),
    },
    suggestedComment:
      "I reviewed the changed files, conversation, and CI state. Please verify the highlighted risk areas before merging.",
  };
}

function buildLocalPRHunkReviewData(detail: PullRequestDetail): PRHunkReviewData {
  const hunks = detail.files
    .flatMap((file) => extractPatchHunks(file.path, file.patch))
    .sort((a, b) => hunkPromptScore(b) - hunkPromptScore(a))
    .slice(0, MAX_PR_HUNKS);
  return {
    overall: hunks.length > 0 ? "needs_attention" : "low_risk",
    hunks: hunks.map((hunk) => ({
      file: hunk.file,
      header: hunk.header,
      verdict: /test|spec|\.md$/i.test(hunk.file) ? "safe" : "needs_test",
      note: "Review this hunk with adjacent context and confirm coverage for the changed behavior.",
      suggestedCheck: "Run the relevant test or build command for this module.",
    })),
    questions: detail.reviewComments.slice(0, 4).map((comment) =>
      comment.body.replace(/\s+/g, " ").slice(0, 220),
    ),
    tests: [
      "Run the validation command for the touched module set.",
      "Inspect any changed control flow, boundary checks, or configuration defaults.",
    ],
  };
}

function buildLocalPRFileChangeData(file: PullRequestFile): PRFileChangeData {
  const addedLines = extractChangedCodeLines(file.patch, "+");
  const removedLines = extractChangedCodeLines(file.patch, "-");
  const data = emptyPRFileChangeData();
  const largeChange = file.additions + file.deletions > 180;
  const sourceFile = isSourceLikePath(file.path);
  const sensitiveFile = isSensitivePath(file.path);
  const docsOnly = /\.(md|mdx|txt|rst)$/i.test(file.path);

  return {
    ...data,
    added: summarizeChangedLines(addedLines, file.additions, "added"),
    removed: summarizeChangedLines(removedLines, file.deletions, "removed"),
    changedBehavior: `${file.status} ${file.path} with +${file.additions}/-${file.deletions}.`,
    risk: sensitiveFile || largeChange ? "high" : sourceFile && !docsOnly ? "medium" : "low",
    reviewFocus: [
      sensitiveFile ? "Check secrets, auth, proxy, or environment handling carefully." : "",
      largeChange ? "Review in smaller chunks; this file has a large diff." : "",
      file.status === "removed" ? "Confirm no live imports or references still expect this file." : "",
      file.status === "added" ? "Confirm this new file is covered by tests or manual validation." : "",
      !file.patch?.trim() ? "Patch text was not returned by the provider." : "",
    ].filter(Boolean),
    suggestedChecks: [
      docsOnly ? "Preview the rendered documentation." : "Run the tests or build command for this module.",
      sourceFile ? `Search for callers and imports of ${file.path}.` : "",
    ].filter(Boolean),
  };
}

function buildLocalIssueTriageData(payload: IssueTriagePayload): IssueTriageData {
  if (payload.unavailableReason) {
    return {
      ...emptyIssueTriageData(),
      problem: payload.unavailableReason,
      ambiguities: [payload.unavailableReason],
    };
  }

  const issue = payload.issue;
  const tree = summarizeBriefTree(payload.repoTree?.filter(Boolean) ?? []);
  const changedFiles = payload.localChangedFiles?.filter(Boolean) ?? [];
  const likelyPaths = inferIssuePaths(issue, tree, changedFiles);
  return {
    priority: issue.labels.some((label) => /bug|critical|security|sev|p0|p1/i.test(label.name))
      ? "high"
      : "medium",
    problem: firstSentence(issue.body) || issue.title,
    likelyModules: groupPathsByTopLevel(likelyPaths).map(([name, paths]) => ({
      name,
      paths: paths.slice(0, 8),
      reason: "Matched issue text against local repository paths.",
    })),
    ambiguities: [
      issue.body.trim() ? "" : "Issue body is empty.",
      issue.commentsData.length === 0 ? "No discussion comments were returned." : "",
      likelyPaths.length === 0 ? "No local files matched the issue text." : "",
    ].filter(Boolean),
    suggestedPlan: [
      "Confirm the issue reproduction path and expected behavior.",
      likelyPaths.length > 0
        ? `Inspect ${likelyPaths.slice(0, 5).join(", ")}.`
        : "Search the repository for the terms in the issue title.",
      "Create a focused branch or worktree before changing files.",
      "Run the repo's detected validation commands before opening a PR.",
    ],
    acceptanceChecks: [
      "The issue's expected behavior is covered by a test or clear manual check.",
      "The change is isolated to the smallest relevant module set.",
      "Linked PRs or comments are reviewed before starting duplicate work.",
    ],
    suggestedBranchName: `issue-${issue.number}-${slugify(issue.title).slice(0, 42)}`,
  };
}

function buildLocalCodeExplanationData(payload: CodeExplainPayload): CodeExplanationData {
  if (payload.unavailableReason) {
    return {
      ...emptyCodeExplanationData(),
      subject: payload.subject,
      purpose: payload.unavailableReason,
    };
  }

  const paths = payload.kind === "diff-hunk" ? extractPathsFromDiff(payload.content) : [];
  const functions = extractLikelySymbols(payload.content);
  return {
    subject: payload.subject,
    purpose:
      payload.kind === "diff-hunk"
        ? "This diff hunk changes the selected lines. AI did not return structured detail."
        : "This file or selection is available for read-only inspection. AI did not return structured detail.",
    keyPoints: [
      payload.language ? `Language: ${payload.language}` : "",
      paths.length > 0 ? `Touched paths: ${paths.slice(0, 5).join(", ")}` : "",
      functions.length > 0 ? `Likely symbols: ${functions.slice(0, 6).join(", ")}` : "",
      `${payload.content.split("\n").length} visible lines in the inspected content.`,
    ].filter(Boolean),
    risks: payload.kind === "diff-hunk"
      ? [
          {
            severity: "medium",
            text: "Review adjacent context and run the validation command for the touched module.",
          },
        ]
      : [],
    suggestedChecks: [
      "Search for callers or tests that cover this code path.",
      "Run the repo's detected validation command before relying on this change.",
    ],
  };
}

function buildLocalStashExplainData(payload: StashExplainPayload): StashExplainData {
  const diff = payload.diff?.trim() ?? "";
  const files = payload.files?.length
    ? payload.files
    : extractPathsFromDiff(diff);
  const addedLines = extractChangedCodeLines(diff, "+");
  const removedLines = extractChangedCodeLines(diff, "-");
  const largeChange = diff.length > 16_000 || files.length > 20;
  return {
    ...emptyStashExplainData(),
    intent:
      payload.message?.replace(/^WIP on [^:]+:\s*/i, "").trim() ||
      "This stash preserves local work in progress for later review.",
    files: files.slice(0, 30),
    added: summarizeChangedLines(addedLines, addedLines.length, "added"),
    removed: summarizeChangedLines(removedLines, removedLines.length, "removed"),
    risks: [
      ...(largeChange
        ? [{
            severity: "high" as const,
            text: "Large or broad stash. Inspect by file before popping into a busy branch.",
            files: files.slice(0, 8),
          }]
        : []),
      ...(files.some(isSensitivePath)
        ? [{
            severity: "high" as const,
            text: "Sensitive-looking config, auth, proxy, or environment files are present.",
            files: files.filter(isSensitivePath).slice(0, 8),
          }]
        : []),
    ],
    suggestedActions: [
      "Inspect the file list before applying the stash.",
      "Apply onto a clean worktree or temporary branch if this work is old.",
      "Run tests for the touched modules after popping.",
    ],
    label:
      payload.message?.replace(/^WIP on [^:]+:\s*/i, "").slice(0, 80).trim() ||
      `${files.length} stashed file${files.length === 1 ? "" : "s"}`,
  };
}

function extractLikelySymbols(value: string): string[] {
  const symbols = new Set<string>();
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      if (match[1]) symbols.add(match[1]);
    }
  }
  return Array.from(symbols).slice(0, 20);
}

function inferIssuePaths(
  issue: GitHubIssueDetail,
  repoTree: string[],
  changedFiles: string[],
): string[] {
  const haystack = [
    issue.title,
    issue.body,
    ...issue.labels.map((label) => label.name),
    ...issue.commentsData.map((comment) => comment.body),
  ].join(" ").toLowerCase();
  const candidates = [...changedFiles, ...repoTree].filter(Boolean);
  return Array.from(
    new Set(
      candidates.filter((path) => {
        const base = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
        return base.length >= 3 && haystack.includes(base.toLowerCase());
      }),
    ),
  ).slice(0, 30);
}

function firstSentence(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)[0]
    ?.trim()
    .slice(0, 280) ?? "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "work";
}

function buildWorktreeComparePrompt(payload: WorktreeComparePayload): string {
  return truncateText([
    "WORKTREE COMPARE:",
    `Repo: ${payload.repoName || payload.repoId}`,
    `Branch: ${payload.branch || "unavailable"}`,
    `Base: ${payload.base} (${payload.baseRef || "unavailable"})`,
    `Target: ${payload.target} (${payload.targetRef || "unavailable"})`,
    `Ahead: ${payload.ahead}`,
    `Behind: ${payload.behind}`,
    `Dirty files: ${payload.dirtyFiles}`,
    "",
    `DIFF STAT:\n${payload.diffStat || "Unavailable"}`,
    "",
    `NAME STATUS:\n${payload.nameStatus || "Unavailable"}`,
    "",
    `PATCH EXCERPT:\n${compactDiff(payload.patch || "", MAX_DIFF_CHARS) || "Unavailable"}`,
    "",
    `UNCOMMITTED DIFF:\n${compactDiff(payload.uncommittedDiff || "", 8_000) || "Unavailable"}`,
    "",
    `UNIQUE COMMITS:\n${formatList(payload.uniqueCommits ?? [], "No unique commits returned.")}`,
    "",
    `CHANGED FILES:\n${formatList(payload.changedFiles ?? [], "No changed files returned.")}`,
    "",
    `AVAILABLE BASES:\n${formatList(payload.baseCandidates ?? [], "No alternate bases returned.")}`,
    "",
    `LOCAL WORKTREES:\n${formatList(
      (payload.worktreeCandidates ?? []).map((tree) =>
        `${tree.branch || "(detached)"} ${tree.head?.slice(0, 7) ?? ""} ${tree.path}`,
      ),
      "No worktrees returned.",
    )}`,
    "",
    buildCogneeMemoryPromptSection(payload.memoryContext),
  ].filter(Boolean).join("\n"), MAX_PR_PROMPT_CHARS);
}

function buildLocalWorktreeCompareData(payload: WorktreeComparePayload): WorktreeCompareData {
  const files = payload.changedFiles?.length
    ? payload.changedFiles
    : extractPathsFromDiff([payload.nameStatus, payload.patch, payload.uncommittedDiff].filter(Boolean).join("\n"));
  return {
    base: payload.base,
    target: payload.target,
    ahead: payload.ahead,
    behind: payload.behind,
    dirtyFiles: payload.dirtyFiles,
    intent: payload.uniqueCommits?.[0] ?? "Compare this worktree with the selected base before updating a PR.",
    moduleMap: groupPathsByTopLevel(files).map(([module, moduleFiles]) => ({
      module,
      files: moduleFiles.slice(0, 8),
      risk: moduleFiles.length > 5 ? "high" : "medium",
    })),
    readiness: payload.dirtyFiles > 0 || payload.behind > 0 ? "reviewable" : "ready",
    nextActions: [
      payload.behind > 0 ? `Review ${payload.behind} behind commits before pushing.` : "Base divergence looks current.",
      payload.dirtyFiles > 0 ? "Review or commit local dirty files." : "No dirty files were reported.",
      "Run tests for the touched modules.",
    ],
    prDraft: {
      title: payload.uniqueCommits?.[0] ?? `${payload.target} vs ${payload.base}`,
      body: `Compared ${payload.target} against ${payload.base}. Ahead ${payload.ahead}, behind ${payload.behind}, dirty files ${payload.dirtyFiles}.`,
    },
  };
}

function buildLocalStandupData(payload: StandupPayload): StandupData {
  if (payload.unavailableReason) {
    return {
      ...emptyStandupData(),
      greeting: payload.greeting,
      headline: payload.unavailableReason,
      blockers: [payload.unavailableReason],
      slackDraft: payload.unavailableReason,
    };
  }

  const commitsByRepo = groupStandupItems(payload.commits.map((commit) => commit.repo));
  const activeRepos = Array.from(
    new Set([
      ...payload.commits.map((commit) => commit.repo),
      ...payload.pullRequests.map((pr) => pr.repo),
      ...payload.localChanges.map((change) => change.repo),
    ]),
  );
  const yesterday = payload.commits.slice(0, 6).map((commit) =>
    `${commit.repo}: ${firstLine(commit.message)}`,
  );
  const today = payload.localChanges.slice(0, 6).map((change) =>
    `${change.repo}: continue ${change.changedFiles} local file change${change.changedFiles === 1 ? "" : "s"} on ${change.branch}.`,
  );
  const blockers = [
    ...payload.localChanges
      .filter((change) => change.behind > 0)
      .slice(0, 4)
      .map((change) => `${change.repo} is ${change.behind} commits behind its upstream.`),
  ];
  return {
    headline: `${activeRepos.length} repo${activeRepos.length === 1 ? "" : "s"} active in ${payload.rangeLabel}.`,
    greeting: payload.greeting,
    yesterday,
    today,
    blockers,
    notableRepos: Object.entries(commitsByRepo).slice(0, 6).map(([repo, count]) => ({
      repo,
      note: `${count} commit${count === 1 ? "" : "s"} in range.`,
    })),
    slackDraft: [
      yesterday.length ? `Yesterday: ${yesterday.join("; ")}` : "Yesterday: no commits found in the selected range.",
      today.length ? `Today: ${today.join("; ")}` : "Today: review active PRs and local workspace state.",
      blockers.length ? `Blockers: ${blockers.join("; ")}` : "Blockers: none surfaced from local/PR data.",
    ].join("\n"),
  };
}

function groupStandupItems(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return counts;
}

function extractPathsFromDiff(value: string): string[] {
  const paths = new Set<string>();
  for (const line of value.split("\n")) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch?.[2]) paths.add(diffMatch[2]);
    const statusMatch = line.match(/^[AMDRCU?]\s+(.+)$/);
    if (statusMatch?.[1]) paths.add(statusMatch[1].trim());
  }
  return Array.from(paths).slice(0, 80);
}

function groupPathsByTopLevel(paths: string[]): Array<[string, string[]]> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const key = path.split("/").filter(Boolean)[0] || path;
    const group = groups.get(key) ?? [];
    group.push(path);
    groups.set(key, group);
  }
  return Array.from(groups.entries()).slice(0, 12);
}

function summarizeReadme(value: string): string {
  const lines = sanitizeRepositoryEvidenceText(value)
    .split("\n")
    .map((line) => ({
      raw: line.trim(),
      clean: cleanReadmeLine(line),
    }))
    .filter((line) => line.clean)
    .filter(
      (line) =>
        !/^(name|version|description|scripts|dependencies|devDependencies):/i.test(line.clean),
    );
  const heading = lines.find((line) => /^#\s+/.test(line.raw))?.clean;
  const prose = lines.find(
    (line) =>
      !line.raw.startsWith("#") &&
      !line.raw.startsWith("[") &&
      !line.raw.startsWith("!") &&
      !/^<\/?(p|img|picture|source|h1|h2|h3|strong|em|div|span)\b/i.test(line.raw) &&
      !/<img\b/i.test(line.raw) &&
      !/shields\.io|badge/i.test(line.raw) &&
      line.clean.length > 30,
  );
  return truncateText([heading, prose?.clean].filter(Boolean).join(" "), 700);
}

function sanitizeRepositoryEvidenceText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\bMARKEE:(?:START|END):[A-Za-z0-9:_-]+\b/gi, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function cleanReadmeLine(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRepositoryLabel(value: string | undefined): string {
  return (value ?? "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\bMARKEE:(?:START|END):[A-Za-z0-9:_-]+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNaturalList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatList(items: string[], emptyText: string): string {
  return items.length > 0 ? items.join("\n") : emptyText;
}

function limitList(items: string[], maxItems: number): string[] {
  if (items.length <= maxItems) return items;
  return [
    ...items.slice(0, maxItems),
    `[truncated ${items.length - maxItems} item${items.length - maxItems === 1 ? "" : "s"}]`,
  ];
}

function rankPullRequestFiles(files: PullRequestDetail["files"]): PullRequestDetail["files"] {
  return [...files].sort((a, b) => filePromptScore(b) - filePromptScore(a));
}

function filePromptScore(file: PullRequestDetail["files"][number]): number {
  const volume = file.additions + file.deletions;
  const statusWeight = file.status === "removed" || file.status === "renamed" ? 60 : 0;
  const patchWeight = file.patch ? 30 : 0;
  const sourceWeight = /(^|\/)(src|app|electron|server|api|lib|components|screens|hooks|store)\//.test(file.path)
    ? 40
    : 0;
  const configWeight = /(package\.json|lock|config|tsconfig|vite|electron|docker|compose|\.env\.example)$/i.test(file.path)
    ? 35
    : 0;
  return Math.min(volume, 600) + statusWeight + patchWeight + sourceWeight + configWeight;
}

function extractChangedCodeLines(
  patch: string | undefined,
  prefix: "+" | "-",
): string[] {
  if (!patch?.trim()) return [];
  const skipPrefix = prefix === "+" ? "+++" : "---";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of patch.split("\n")) {
    if (!line.startsWith(prefix) || line.startsWith(skipPrefix)) continue;
    const cleaned = line.slice(1).trim();
    if (!cleaned || cleaned === "{" || cleaned === "}") continue;
    const compact = truncateText(cleaned.replace(/\s+/g, " "), 140);
    if (seen.has(compact)) continue;
    seen.add(compact);
    lines.push(compact);
    if (lines.length >= 6) break;
  }
  return lines;
}

function summarizeChangedLines(
  lines: string[],
  total: number,
  verb: "added" | "removed",
): string[] {
  if (total === 0) return [`No lines ${verb}.`];
  if (lines.length === 0) return [`${total} line${total === 1 ? "" : "s"} ${verb}.`];
  return [
    `${total} line${total === 1 ? "" : "s"} ${verb}.`,
    ...lines.slice(0, 4),
  ];
}

function isSourceLikePath(path: string): boolean {
  return /(^|\/)(src|app|electron|server|api|lib|components|screens|hooks|store|contracts)\//.test(path) ||
    /\.(ts|tsx|js|jsx|py|rs|go|sol|cairo|java|kt|swift|css|scss)$/i.test(path);
}

function isSensitivePath(path: string): boolean {
  return /(^|\/)(auth|oauth|security|secrets?|proxy|middleware|rate[-_]?limit|permissions?|roles?)|(\.env|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|docker|compose|config)/i.test(path);
}

function filterBriefTree(items: string[]): string[] {
  return items.filter((item) => {
    const lower = item.toLowerCase();
    if (
      /\.(dll|exe|lib|png|jpg|jpeg|gif|webp|ico|wav|mp3|mp4|mov|zip|tar|gz|7z|pdf)$/i.test(
        lower,
      )
    ) {
      return false;
    }
    return !/(^|\/)(dist|build|out|coverage|target|vendor|node_modules)(\/|$)/.test(
      lower,
    );
  });
}

function summarizeBriefTree(items: string[]): string[] {
  const topLevel = Array.from(
    new Set(
      items
        .map((item) => {
          const parts = item.split("/").filter(Boolean);
          const first = parts[0];
          if (!first || first === ".git") return "";
          return parts.length === 1 && /\.[a-z0-9]+$/i.test(first) ? "" : first;
        })
        .filter((item): item is string => Boolean(item) && item !== ".git"),
    ),
  )
    .slice(0, 24)
    .map((item) => `${item}/`);

  const importantPaths = filterBriefTree(items)
    .filter(isImportantBriefPath)
    .slice(0, 48);

  return limitList(
    Array.from(new Set([...topLevel, ...importantPaths])),
    MAX_TREE_ITEMS,
  );
}

function localRepoBriefRole(path: string): string {
  const normalized = path.replace(/\/+$/, "").toLowerCase();
  if (normalized === "src") return "React renderer, state, and AI workflow UI.";
  if (normalized === "electron") {
    return "Electron main process, IPC handlers, Git worker, AI provider adapters, and Cognee adapter.";
  }
  if (normalized === "docs") return "Project planning, architecture, and submission documentation.";
  if (normalized === ".github") return "GitHub workflows and repository automation.";
  if (normalized === "public") return "Static brand and renderer assets.";
  if (normalized === "release") return "Release packaging resources.";
  if (normalized.includes("src/components/ai")) return "AI workflow components and result rendering.";
  if (normalized.includes("src/lib/ai-features")) return "Structured AI prompt builders, validation fallback, and cache behavior.";
  if (normalized.includes("src/lib/ipc")) return "Renderer bridge wrapper for Electron IPC.";
  if (normalized.includes("electron/lib/ai-runtime")) return "Provider runtime selection, model calls, and structured checks.";
  if (normalized.includes("electron/ipc-handlers")) return "Main-process IPC boundary for Git, AI, settings, and memory.";
  if (normalized === "readme.md") return "Top-level product, architecture, and setup overview.";
  if (normalized === "package.json") return "Application metadata, dependencies, and developer scripts.";
  return "Repository evidence from the local file tree.";
}

function isImportantBriefPath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /(^|\/)(readme|package\.json|pyproject\.toml|cargo\.toml|go\.mod|vite\.config|tsconfig|dockerfile|compose\.ya?ml)$/.test(
      lower,
    ) ||
    /^(src|app|electron|components|lib|main|renderer|preload|server|api|pages|screens|hooks|store|styles)\//.test(
      lower,
    ) ||
    /\.(ts|tsx|js|jsx|py|rs|go|java|kt|swift|css|scss|html|md|json|ya?ml|toml)$/i.test(
      lower,
    )
  );
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

function compactDiff(value: string, maxChars: number): string {
  const diff = value.trim();
  if (!diff || diff.length <= maxChars) return diff;

  const sections = diff
    .split(/(?=^diff --git\s)/m)
    .map((section) => section.trim())
    .filter(Boolean);
  if (sections.length <= 1) return truncateText(diff, maxChars);

  const selected = sections.slice(0, MAX_DIFF_FILES);
  const perFileBudget = Math.max(500, Math.floor(maxChars / selected.length));
  const compacted = selected
    .map((section) => truncateText(section, perFileBudget))
    .join("\n\n");
  const suffix = sections.length > selected.length
    ? `\n[truncated ${sections.length - selected.length} diff file sections]`
    : "";
  return truncateText(`${compacted}${suffix}`, maxChars);
}

function unavailableCommitResult(reason: string): CommitAssistantResult {
  return {
    commitMessage: reason,
    prDescription: "",
  };
}

function hashText(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function parseCommitAssistantResponse(response: string): CommitAssistantResult {
  const parts = response.split("---PR---");
  return {
    commitMessage: parts[0]?.trim() ?? response,
    prDescription: parts[1]?.trim() ?? "",
  };
}

async function getAICache(): Promise<AICache> {
  return asAICache(await ipc.getFromStore(AI_CACHE_KEY));
}

async function setAICache(cache: AICache): Promise<void> {
  await ipc.setInStore(AI_CACHE_KEY, cache);
}

function asAICache(value: unknown): AICache {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as AICache;
  }
  return {};
}

function isFreshStructuredCacheEntry<T>(
  value: unknown,
): value is StructuredCacheEntry<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<StructuredCacheEntry<T>>;
  const content = entry.content as Partial<AIEnvelope<T>> | undefined;
  if (!content) return false;
  return (
    content.schemaVersion === 1 &&
    typeof content.feature === "string" &&
    typeof content.summary === "string" &&
    typeof entry.timestamp === "number" &&
    Date.now() - entry.timestamp < CACHE_TTL_MS
  );
}
