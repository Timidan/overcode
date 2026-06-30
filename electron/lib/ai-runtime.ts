import * as storeLib from "./store";
import {
  OPENROUTER_FREE_MODEL_ID,
  curatedModelsForProvider,
  providerAdapters,
} from "./ai-providers";
import type { AIProviderId } from "./ai-provider-types";

const supportedProviderIds: AIProviderId[] = [
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
];
const providerRequiredEnv = {
  openrouter: ["OPENROUTER_API_KEY"] as const,
  openai: ["OPENAI_API_KEY"] as const,
  anthropic: ["ANTHROPIC_API_KEY"] as const,
  gemini: ["GEMINI_API_KEY"] as const,
} as const;

export type RequiredAIEnv =
  | "OPENROUTER_API_KEY"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "GEMINI_API_KEY";
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
  env: Partial<Record<RequiredAIEnv, AIEnvStatus>>;
  health: AIModelHealth[];
}

const healthCache = new Map<string, AIModelHealth>();
const healthHistory = new Map<string, AIModelHealthHistoryEntry[]>();

function withHistory(
  providerId: AIProviderId,
  health: AIModelHealth,
): AIModelHealth {
  const list = healthHistory.get(cacheKey(providerId, health.model));
  return list && list.length > 0
    ? { ...health, history: list.slice() }
    : health;
}

export function configuredModel(): string {
  const providerId = configuredProvider();
  const fallbackModel = providerDefaultModel(providerId);
  try {
    const settings = storeLib.getStoreValue("settings") as
      | { ai_model_id?: string }
      | undefined;
    const savedModel = settings?.ai_model_id?.trim();
    if (savedModel) {
      return isModelCompatibleWithProvider(savedModel, providerId)
        ? savedModel
        : fallbackModel;
    }
  } catch {
    // Settings unreadable, so fall through to env/default.
  }
  if (providerId === "openrouter") {
    const envModel = process.env.OPENROUTER_MODEL?.trim();
    return envModel && isModelCompatibleWithProvider(envModel, providerId)
      ? envModel
      : fallbackModel;
  }
  return fallbackModel;
}

export function configuredProvider(): AIProviderId {
  try {
    const settings = storeLib.getStoreValue("settings") as
      | { ai_provider_id?: string }
      | undefined;
    if (isAIProviderId(settings?.ai_provider_id)) return settings.ai_provider_id;
  } catch {
    // Settings unreadable, so fall through to credential-based detection.
  }
  return fallbackProvider();
}

function isAIProviderId(value: unknown): value is AIProviderId {
  return typeof value === "string" && supportedProviderIds.includes(value as AIProviderId);
}

function fallbackProvider(): AIProviderId {
  for (const providerId of supportedProviderIds) {
    if (providerApiKey(providerId)) return providerId;
  }
  return "openrouter";
}

function providerApiKey(providerId: AIProviderId): string | undefined {
  try {
    const stored = storeLib.getAIProviderApiKey(providerId);
    if (stored) return stored;
  } catch {
    // Store unreachable, so fall through to env.
  }
  return providerEnvKey(providerId);
}

function providerBaseUrl(providerId: AIProviderId): string | undefined {
  try {
    const stored = storeLib.getAIProviderBaseUrl(providerId);
    if (stored) return stored.replace(/\/+$/, "");
  } catch {
    // Store unreachable, so fall through to env/default.
  }
  return providerId === "openrouter" && process.env.OPENROUTER_BASE_URL?.trim()
    ? process.env.OPENROUTER_BASE_URL.trim().replace(/\/+$/, "")
    : undefined;
}

function envStatus(providerId: AIProviderId): {
  missing: RequiredAIEnv[];
  env: Partial<Record<RequiredAIEnv, AIEnvStatus>>;
} {
  const envKeys = providerRequiredEnv[providerId];
  const configured = !!providerApiKey(providerId);
  const primaryEnvKey = envKeys[0];
  return {
    missing: configured ? [] : [primaryEnvKey],
    env: {
      [primaryEnvKey]: configured ? "configured" : "missing",
    },
  };
}

export async function aiConfigStatus(): Promise<AIStatus> {
  const providerId = configuredProvider();
  const { missing, env } = envStatus(providerId);
  const model = configuredModel();
  const configured = missing.length === 0;
  return {
    configured,
    model,
    missing,
    env,
    health: passiveModelHealthEntries(providerId, configured, missing, model),
  };
}

function uniqueModels(providerId: AIProviderId, activeModel: string): string[] {
  const curated = curatedModelsForProvider(providerId).map((entry) => entry.id);
  return Array.from(new Set([...curated, activeModel]));
}

function notConfiguredHealth(model: string, missing: RequiredAIEnv[]): AIModelHealth {
  return {
    model,
    status: "not_configured",
    reason: `Missing ${missing.join(", ")}`,
    checkedAt: null,
  };
}

function passiveModelHealthEntries(
  providerId: AIProviderId,
  configured: boolean,
  missing: RequiredAIEnv[],
  activeModel: string,
): AIModelHealth[] {
  const models = uniqueModels(providerId, activeModel);
  if (!configured) return models.map((model) => notConfiguredHealth(model, missing));
  return models.map((model) => passiveHealthForModel(providerId, model));
}

function passiveHealthForModel(providerId: AIProviderId, model: string): AIModelHealth {
  const key = cacheKey(providerId, model);
  const cached = healthCache.get(key);
  if (cached) return withHistory(providerId, cached);

  const history = healthHistory.get(key);
  if (history && history.length > 0) {
    const latest = history[history.length - 1];
    return {
      model,
      status: latest.status,
      checkedAt: latest.checkedAt,
      latencyMs: latest.latencyMs,
      reason: "Last known status from a prior active probe.",
      history: history.slice(),
    };
  }

  return {
    model,
    status: "unknown",
    reason: "Passive status is local only and skips provider health probes.",
    checkedAt: null,
  };
}

function cacheKey(providerId: AIProviderId, model: string): string {
  return `${providerId}:${model}`;
}

export async function callAIModel(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const providerId = configuredProvider();
  const adapter = providerAdapters[providerId];
  const key = providerApiKey(providerId);
  if (!key) throw new Error(`${adapter.displayName} API key is not configured.`);
  return adapter.completeChat({
    apiKey: key,
    baseUrl: providerBaseUrl(providerId),
    model: configuredModel(),
    systemPrompt,
    userPrompt,
    maxTokens: 800,
    temperature: 0,
  });
}

function providerDefaultModel(providerId: AIProviderId): string {
  return providerId === "openrouter"
    ? OPENROUTER_FREE_MODEL_ID
    : providerAdapters[providerId].defaultModel;
}

function isModelCompatibleWithProvider(modelId: string, providerId: AIProviderId): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return false;
  if (providerId === "openrouter") return true;

  if (normalized.includes("/")) return false;

  switch (providerId) {
    case "openai":
      return !startsWithAny(normalized, ["claude-", "gemini-"]);
    case "anthropic":
      return !startsWithAny(normalized, ["gpt-", "gemini-", "o1", "o3", "o4"]);
    case "gemini":
      return !startsWithAny(normalized, ["gpt-", "claude-", "o1", "o3", "o4"]);
  }
}

function startsWithAny(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function providerEnvKey(providerId: AIProviderId): string | undefined {
  switch (providerId) {
    case "openrouter":
      return process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER?.trim() || undefined;
    case "openai":
      return process.env.OPENAI_API_KEY?.trim() || undefined;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
    case "gemini":
      return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || undefined;
  }
}
