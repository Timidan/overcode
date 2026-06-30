import type {
  AIModelCatalogEntry,
  AIProviderAdapter,
  AIProviderId,
} from "./ai-provider-types";

export const OPENROUTER_FREE_MODEL_ID = "openrouter/free";

export const providerDisplayNames: Record<AIProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

const providerBilled = {
  free: false,
  tags: ["paid"] as const,
};

const curatedModels: Record<AIProviderId, AIModelCatalogEntry[]> = {
  openrouter: [
    model("openrouter", OPENROUTER_FREE_MODEL_ID, "Free Models Router", true, [
      "free",
      "coding",
      "recommended",
    ], 200000),
    model("openrouter", "qwen/qwen3-coder:free", "Qwen3 Coder", true, [
      "free",
      "coding",
      "recommended",
      "long_context",
    ], 1048576),
    model("openrouter", "minimax/minimax-m3", "MiniMax M3", false, [
      "paid",
      "coding",
      "long_context",
    ], 1000000),
  ],
  openai: [
    model("openai", "gpt-4.1", "GPT-4.1", providerBilled.free, [
      "paid",
      "coding",
      "recommended",
      "long_context",
    ], 1047576),
    model("openai", "gpt-4.1-mini", "GPT-4.1 Mini", providerBilled.free, [
      "paid",
      "coding",
    ], 1047576),
  ],
  anthropic: [
    model("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", providerBilled.free, [
      "paid",
      "coding",
      "recommended",
      "long_context",
    ], 200000),
    model("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", providerBilled.free, [
      "paid",
      "coding",
    ], 200000),
  ],
  gemini: [
    model("gemini", "gemini-2.5-pro", "Gemini 2.5 Pro", providerBilled.free, [
      "paid",
      "coding",
      "recommended",
      "long_context",
      "vision",
    ], 1048576),
    model("gemini", "gemini-2.5-flash", "Gemini 2.5 Flash", providerBilled.free, [
      "paid",
      "coding",
      "vision",
    ], 1048576),
  ],
};

function model(
  providerId: AIProviderId,
  id: string,
  name: string,
  free: boolean,
  tags: AIModelCatalogEntry["tags"],
  contextLength?: number,
): AIModelCatalogEntry {
  return {
    providerId,
    id,
    name,
    free,
    contextLength,
    modalities: tags.includes("vision") ? ["text", "image"] : ["text"],
    tags,
    source: "curated",
  };
}

export function curatedModelsForProvider(providerId: AIProviderId): AIModelCatalogEntry[] {
  return curatedModels[providerId].map((entry) => ({ ...entry, tags: [...entry.tags] }));
}

export function normalizeOpenRouterCatalog(data: unknown): AIModelCatalogEntry[] {
  const rows = Array.isArray((data as { data?: unknown[] })?.data)
    ? ((data as { data: unknown[] }).data)
    : [];
  return rows
    .map((row) => {
      const item = row as {
        id?: unknown;
        name?: unknown;
        pricing?: { prompt?: unknown; completion?: unknown };
        context_length?: unknown;
        architecture?: { modality?: unknown };
      };
      if (typeof item.id !== "string") return null;
      const prompt = typeof item.pricing?.prompt === "string" ? item.pricing.prompt : undefined;
      const completion = typeof item.pricing?.completion === "string"
        ? item.pricing.completion
        : undefined;
      const free = prompt === "0" && completion === "0";
      const modalities = parseModalities(
        typeof item.architecture?.modality === "string"
          ? item.architecture.modality
          : "text->text",
      );
      const tags: AIModelCatalogEntry["tags"] = [
        free ? "free" : "paid",
        ...codingTags(item.id),
        ...longContextTags(item.context_length),
        ...(modalities.includes("image") ? ["vision" as const] : []),
      ];
      return {
        providerId: "openrouter" as const,
        id: item.id,
        name: typeof item.name === "string" ? item.name : item.id,
        free,
        pricing: { prompt, completion },
        contextLength: typeof item.context_length === "number" ? item.context_length : undefined,
        modalities,
        tags: Array.from(new Set(tags)),
        source: "live" as const,
      };
    })
    .filter((entry): entry is AIModelCatalogEntry => Boolean(entry));
}

function parseModalities(modality: string): string[] {
  const input = modality.split("->")[0] ?? "text";
  return input.split("+").map((part) => part.trim()).filter(Boolean);
}

function codingTags(id: string): AIModelCatalogEntry["tags"] {
  const lowered = id.toLowerCase();
  if (lowered.includes("coder") || lowered.includes("code") || lowered.includes("qwen")) {
    return ["coding", "recommended"];
  }
  return [];
}

function longContextTags(contextLength: unknown): AIModelCatalogEntry["tags"] {
  return typeof contextLength === "number" && contextLength >= 200000
    ? ["long_context"]
    : [];
}

export const providerAdapters = {} as Record<AIProviderId, AIProviderAdapter>;
