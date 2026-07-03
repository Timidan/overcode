import type { API } from "../../electron/preload";
import type {
  AIModelCatalogEntry,
  AIModelStructuredCheckResult,
  AIProviderCredentialSourceStatus,
  AIProviderId,
  AIProviderStatus,
} from "./ipc";

const STORE_KEY = "overcode:browser-api-fallback";
const PROVIDERS: AIProviderId[] = ["openrouter", "openai", "anthropic", "gemini", "nvidia"];
const CURATED_MODELS: Record<AIProviderId, AIModelCatalogEntry[]> = {
  openrouter: [
    {
      providerId: "openrouter",
      id: "openrouter/free",
      name: "Free Models Router",
      free: true,
      contextLength: 200000,
      modalities: ["text"],
      tags: ["free", "recommended"],
      source: "curated",
    },
    {
      providerId: "openrouter",
      id: "qwen/qwen3-coder:free",
      name: "Qwen3 Coder",
      free: true,
      contextLength: 1048576,
      modalities: ["text"],
      tags: ["free", "coding", "recommended", "long_context"],
      source: "curated",
    },
  ],
  openai: [
    {
      providerId: "openai",
      id: "gpt-4.1",
      name: "GPT-4.1",
      free: false,
      contextLength: 1047576,
      modalities: ["text"],
      tags: ["paid", "coding", "recommended", "long_context"],
      source: "curated",
    },
    {
      providerId: "openai",
      id: "gpt-4.1-mini",
      name: "GPT-4.1 Mini",
      free: false,
      contextLength: 1047576,
      modalities: ["text"],
      tags: ["paid", "coding"],
      source: "curated",
    },
  ],
  anthropic: [
    {
      providerId: "anthropic",
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      free: false,
      contextLength: 200000,
      modalities: ["text"],
      tags: ["paid", "coding", "recommended", "long_context"],
      source: "curated",
    },
    {
      providerId: "anthropic",
      id: "claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      free: false,
      contextLength: 200000,
      modalities: ["text"],
      tags: ["paid", "coding"],
      source: "curated",
    },
  ],
  gemini: [
    {
      providerId: "gemini",
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      free: false,
      contextLength: 1048576,
      modalities: ["text", "image"],
      tags: ["paid", "coding", "recommended", "long_context", "vision"],
      source: "curated",
    },
    {
      providerId: "gemini",
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      free: false,
      contextLength: 1048576,
      modalities: ["text", "image"],
      tags: ["paid", "coding", "vision"],
      source: "curated",
    },
  ],
  nvidia: [
    {
      providerId: "nvidia",
      id: "meta/llama-4-maverick-17b-128e-instruct",
      name: "Meta: Llama 4 Maverick",
      free: false,
      modalities: ["text"],
      tags: ["paid", "recommended", "long_context"],
      source: "curated",
    },
    {
      providerId: "nvidia",
      id: "qwen/qwen3-next-80b-a3b-instruct",
      name: "Qwen: Qwen3 Next 80B",
      free: false,
      modalities: ["text"],
      tags: ["paid", "coding", "recommended", "long_context"],
      source: "curated",
    },
    {
      providerId: "nvidia",
      id: "mistralai/mistral-large-3-675b-instruct-2512",
      name: "Mistral: Large 3",
      free: false,
      modalities: ["text"],
      tags: ["paid", "recommended", "long_context"],
      source: "curated",
    },
  ],
};

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

function readActiveProviderId(data: StoreData): AIProviderId {
  const providerId = data.ai_provider_id;
  return typeof providerId === "string" && PROVIDERS.includes(providerId as AIProviderId)
    ? (providerId as AIProviderId)
    : "openrouter";
}

function readProviderStatusMap(data: StoreData): Record<AIProviderId, AIProviderCredentialSourceStatus> {
  const raw = data.ai_provider_status;
  const result = {} as Record<AIProviderId, AIProviderCredentialSourceStatus>;
  for (const providerId of PROVIDERS) {
    const value =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)[providerId]
        : undefined;
    const entry = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<AIProviderCredentialSourceStatus>)
      : undefined;
    result[providerId] = {
      api_key:
        entry?.api_key === "stored" || entry?.api_key === "env" ? entry.api_key : "none",
      base_url:
        entry?.base_url === "stored" || entry?.base_url === "env" || entry?.base_url === "none"
          ? entry.base_url
          : "default",
    };
  }
  return result;
}

function writeProviderStatus(
  providerId: AIProviderId,
  update: { api_key?: string | null; base_url?: string | null },
): void {
  const data = readStore();
  const statuses = readProviderStatusMap(data);
  const current = statuses[providerId];
  statuses[providerId] = {
    api_key:
      update.api_key === undefined
        ? current.api_key
        : update.api_key === null || update.api_key.trim() === ""
          ? "none"
          : "stored",
    base_url:
      update.base_url === undefined
        ? current.base_url
        : update.base_url === null || update.base_url.trim() === ""
          ? "default"
          : "stored",
  };
  data.ai_provider_status = statuses;
  writeStore(data);
}

function browserProviderStatuses(): AIProviderStatus[] {
  const data = readStore();
  const activeProviderId = readActiveProviderId(data);
  const statuses = readProviderStatusMap(data);
  return PROVIDERS.map((providerId) => {
    const credentialStatus = statuses[providerId];
    const configured = credentialStatus.api_key !== "none";
    return {
      providerId,
      configured,
      active: providerId === activeProviderId,
      credentialSource: credentialStatus.api_key,
      baseUrlSource: credentialStatus.base_url,
      health: configured ? "unknown" : "not_configured",
      reason: configured
        ? "Browser fallback uses local mock provider metadata only."
        : "API key is not configured in browser fallback mode.",
    };
  });
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
      providers: async () => browserProviderStatuses(),
      structuredCheck: async (providerId, modelId) => {
        const data = readStore();
        const checkedProvider = PROVIDERS.includes(providerId as AIProviderId)
          ? (providerId as AIProviderId)
          : (data.ai_provider_id as AIProviderId | undefined) ?? "openrouter";
        const model = typeof modelId === "string" && modelId.trim()
          ? modelId.trim()
          : typeof data.ai_model_id === "string" && data.ai_model_id.trim()
            ? data.ai_model_id.trim()
            : CURATED_MODELS[checkedProvider]?.[0]?.id ?? "openrouter/free";
        const fallback: AIModelStructuredCheckResult = {
          providerId: checkedProvider,
          model,
          status: "not_configured",
          reason: "Structured checks require the Electron app runtime.",
          checkedAt: Date.now(),
          generatedLength: 0,
          parsedJson: false,
          schemaValid: false,
        };
        return bridgeOr("/api/ai/structured-check", { providerId: checkedProvider, modelId: model }, fallback);
      },
      models: async (providerId) => CURATED_MODELS[providerId as AIProviderId] ?? [],
      setActiveProvider: async (providerId, modelId) => {
        const data = readStore();
        const nextProviderId = PROVIDERS.includes(providerId as AIProviderId)
          ? (providerId as AIProviderId)
          : "openrouter";
        data.ai_provider_id = nextProviderId;
        if (typeof modelId === "string" && modelId.trim()) {
          data.ai_model_id = modelId.trim();
        } else if (typeof data.ai_model_id !== "string" || !data.ai_model_id.trim()) {
          data.ai_model_id = "openrouter/free";
        }
        writeStore(data);
      },
      status: () => bridgeOr("/api/ai/status", {}, {
        configured: false,
        model: "openrouter/free",
        missing: ["OPENROUTER_API_KEY"],
        env: {
          OPENROUTER_API_KEY: "missing",
        },
        health: CURATED_MODELS.openrouter.map((entry) => ({
          model: entry.id,
          status: "not_configured",
          reason: "Electron preload unavailable in browser mode",
          checkedAt: null,
        })),
      }),
    },
    memory: {
      remember: async () => ({
        ok: false,
        skipped: true,
        reason: "Cognee memory is only available in the Electron app runtime.",
        stored: 0,
      }),
      recall: async () => ({
        ok: false,
        skipped: true,
        reason: "Cognee memory is only available in the Electron app runtime.",
        items: [],
      }),
      improve: async () => ({
        ok: false,
        skipped: true,
        reason: "Cognee memory is only available in the Electron app runtime.",
        accepted: false,
      }),
      forget: async () => ({
        ok: false,
        skipped: true,
        reason: "Cognee memory is only available in the Electron app runtime.",
        forgotten: false,
      }),
      status: async () => ({
        enabled: false,
        configured: false,
        endpointVerified: false,
        missing: ["COGNEE_API_URL"],
        auth: "none",
        requestTimeoutMs: 8_000,
        reason: "Electron preload unavailable in browser mode",
      }),
      usage: async () => ({
        ok: false,
        skipped: true,
        reason: "Cognee memory is only available in the Electron app runtime.",
        storageUsedInBytes: 0,
        storageLimitInBytes: 0,
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
      saveAIProvider: async (update) => {
        if (!update || typeof update !== "object") return;
        const payload = update as {
          providerId?: unknown;
          api_key?: string | null;
          base_url?: string | null;
        };
        if (typeof payload.providerId !== "string" || !PROVIDERS.includes(payload.providerId as AIProviderId)) {
          throw new Error("Provider id must be one of: openrouter, openai, anthropic, gemini, nvidia.");
        }
        writeProviderStatus(payload.providerId as AIProviderId, payload);
      },
      aiProviderStatus: async (providerId) => {
        const data = readStore();
        const statuses = readProviderStatusMap(data);
        if (typeof providerId === "string" && PROVIDERS.includes(providerId as AIProviderId)) {
          return { [providerId]: statuses[providerId as AIProviderId] } as Record<
            AIProviderId,
            AIProviderCredentialSourceStatus
          >;
        }
        return statuses;
      },
    },
  };

  Object.defineProperty(window, "api", {
    value: api,
    configurable: true,
  });
}
