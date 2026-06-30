import type {
  AIChatRequest,
  AIModelCatalogEntry,
  AIProviderAdapter,
  AIProviderId,
  AIProviderCredentials,
  AIModelHealth,
} from "./ai-provider-types";

export const OPENROUTER_FREE_MODEL_ID = "openrouter/free";

export const providerDisplayNames: Record<AIProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

const defaultBaseUrls: Record<AIProviderId, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

const providerBilled = {
  free: false,
  tags: ["paid"] as const,
};

const curatedModels: Record<AIProviderId, AIModelCatalogEntry[]> = {
  openrouter: [
    model("openrouter", OPENROUTER_FREE_MODEL_ID, "Free Models Router", true, [
      "free",
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
  return curatedModels[providerId].map((entry) => ({
    ...entry,
    tags: [...entry.tags],
    modalities: [...entry.modalities],
  }));
}

export function normalizeOpenRouterCatalog(data: unknown): AIModelCatalogEntry[] {
  const rows = Array.isArray((data as { data?: unknown[] })?.data)
    ? ((data as { data: unknown[] }).data)
    : [];
  const catalog: AIModelCatalogEntry[] = [];
  for (const row of rows) {
    const item = row as {
      id?: unknown;
      name?: unknown;
      pricing?: { prompt?: unknown; completion?: unknown };
      context_length?: unknown;
      architecture?: { modality?: unknown };
    };
    if (typeof item.id !== "string") continue;
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
    catalog.push({
      providerId: "openrouter",
      id: item.id,
      name: typeof item.name === "string" ? item.name : item.id,
      free,
      pricing: { prompt, completion },
      contextLength: typeof item.context_length === "number" ? item.context_length : undefined,
      modalities,
      tags: Array.from(new Set(tags)),
      source: "live",
    });
  }
  return catalog;
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

function cleanBaseUrl(baseUrl: string | undefined, providerId: AIProviderId): string {
  return (baseUrl || defaultBaseUrls[providerId]).replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

function extractOpenAIContent(data: unknown): string {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part && typeof part.text === "string"
          ? part.text
          : "")
      .join("\n");
  }
  return "";
}

function extractAnthropicContent(data: unknown): string {
  return ((data as { content?: Array<{ type?: string; text?: string }> }).content ?? [])
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
}

function extractGeminiContent(data: unknown): string {
  return ((data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("\n");
}

async function openAICompatibleChat(
  providerId: "openrouter" | "openai",
  request: AIChatRequest,
): Promise<string> {
  const response = await fetch(`${cleanBaseUrl(request.baseUrl, providerId)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(providerId === "openrouter"
        ? {
            "HTTP-Referer": "https://github.com/Timidan/overcode",
            "X-Title": "Overcode",
          }
        : {}),
    },
    body: JSON.stringify({
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    }),
  });
  if (!response.ok) throw new Error(`${providerDisplayNames[providerId]} returned ${response.status}`);
  const text = extractOpenAIContent(await readJson(response)).trim();
  if (!text) throw new Error(`${providerDisplayNames[providerId]} returned an empty response`);
  return text;
}

async function anthropicChat(request: AIChatRequest): Promise<string> {
  const response = await fetch(`${cleanBaseUrl(request.baseUrl, "anthropic")}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": request.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: request.model,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    }),
  });
  if (!response.ok) throw new Error("Anthropic returned " + response.status);
  const text = extractAnthropicContent(await readJson(response)).trim();
  if (!text) throw new Error("Anthropic returned an empty response");
  return text;
}

async function geminiChat(request: AIChatRequest): Promise<string> {
  const baseUrl = cleanBaseUrl(request.baseUrl, "gemini");
  const response = await fetch(
    `${baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(request.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: request.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: request.userPrompt }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
        },
      }),
    },
  );
  if (!response.ok) throw new Error("Gemini returned " + response.status);
  const text = extractGeminiContent(await readJson(response)).trim();
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

async function curatedListModels(providerId: AIProviderId): Promise<AIModelCatalogEntry[]> {
  return curatedModelsForProvider(providerId);
}

async function providerHealthCheck(
  providerId: AIProviderId,
  credentials: AIProviderCredentials,
  modelId: string,
): Promise<AIModelHealth> {
  if (!credentials.apiKey) {
    return {
      model: modelId,
      status: "not_configured",
      reason: "API key is not configured",
      checkedAt: null,
    };
  }
  const checkedAt = Date.now();
  const startedAt = checkedAt;
  try {
    await providerAdapters[providerId].completeChat({
      apiKey: credentials.apiKey,
      baseUrl: credentials.baseUrl,
      model: modelId,
      systemPrompt: "Health check.",
      userPrompt: "Reply with ok.",
      maxTokens: 1,
      temperature: 0,
    } as AIChatRequest);
    return {
      model: modelId,
      status: "available",
      checkedAt,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Health check failed";
    return {
      model: modelId,
      status: "unavailable",
      reason,
      checkedAt,
      latencyMs: Date.now() - startedAt,
    };
  }
}

export async function listProviderModels(providerId: AIProviderId): Promise<AIModelCatalogEntry[]> {
  return curatedListModels(providerId);
}

export const providerAdapters: Record<AIProviderId, AIProviderAdapter> = {
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    defaultBaseUrl: defaultBaseUrls.openrouter,
    defaultModel: OPENROUTER_FREE_MODEL_ID,
    listModels: () => curatedListModels("openrouter"),
    healthCheck: (credentials, modelId) =>
      providerHealthCheck("openrouter", credentials, modelId),
    completeChat: (request) => openAICompatibleChat("openrouter", request),
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    defaultBaseUrl: defaultBaseUrls.openai,
    defaultModel: "gpt-4.1",
    listModels: () => curatedListModels("openai"),
    healthCheck: (credentials, modelId) =>
      providerHealthCheck("openai", credentials, modelId),
    completeChat: (request) => openAICompatibleChat("openai", request),
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    defaultBaseUrl: defaultBaseUrls.anthropic,
    defaultModel: "claude-sonnet-4-5",
    listModels: () => curatedListModels("anthropic"),
    healthCheck: (credentials, modelId) =>
      providerHealthCheck("anthropic", credentials, modelId),
    completeChat: anthropicChat,
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini",
    defaultBaseUrl: defaultBaseUrls.gemini,
    defaultModel: "gemini-2.5-pro",
    listModels: () => curatedListModels("gemini"),
    healthCheck: (credentials, modelId) =>
      providerHealthCheck("gemini", credentials, modelId),
    completeChat: geminiChat,
  },
};
