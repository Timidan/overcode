import type {
  AIChatRequest,
  AIProviderAccountStatus,
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
  nvidia: "NVIDIA NIM",
};

const defaultBaseUrls: Record<AIProviderId, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  nvidia: "https://integrate.api.nvidia.com/v1",
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
  nvidia: [
    model(
      "nvidia",
      "meta/llama-4-maverick-17b-128e-instruct",
      "Meta: Llama 4 Maverick",
      providerBilled.free,
      ["paid", "recommended", "long_context"],
    ),
    model(
      "nvidia",
      "qwen/qwen3-next-80b-a3b-instruct",
      "Qwen: Qwen3 Next 80B",
      providerBilled.free,
      ["paid", "coding", "recommended", "long_context"],
    ),
    model(
      "nvidia",
      "mistralai/mistral-large-3-675b-instruct-2512",
      "Mistral: Large 3",
      providerBilled.free,
      ["paid", "recommended", "long_context"],
    ),
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

export function normalizeNvidiaCatalog(data: unknown): AIModelCatalogEntry[] {
  const rows = Array.isArray((data as { data?: unknown[] })?.data)
    ? ((data as { data: unknown[] }).data)
    : [];
  const catalog: AIModelCatalogEntry[] = [];
  for (const row of rows) {
    const item = row as {
      id?: unknown;
      root?: unknown;
      object?: unknown;
    };
    const id = typeof item.id === "string"
      ? item.id
      : typeof item.root === "string"
        ? item.root
        : undefined;
    if (!id) continue;
    const tags: AIModelCatalogEntry["tags"] = [
      "paid",
      ...nvidiaRecommendedTags(id),
      ...codingTags(id),
      ...nvidiaLongContextTags(id),
    ];
    catalog.push({
      providerId: "nvidia",
      id,
      name: nvidiaModelName(id),
      free: false,
      modalities: ["text"],
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

function nvidiaRecommendedTags(id: string): AIModelCatalogEntry["tags"] {
  const recommended = new Set([
    "meta/llama-4-maverick-17b-128e-instruct",
    "qwen/qwen3-next-80b-a3b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ]);
  return recommended.has(id.toLowerCase()) ? ["recommended"] : [];
}

function nvidiaLongContextTags(id: string): AIModelCatalogEntry["tags"] {
  const lowered = id.toLowerCase();
  return lowered.includes("llama-4-maverick") ||
    lowered.includes("qwen3-next") ||
    lowered.includes("mistral-large-3")
    ? ["long_context"]
    : [];
}

function nvidiaModelName(id: string): string {
  const curated = curatedModels.nvidia.find((entry) => entry.id === id);
  if (curated) return curated.name;

  const [vendor, rawModel = id] = id.split("/", 2);
  const vendorName = vendor
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const modelName = rawModel
    .split("-")
    .map((part) => /^[0-9]+[a-z]?$/i.test(part)
      ? part.toUpperCase()
      : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return `${vendorName}: ${modelName}`;
}

function cleanBaseUrl(baseUrl: string | undefined, providerId: AIProviderId): string {
  return (baseUrl || defaultBaseUrls[providerId]).replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

async function readProviderError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  let reason = "";
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    if (typeof parsed.error?.message === "string") reason = parsed.error.message;
    else if (typeof parsed.message === "string") reason = parsed.message;
  } catch {
    reason = body;
  }
  return sanitizeProviderError(reason || response.statusText);
}

function sanitizeProviderError(value: string): string {
  return value
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function providerErrorMessage(providerId: AIProviderId, response: Response, reason: string): string {
  return `${providerDisplayNames[providerId]} returned ${response.status}${reason ? `: ${reason}` : ""}`;
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
  providerId: "openrouter" | "openai" | "nvidia",
  request: AIChatRequest,
): Promise<string> {
  const response = await fetch(`${cleanBaseUrl(request.baseUrl, providerId)}/chat/completions`, {
    method: "POST",
    signal: request.signal,
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
  if (!response.ok) {
    throw new Error(providerErrorMessage(
      providerId,
      response,
      await readProviderError(response),
    ));
  }
  const text = extractOpenAIContent(await readJson(response)).trim();
  if (!text) throw new Error(`${providerDisplayNames[providerId]} returned an empty response`);
  return text;
}

async function anthropicChat(request: AIChatRequest): Promise<string> {
  const response = await fetch(`${cleanBaseUrl(request.baseUrl, "anthropic")}/messages`, {
    method: "POST",
    signal: request.signal,
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
      signal: request.signal,
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

async function openRouterListModels(
  credentials: AIProviderCredentials,
): Promise<AIModelCatalogEntry[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (credentials.apiKey) {
    headers.Authorization = `Bearer ${credentials.apiKey}`;
  }

  const response = await fetch(`${cleanBaseUrl(credentials.baseUrl, "openrouter")}/models`, {
    headers,
  });
  if (!response.ok) throw new Error(`OpenRouter model catalog returned ${response.status}`);

  const models = normalizeOpenRouterCatalog(await readJson(response));
  if (models.length === 0) throw new Error("OpenRouter returned an empty model catalog");
  return models;
}

async function nvidiaListModels(
  credentials: AIProviderCredentials,
): Promise<AIModelCatalogEntry[]> {
  if (!credentials.apiKey) return curatedListModels("nvidia");

  const headers: Record<string, string> = { Accept: "application/json" };
  headers.Authorization = `Bearer ${credentials.apiKey}`;

  const response = await fetch(`${cleanBaseUrl(credentials.baseUrl, "nvidia")}/models`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(providerErrorMessage(
      "nvidia",
      response,
      await readProviderError(response),
    ));
  }

  const models = normalizeNvidiaCatalog(await readJson(response));
  if (models.length === 0) throw new Error("NVIDIA NIM returned an empty model catalog");
  return models;
}

export async function readOpenRouterKeyStatus(
  credentials: AIProviderCredentials,
): Promise<AIProviderAccountStatus | undefined> {
  if (!credentials.apiKey) return undefined;
  const response = await fetch(`${cleanBaseUrl(credentials.baseUrl, "openrouter")}/key`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${credentials.apiKey}`,
    },
  });
  if (!response.ok) {
    return {
      plan: "unknown",
      checkedAt: Date.now(),
      freeModelNote: providerErrorMessage(
        "openrouter",
        response,
        await readProviderError(response),
      ),
    };
  }

  const data = (await readJson(response) as { data?: Record<string, unknown> }).data ?? {};
  const isFreeTier = typeof data.is_free_tier === "boolean" ? data.is_free_tier : undefined;
  return {
    plan: isFreeTier === undefined ? "unknown" : isFreeTier ? "free" : "paid",
    isFreeTier,
    freeModelDailyLimit: isFreeTier === false ? 1000 : isFreeTier === true ? 50 : undefined,
    freeModelNote: isFreeTier === false
      ? "OpenRouter accounts with at least 10 purchased credits can make up to 1000 free-model requests per day."
      : isFreeTier === true
        ? "Free-tier OpenRouter keys are capped at 50 free-model requests per day. Add 10 credits to unlock 1000 free-model requests per day."
        : "OpenRouter key status did not include free-tier quota details.",
    limit: typeof data.limit === "number" || data.limit === null ? data.limit : undefined,
    limitRemaining:
      typeof data.limit_remaining === "number" || data.limit_remaining === null
        ? data.limit_remaining
        : undefined,
    usage: typeof data.usage === "number" ? data.usage : undefined,
    usageDaily: typeof data.usage_daily === "number" ? data.usage_daily : undefined,
    checkedAt: Date.now(),
  };
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

export async function listProviderModels(
  providerId: AIProviderId,
  credentials: AIProviderCredentials = {},
): Promise<AIModelCatalogEntry[]> {
  return providerAdapters[providerId].listModels(credentials);
}

export const providerAdapters: Record<AIProviderId, AIProviderAdapter> = {
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    defaultBaseUrl: defaultBaseUrls.openrouter,
    defaultModel: OPENROUTER_FREE_MODEL_ID,
    listModels: openRouterListModels,
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
  nvidia: {
    id: "nvidia",
    displayName: "NVIDIA NIM",
    defaultBaseUrl: defaultBaseUrls.nvidia,
    defaultModel: "meta/llama-4-maverick-17b-128e-instruct",
    listModels: nvidiaListModels,
    healthCheck: (credentials, modelId) =>
      providerHealthCheck("nvidia", credentials, modelId),
    completeChat: (request) => openAICompatibleChat("nvidia", request),
  },
};
