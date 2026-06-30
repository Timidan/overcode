# BYOK AI Provider Design

## Goal

Overcode should support a normal bring-your-own-key AI setup. Users can connect one or more AI providers, choose which provider is active, choose the underlying model, and use free or paid models intentionally.

The experience should feel like a desktop settings surface for real operators, not a developer-only model ID textbox.

## Scope

This design covers:

- OpenRouter, OpenAI, Anthropic, and Google Gemini / AI Studio.
- Saving credentials for multiple providers.
- Choosing one active provider and one active model.
- Model discovery, model search, and model metadata display.
- Provider health checks and model health checks.
- Clear paid/free model labeling where pricing data is available.
- A manual model ID escape hatch for advanced users.

This design does not cover:

- Provider-specific tool calling.
- File upload APIs.
- Assistants, batches, agents, realtime, embeddings, image generation, or audio generation.
- Per-feature model routing.
- Team credential sharing.

## UX Principles

1. **BYOK first.** The user should immediately understand that Overcode uses their own provider account and key.
2. **Choice without surprise cost.** Paid models are allowed, but the app must mark them clearly before saving.
3. **No model-ID homework.** Users should be able to search and select human-readable model names. Manual IDs remain available under advanced controls.
4. **Provider logos matter.** Provider cards should use recognizable official logos or wordmarks, rendered locally with accessible labels. Do not use generic sparkles or placeholder icons for provider identity.
5. **Graceful degradation.** If catalog loading fails, the user can still use a curated fallback list or type a model ID.
6. **One active runtime.** Multiple providers can be configured, but Overcode sends AI calls through exactly one active provider/model at a time.

## Settings Information Architecture

Replace the current single **AI runtime** area with **AI Providers**.

### Provider Overview

The first view shows a compact provider grid:

- OpenRouter
- OpenAI
- Anthropic
- Gemini

Each provider card shows:

- Official logo or wordmark.
- Provider name.
- Connection state: Not configured, Connected, Error, or Active.
- Active model if that provider is active.
- Last health check result.
- Configure button.
- Set active button when credentials are valid.

Cards should be visually restrained and data-dense. This is an operational settings surface, not a landing page.

### Configure Provider Panel

Selecting a provider opens an inline panel or right-side settings drawer.

Fields:

- API key input.
- Optional base URL input only where useful:
  - OpenRouter: allowed.
  - OpenAI: allowed for compatible gateways and enterprise proxies.
  - Anthropic: hidden by default, available under advanced.
  - Gemini: hidden by default, available under advanced.
- Save credentials.
- Clear stored credentials.
- Validate key.

Credential source badges:

- Stored on device.
- From environment.
- Not set.

Environment aliases:

- OpenRouter: `OPENROUTER_API_KEY`, accepted alias `OPENROUTER`.
- OpenAI: `OPENAI_API_KEY`.
- Anthropic: `ANTHROPIC_API_KEY`.
- Gemini: `GEMINI_API_KEY` and accepted alias `GOOGLE_API_KEY`.

Stored credentials take precedence over environment variables.

### Model Picker

After a provider has credentials, show the model picker.

Model picker layout:

- Search input.
- Filter row:
  - Recommended
  - Free
  - Paid
  - Coding
  - Long context
  - Vision
  - All
- Model list with stable rows.
- Advanced manual model ID field below the list.

Each model row shows:

- Display name.
- Model ID.
- Provider owner where applicable.
- Free or paid label.
- Approximate input/output pricing when available.
- Context length when available.
- Modality badges: text, vision, audio, video.
- Recommended-for-code badge where Overcode classifies it as suitable for code and repo workflows.
- Health status for the selected model after validation.

Paid model behavior:

- Paid models are selectable.
- Saving a paid model shows inline confirmation text near the Save button:
  - "This model may bill your provider account. Overcode does not charge for model usage."
- The confirmation should not be a modal.
- The app should avoid blocking paid-model usage after the user confirms.

Recommended default behavior:

- If no provider is configured, show OpenRouter first because it gives the broadest catalog and free route.
- If OpenRouter is configured and no model is selected, default to `openrouter/free`.
- If a direct provider is configured and no model is selected, use a conservative provider-specific default from the curated list.

## Runtime Architecture

Introduce a provider adapter layer in the main process.

```ts
interface AIProviderAdapter {
  id: AIProviderId;
  displayName: string;
  listModels(credentials: AIProviderCredentials): Promise<AIModelCatalogResult>;
  validateCredential(credentials: AIProviderCredentials): Promise<AIProviderHealth>;
  healthCheck(credentials: AIProviderCredentials, modelId: string): Promise<AIModelHealth>;
  completeChat(request: AIChatRequest): Promise<string>;
}
```

Provider IDs:

```ts
type AIProviderId = "openrouter" | "openai" | "anthropic" | "gemini";
```

The existing `callAIModel(systemPrompt, userPrompt)` contract can remain at the IPC boundary. Internally it should resolve:

1. Active provider from Settings.
2. Active model from Settings.
3. Provider credentials from encrypted store or environment.
4. Provider adapter.
5. Provider-specific chat-completion request.

## Data Model

Settings:

```ts
interface Settings {
  ai_provider_id?: AIProviderId;
  ai_model_id?: string;
  ai_model_paid_ack?: Record<string, boolean>;
}
```

Stored credential secrets:

```ts
interface StoredSettings {
  ai_provider_secrets?: Partial<Record<AIProviderId, StoredSecret>>;
  ai_provider_base_urls?: Partial<Record<AIProviderId, string>>;
}
```

Renderer-safe provider status:

```ts
interface AIProviderStatus {
  providerId: AIProviderId;
  configured: boolean;
  active: boolean;
  credentialSource: "stored" | "env" | "none";
  baseUrlSource?: "stored" | "env" | "default" | "none";
  health: "available" | "unavailable" | "not_configured" | "unknown";
  reason?: string;
}
```

Model catalog row:

```ts
interface AIModelCatalogEntry {
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
  tags: Array<"recommended" | "coding" | "long_context" | "vision" | "paid" | "free">;
  source: "live" | "curated" | "manual";
}
```

## Catalog Strategy

OpenRouter:

- Use the live OpenRouter model catalog.
- Treat `pricing.prompt === "0"` and `pricing.completion === "0"` as free.
- Show paid/free labels from pricing.
- Keep curated recommendations for code-heavy use: `openrouter/free`, `qwen/qwen3-coder:free`, and one or two stable paid options.

OpenAI:

- Use the provider model-list API when credentials allow it.
- Use a curated fallback list when the API is unavailable or returns models that are not useful for chat.
- Pricing may not be available from the provider model list, so paid/free should be shown as "provider billed" unless pricing metadata is locally curated.

Anthropic:

- Use the provider model-list API where available.
- Use a curated fallback list for current chat-capable Claude models.
- Treat direct Anthropic models as provider-billed unless local pricing metadata is curated.

Gemini / AI Studio:

- Use the Gemini model list API where available.
- Use a curated fallback list for chat-capable Gemini models.
- Treat direct Gemini models as provider-billed unless local pricing metadata is curated.

Catalog caching:

- Cache live catalog results locally with a short TTL, around 6 hours.
- Manual refresh should bypass cache.
- Failed live catalog loads should not erase the last successful catalog.

## Logos And Branding

Provider logos should live in local assets, for example `public/providers/`.

Use official provider assets where redistribution is permitted. If a provider logo cannot be redistributed cleanly, use a locally stored provider wordmark treatment based on the official name, not a fake icon.

Every logo must include accessible text:

- Decorative image hidden from screen readers when adjacent text says provider name.
- Otherwise, meaningful `alt` text.

Do not fetch logos from remote CDNs at runtime.

## Error Handling

Credential validation errors:

- Show inline error under the provider card or configure panel.
- Redact any key-shaped substrings.
- Keep the entered key in the input until the user leaves the panel so they can fix copy/paste mistakes.

Catalog errors:

- Show a small inline status: "Live catalog unavailable. Showing saved recommendations."
- Keep the model picker usable with curated and manual options.

Model health errors:

- Show unavailable status on the row.
- Allow saving anyway for manual/advanced use, but make the warning visible.

AI request errors:

- Preserve the current local fallback behavior for structured AI features.
- Audit metadata should record provider ID, model ID, status, duration, and byte counts.
- Prompt and response bodies must not be stored.

## Security And Privacy

- Raw API keys must never cross to the renderer after saving.
- The renderer can know credential source and status, not secret values.
- Stored credentials use Electron `safeStorage` when available.
- Environment variables remain supported for development and CI.
- Cognee memory must not receive provider keys, raw prompt bodies, or raw model responses.

## Testing

Main-process tests:

- Provider selection resolves stored settings before environment defaults.
- Each provider adapter sends the correct auth header and chat request shape.
- Missing credentials return `not_configured`.
- Stored credentials are redacted from renderer status.
- OpenRouter free/paid classification uses catalog pricing.

Renderer tests:

- Provider cards render configured, active, and error states.
- Model picker filters free, paid, coding, long-context, and all models.
- Paid model selection shows confirmation text before save.
- Manual model ID entry remains available when catalog loading fails.

Smoke tests:

- `npm run smoke:openrouter` remains.
- Add direct provider smoke scripts only if keys are present.
- Smoke scripts must never print secret values.

## Migration

Existing OpenRouter-only settings should migrate cleanly:

- If `settings.ai_model_id` exists, keep it.
- If no `settings.ai_provider_id` exists, set `openrouter` when an OpenRouter key is present.
- Existing stored OpenRouter API key becomes the OpenRouter provider secret.
- Existing OpenRouter base URL becomes the OpenRouter provider base URL.
- No AI cache or audit log needs to be deleted.

## Success Criteria

- A non-technical evaluator can paste an OpenRouter key, see model options, and select a model without knowing model IDs.
- A power user can paste OpenAI, Anthropic, or Gemini keys and use those providers instead.
- Paid models are selectable without hidden friction or surprise billing ambiguity.
- The Settings page clearly shows which provider and model are active.
- All existing AI features continue using the same renderer-level API.
- The app remains usable when provider model catalogs are unavailable.
