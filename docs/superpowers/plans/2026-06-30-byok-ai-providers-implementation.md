# BYOK AI Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished BYOK AI provider experience where users can save keys for OpenRouter, OpenAI, Anthropic, and Gemini, choose one active provider/model, use free or paid models knowingly, and see Cognee memory branding in the Settings surface.

**Architecture:** Add a main-process provider adapter layer that hides provider-specific chat, health, credential, and catalog differences behind one runtime interface. Keep the existing renderer AI feature API stable while Settings gets provider cards, real/local logos, catalog-backed model selection, paid/free labels, and Cognee memory retention copy.

**Tech Stack:** Electron 30, React 18, TypeScript, vanilla CSS, electron-store, Electron safeStorage, Vitest, existing IPC/preload bridge, existing Phosphor icons only for generic actions.

## Global Constraints

- Preserve the current renderer-level `ipc.callAIModel(systemPrompt, userPrompt)` contract for existing AI features.
- Support multiple saved provider keys, but exactly one active provider/model at runtime.
- OpenRouter remains the default provider when a key exists and no explicit active provider is set.
- Store raw provider keys only in the main-process encrypted settings path; never return raw keys to the renderer.
- Use local provider logo assets. Do not fetch logos from remote CDNs at runtime.
- Paid models are allowed. The UI must mark paid/provider-billed models clearly before saving.
- Cognee remains memory/retrieval only. Provider keys, raw prompts, and raw model responses must never be written to Cognee.
- Keep the app free of previous-hackathon provider references except unavoidable upstream legal license notices in generated Electron artifacts.
- Settings UI must remain a dense operational settings surface, not a landing page.

---

## File Structure

Create:

- `electron/lib/ai-provider-types.ts`  
  Shared main-process provider IDs, model catalog types, health types, credential types, and adapter interface.

- `electron/lib/ai-providers.ts`  
  Provider registry and adapter implementations for OpenRouter, OpenAI, Anthropic, and Gemini.

- `electron/lib/ai-providers.test.ts`  
  Main-process tests for provider selection, request shape, catalog normalization, credential redaction, and paid/free classification.

- `src/components/AIProviderLogo.tsx`  
  Renderer component that maps provider IDs to local SVG assets.

- `src/components/AIProviderLogo.css`  
  Size, contrast, and fallback wordmark treatment for provider/Cognee logos.

- `src/components/AIProviderSettings.tsx`  
  Renderer BYOK provider cards, configure panel, model catalog picker, paid warning, and manual model entry.

- `src/components/AIProviderSettings.css`  
  Dense Settings UI styles for provider grid, model rows, filters, loading, empty, and error states.

- `src/assets/providers/openrouter.svg`
- `src/assets/providers/openai.svg`
- `src/assets/providers/anthropic.svg`
- `src/assets/providers/gemini.svg`
- `src/assets/providers/cognee.svg`  
  Local logo assets. Use official redistributable marks where licensing permits; otherwise use a simple local wordmark using the provider name.

Modify:

- `electron/lib/store.ts`  
  Replace OpenRouter-specific secret helpers with generic provider secret helpers and migrate existing OpenRouter fields.

- `electron/lib/ai-runtime.ts`  
  Replace OpenRouter-only runtime with provider registry resolution while keeping exported `configuredModel`, `aiConfigStatus`, and `callAIModel`.

- `electron/ipc-handlers.ts`  
  Add provider/model catalog IPC handlers and update settings credential handlers.

- `electron/preload.ts`  
  Expose typed provider APIs.

- `src/lib/ipc.ts`  
  Add renderer-safe provider/model types and methods.

- `src/lib/browser-api-fallback.ts`  
  Mirror provider status/catalog fallback for browser-mode layout testing.

- `src/screens/Settings.tsx`  
  Replace current inline OpenRouter Settings block with `AIProviderSettings`; add Cognee memory retention branding.

- `src/screens/Settings.css`  
  Remove or reduce old AI runtime styles after moving provider UI to component CSS.

- `.env.example`  
  Add OpenAI, Anthropic, and Gemini BYOK keys; keep OpenRouter aliases.

- `README.md`  
  Document multi-provider BYOK behavior and paid-model warning.

- `scripts/smoke-openrouter.mjs`  
  Keep existing OpenRouter smoke. Do not print keys.

---

### Task 1: Provider Types And Catalog Normalization

**Files:**
- Create: `electron/lib/ai-provider-types.ts`
- Create: `electron/lib/ai-providers.test.ts`
- Create: `electron/lib/ai-providers.ts`

**Interfaces:**
- Produces:
  - `AIProviderId`
  - `AIProviderCredentialSource`
  - `AIProviderStatus`
  - `AIModelCatalogEntry`
  - `AIProviderAdapter`
  - `OPENROUTER_FREE_MODEL_ID`
  - `providerDisplayNames`
  - `normalizeOpenRouterCatalog(data: unknown): AIModelCatalogEntry[]`
  - `curatedModelsForProvider(providerId: AIProviderId): AIModelCatalogEntry[]`

- [ ] **Step 1: Write failing tests for model normalization**

Add this to `electron/lib/ai-providers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  curatedModelsForProvider,
  normalizeOpenRouterCatalog,
  OPENROUTER_FREE_MODEL_ID,
} from "./ai-providers";

describe("AI provider model catalogs", () => {
  it("classifies OpenRouter free and paid models from pricing", () => {
    const result = normalizeOpenRouterCatalog({
      data: [
        {
          id: "qwen/qwen3-coder:free",
          name: "Qwen: Qwen3 Coder 480B A35B (free)",
          pricing: { prompt: "0", completion: "0" },
          context_length: 1048576,
          architecture: { modality: "text->text" },
        },
        {
          id: "minimax/minimax-m3",
          name: "MiniMax: MiniMax M3",
          pricing: { prompt: "0.0000003", completion: "0.0000012" },
          context_length: 1000000,
          architecture: { modality: "text->text" },
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        providerId: "openrouter",
        id: "qwen/qwen3-coder:free",
        free: true,
        contextLength: 1048576,
        tags: expect.arrayContaining(["free", "coding", "recommended"]),
      }),
      expect.objectContaining({
        providerId: "openrouter",
        id: "minimax/minimax-m3",
        free: false,
        tags: expect.arrayContaining(["paid"]),
      }),
    ]);
  });

  it("returns curated fallback models for every supported provider", () => {
    expect(OPENROUTER_FREE_MODEL_ID).toBe("openrouter/free");
    expect(curatedModelsForProvider("openrouter").map((m) => m.id)).toContain("openrouter/free");
    expect(curatedModelsForProvider("openai").length).toBeGreaterThan(0);
    expect(curatedModelsForProvider("anthropic").length).toBeGreaterThan(0);
    expect(curatedModelsForProvider("gemini").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run electron/lib/ai-providers.test.ts
```

Expected: fail because `electron/lib/ai-providers.ts` does not export the requested helpers yet.

- [ ] **Step 3: Add provider types**

Create `electron/lib/ai-provider-types.ts`:

```ts
export type AIProviderId = "openrouter" | "openai" | "anthropic" | "gemini";

export type AIProviderCredentialSource = "stored" | "env" | "none";

export type AIProviderBaseUrlSource = "stored" | "env" | "default" | "none";

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

export interface AIProviderStatus {
  providerId: AIProviderId;
  configured: boolean;
  active: boolean;
  credentialSource: AIProviderCredentialSource;
  baseUrlSource?: AIProviderBaseUrlSource;
  health: AIModelHealthStatus;
  reason?: string;
}

export interface AIProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
}

export interface AIProviderCredentialUpdate {
  providerId: AIProviderId;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export type AIModelTag =
  | "recommended"
  | "coding"
  | "long_context"
  | "vision"
  | "paid"
  | "free";

export interface AIModelCatalogEntry {
  providerId: AIProviderId;
  id: string;
  name: string;
  free?: boolean;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  contextLength?: number;
  modalities: string[];
  tags: AIModelTag[];
  source: "live" | "curated" | "manual";
}

export interface AIChatRequest {
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
}

export interface AIProviderAdapter {
  id: AIProviderId;
  displayName: string;
  defaultBaseUrl?: string;
  defaultModel: string;
  listModels(credentials: AIProviderCredentials): Promise<AIModelCatalogEntry[]>;
  healthCheck(
    credentials: AIProviderCredentials,
    modelId: string,
  ): Promise<AIModelHealth>;
  completeChat(request: AIChatRequest): Promise<string>;
}
```

- [ ] **Step 4: Add catalog helpers**

Create `electron/lib/ai-providers.ts`:

```ts
import type {
  AIModelCatalogEntry,
  AIModelHealth,
  AIProviderAdapter,
  AIProviderCredentials,
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
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- --run electron/lib/ai-providers.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add electron/lib/ai-provider-types.ts electron/lib/ai-providers.ts electron/lib/ai-providers.test.ts
git commit -m "feat: add ai provider catalog types"
```

---

### Task 2: Generic Provider Credential Store And Migration

**Files:**
- Modify: `electron/lib/store.ts`
- Modify: `electron/lib/ai-providers.test.ts`

**Interfaces:**
- Consumes: `AIProviderId`, `AIProviderCredentialUpdate` from Task 1.
- Produces:
  - `getAIProviderApiKey(providerId: AIProviderId): string | undefined`
  - `getAIProviderBaseUrl(providerId: AIProviderId): string | undefined`
  - `saveAIProviderCredentials(update: AIProviderCredentialUpdate): void`
  - `aiProviderCredentialStatus(providerId?: AIProviderId): Record<AIProviderId, AIProviderCredentialSourceStatus>`

- [ ] **Step 1: Add failing credential tests**

Append to `electron/lib/ai-providers.test.ts`:

```ts
import { beforeEach, vi } from "vitest";

vi.mock("./store", async () => {
  const data: {
    settings: Record<string, unknown>;
    secrets: Record<string, string | undefined>;
  } = { settings: {}, secrets: {} };
  return {
    __data: data,
    getSettings: () => data.settings,
    getStoreValue: (key: string) => key === "settings" ? data.settings : undefined,
    updateSettings: (next: Record<string, unknown>) => {
      data.settings = { ...data.settings, ...next };
    },
    getAIProviderApiKey: (providerId: string) => data.secrets[`${providerId}:apiKey`],
    getAIProviderBaseUrl: (providerId: string) => data.secrets[`${providerId}:baseUrl`],
    saveAIProviderCredentials: (update: { providerId: string; apiKey?: string | null; baseUrl?: string | null }) => {
      if (update.apiKey !== undefined) {
        data.secrets[`${update.providerId}:apiKey`] = update.apiKey ?? undefined;
      }
      if (update.baseUrl !== undefined) {
        data.secrets[`${update.providerId}:baseUrl`] = update.baseUrl ?? undefined;
      }
    },
  };
});

describe("AI provider credential storage", () => {
  beforeEach(async () => {
    const store = await import("./store") as unknown as { __data: { settings: Record<string, unknown>; secrets: Record<string, string | undefined> } };
    store.__data.settings = {};
    store.__data.secrets = {};
  });

  it("stores provider credentials by provider id", async () => {
    const store = await import("./store");
    store.saveAIProviderCredentials({
      providerId: "openai",
      apiKey: "sk-openai",
      baseUrl: "https://api.openai.com/v1",
    });

    expect(store.getAIProviderApiKey("openai")).toBe("sk-openai");
    expect(store.getAIProviderBaseUrl("openai")).toBe("https://api.openai.com/v1");
    expect(store.getAIProviderApiKey("anthropic")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify missing real exports fail**

Run:

```bash
npm test -- --run electron/lib/ai-providers.test.ts
```

Expected: fail after the mock is removed or adjusted to call real store exports. This step confirms the desired API is represented in tests before wiring runtime calls.

- [ ] **Step 3: Update store schema and helpers**

Modify `electron/lib/store.ts`:

```ts
import type {
  AIProviderCredentialSource,
  AIProviderCredentialUpdate,
  AIProviderId,
} from "./ai-provider-types";
```

Replace the Settings AI fields with:

```ts
export interface Settings {
  watch_directories: string[];
  ai_provider_id?: AIProviderId;
  ai_model_id?: string;
  ai_model_paid_ack?: Record<string, boolean>;
  openrouter_base_url?: string;
  openrouter_api_key?: string;
  hidden_repo_ids?: string[];
}

interface StoredSettings extends Settings {
  openrouter_api_key_secret?: StoredSecret;
  ai_provider_secrets?: Partial<Record<AIProviderId, StoredSecret>>;
  ai_provider_base_urls?: Partial<Record<AIProviderId, string>>;
}
```

Replace OpenRouter-only credential helpers with generic helpers:

```ts
const providerEnvKeys: Record<AIProviderId, string[]> = {
  openrouter: ["OPENROUTER_API_KEY", "OPENROUTER"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

export interface AIProviderCredentialSourceStatus {
  api_key: AIProviderCredentialSource;
  base_url: AIProviderCredentialSource | "default";
}

function readProviderSecret(providerId: AIProviderId): string | undefined {
  const stored = store.get("settings") as StoredSettings | undefined;
  const secret = stored?.ai_provider_secrets?.[providerId];
  if (secret) return decryptSecret(secret);
  if (providerId === "openrouter") return readSecret("openrouter_api_key");
  return undefined;
}

function decryptSecret(secret: StoredSecret): string | undefined {
  if (secret.value_encrypted && secret.encoding === "safeStorage:v1") {
    try {
      return safeStorage.decryptString(Buffer.from(secret.value_encrypted, "base64"));
    } catch {
      return undefined;
    }
  }
  return secret.value;
}

function encryptSecret(value: string): StoredSecret {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      value_encrypted: safeStorage.encryptString(value).toString("base64"),
      encoding: "safeStorage:v1",
    };
  }
  return { value };
}

export function getAIProviderApiKey(providerId: AIProviderId): string | undefined {
  return readProviderSecret(providerId);
}

export function getAIProviderBaseUrl(providerId: AIProviderId): string | undefined {
  const stored = store.get("settings") as StoredSettings | undefined;
  return stored?.ai_provider_base_urls?.[providerId]
    ?? (providerId === "openrouter" ? stored?.openrouter_base_url : undefined);
}

export function saveAIProviderCredentials(update: AIProviderCredentialUpdate): void {
  const current = store.get("settings", { watch_directories: [] }) as StoredSettings;
  const next: StoredSettings = {
    ...current,
    ai_provider_secrets: { ...(current.ai_provider_secrets ?? {}) },
    ai_provider_base_urls: { ...(current.ai_provider_base_urls ?? {}) },
  };

  if (update.apiKey !== undefined) {
    if (update.apiKey === null) delete next.ai_provider_secrets![update.providerId];
    else next.ai_provider_secrets![update.providerId] = encryptSecret(update.apiKey);
  }

  if (update.baseUrl !== undefined) {
    if (update.baseUrl === null) delete next.ai_provider_base_urls![update.providerId];
    else next.ai_provider_base_urls![update.providerId] = update.baseUrl;
  }

  if (update.providerId === "openrouter") {
    delete next.openrouter_api_key;
    delete next.openrouter_api_key_secret;
    delete next.openrouter_base_url;
  }

  store.set("settings", next);
}

export function aiProviderCredentialStatus(
  providerId?: AIProviderId,
): Record<AIProviderId, AIProviderCredentialSourceStatus> {
  const providers: AIProviderId[] = providerId
    ? [providerId]
    : ["openrouter", "openai", "anthropic", "gemini"];
  return Object.fromEntries(
    providers.map((id) => {
      const storedKey = Boolean(getAIProviderApiKey(id));
      const envKey = providerEnvKeys[id].some((key) => Boolean(process.env[key]?.trim()));
      const storedBaseUrl = Boolean(getAIProviderBaseUrl(id));
      return [
        id,
        {
          api_key: storedKey ? "stored" : envKey ? "env" : "none",
          base_url: storedBaseUrl ? "stored" : "default",
        },
      ];
    }),
  ) as Record<AIProviderId, AIProviderCredentialSourceStatus>;
}
```

Keep these compatibility wrappers temporarily so existing renderer code compiles during the transition:

```ts
export function getOpenRouterApiKey(): string | undefined {
  return getAIProviderApiKey("openrouter");
}

export function getOpenRouterBaseUrl(): string | undefined {
  return getAIProviderBaseUrl("openrouter");
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- --run electron/lib/ai-providers.test.ts
```

Expected: pass after tests are adjusted to import the real helpers or separated into a dedicated store test.

- [ ] **Step 5: Commit**

```bash
git add electron/lib/store.ts electron/lib/ai-providers.test.ts
git commit -m "feat: store ai provider credentials"
```

---

### Task 3: Provider Adapters And Runtime Resolution

**Files:**
- Modify: `electron/lib/ai-providers.ts`
- Modify: `electron/lib/ai-runtime.ts`
- Modify: `electron/lib/ai-providers.test.ts`

**Interfaces:**
- Consumes store helpers from Task 2.
- Produces:
  - `resolveActiveProvider(): AIProviderId`
  - `resolveActiveModel(providerId: AIProviderId): string`
  - `listProviderModels(providerId: AIProviderId): Promise<AIModelCatalogEntry[]>`
  - `callAIModel(systemPrompt: string, userPrompt: string): Promise<string>` for all providers.

- [ ] **Step 1: Add failing adapter request-shape tests**

Append tests:

```ts
describe("AI provider adapters", () => {
  it("sends OpenAI chat completions with Bearer auth", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { providerAdapters } = await import("./ai-providers");
    const result = await providerAdapters.openai.completeChat({
      apiKey: "sk-test",
      model: "gpt-4.1-mini",
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 20,
      temperature: 0,
    });

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("sends Anthropic messages with x-api-key auth", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { providerAdapters } = await import("./ai-providers");
    const result = await providerAdapters.anthropic.completeChat({
      apiKey: "sk-ant",
      model: "claude-sonnet-4-5",
      systemPrompt: "system",
      userPrompt: "user",
      maxTokens: 20,
      temperature: 0,
    });

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "sk-ant",
          "anthropic-version": expect.any(String),
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run electron/lib/ai-providers.test.ts
```

Expected: fail because provider adapters are still empty or incomplete.

- [ ] **Step 3: Implement adapters**

In `electron/lib/ai-providers.ts`, replace `providerAdapters = {}` with concrete adapters. Use these endpoints:

```ts
const defaultBaseUrls: Record<AIProviderId, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};
```

Add shared helpers:

```ts
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
    return content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n");
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
```

Implement `completeChat` for each provider:

```ts
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
```

Add Anthropic and Gemini equivalents:

```ts
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
  if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
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
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const text = extractGeminiContent(await readJson(response)).trim();
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}
```

- [ ] **Step 4: Replace runtime resolution**

Modify `electron/lib/ai-runtime.ts` to import registry/store types and resolve provider/model:

```ts
import {
  curatedModelsForProvider,
  providerAdapters,
  OPENROUTER_FREE_MODEL_ID,
} from "./ai-providers";
import type { AIProviderId } from "./ai-provider-types";
```

Add:

```ts
export function configuredProvider(): AIProviderId {
  const settings = storeLib.getStoreValue("settings") as { ai_provider_id?: AIProviderId } | undefined;
  if (settings?.ai_provider_id) return settings.ai_provider_id;
  if (storeLib.getAIProviderApiKey("openrouter") || process.env.OPENROUTER_API_KEY || process.env.OPENROUTER) {
    return "openrouter";
  }
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini";
  return "openrouter";
}

export function configuredModel(): string {
  const providerId = configuredProvider();
  const settings = storeLib.getStoreValue("settings") as { ai_model_id?: string } | undefined;
  if (settings?.ai_model_id?.trim()) return settings.ai_model_id.trim();
  if (providerId === "openrouter") return process.env.OPENROUTER_MODEL?.trim() || OPENROUTER_FREE_MODEL_ID;
  return providerAdapters[providerId].defaultModel;
}
```

In `callAIModel`, resolve provider adapter and credentials:

```ts
const providerId = configuredProvider();
const adapter = providerAdapters[providerId];
const key = storeLib.getAIProviderApiKey(providerId) ?? providerEnvKey(providerId);
if (!key) throw new Error(`${adapter.displayName} API key is not configured.`);
return adapter.completeChat({
  apiKey: key,
  baseUrl: storeLib.getAIProviderBaseUrl(providerId),
  model: configuredModel(),
  systemPrompt,
  userPrompt,
  maxTokens: 800,
  temperature: 0,
});
```

- [ ] **Step 5: Run runtime tests**

Run:

```bash
npm test -- --run electron/lib/ai-runtime.test.ts electron/lib/ai-providers.test.ts
```

Expected: pass after updating OpenRouter-only test expectations to include provider ID where needed.

- [ ] **Step 6: Commit**

```bash
git add electron/lib/ai-providers.ts electron/lib/ai-runtime.ts electron/lib/ai-providers.test.ts electron/lib/ai-runtime.test.ts
git commit -m "feat: route ai runtime through providers"
```

---

### Task 4: Provider IPC And Renderer Types

**Files:**
- Modify: `electron/ipc-handlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/browser-api-fallback.ts`

**Interfaces:**
- Consumes provider runtime from Task 3.
- Produces renderer methods:
  - `ipc.listAIProviders(): Promise<AIProviderStatus[]>`
  - `ipc.saveAIProviderCredentials(update: AIProviderCredentialUpdate): Promise<void>`
  - `ipc.getAIProviderCredentialStatus(providerId?: AIProviderId): Promise<Record<AIProviderId, AIProviderCredentialSourceStatus>>`
  - `ipc.listAIModels(providerId: AIProviderId, options?: { force?: boolean }): Promise<AIModelCatalogEntry[]>`
  - `ipc.setActiveAIProvider(providerId: AIProviderId, modelId?: string): Promise<void>`

- [ ] **Step 1: Add renderer-safe types**

Modify `src/lib/ipc.ts`:

```ts
export type AIProviderId = "openrouter" | "openai" | "anthropic" | "gemini";
export type AIProviderCredentialSource = "stored" | "env" | "none";

export interface AIProviderCredentialUpdate {
  providerId: AIProviderId;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export interface AIProviderCredentialSourceStatus {
  api_key: AIProviderCredentialSource;
  base_url: AIProviderCredentialSource | "default";
}

export interface AIProviderStatus {
  providerId: AIProviderId;
  configured: boolean;
  active: boolean;
  credentialSource: AIProviderCredentialSource;
  baseUrlSource?: "stored" | "env" | "default" | "none";
  health: AIModelHealthStatus;
  reason?: string;
}

export interface AIModelCatalogEntry {
  providerId: AIProviderId;
  id: string;
  name: string;
  free?: boolean;
  pricing?: { prompt?: string; completion?: string };
  contextLength?: number;
  modalities: string[];
  tags: Array<"recommended" | "coding" | "long_context" | "vision" | "paid" | "free">;
  source: "live" | "curated" | "manual";
}
```

Add methods to the `ipc` object:

```ts
listAIProviders: () => window.api.ai.providers(),
listAIModels: (providerId, options) => window.api.ai.models(providerId, options),
setActiveAIProvider: (providerId, modelId) => window.api.ai.setActiveProvider(providerId, modelId),
saveAIProviderCredentials: (update) => window.api.settings.saveAIProvider(update),
getAIProviderCredentialStatus: (providerId) => window.api.settings.aiProviderStatus(providerId),
```

- [ ] **Step 2: Add preload methods**

Modify `electron/preload.ts`:

```ts
ai: {
  complete: (systemPrompt: string, userPrompt: string) =>
    ipcRenderer.invoke("ai:complete", { systemPrompt, userPrompt }),
  status: () => ipcRenderer.invoke("ai:status"),
  providers: () => ipcRenderer.invoke("ai:providers"),
  models: (providerId: string, options?: { force?: boolean }) =>
    ipcRenderer.invoke("ai:models", { providerId, options }),
  setActiveProvider: (providerId: string, modelId?: string) =>
    ipcRenderer.invoke("ai:set-active-provider", { providerId, modelId }),
},
settings: {
  saveAIProvider: (update: unknown) => ipcRenderer.invoke("settings:save-ai-provider", update),
  aiProviderStatus: (providerId?: string) =>
    ipcRenderer.invoke("settings:ai-provider-status", { providerId }),
}
```

- [ ] **Step 3: Add IPC handlers**

Modify `electron/ipc-handlers.ts`:

```ts
ipcMain.handle("ai:providers", async () => {
  return aiProviderStatuses();
});

ipcMain.handle("ai:models", async (_event, payload: { providerId: AIProviderId; options?: { force?: boolean } }) => {
  return listProviderModels(payload.providerId, payload.options);
});

ipcMain.handle("ai:set-active-provider", async (_event, payload: { providerId: AIProviderId; modelId?: string }) => {
  const settings = getSettings();
  updateSettings({
    ...settings,
    ai_provider_id: payload.providerId,
    ai_model_id: payload.modelId?.trim() || settings.ai_model_id,
  });
});
```

Update `settings:save-ai-provider` validation to require `providerId`.

- [ ] **Step 4: Browser fallback**

Modify `src/lib/browser-api-fallback.ts` so browser mode returns four provider statuses and curated models:

```ts
const PROVIDERS: AIProviderId[] = ["openrouter", "openai", "anthropic", "gemini"];
```

Return OpenRouter as active with `openrouter/free` when no store state exists.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc-handlers.ts electron/preload.ts src/lib/ipc.ts src/lib/browser-api-fallback.ts
git commit -m "feat: expose ai provider ipc"
```

---

### Task 5: Provider Logos And Cognee Memory Branding

**Files:**
- Create: `src/assets/providers/openrouter.svg`
- Create: `src/assets/providers/openai.svg`
- Create: `src/assets/providers/anthropic.svg`
- Create: `src/assets/providers/gemini.svg`
- Create: `src/assets/providers/cognee.svg`
- Create: `src/components/AIProviderLogo.tsx`
- Create: `src/components/AIProviderLogo.css`
- Modify: `src/screens/Settings.tsx`
- Modify: `src/screens/Settings.css`

**Interfaces:**
- Consumes renderer `AIProviderId`.
- Produces:
  - `<AIProviderLogo providerId="openrouter" size="md" />`
  - Cognee memory copy: `Memory retention powered by Cognee`

- [ ] **Step 1: Add local logo assets**

Add SVG files under `src/assets/providers/`. If official redistributable SVG marks are available, use those. If a mark cannot be redistributed cleanly, create a wordmark SVG containing only the provider name in the app’s existing mono/sans style.

Each SVG must:

- Have a square viewBox.
- Avoid remote images.
- Avoid hardcoded huge dimensions.
- Use `currentColor` where practical so dark/light themes work.

- [ ] **Step 2: Create logo component**

Create `src/components/AIProviderLogo.tsx`:

```tsx
import type { AIProviderId } from "../lib/ipc";
import openrouterLogo from "../assets/providers/openrouter.svg";
import openaiLogo from "../assets/providers/openai.svg";
import anthropicLogo from "../assets/providers/anthropic.svg";
import geminiLogo from "../assets/providers/gemini.svg";
import cogneeLogo from "../assets/providers/cognee.svg";
import "./AIProviderLogo.css";

type LogoId = AIProviderId | "cognee";

const logos: Record<LogoId, string> = {
  openrouter: openrouterLogo,
  openai: openaiLogo,
  anthropic: anthropicLogo,
  gemini: geminiLogo,
  cognee: cogneeLogo,
};

const labels: Record<LogoId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  cognee: "Cognee",
};

export function AIProviderLogo({
  providerId,
  size = "md",
  decorative = false,
}: {
  providerId: LogoId;
  size?: "sm" | "md" | "lg";
  decorative?: boolean;
}) {
  return (
    <img
      className={`ai-provider-logo is-${size}`}
      src={logos[providerId]}
      alt={decorative ? "" : labels[providerId]}
      aria-hidden={decorative ? true : undefined}
      loading="lazy"
    />
  );
}
```

Create `src/components/AIProviderLogo.css`:

```css
.ai-provider-logo {
  display: inline-block;
  object-fit: contain;
  color: var(--color-text-primary);
  flex: 0 0 auto;
}

.ai-provider-logo.is-sm {
  width: 18px;
  height: 18px;
}

.ai-provider-logo.is-md {
  width: 26px;
  height: 26px;
}

.ai-provider-logo.is-lg {
  width: 34px;
  height: 34px;
}
```

- [ ] **Step 3: Add Cognee memory retention branding**

Modify the Cognee memory section in `src/screens/Settings.tsx` to include:

```tsx
<div className="settings-memory-brand">
  <AIProviderLogo providerId="cognee" size="md" decorative />
  <span>Memory retention powered by Cognee</span>
</div>
```

Add CSS in `src/screens/Settings.css`:

```css
.settings-memory-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.4;
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/assets/providers src/components/AIProviderLogo.tsx src/components/AIProviderLogo.css src/screens/Settings.tsx src/screens/Settings.css
git commit -m "feat: add provider logos and cognee branding"
```

---

### Task 6: BYOK Provider Settings UI

**Files:**
- Create: `src/components/AIProviderSettings.tsx`
- Create: `src/components/AIProviderSettings.css`
- Modify: `src/screens/Settings.tsx`
- Modify: `src/screens/Settings.css`

**Interfaces:**
- Consumes:
  - `ipc.listAIProviders`
  - `ipc.listAIModels`
  - `ipc.saveAIProviderCredentials`
  - `ipc.setActiveAIProvider`
  - `AIProviderLogo`
- Produces:
  - Provider grid
  - Configure panel
  - Catalog-backed model picker
  - Free/paid filters
  - Paid model warning

- [ ] **Step 1: Spawn UI helper during subagent-driven execution**

When executing this task with subagents, assign this whole task to a UI-focused worker and tell it:

```text
You own src/components/AIProviderSettings.tsx, src/components/AIProviderSettings.css, and the Settings integration for the BYOK provider UI. Do not change runtime adapter files. Preserve existing user edits. Prioritize dense operational UX, clear paid/free labeling, accessible provider logo usage, loading/empty/error states, and Cognee memory branding already added by the previous task.
```

- [ ] **Step 2: Create component skeleton**

Create `src/components/AIProviderSettings.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, Check, Warning, X } from "@phosphor-icons/react";
import { AIProviderLogo } from "./AIProviderLogo";
import {
  ipc,
  type AIModelCatalogEntry,
  type AIProviderId,
  type AIProviderStatus,
} from "../lib/ipc";
import "./AIProviderSettings.css";

const providerOrder: AIProviderId[] = ["openrouter", "openai", "anthropic", "gemini"];

const providerNames: Record<AIProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

type Filter = "recommended" | "free" | "paid" | "coding" | "long_context" | "vision" | "all";

export function AIProviderSettings() {
  const [providers, setProviders] = useState<AIProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AIProviderId>("openrouter");
  const [models, setModels] = useState<AIModelCatalogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("recommended");
  const [query, setQuery] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [paidAcknowledged, setPaidAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(nextProvider = selectedProvider) {
    setLoading(true);
    try {
      const [providerRows, modelRows] = await Promise.all([
        ipc.listAIProviders(),
        ipc.listAIModels(nextProvider),
      ]);
      setProviders(providerRows);
      setModels(modelRows);
      const active = providerRows.find((row) => row.active);
      if (active) setSelectedProvider(active.providerId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load providers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const selected = providers.find((row) => row.providerId === selectedProvider);
  const visibleModels = useMemo(() => filterModels(models, filter, query), [models, filter, query]);
  const chosenModel = models.find((model) => model.id === selectedModel);
  const needsPaidAck = chosenModel?.free === false && !paidAcknowledged;

  async function saveCredentials() {
    await ipc.saveAIProviderCredentials({
      providerId: selectedProvider,
      apiKey: apiKey.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
    });
    setApiKey("");
    setBaseUrl("");
    setMessage(`${providerNames[selectedProvider]} credentials saved.`);
    await refresh(selectedProvider);
  }

  async function activate() {
    if (!selectedModel) {
      setMessage("Choose a model before activating this provider.");
      return;
    }
    if (needsPaidAck) {
      setMessage("Confirm provider billing before saving this paid model.");
      return;
    }
    await ipc.setActiveAIProvider(selectedProvider, selectedModel);
    setMessage(`${providerNames[selectedProvider]} is now active.`);
    await refresh(selectedProvider);
  }

  return (
    <section className="ai-provider-settings">
      <div className="settings-section-header">
        <div>
          <div className="section-label">AI Providers</div>
          <div className="settings-row-hint">
            Bring your own key. Choose the provider and model Overcode uses for AI features.
          </div>
        </div>
        <button type="button" className="settings-button" onClick={() => refresh()} disabled={loading}>
          <ArrowsClockwise size={12} className={loading ? "motion-spin" : undefined} />
          Refresh
        </button>
      </div>

      {message && <div className="settings-toast" onClick={() => setMessage(null)}>{message}</div>}

      <div className="ai-provider-grid">
        {providerOrder.map((providerId) => {
          const row = providers.find((item) => item.providerId === providerId);
          return (
            <button
              key={providerId}
              type="button"
              className={`ai-provider-card${selectedProvider === providerId ? " is-selected" : ""}${row?.active ? " is-active" : ""}`}
              onClick={() => {
                setSelectedProvider(providerId);
                setSelectedModel("");
                setPaidAcknowledged(false);
                refresh(providerId);
              }}
            >
              <AIProviderLogo providerId={providerId} size="md" decorative />
              <span className="ai-provider-card-name">{providerNames[providerId]}</span>
              <span className={`ai-provider-card-state is-${row?.health ?? "unknown"}`}>
                {row?.active ? "Active" : row?.configured ? "Connected" : "Not configured"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="ai-provider-config">
        <div className="ai-provider-config-header">
          <AIProviderLogo providerId={selectedProvider} size="lg" decorative />
          <div>
            <div className="settings-row-title">{providerNames[selectedProvider]}</div>
            <div className="settings-row-hint">
              {selected?.configured ? "Key available. Choose a model below." : "Paste a key to enable this provider."}
            </div>
          </div>
        </div>

        <label className="settings-field">
          <span>API key</span>
          <input
            className="settings-input"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={`${providerNames[selectedProvider]} API key`}
          />
        </label>

        <label className="settings-field">
          <span>Base URL</span>
          <input
            className="settings-input"
            type="text"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="Optional; leave blank for provider default"
          />
        </label>

        <button type="button" className="settings-button" onClick={saveCredentials}>
          <Check size={12} />
          Save credentials
        </button>
      </div>

      <div className="ai-model-picker">
        <div className="ai-model-toolbar">
          <input
            className="settings-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models"
          />
          <div className="ai-model-filters">
            {(["recommended", "free", "paid", "coding", "long_context", "vision", "all"] as Filter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`ai-model-filter${filter === item ? " is-active" : ""}`}
                onClick={() => setFilter(item)}
              >
                {filterLabel(item)}
              </button>
            ))}
          </div>
        </div>

        <div className="ai-model-list">
          {visibleModels.map((model) => (
            <button
              key={`${model.providerId}:${model.id}`}
              type="button"
              className={`ai-model-row${selectedModel === model.id ? " is-selected" : ""}`}
              onClick={() => {
                setSelectedModel(model.id);
                setPaidAcknowledged(model.free !== false);
              }}
            >
              <span className="ai-model-name">{model.name}</span>
              <span className="ai-model-id">{model.id}</span>
              <span className={`ai-model-price${model.free ? " is-free" : " is-paid"}`}>
                {model.free ? "Free" : "Provider billed"}
              </span>
              {model.contextLength && <span className="ai-model-context">{formatContext(model.contextLength)}</span>}
            </button>
          ))}
          {visibleModels.length === 0 && (
            <div className="settings-empty">No models match this filter. Use manual entry below.</div>
          )}
        </div>

        <label className="settings-field">
          <span>Manual model ID</span>
          <input
            className="settings-input"
            value={selectedModel}
            onChange={(event) => {
              setSelectedModel(event.target.value);
              setPaidAcknowledged(true);
            }}
            placeholder="provider/model-id"
          />
        </label>

        {chosenModel?.free === false && (
          <label className="ai-paid-confirm">
            <input
              type="checkbox"
              checked={paidAcknowledged}
              onChange={(event) => setPaidAcknowledged(event.target.checked)}
            />
            <span>This model may bill your provider account. Overcode does not charge for model usage.</span>
          </label>
        )}

        {needsPaidAck && (
          <div className="settings-warning">
            <Warning size={12} />
            Confirm provider billing before saving this model.
          </div>
        )}

        <button type="button" className="settings-button" onClick={activate}>
          <Check size={12} />
          Use selected model
        </button>
      </div>
    </section>
  );
}

function filterModels(models: AIModelCatalogEntry[], filter: Filter, query: string): AIModelCatalogEntry[] {
  const q = query.trim().toLowerCase();
  return models.filter((model) => {
    const matchesFilter = filter === "all"
      || (filter === "free" && model.free)
      || (filter === "paid" && model.free === false)
      || model.tags.includes(filter);
    const matchesQuery = !q
      || model.name.toLowerCase().includes(q)
      || model.id.toLowerCase().includes(q);
    return matchesFilter && matchesQuery;
  });
}

function filterLabel(filter: Filter): string {
  return filter === "long_context" ? "Long context" : filter[0].toUpperCase() + filter.slice(1);
}

function formatContext(value: number): string {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M ctx`;
  if (value >= 1000) return `${Math.round(value / 1000)}K ctx`;
  return `${value} ctx`;
}
```

- [ ] **Step 3: Add component CSS**

Create `src/components/AIProviderSettings.css` with stable dimensions and dense rows:

```css
.ai-provider-settings {
  display: grid;
  gap: 18px;
}

.ai-provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.ai-provider-card {
  min-height: 78px;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    "logo name"
    "logo state";
  align-items: center;
  gap: 4px 10px;
  padding: 12px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-panel);
  color: var(--color-text-primary);
  text-align: left;
  border-radius: 8px;
}

.ai-provider-card:active {
  transform: translateY(1px);
}

.ai-provider-card.is-selected {
  border-color: var(--color-accent);
}

.ai-provider-card .ai-provider-logo {
  grid-area: logo;
}

.ai-provider-card-name {
  grid-area: name;
  font-size: 13px;
  font-weight: 600;
}

.ai-provider-card-state {
  grid-area: state;
  font-size: 11px;
  color: var(--color-text-muted);
}

.ai-provider-config,
.ai-model-picker {
  display: grid;
  gap: 12px;
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 14px;
}

.ai-provider-config-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-field {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.ai-model-toolbar {
  display: grid;
  gap: 10px;
}

.ai-model-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-model-filter {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: 999px;
  font-size: 11px;
}

.ai-model-filter.is-active {
  color: var(--color-text-primary);
  border-color: var(--color-accent);
}

.ai-model-list {
  display: grid;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
}

.ai-model-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.8fr) auto auto;
  gap: 10px;
  align-items: center;
  min-height: 48px;
  padding: 9px 11px;
  border: 0;
  border-bottom: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
}

.ai-model-row:last-child {
  border-bottom: 0;
}

.ai-model-row.is-selected {
  background: var(--color-bg-elevated);
}

.ai-model-name,
.ai-model-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-model-id,
.ai-model-context {
  color: var(--color-text-muted);
  font-size: 11px;
}

.ai-model-price {
  font-size: 11px;
  white-space: nowrap;
}

.ai-model-price.is-free {
  color: var(--color-success);
}

.ai-model-price.is-paid {
  color: var(--color-warning);
}

.ai-paid-confirm {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

@media (max-width: 760px) {
  .ai-model-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Integrate in Settings**

Modify `src/screens/Settings.tsx`:

```tsx
import { AIProviderSettings } from "../components/AIProviderSettings";
```

Replace the old AI runtime section with:

```tsx
<AIProviderSettings />
```

Keep AI governance and Cognee memory sections below it.

- [ ] **Step 5: Run checks**

Run:

```bash
npx tsc --noEmit
npm run lint
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/AIProviderSettings.tsx src/components/AIProviderSettings.css src/screens/Settings.tsx src/screens/Settings.css
git commit -m "feat: add byok provider settings ui"
```

---

### Task 7: Environment, Docs, And Smoke Updates

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `scripts/smoke-openrouter.mjs`
- Create: `scripts/smoke-ai-provider.mjs`

**Interfaces:**
- Consumes provider env aliases from Task 2.
- Produces docs and a generic smoke script.

- [ ] **Step 1: Update `.env.example`**

Add:

```dotenv
# OpenAI BYOK
OPENAI_API_KEY=

# Anthropic BYOK
ANTHROPIC_API_KEY=

# Gemini / AI Studio BYOK
GEMINI_API_KEY=
# GOOGLE_API_KEY is accepted as an alias.
```

Keep:

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

- [ ] **Step 2: Add generic smoke script**

Create `scripts/smoke-ai-provider.mjs`:

```js
import "./smoke-openrouter.mjs";
```

This keeps the current smoke path honest while leaving direct-provider smoke scripts for a later task if real keys are available.

- [ ] **Step 3: Update README**

In `README.md`, replace the OpenRouter-only setup section with:

```md
## AI Provider Setup

Overcode uses bring-your-own-key AI providers. You can save keys for OpenRouter, OpenAI, Anthropic, and Gemini, then choose one active provider and model under Settings -> AI Providers.

OpenRouter is the default because it exposes a broad model catalog, including free and paid models. Direct provider keys are supported for users who prefer billing through OpenAI, Anthropic, or Google AI Studio.

Paid models are allowed. Overcode marks provider-billed models before activation and does not charge for model usage.
```

Add environment variable table:

```md
| Provider | Environment variables |
| --- | --- |
| OpenRouter | `OPENROUTER_API_KEY`, accepted alias `OPENROUTER`, optional `OPENROUTER_MODEL`, optional `OPENROUTER_BASE_URL` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Gemini / AI Studio | `GEMINI_API_KEY`, accepted alias `GOOGLE_API_KEY` |
```

- [ ] **Step 4: Verify previous-hackathon provider references remain absent**

Run the local legacy-provider audit used by this branch and confirm it produces no committed-source hits.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md scripts/smoke-ai-provider.mjs scripts/smoke-openrouter.mjs
git commit -m "docs: document byok ai providers"
```

---

### Task 8: Final Verification And Build

**Files:**
- No planned source edits unless verification exposes defects.

**Interfaces:**
- Consumes all tasks.
- Produces a verified build and launchable app.

- [ ] **Step 1: Run full typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: exit 0.

- [ ] **Step 3: Run tests**

```bash
npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 4: Run OpenRouter smoke if key exists**

```bash
npm run smoke:openrouter
```

Expected: if `OPENROUTER_API_KEY` or `OPENROUTER` is configured, API returns HTTP 200 without printing the key.

- [ ] **Step 5: Build app**

```bash
npm run build
```

Expected: Electron builder creates `release/0.1.0/Overcode-Linux-0.1.0.AppImage`.

- [ ] **Step 6: Strict previous-provider cleanup scan**

Run the strict legacy-provider audit across source, docs, scripts, package metadata, and env examples. Expected: no output.

- [ ] **Step 7: Launch app**

```bash
setsid env -u ELECTRON_RUN_AS_NODE ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 OVERCODE_NO_SANDBOX=1 ./node_modules/electron/dist/electron /home/timidan/Desktop/persona/overcode > /tmp/overcode-electron-byok.log 2>&1 < /dev/null & printf '%s\n' "$!"
```

Expected: app stays running; `/tmp/overcode-electron-byok.log` has no startup crash.

- [ ] **Step 8: Commit any verification fixes**

If verification required source changes:

```bash
git add <changed-files>
git commit -m "fix: stabilize byok provider flow"
```

If no source changes were required, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: provider cards, multi-provider BYOK, one active provider/model, OpenRouter catalog, direct provider fallbacks, paid/free labeling, provider logos, Cognee memory branding, credential privacy, catalog failure fallback, migration, tests, and docs are all mapped to tasks.
- Scope check: provider adapters, credential storage, IPC, UI, docs, and verification are coupled enough to remain one implementation plan because the deliverable is one end-to-end Settings/runtime feature.
- Type consistency: provider IDs use `openrouter | openai | anthropic | gemini`; model rows use `AIModelCatalogEntry`; renderer-safe status uses `AIProviderStatus`; provider secret updates use `AIProviderCredentialUpdate`.
