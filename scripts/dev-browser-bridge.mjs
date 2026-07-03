import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const DEFAULT_PORT = 5174;
const DEFAULT_RENDERER_ORIGIN = "http://127.0.0.1:5173";
const STORE_FILE = path.join(os.homedir(), ".overcode", "browser-dev-store.json");
const MODELS = [
  "openrouter/free",
  "minimax/minimax-m3",
  "qwen/qwen3-coder:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

let gitOpsModule;
const healthCache = new Map();
const remoteCache = new Map();
let tsRequireHookInstalled = false;
const originalResolveFilename = Module._resolveFilename;
const REMOTE_LIST_TTL_MS = 2 * 60 * 1000;
const REMOTE_DETAIL_TTL_MS = 5 * 60 * 1000;
const MAX_REQUEST_BODY_BYTES = 1_000_000;
const MAX_REMOTE_CACHE_ENTRIES = 200;
const PROVIDER_FETCH_TIMEOUT_MS = 12_000;
const PROVIDER_FETCH_RETRIES = 2;
const TRANSIENT_PROVIDER_STATUSES = new Set([429, 502, 503, 504]);
const FORBIDDEN_STORE_KEYS = new Set(["accounts"]);
const SETTINGS_SECRET_KEYS = new Set(["openrouter_api_key"]);
const SAFE_ERROR_PREFIXES = [
  "File path",
  "File inspection",
  "Requested path",
  "Unsafe git ref",
  "Git ref inspection",
  "GitHub token",
  "GitLab token",
  "OpenRouter",
  "openrouter",
];

class BridgeHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function startBridge(options = {}) {
  const port = Number(options.port ?? process.env.OVERCODE_BRIDGE_PORT ?? DEFAULT_PORT);
  loadDotEnv();
  await ensureStoreFile();

  const server = http.createServer(async (request, response) => {
    if (!isAllowedOrigin(request.headers.origin)) {
      sendJson(response, 403, { error: "Origin not allowed" });
      return;
    }
    setCorsHeaders(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "POST required" });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await route(request.url ?? "/", body);
      sendJson(response, 200, result);
    } catch (error) {
      const { status, payload } = bridgeErrorResponse(error);
      sendJson(response, status, payload);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const address = server.address();
  const actualPort =
    address && typeof address === "object" && typeof address.port === "number"
      ? address.port
      : port;

  return {
    port: actualPort,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function route(url, body) {
  switch (url) {
    case "/api/auth/status":
      return { github: Boolean(process.env.GITHUB_TOKEN), gitlab: Boolean(process.env.GITLAB_TOKEN) };
    case "/api/git/scan":
      if (body.mode === "candidates") {
        return gitOps().scanWorkspaceCandidates(assertStringArray(body.directories, "directories"));
      }
      return gitOps().scanRepos(assertStringArray(body.directories, "directories"));
    case "/api/git/status":
      return gitOps().getStatus(assertString(body.repoPath, "repoPath"), body.options);
    case "/api/git/log":
      if (typeof body.hash === "string" && body.hash) {
        return gitOps().showCommit(assertString(body.repoPath, "repoPath"), body.hash);
      }
      return gitOps().getLog(
        assertString(body.repoPath, "repoPath"),
        boundedInteger(body.maxCount, 100, 1, 500),
      );
    case "/api/git/stashes":
      return gitOps().getStashes(assertString(body.repoPath, "repoPath"));
    case "/api/git/stash-show":
      return gitOps().getStashShow(
        assertString(body.repoPath, "repoPath"),
        assertString(body.stashRef, "stashRef"),
      );
    case "/api/git/worktrees":
      return gitOps().getWorktrees(assertString(body.repoPath, "repoPath"), body.options);
    case "/api/git/file":
      return gitOps().readRepoFile(
        assertString(body.repoPath, "repoPath"),
        assertString(body.filePath, "filePath"),
        body.options,
      );
    case "/api/git/divergence":
      return gitOps().getDivergence(
        assertString(body.repoPath, "repoPath"),
        assertString(body.branch, "branch"),
      );
    case "/api/github/repos":
      return githubPaginated("/user/repos?per_page=100&sort=updated");
    case "/api/github/issues":
      if (body.mode === "detail") {
        const repoFullName = assertGithubRepoFullName(body.repoFullName);
        const number = assertPositiveInteger(body.number, "number");
        return cachedRemote(
          `github:issue-detail:${repoFullName}:${number}`,
          REMOTE_DETAIL_TTL_MS,
          body.force === true,
          () => githubIssueDetail(repoFullName, number),
        );
      }
      {
        const repoFullName = typeof body.repoFullName === "string"
          ? body.repoFullName.trim()
          : "";
        return cachedRemote(
          repoFullName ? `github:issues:${repoFullName}` : "github:issues:all",
          REMOTE_LIST_TTL_MS,
          body.force === true,
          () => repoFullName
            ? githubIssues(assertGithubRepoFullName(repoFullName))
            : githubUserIssues(),
        );
      }
    case "/api/github/prs":
      if (body.mode === "detail") {
        const repoFullName = assertGithubRepoFullName(body.repoFullName);
        const number = assertPositiveInteger(body.number, "number");
        return cachedRemote(
          `github:pr-detail:${repoFullName}:${number}`,
          REMOTE_DETAIL_TTL_MS,
          body.force === true,
          () => githubPRDetail(repoFullName, number),
        );
      }
      {
        const repoFullName = assertGithubRepoFullName(body.repoFullName);
        return cachedRemote(
          `github:prs:${repoFullName}`,
          REMOTE_LIST_TTL_MS,
          body.force === true,
          () => githubPRs(repoFullName),
        );
      }
    case "/api/github/pipelines":
      return githubPipelines(assertGithubRepoFullName(body.repoFullName));
    case "/api/gitlab/projects":
      return gitlabPaginated("/projects?membership=true&per_page=100&order_by=last_activity_at");
    case "/api/gitlab/mrs":
      if (body.mode === "detail") {
        return gitlabMRDetail(
          assertString(body.projectId, "projectId"),
          assertPositiveInteger(body.iid, "iid"),
        );
      }
      return gitlabMRs(assertString(body.projectId, "projectId"));
    case "/api/gitlab/pipelines":
      return gitlabPaginated(`/projects/${encodeURIComponent(assertString(body.projectId, "projectId"))}/pipelines?per_page=100`, 5);
    case "/api/ai/status":
      return aiStatus();
    case "/api/ai/complete":
      return callAIModel(
        assertString(body.systemPrompt, "systemPrompt"),
        assertString(body.userPrompt, "userPrompt"),
      );
    case "/api/store/get":
      {
        const key = assertStoreKey(body.key);
        if (FORBIDDEN_STORE_KEYS.has(key)) {
          throw new BridgeHttpError(403, "Store key is restricted");
        }
        return sanitizeStoreValue(key, (await readStore())[key]);
      }
    case "/api/store/set":
      {
        const store = await readStore();
        const key = assertStoreKey(body.key);
        if (FORBIDDEN_STORE_KEYS.has(key)) {
          throw new BridgeHttpError(403, "Store key is restricted");
        }
        store[key] = sanitizeStoreWriteValue(key, body.value, store[key]);
        await writeStore(store);
        return undefined;
      }
    case "/api/store/list":
      return Object.keys(await readStore()).filter((key) => !FORBIDDEN_STORE_KEYS.has(key));
    default:
      throw new BridgeHttpError(404, "Unknown bridge route");
  }
}

function gitOps() {
  if (gitOpsModule) return gitOpsModule;
  installTsRequireHook();
  const filename = path.resolve("electron/lib/git-ops.ts");
  const moduleInstance = new Module(filename);
  moduleInstance.filename = filename;
  moduleInstance.paths = Module._nodeModulePaths(path.dirname(filename));
  moduleInstance._compile(transpileTypeScriptFile(filename), filename);
  gitOpsModule = moduleInstance.exports;
  return gitOpsModule;
}

function installTsRequireHook() {
  if (tsRequireHookInstalled) return;
  Module._resolveFilename = (request, parent, isMain, options) => {
    try {
      return originalResolveFilename.call(Module, request, parent, isMain, options);
    } catch (error) {
      if (request.startsWith(".") && parent?.filename) {
        const candidate = path.resolve(path.dirname(parent.filename), request);
        if (fs.existsSync(`${candidate}.ts`)) return `${candidate}.ts`;
      }
      throw error;
    }
  };
  Module._extensions[".ts"] = (moduleInstance, filename) => {
    moduleInstance._compile(transpileTypeScriptFile(filename), filename);
  };
  tsRequireHookInstalled = true;
}

function transpileTypeScriptFile(filename) {
  const source = fs.readFileSync(filename, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
}

async function aiStatus() {
  const configured = Boolean(openRouterApiKey());
  const missing = configured ? [] : ["OPENROUTER_API_KEY"];
  const activeModel = process.env.OPENROUTER_MODEL?.trim() || MODELS[0];
  return {
    configured,
    model: activeModel,
    missing,
    env: {
      OPENROUTER_API_KEY: envValue("OPENROUTER_API_KEY") ? "configured" : "missing",
      OPENROUTER: envValue("OPENROUTER") ? "configured" : "missing",
      OPENROUTER_MODEL: envValue("OPENROUTER_MODEL") ? "configured" : "missing",
      OPENROUTER_BASE_URL: envValue("OPENROUTER_BASE_URL") ? "configured" : "missing",
    },
    health: configured
      ? await Promise.all(uniqueModels(activeModel).map((model) => modelHealth(model)))
      : uniqueModels(activeModel).map((model) => ({
          model,
          status: "not_configured",
          reason: `Missing ${missing.join(", ")}`,
          checkedAt: null,
        })),
  };
}

async function modelHealth(model) {
  const cached = healthCache.get(model);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const checkedAt = Date.now();
  try {
    await openRouterChatRequest(model, "Return one token.", "health check", 1);
    const value = { model, status: "available", checkedAt };
    healthCache.set(model, { value, expiresAt: checkedAt + 10 * 60 * 1000 });
    return value;
  } catch (error) {
    const value = {
      model,
      status: "unavailable",
      reason: sanitizeError(error),
      checkedAt,
    };
    healthCache.set(model, { value, expiresAt: checkedAt + 10 * 60 * 1000 });
    return value;
  }
}

async function callAIModel(systemPrompt, userPrompt) {
  const model = process.env.OPENROUTER_MODEL?.trim() || MODELS[0];
  return openRouterChatRequest(model, systemPrompt, userPrompt, 800);
}

async function openRouterChatRequest(model, systemPrompt, userPrompt, maxTokens) {
  const apiKey = assertString(openRouterApiKey(), "OPENROUTER_API_KEY");
  const baseUrl = (envValue("OPENROUTER_BASE_URL") || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "HTTP-Referer": "https://github.com/Timidan/overcode",
      "X-Title": "Overcode",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter chat returned ${response.status}`);
  const data = await response.json();
  return extractChatContent(data) ?? "";
}

function extractChatContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part && typeof part === "object" && "text" in part ? String(part.text) : "")
      .filter(Boolean)
      .join("\n");
  }
  return undefined;
}

function openRouterApiKey() {
  return envValue("OPENROUTER_API_KEY") || envValue("OPENROUTER") || "";
}

async function githubFetch(apiPath) {
  const token = envValue("GITHUB_TOKEN");
  if (!token) throw new BridgeHttpError(401, "GitHub token is not configured for browser bridge");
  return providerFetchJson("github", `https://api.github.com${apiPath}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
}

async function githubPaginated(apiPath, extractItems, maxPages = 10) {
  const token = envValue("GITHUB_TOKEN");
  if (!token) throw new BridgeHttpError(401, "GitHub token is not configured for browser bridge");
  return providerFetchPaginated(
    "github",
    `https://api.github.com${apiPath}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
    extractItems,
    maxPages,
  );
}

async function cachedRemote(key, ttlMs, force, fetchFresh) {
  pruneRemoteCache();
  const cached = remoteCache.get(key);
  if (!force && cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.value;
  }
  const value = await fetchFresh();
  remoteCache.set(key, { value, timestamp: Date.now() });
  pruneRemoteCache();
  return value;
}

function pruneRemoteCache() {
  const now = Date.now();
  for (const [key, entry] of remoteCache.entries()) {
    if (!entry || typeof entry.timestamp !== "number") {
      remoteCache.delete(key);
      continue;
    }
    if (now - entry.timestamp > REMOTE_DETAIL_TTL_MS * 4) {
      remoteCache.delete(key);
    }
  }
  if (remoteCache.size <= MAX_REMOTE_CACHE_ENTRIES) return;
  const keep = new Set(
    Array.from(remoteCache.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, MAX_REMOTE_CACHE_ENTRIES)
      .map(([key]) => key),
  );
  for (const key of remoteCache.keys()) {
    if (!keep.has(key)) remoteCache.delete(key);
  }
}

async function githubPRs(repoFullName) {
  const data = await githubPaginated(`/repos/${repoFullName}/pulls?state=open&per_page=100`);
  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? "unknown",
    head: pr.head?.ref ?? "",
    base: pr.base?.ref ?? "",
    updated_at: pr.updated_at ?? null,
    html_url: pr.html_url,
    draft: Boolean(pr.draft),
  }));
}

async function githubPipelines(repoFullName) {
  const runs = await githubPaginated(
    `/repos/${repoFullName}/actions/runs?per_page=100`,
    (value) => Array.isArray(value?.workflow_runs) ? value.workflow_runs : [],
    5,
  );
  return runs.map((run) => ({
    id: run.id,
    name: run.name ?? null,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    head_sha: run.head_sha ?? "",
    html_url: run.html_url,
    updated_at: run.updated_at ?? null,
  }));
}

function mapGithubLabels(labels = []) {
  return labels
    .map((label) => {
      if (typeof label === "string") {
        return { name: label, color: null, description: null };
      }
      if (!label || typeof label !== "object" || !label.name) return null;
      return {
        name: String(label.name),
        color: typeof label.color === "string" ? label.color : null,
        description: typeof label.description === "string" ? label.description : null,
      };
    })
    .filter(Boolean);
}

async function githubIssues(repoFullName) {
  const data = await githubPaginated(`/repos/${repoFullName}/issues?state=all&sort=updated&direction=desc&per_page=100`);
  return data
    .filter((issue) => !issue.pull_request)
    .map((issue) => mapGithubIssue(issue, repoFullName));
}

async function githubUserIssues() {
  const data = await githubPaginated("/issues?filter=all&state=all&sort=updated&direction=desc&per_page=100");
  return data
    .filter((issue) => !issue.pull_request)
    .map((issue) => mapGithubIssue(issue, readGithubIssueRepoFullName(issue)));
}

function mapGithubIssue(issue, repoFullName) {
  return {
    repoFullName,
    number: issue.number,
    title: issue.title,
    author: issue.user?.login ?? "unknown",
    state: issue.state,
    labels: mapGithubLabels(issue.labels),
    assignees: (issue.assignees ?? []).map((assignee) => assignee.login).filter(Boolean),
    comments: issue.comments ?? 0,
    updated_at: issue.updated_at ?? null,
    html_url: issue.html_url,
  };
}

function readGithubIssueRepoFullName(issue) {
  if (issue.repository?.full_name) return issue.repository.full_name;
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\//.exec(issue.html_url ?? "");
  return match?.[1] ?? "unknown/unknown";
}

function mapGithubLinkedPullRequests(events = []) {
  const byNumber = new Map();
  for (const event of events) {
    const issue = event?.source?.issue;
    if (!issue?.pull_request || typeof issue.number !== "number") continue;
    byNumber.set(issue.number, {
      number: issue.number,
      title: issue.title ?? "",
      state: issue.state ?? "unknown",
      url: issue.html_url ?? "",
    });
  }
  return Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
}

async function githubIssueDetail(repoFullName, issueNumber) {
  const [issue, comments, timeline] = await Promise.all([
    githubFetch(`/repos/${repoFullName}/issues/${issueNumber}`),
    githubPaginated(`/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=100`),
    githubPaginated(`/repos/${repoFullName}/issues/${issueNumber}/timeline?per_page=100`)
      .catch(() => []),
  ]);
  if (issue.pull_request) {
    throw new Error(`GitHub #${issueNumber} is a pull request, not an issue.`);
  }
  return {
    repoFullName,
    number: issue.number,
    title: issue.title,
    author: issue.user?.login ?? "unknown",
    state: issue.state,
    labels: mapGithubLabels(issue.labels),
    assignees: (issue.assignees ?? []).map((assignee) => assignee.login).filter(Boolean),
    comments: issue.comments ?? 0,
    updated_at: issue.updated_at ?? null,
    html_url: issue.html_url,
    body: issue.body ?? "",
    locked: Boolean(issue.locked),
    milestone: issue.milestone?.title ?? null,
    commentsData: comments.map((comment) => ({
      id: String(comment.id),
      author: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      url: comment.html_url,
    })),
    linkedPullRequests: mapGithubLinkedPullRequests(timeline),
  };
}

function mapGithubFileStatus(status) {
  if (["added", "modified", "removed", "renamed"].includes(status)) return status;
  return "unknown";
}

async function githubPRDetail(repoFullName, prNumber) {
  const [
    pr,
    files,
    commits,
    issueComments,
    reviewComments,
    reviews,
    checksData,
  ] = await Promise.all([
    githubFetch(`/repos/${repoFullName}/pulls/${prNumber}`),
    githubPaginated(`/repos/${repoFullName}/pulls/${prNumber}/files?per_page=100`),
    githubPaginated(`/repos/${repoFullName}/pulls/${prNumber}/commits?per_page=100`),
    githubPaginated(`/repos/${repoFullName}/issues/${prNumber}/comments?per_page=100`),
    githubPaginated(`/repos/${repoFullName}/pulls/${prNumber}/comments?per_page=100`),
    githubPaginated(`/repos/${repoFullName}/pulls/${prNumber}/reviews?per_page=100`),
    githubPaginated(
      `/repos/${repoFullName}/commits/pull/${prNumber}/head/check-runs?per_page=100`,
      (value) => Array.isArray(value?.check_runs) ? value.check_runs : [],
      5,
    ).catch(() => []),
  ]);

  return {
    id: `github:${repoFullName}:${prNumber}`,
    provider: "github",
    repoFullName,
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
    draft: Boolean(pr.draft),
    url: pr.html_url,
    updated_at: pr.updated_at,
    files: files.map((file) => ({
      path: file.filename,
      status: mapGithubFileStatus(file.status),
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
    comments: issueComments.map((comment) => ({
      id: String(comment.id),
      author: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      url: comment.html_url,
    })),
    reviewComments: reviewComments.map((comment) => ({
      id: String(comment.id),
      author: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      file_path: comment.path,
      line: comment.line ?? comment.original_line ?? undefined,
      url: comment.html_url,
    })),
    reviews: reviews.map((review) => ({
      id: String(review.id),
      author: review.user?.login ?? "unknown",
      body: `[${review.state}] ${review.body ?? ""}`.trim(),
      created_at: review.submitted_at ?? "",
      url: review.html_url,
    })),
    checks: checksData.map((run) => ({
      id: String(run.id),
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url ?? undefined,
      updated_at: run.completed_at ?? run.started_at,
    })),
  };
}

async function gitlabFetch(apiPath) {
  const token = envValue("GITLAB_TOKEN");
  if (!token) throw new BridgeHttpError(401, "GitLab token is not configured for browser bridge");
  return providerFetchJson("gitlab", `https://gitlab.com/api/v4${apiPath}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
}

async function gitlabPaginated(apiPath, maxPages = 10) {
  const token = envValue("GITLAB_TOKEN");
  if (!token) throw new BridgeHttpError(401, "GitLab token is not configured for browser bridge");
  return providerFetchPaginated(
    "gitlab",
    `https://gitlab.com/api/v4${apiPath}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    undefined,
    maxPages,
  );
}

async function gitlabMRs(projectId) {
  const data = await gitlabPaginated(`/projects/${encodeURIComponent(projectId)}/merge_requests?state=opened&per_page=100`);
  return data.map((mr) => ({
    iid: mr.iid,
    title: mr.title,
    author: mr.author?.username ?? "unknown",
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    updated_at: mr.updated_at,
    web_url: mr.web_url,
    draft: Boolean(mr.draft || mr.work_in_progress),
    state: mr.state,
  }));
}

function gitlabChangeStatus(change) {
  if (change.new_file) return "added";
  if (change.deleted_file) return "removed";
  if (change.renamed_file) return "renamed";
  return "modified";
}

function diffCounts(diff = "") {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

async function gitlabMRDetail(projectId, mrIid) {
  const encodedProject = encodeURIComponent(projectId);
  const [mr, commits, notes, approval, pipelines] = await Promise.all([
    gitlabFetch(`/projects/${encodedProject}/merge_requests/${mrIid}/changes`),
    gitlabPaginated(`/projects/${encodedProject}/merge_requests/${mrIid}/commits?per_page=100`)
      .catch(() => []),
    gitlabPaginated(`/projects/${encodedProject}/merge_requests/${mrIid}/notes?per_page=100&sort=asc&order_by=created_at`)
      .catch(() => []),
    gitlabFetch(`/projects/${encodedProject}/merge_requests/${mrIid}/approvals`)
      .catch(() => null),
    gitlabPaginated(`/projects/${encodedProject}/merge_requests/${mrIid}/pipelines?per_page=100`, 5)
      .catch(() => []),
  ]);

  const comments = [];
  const reviewComments = [];
  for (const note of notes) {
    if (note.system) continue;
    const item = {
      id: String(note.id),
      author: note.author?.username ?? "unknown",
      body: note.body ?? "",
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

  const reviews = approval
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
          created_at: mr.updated_at,
        },
      ].filter((item) => item.body.length > 0)
    : [];

  const repoFullName = mr.references?.full?.replace(/!\d+$/, "") ?? projectId;

  return {
    id: `gitlab:${repoFullName}:${mrIid}`,
    provider: "gitlab",
    repoFullName,
    number: mrIid,
    numberPrefix: "!",
    title: mr.title,
    body: mr.description ?? "",
    author: mr.author?.username ?? "unknown",
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    status: mr.state,
    draft: Boolean(mr.draft || mr.work_in_progress),
    url: mr.web_url,
    updated_at: mr.updated_at,
    files: (mr.changes ?? []).map((change) => {
      const counts = diffCounts(change.diff);
      return {
        path: change.new_path || change.old_path,
        status: gitlabChangeStatus(change),
        additions: counts.additions,
        deletions: counts.deletions,
        patch: change.diff,
        previous_path: change.renamed_file ? change.old_path : undefined,
      };
    }),
    commits: commits.map((commit) => ({
      sha: commit.id,
      message: commit.message || commit.title || "",
      author: commit.author_name ?? "unknown",
      date: commit.authored_date ?? "",
      url: commit.web_url,
    })),
    comments,
    reviewComments,
    reviews,
    checks: pipelines.map((pipeline) => ({
      id: String(pipeline.id),
      name: `Pipeline ${pipeline.ref}`,
      status: pipeline.status,
      conclusion: pipeline.status,
      url: pipeline.web_url,
      updated_at: pipeline.updated_at,
    })),
  };
}

async function providerFetchJson(provider, url, init = {}) {
  const response = await providerFetch(provider, url, init);
  if (response.status === 204) return undefined;
  return response.json();
}

async function providerFetchPaginated(provider, url, init = {}, extractItems, maxPages = 10) {
  const items = [];
  let nextUrl = url;
  let pages = 0;
  while (nextUrl && pages < maxPages) {
    const response = await providerFetch(provider, nextUrl, init);
    const value = await response.json();
    if (extractItems) {
      items.push(...extractItems(value));
    } else if (Array.isArray(value)) {
      items.push(...value);
    }
    nextUrl = nextLink(response.headers.get("link"));
    pages += 1;
  }
  return items;
}

async function providerFetch(provider, url, init = {}) {
  let lastError;
  for (let attempt = 0; attempt <= PROVIDER_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (response.ok) return response;
      if (TRANSIENT_PROVIDER_STATUSES.has(response.status) && attempt < PROVIDER_FETCH_RETRIES) {
        await discardResponseBody(response);
        await sleep(retryDelayMs(attempt, response.headers));
        continue;
      }
      await discardResponseBody(response);
      throw new BridgeHttpError(502, `${provider} request failed (${response.status})`);
    } catch (error) {
      lastError = error;
      if (error instanceof BridgeHttpError) throw error;
      if (attempt < PROVIDER_FETCH_RETRIES) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new BridgeHttpError(504, `${provider} request timed out`);
  }
  throw new BridgeHttpError(502, `${provider} request failed`);
}

async function discardResponseBody(response) {
  try {
    await response.arrayBuffer();
  } catch {
    // Only discarding to allow connection reuse.
  }
}

function nextLink(value) {
  if (!value) return null;
  const match = value
    .split(",")
    .map((part) => part.trim().match(/^<([^>]+)>;\s*rel="next"$/))
    .find((part) => part?.[1]);
  return match?.[1] ?? null;
}

function retryDelayMs(attempt, headers) {
  const retryAfter = headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10_000);
  }
  return Math.min(500 * 2 ** attempt, 4_000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureStoreFile() {
  await fsp.mkdir(path.dirname(STORE_FILE), { recursive: true });
  try {
    await fsp.access(STORE_FILE);
  } catch {
    await writeStore({
      repositories: [],
      activity: [],
      ai_cache: {},
      settings: { watch_directories: ["~/projects", "~/Desktop/persona", "~/Desktop"] },
    });
  }
}

async function readStore() {
  try {
    return JSON.parse(await fsp.readFile(STORE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeStore(store) {
  await fsp.writeFile(STORE_FILE, JSON.stringify(store, null, 2));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    let failed = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (failed) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        failed = true;
        reject(new BridgeHttpError(413, "Request body too large"));
        request.resume();
        return;
      }
      raw += chunk;
    });
    request.on("end", () => {
      if (failed) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new BridgeHttpError(400, "Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value ?? null));
}

function setCorsHeaders(request, response) {
  const origin = corsOriginFor(request.headers.origin);
  response.setHeader(
    "Access-Control-Allow-Origin",
    origin, // nosemgrep: javascript.express.security.cors-misconfiguration.cors-misconfiguration
  );
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return corsOriginFor(origin) === origin;
}

function corsOriginFor(origin) {
  if (origin && allowedOrigins().has(origin)) return origin;
  return DEFAULT_RENDERER_ORIGIN;
}

function allowedOrigins() {
  const origins = new Set([DEFAULT_RENDERER_ORIGIN, "http://localhost:5173"]);
  const devServer = process.env.VITE_DEV_SERVER_URL?.trim();
  if (devServer) addLoopbackOrigin(origins, devServer);
  for (const value of (process.env.OVERCODE_BRIDGE_ALLOWED_ORIGINS ?? "").split(",")) {
    addLoopbackOrigin(origins, value);
  }
  return origins;
}

function addLoopbackOrigin(origins, value) {
  const origin = loopbackOrigin(value);
  if (origin) origins.add(origin);
}

function loopbackOrigin(value) {
  const candidate = value.trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
    ) {
      return url.origin;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function loadDotEnv() {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function envValue(key) {
  return process.env[key]?.trim() || undefined;
}

function uniqueModels(activeModel) {
  return Array.from(new Set([...MODELS, activeModel]));
}

function sanitizeError(error) {
  if (error instanceof Error) {
    if (error.message.includes("404")) return "Model is not available for this project";
    if (error.message.includes("401") || error.message.includes("403")) {
      return "Credentials rejected";
    }
    if (error.message.includes("IAM")) return "IAM token request failed";
  }
  return "Health probe failed";
}

function assertString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BridgeHttpError(400, `${name} must be a non-empty string`);
  }
  return value;
}

function assertStringArray(value, name) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new BridgeHttpError(400, `${name} must be an array of strings`);
  }
  return value;
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new BridgeHttpError(400, `${name} must be a positive integer`);
  }
  return value;
}

function boundedInteger(value, fallback, min, max) {
  const candidate = Number.isInteger(value) ? value : fallback;
  return Math.max(min, Math.min(candidate, max));
}

function assertGithubRepoFullName(value) {
  const fullName = assertString(value, "repoFullName").trim();
  const parts = fullName.split("/");
  const segmentPattern = /^[A-Za-z0-9_.-]{1,100}$/;
  if (
    parts.length !== 2 ||
    !segmentPattern.test(parts[0]) ||
    !segmentPattern.test(parts[1]) ||
    parts.some((part) => part === "." || part === ".." || part.startsWith("-"))
  ) {
    throw new BridgeHttpError(400, "repoFullName must be a valid owner/repo pair");
  }
  return `${parts[0]}/${parts[1]}`;
}

function assertStoreKey(value) {
  const key = assertString(value, "key").trim();
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(key)) {
    throw new BridgeHttpError(400, "Store key contains unsupported characters");
  }
  return key;
}

function sanitizeStoreValue(key, value) {
  if (key === "settings" && value && typeof value === "object" && !Array.isArray(value)) {
    const sanitized = { ...value };
    for (const secret of SETTINGS_SECRET_KEYS) delete sanitized[secret];
    return sanitized;
  }
  return value;
}

function sanitizeStoreWriteValue(key, value, existing) {
  if (key !== "settings" || !value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const next = { ...value };
  const current = existing && typeof existing === "object" && !Array.isArray(existing)
    ? existing
    : {};
  for (const secret of SETTINGS_SECRET_KEYS) {
    if (current[secret] !== undefined) next[secret] = current[secret];
    else delete next[secret];
  }
  return next;
}

function bridgeErrorResponse(error) {
  if (error instanceof BridgeHttpError) {
    return { status: error.status, payload: { error: error.message } };
  }
  if (error instanceof Error && SAFE_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix))) {
    return { status: 400, payload: { error: error.message } };
  }
  return { status: 500, payload: { error: "Bridge request failed" } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startBridge()
    .then(({ port }) => {
      console.log(`Overcode browser bridge listening on http://127.0.0.1:${port}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
