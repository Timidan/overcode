import type { API } from "../../electron/preload";

const STORE_KEY = "overcode:browser-api-fallback";
const KNOWN_MODELS = [
  "ibm/granite-4-h-small",
  "ibm/granite-3-3-8b-instruct",
  "ibm/granite-3-2-8b-instruct",
  "mistralai/mistral-large",
];

type StoreData = Record<string, unknown>;
const BRIDGE_URL =
  (import.meta.env.VITE_OVERCODE_BRIDGE_URL as string | undefined) ??
  "http://127.0.0.1:5174";

function readStore(): StoreData {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as StoreData) : {};
  } catch {
    return {};
  }
}

function writeStore(data: StoreData): void {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

function unavailable(feature: string): Promise<never> {
  return Promise.reject(
    new Error(`${feature} is only available in the Electron app runtime.`),
  );
}

async function bridge<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let bridgeError: string | undefined;
    try {
      const payload = JSON.parse(text) as { error?: unknown };
      if (typeof payload.error === "string") {
        bridgeError = payload.error;
      }
    } catch {
      // Fall through to the generic status message for non-JSON responses.
    }
    if (bridgeError) throw new Error(bridgeError);
    throw new Error(`Browser bridge failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function bridgeOr<T>(
  path: string,
  body: Record<string, unknown>,
  fallback: T,
): Promise<T> {
  try {
    return await bridge<T>(path, body);
  } catch {
    return fallback;
  }
}

export function installBrowserApiFallback(): void {
  if (window.api) return;
  if (!import.meta.env.DEV && import.meta.env.VITE_BROWSER_E2E !== "1") return;

  const api: API = {
    auth: {
      connect: (provider) => unavailable(`${provider} OAuth`),
      disconnect: async () => undefined,
      status: () =>
        bridgeOr("/api/auth/status", {}, { github: false, gitlab: false }),
    },
    git: {
      scan: (directories) => bridgeOr("/api/git/scan", { directories }, []),
      scanCandidates: (directories) =>
        bridgeOr("/api/git/scan", { directories, mode: "candidates" }, []),
      status: (repoPath, options) =>
        bridgeOr("/api/git/status", { repoPath, options }, {
          files: [],
          branch: "HEAD",
          ahead: 0,
          behind: 0,
          diff: "",
          stagedDiff: "",
          fileTree: [],
          readme: "",
          packageSummary: "",
          environmentWarnings: [],
          secretWarnings: [],
          testCommands: [],
        }),
      log: (repoPath, maxCount) =>
        bridgeOr("/api/git/log", { repoPath, maxCount }, []),
      show: (repoPath, hash) =>
        bridgeOr("/api/git/log", { repoPath, maxCount: 1, hash }, ""),
      commitStat: (repoPath, hash) =>
        bridgeOr(
          "/api/git/log",
          { repoPath, maxCount: 1, hash, options: { mode: "stat" } },
          { hash, files: [], insertions: 0, deletions: 0, changed: 0, isRoot: false },
        ),
      diff: async (repoPath) => {
        const status = await bridgeOr("/api/git/status", { repoPath, options: { mode: "diff" } }, {
          diff: "",
        });
        return typeof status.diff === "string" ? status.diff : "";
      },
      stashes: (repoPath) =>
        bridgeOr("/api/git/stashes", { repoPath }, []),
      stashShow: (repoPath, stashRef) =>
        bridgeOr("/api/git/stash-show", { repoPath, stashRef }, ""),
      worktrees: (repoPath, options) =>
        bridgeOr("/api/git/worktrees", { repoPath, options }, []),
      file: (repoPath, filePath, options) =>
        bridge("/api/git/file", { repoPath, filePath, options }),
      divergence: (repoPath, branch) =>
        bridgeOr("/api/git/divergence", { repoPath, branch }, { ahead: 0, behind: 0 }),
      push: () => unavailable("Git push"),
      pull: () => unavailable("Git pull"),
      commit: () => unavailable("Git commit"),
      stashPop: () => unavailable("Stash pop"),
      stashDrop: () => unavailable("Stash drop"),
    },
    github: {
      repos: () => bridgeOr("/api/github/repos", {}, []),
      issues: (repoFullName) =>
        bridgeOr("/api/github/issues", { repoFullName: repoFullName ?? "" }, []),
      issueDetail: (repoFullName, issueNumber) =>
        bridge("/api/github/issues", { repoFullName, mode: "detail", number: issueNumber }),
      prs: (repoFullName) =>
        bridgeOr("/api/github/prs", { repoFullName }, []),
      prDetail: (repoFullName, prNumber) =>
        bridge("/api/github/prs", { repoFullName, mode: "detail", number: prNumber }),
      pipelines: (repoFullName) =>
        bridgeOr("/api/github/pipelines", { repoFullName }, []),
      comment: () => unavailable("GitHub comments"),
    },
    gitlab: {
      projects: () => bridgeOr("/api/gitlab/projects", {}, []),
      mrs: (projectId) =>
        bridgeOr("/api/gitlab/mrs", { projectId }, []),
      mrDetail: (projectId, mrIid) =>
        bridge("/api/gitlab/mrs", { projectId, mode: "detail", iid: mrIid }),
      issues: (projectId) =>
        bridgeOr("/api/gitlab/issues", { projectId }, []),
      issueDetail: (projectId, issueIid) =>
        bridge("/api/gitlab/issues", { projectId, mode: "detail", number: issueIid }),
      pipelines: (projectId) =>
        bridgeOr("/api/gitlab/pipelines", { projectId }, []),
      comment: () => unavailable("GitLab comments"),
    },
    ai: {
      complete: (systemPrompt, userPrompt) =>
        bridge("/api/ai/complete", { systemPrompt, userPrompt }),
      status: () => bridgeOr("/api/ai/status", {}, {
        configured: false,
        model: "ibm/granite-4-h-small",
        missing: ["WATSONX_API_KEY", "WATSONX_PROJECT_ID", "WATSONX_URL"],
        env: {
          WATSONX_API_KEY: "missing",
          WATSONX_PROJECT_ID: "missing",
          WATSONX_URL: "missing",
        },
        health: KNOWN_MODELS.map((model) => ({
          model,
          status: "not_configured",
          reason: "Electron preload unavailable in browser mode",
          checkedAt: null,
        })),
      }),
    },
    store: {
      get: async (key) => {
        try {
          return await bridge("/api/store/get", { key });
        } catch {
          return readStore()[key];
        }
      },
      set: async (key, value) => {
        try {
          await bridge("/api/store/set", { key, value });
        } catch {
          const data = readStore();
          data[key] = value;
          writeStore(data);
        }
      },
      list: async () => {
        try {
          return await bridge<string[]>("/api/store/list");
        } catch {
          return Object.keys(readStore());
        }
      },
    },
    settings: {
      saveWatsonx: async () => ({ api_key: false, project_id: false, url: false }),
      watsonxStatus: async () =>
        ({ api_key: "none", project_id: "none", url: "none" } as const),
    },
  };

  Object.defineProperty(window, "api", {
    value: api,
    configurable: true,
  });
}
