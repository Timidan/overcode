// watsonx.ai Granite client. Default targets a 2026-current Granite 4 model;
// user can override per-app via Settings UI (settings.watsonx_model_id), or via
// WATSONX_MODEL_ID env. ibm/granite-3-8b-instruct was withdrawn 2026-02-22.
import * as storeLib from "./store";

const DEFAULT_MODEL_ID = "ibm/granite-4-h-small";
// Granite-only allowlist. The hackathon scores on watsonx.ai Granite usage,
// and showing a non-Granite model in the Settings health panel dilutes the
// attribution narrative. If you ever want to fall back to a different vendor,
// add it back here and the rest of the health-probe machinery just works.
const KNOWN_MODELS = [
  "ibm/granite-4-h-small",
  "ibm/granite-3-3-8b-instruct",
  "ibm/granite-3-2-8b-instruct",
] as const;
const REQUIRED_ENV = [
  "WATSONX_API_KEY",
  "WATSONX_PROJECT_ID",
  "WATSONX_URL",
] as const;
const HEALTH_CACHE_TTL_MS = 10 * 60 * 1000;
const HEALTH_PROBE_TIMEOUT_MS = 8_000;
const HEALTH_HISTORY_LIMIT = 5;
const WATSONX_API_VERSION = "2023-05-29";

export type RequiredWatsonxEnv = (typeof REQUIRED_ENV)[number];
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

let tokenCache: { token: string | null; expiresAt: number } = {
  token: null,
  expiresAt: 0,
};

const healthCache = new Map<
  string,
  { expiresAt: number; value: AIModelHealth }
>();

// Rolling per-model history of the most recent probe resolutions (cap = 5).
// Keyed by model id; oldest entry is shifted off when full.
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
      | { watsonx_model_id?: string }
      | undefined;
    if (settings?.watsonx_model_id && settings.watsonx_model_id.trim()) {
      return settings.watsonx_model_id.trim();
    }
  } catch {
    // Settings unreadable — fall through to env / default.
  }
  return process.env.WATSONX_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
}

// Credential resolution: stored credentials (entered through the Settings UI
// and persisted in electron-store, encrypted via safeStorage when available)
// take precedence over process.env. The env path remains useful for `npm run
// dev` workflows that load a local .env, and for CI/test harnesses.
function envValue(name: RequiredWatsonxEnv): string | undefined {
  try {
    switch (name) {
      case "WATSONX_API_KEY": {
        const stored = storeLib.getWatsonxApiKey();
        if (stored) return stored;
        break;
      }
      case "WATSONX_PROJECT_ID": {
        const stored = storeLib.getWatsonxProjectId();
        if (stored) return stored;
        break;
      }
      case "WATSONX_URL": {
        const stored = storeLib.getWatsonxUrl();
        if (stored) return stored;
        break;
      }
    }
  } catch {
    // Store unreachable (e.g. very early init) — fall through to env.
  }
  const value = process.env[name]?.trim();
  return value || undefined;
}

function envStatus(): {
  missing: RequiredWatsonxEnv[];
  env: Record<RequiredWatsonxEnv, AIEnvStatus>;
} {
  const missing: RequiredWatsonxEnv[] = [];
  const env = {} as Record<RequiredWatsonxEnv, AIEnvStatus>;
  for (const name of REQUIRED_ENV) {
    const configured = !!envValue(name);
    env[name] = configured ? "configured" : "missing";
    if (!configured) missing.push(name);
  }
  return { missing, env };
}

function watsonxBaseUrl(): string | undefined {
  return envValue("WATSONX_URL")?.replace(/\/+$/, "");
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

async function getIAMToken(): Promise<string> {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 600_000) {
    return tokenCache.token;
  }

  const apiKey = envValue("WATSONX_API_KEY");
  if (!apiKey) {
    throw new Error(
      "WATSONX_API_KEY is not configured. Enter it under Settings → AI or set the WATSONX_API_KEY environment variable.",
    );
  }

  const tokenBody = new URLSearchParams({
    grant_type: "urn:ibm:params:oauth:grant-type:apikey",
    apikey: apiKey,
  });
  const response = await fetch("https://iam.cloud.ibm.com/identity/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenBody,
  });

  if (!response.ok) {
    throw new Error(
      `IAM token request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("IAM response missing access_token");
  }
  tokenCache = {
    token: data.access_token,
    expiresAt: (data.expiration ?? 0) * 1000,
  };

  return data.access_token;
}

function uniqueModels(activeModel: string): string[] {
  return Array.from(new Set([...KNOWN_MODELS, activeModel]));
}

function notConfiguredHealth(
  model: string,
  missing: RequiredWatsonxEnv[],
): AIModelHealth {
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
  missing: RequiredWatsonxEnv[],
  activeModel: string,
): Promise<AIModelHealth[]> {
  const models = uniqueModels(activeModel);
  if (!configured) {
    return models.map((model) => notConfiguredHealth(model, missing));
  }

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

  let token: string;
  try {
    token = await getIAMToken();
  } catch (error) {
    const reason = sanitizeProbeError(error);
    for (const model of modelsToProbe) {
      const health = unknownHealth(model, reason, checkedAt);
      recordHealthHistory(health);
      healthByModel.set(model, health);
      healthCache.set(model, {
        value: health,
        expiresAt: checkedAt + HEALTH_CACHE_TTL_MS,
      });
    }
    return orderedHealthEntries(models, healthByModel, checkedAt);
  }

  const probed = await Promise.all(
    modelsToProbe.map((model) => probeAndCacheModel(model, token, checkedAt)),
  );
  for (const health of probed) {
    healthByModel.set(health.model, health);
  }
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
  token: string,
  checkedAt: number,
): Promise<AIModelHealth> {
  const value = await probeModel(model, token, checkedAt);
  recordHealthHistory(value);
  healthCache.set(model, {
    value,
    expiresAt: checkedAt + HEALTH_CACHE_TTL_MS,
  });
  return value;
}

async function probeModel(
  model: string,
  token: string,
  checkedAt: number,
): Promise<AIModelHealth> {
  const baseUrl = watsonxBaseUrl();
  const projectId = envValue("WATSONX_PROJECT_ID");
  if (!baseUrl || !projectId) {
    return unknownHealth(
      model,
      "watsonx.ai configuration is incomplete",
      checkedAt,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(
      `${baseUrl}/ml/v1/chat/completions?version=${WATSONX_API_VERSION}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model,
          project_id: projectId,
          messages: [{ role: "user", content: "health check" }],
          max_tokens: 1,
          temperature: 0,
        }),
      },
    );
    await discardBody(response);
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      return { model, status: "available", checkedAt, latencyMs };
    }
    return {
      model,
      status: "unavailable",
      reason: sanitizeProbeHttpStatus(response.status),
      checkedAt,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      ...unknownHealth(model, sanitizeProbeError(error), checkedAt),
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // Health checks only need the status code; response bodies are intentionally ignored.
  }
}

function sanitizeProbeHttpStatus(status: number): string {
  if (status === 400) return "Model probe was rejected";
  if (status === 401 || status === 403) return "watsonx.ai credentials rejected";
  if (status === 404) return "Model is not available for this project";
  if (status === 429) return "watsonx.ai rate limit reached";
  if (status >= 500) return "watsonx.ai service error";
  return `watsonx.ai returned HTTP ${status}`;
}

function sanitizeProbeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Probe timed out";
    const message = error.message.toLowerCase();
    if (message.includes("iam token request failed")) {
      return "IAM token request failed";
    }
    if (message.includes("missing")) {
      return "watsonx.ai configuration is incomplete";
    }
    if (message.includes("fetch") || message.includes("network")) {
      return "Network request failed";
    }
  }
  return "Health probe failed";
}

export async function callGranite(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const WATSONX_URL = watsonxBaseUrl();
  const WATSONX_PROJECT_ID = envValue("WATSONX_PROJECT_ID");
  const modelId = configuredModel();

  if (!WATSONX_URL || !WATSONX_PROJECT_ID) {
    throw new Error(
      "WATSONX_URL or WATSONX_PROJECT_ID is not configured. Enter them under Settings → AI.",
    );
  }

  const token = await getIAMToken();

  try {
    const chatResult = await callGraniteChat(
      WATSONX_URL,
      WATSONX_PROJECT_ID,
      modelId,
      token,
      systemPrompt,
      userPrompt,
    );
    if (chatResult.trim()) return chatResult;
  } catch (error) {
    if (!isRecoverableChatFailure(error)) throw error;
  }

  return callGraniteTextGeneration(
    WATSONX_URL,
    WATSONX_PROJECT_ID,
    modelId,
    token,
    systemPrompt,
    userPrompt,
  );
}

async function callGraniteChat(
  WATSONX_URL: string,
  WATSONX_PROJECT_ID: string,
  modelId: string,
  token: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await fetch(
    `${WATSONX_URL}/ml/v1/chat/completions?version=${WATSONX_API_VERSION}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        project_id: WATSONX_PROJECT_ID,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 800,
        temperature: 0,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `watsonx.ai (${modelId}) returned ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const generated = extractChatContent(data);
  if (typeof generated !== "string") {
    throw new Error("watsonx.ai chat returned an unexpected payload shape");
  }
  return generated;
}

async function callGraniteTextGeneration(
  WATSONX_URL: string,
  WATSONX_PROJECT_ID: string,
  modelId: string,
  token: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await fetch(
    `${WATSONX_URL}/ml/v1/text/generation?version=${WATSONX_API_VERSION}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model_id: modelId,
        project_id: WATSONX_PROJECT_ID,
        input: `${systemPrompt}\n\n${userPrompt}`,
        parameters: {
          decoding_method: "greedy",
          max_new_tokens: 800,
          repetition_penalty: 1.05,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `watsonx.ai (${modelId}) returned ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const generated = data?.results?.[0]?.generated_text;
  if (typeof generated !== "string") {
    throw new Error("watsonx.ai returned an unexpected payload shape");
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

function isRecoverableChatFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("400") ||
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("unexpected payload shape")
  );
}
