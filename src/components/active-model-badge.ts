import type {
  AIModelHealthStatus,
  AIProviderId,
  AIProviderStatus,
  AIStatus,
} from "../lib/ipc";

export const ACTIVE_MODEL_CHANGED_EVENT = "overcode:active-model-changed";

export type ActiveModelTone =
  | "available"
  | "unavailable"
  | "not-configured"
  | "unknown";

export interface ActiveModelSummaryInput {
  aiStatus: AIStatus | null;
  providers: AIProviderStatus[];
  error?: string | null;
}

export interface ActiveModelSummary {
  providerId?: AIProviderId;
  providerLabel: string;
  visibleModel: string;
  fullModel: string;
  statusLabel: string;
  tone: ActiveModelTone;
  tooltipLines: string[];
}

const PROVIDER_NAMES: Record<AIProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  nvidia: "NVIDIA NIM",
};

const DROP_WORDS = new Set([
  "instruct",
  "preview",
  "latest",
  "free",
  "a3b",
  "a10b",
  "a12b",
  "128e",
  "17b",
  "675b",
  "2512",
]);

export function providerName(providerId: AIProviderId | undefined): string {
  return providerId ? PROVIDER_NAMES[providerId] : "AI";
}

export function shortModelLabel(modelId: string): string {
  const raw = modelId.trim();
  if (!raw) return "unknown model";
  const scoped = raw.includes("/") ? raw.split("/").slice(1).join("/") : raw;
  const normalized = scoped
    .replace(/:free$/i, "")
    .replace(/[_/]+/g, "-")
    .toLowerCase();
  const parts = normalized
    .split("-")
    .map((part) => part.trim())
    .filter((part) => part && !DROP_WORDS.has(part));
  return (parts.length > 0 ? parts : [normalized]).slice(0, 4).join(" ");
}

export function healthTone(status: AIModelHealthStatus | undefined): ActiveModelTone {
  if (status === "available") return "available";
  if (status === "unavailable") return "unavailable";
  if (status === "not_configured") return "not-configured";
  return "unknown";
}

export function buildActiveModelSummary({
  aiStatus,
  providers,
  error,
}: ActiveModelSummaryInput): ActiveModelSummary {
  if (error) {
    return {
      providerLabel: "AI",
      visibleModel: "unavailable",
      fullModel: "unknown",
      statusLabel: "Unavailable",
      tone: "unavailable",
      tooltipLines: ["AI status unavailable", `Error: ${error}`],
    };
  }

  const activeProvider = providers.find((provider) => provider.active);
  const model = aiStatus?.model?.trim() || "unknown";
  const providerLabel = providerName(activeProvider?.providerId);
  const modelHealth = aiStatus?.health.find((entry) => entry.model === model)?.status;
  const tone = aiStatus?.configured === false
    ? "not-configured"
    : healthTone(modelHealth ?? activeProvider?.health);
  const statusLabel = aiStatus?.configured === false
    ? "Not configured"
    : tone === "available"
      ? "Available"
      : tone === "unavailable"
        ? "Unavailable"
        : "Configured";
  const credentialSource = activeProvider?.credentialSource ?? "unknown";
  const health = modelHealth ?? activeProvider?.health ?? "unknown";
  const tooltipLines = [
    `Provider: ${providerLabel}`,
    `Model: ${model}`,
    `Credentials: ${credentialSource}`,
    `Health: ${health}`,
  ];

  if (aiStatus && aiStatus.missing.length > 0) {
    tooltipLines.push(`Missing: ${aiStatus.missing.join(", ")}`);
  }

  return {
    providerId: activeProvider?.providerId,
    providerLabel,
    visibleModel: shortModelLabel(model),
    fullModel: model,
    statusLabel,
    tone,
    tooltipLines,
  };
}
