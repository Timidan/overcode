import * as storeLib from "./store";

const DEFAULT_MODEL_ID = "openrouter/free";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const KNOWN_MODELS = [
  "openrouter/free",
  "minimax/minimax-m3",
  "qwen/qwen3-coder:free",
  "meta-llama/llama-3.3-70b-instruct:free",
] as const;
const REQUIRED_ENV = ["OPENROUTER_API_KEY"] as const;
const HEALTH_CACHE_TTL_MS = 10 * 60 * 1000;
const HEALTH_PROBE_TIMEOUT_MS = 8_000;
const HEALTH_HISTORY_LIMIT = 5;

export type RequiredAIEnv = (typeof REQUIRED_ENV)[number];
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

const healthCache = new Map<
  string,
  { expiresAt: number; value: AIModelHealth }
>();
const healthHistory = new Map<string, AIModelHealthHistoryEntry[]>();

function recordHealthHistory(health: AIModelHealth): AIModelHealthHistoryEntry[] {
  const list = healthHistory.get(health.model) ?? [];
  list.push({
    status: health.status,
    checkedAt: health.checkedAt ?? Date.now(),
    latencyMs: health.latencyMs,
  });
  while (list.length > HEALTH_HISTORY_LIMIT) list.shift();
  healthHistory.set(health.model, list);
  return list;
}

function withHistory(health: AIModelHealth): AIModelHealth {
  const list = healthHistory.get(health.model);
  return list && list.length > 0
    ? { ...health, history: list.slice() }
    : health;
}

export function configuredModel(): string {
  try {
    const settings = storeLib.getStoreValue("settings") as
      | { ai_model_id?: string }
      | undefined;
    if (settings?.ai_model_id && settings.ai_model_id.trim()) {
      return settings.ai_model_id.trim();
    }
  } catch {
    // Settings unreadable, so fall through to env/default.
  }
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL_ID;
}

function apiKey(): string | undefined {
  try {
    const stored = storeLib.getOpenRouterApiKey();
    if (stored) return stored;
  } catch {
    // Store unreachable, so fall through to env.
  }
  return process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER?.trim() || undefined;
}

function baseUrl(): string {
  try {
    const stored = storeLib.getOpenRouterBaseUrl();
    if (stored) return stored.replace(/\/+$/, "");
  } catch {
    // Store unreachable, so fall through to env/default.
  }
  return (process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function envStatus(): {
  missing: RequiredAIEnv[];
  env: Record<RequiredAIEnv, AIEnvStatus>;
} {
  const configured = !!apiKey();
  return {
    missing: configured ? [] : ["OPENROUTER_API_KEY"],
    env: {
      OPENROUTER_API_KEY: configured ? "configured" : "missing",
    },
  };
}

export async function aiConfigStatus(): Promise<AIStatus> {
  const { missing, env } = envStatus();
  const model = configuredModel();
  const configured = missing.length === 0;
  return {
    configured,
    model,
    missing,
    env,
    health: await modelHealthEntries(configured, missing, model),
  };
}

function uniqueModels(activeModel: string): string[] {
  return Array.from(new Set([...KNOWN_MODELS, activeModel]));
}

function notConfiguredHealth(model: string, missing: RequiredAIEnv[]): AIModelHealth {
  return {
    model,
    status: "not_configured",
    reason: `Missing ${missing.join(", ")}`,
    checkedAt: null,
  };
}

function unknownHealth(
  model: string,
  reason: string,
  checkedAt: number,
): AIModelHealth {
  return {
    model,
    status: "unknown",
    reason,
    checkedAt,
  };
}

async function modelHealthEntries(
  configured: boolean,
  missing: RequiredAIEnv[],
  activeModel: string,
): Promise<AIModelHealth[]> {
  const models = uniqueModels(activeModel);
  if (!configured) return models.map((model) => notConfiguredHealth(model, missing));

  const checkedAt = Date.now();
  const healthByModel = new Map<string, AIModelHealth>();
  const modelsToProbe: string[] = [];
  for (const model of models) {
    const cached = healthCache.get(model);
    if (cached && cached.expiresAt > checkedAt) {
      healthByModel.set(model, cached.value);
    } else {
      modelsToProbe.push(model);
    }
  }

  if (modelsToProbe.length === 0) {
    return orderedHealthEntries(models, healthByModel, checkedAt);
  }

  const probed = await Promise.all(
    modelsToProbe.map((model) => probeAndCacheModel(model, checkedAt)),
  );
  for (const health of probed) healthByModel.set(health.model, health);
  return orderedHealthEntries(models, healthByModel, checkedAt);
}

function orderedHealthEntries(
  models: string[],
  healthByModel: Map<string, AIModelHealth>,
  checkedAt: number,
): AIModelHealth[] {
  return models.map((model) =>
    withHistory(
      healthByModel.get(model) ??
        unknownHealth(model, "Health probe failed", checkedAt),
    ),
  );
}

async function probeAndCacheModel(
  model: string,
  checkedAt: number,
): Promise<AIModelHealth> {
  const value = await probeModel(model, checkedAt);
  recordHealthHistory(value);
  healthCache.set(model, {
    value,
    expiresAt: checkedAt + HEALTH_CACHE_TTL_MS,
  });
  return value;
}

async function probeModel(model: string, checkedAt: number): Promise<AIModelHealth> {
  const key = apiKey();
  if (!key) return notConfiguredHealth(model, ["OPENROUTER_API_KEY"]);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: requestHeaders(key),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "health check" }],
        max_tokens: 1,
        temperature: 0,
      }),
    });
    await discardBody(response);
    const latencyMs = Date.now() - startedAt;
    if (response.ok) return { model, status: "available", checkedAt, latencyMs };
    return {
      model,
      status: "unavailable",
      reason: sanitizeHttpStatus(response.status),
      checkedAt,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      ...unknownHealth(model, sanitizeRequestError(error), checkedAt),
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function requestHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": "https://github.com/Timidan/overcode",
    "X-Title": "Overcode",
  };
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // Health checks only need the status code.
  }
}

function sanitizeHttpStatus(status: number): string {
  if (status === 400) return "Model request was rejected";
  if (status === 401 || status === 403) return "OpenRouter credentials rejected";
  if (status === 404) return "Model is not available";
  if (status === 429) return "OpenRouter rate limit reached";
  if (status >= 500) return "OpenRouter service error";
  return `OpenRouter returned HTTP ${status}`;
}

function sanitizeRequestError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Probe timed out";
    const message = error.message.toLowerCase();
    if (message.includes("missing")) return "OpenRouter configuration is incomplete";
    if (message.includes("fetch") || message.includes("network")) {
      return "Network request failed";
    }
  }
  return "Health probe failed";
}

export async function callAIModel(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const key = apiKey();
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. Set OPENROUTER_API_KEY or OPENROUTER, or enter an API key under Settings → AI.",
    );
  }

  const modelId = configuredModel();
  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: requestHeaders(key),
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 800,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenRouter (${modelId}) returned ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const generated = extractChatContent(data);
  if (typeof generated !== "string" || !generated.trim()) {
    throw new Error("OpenRouter returned an unexpected payload shape");
  }
  return generated;
}

function extractChatContent(data: unknown): string | undefined {
  const choice = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return undefined;
}
