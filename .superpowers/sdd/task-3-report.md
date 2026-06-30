## What you implemented

- Added concrete provider adapters in `electron/lib/ai-providers.ts` for:
  - OpenRouter via OpenAI-compatible `/chat/completions`
  - OpenAI via `/chat/completions`
  - Anthropic via `/messages`
  - Gemini via `:generateContent`
- Added shared base URL cleanup and provider-specific response extractors for OpenAI-compatible, Anthropic, and Gemini payloads.
- Replaced the empty `providerAdapters` registry with a typed adapter record including default model metadata for each provider.
- Added `listProviderModels(providerId)` returning curated provider catalogs.
- Updated `electron/lib/ai-runtime.ts` to resolve the active provider and active model at runtime while preserving the renderer contract `ipc.callAIModel(systemPrompt, userPrompt)`.
- Routed `callAIModel` through the active provider adapter and main-process credential lookup, without exposing raw keys to the renderer.
- Added adapter request-shape tests and runtime resolution tests covering:
  - OpenAI Bearer auth request shape
  - Anthropic `x-api-key` request shape
  - OpenRouter default provider fallback when its key exists
  - Explicit active provider selecting that provider’s default model

## What you tested and test results

- Ran targeted Vitest coverage for Task 3 runtime and provider files.
- Result: passing.

Command:

```bash
npm test -- --run electron/lib/ai-runtime.test.ts electron/lib/ai-providers.test.ts
```

Result:

```text
Test Files  2 passed (2)
Tests  15 passed (15)
```

## TDD Evidence

### RED command/output

Command:

```bash
npm test -- --run electron/lib/ai-providers.test.ts electron/lib/ai-runtime.test.ts
```

Output:

```text
Test Files  2 failed (2)
Tests  4 failed | 11 passed (15)

FAIL  electron/lib/ai-providers.test.ts > AI provider adapters > sends OpenAI chat completions with Bearer auth
TypeError: Cannot read properties of undefined (reading 'completeChat')

FAIL  electron/lib/ai-providers.test.ts > AI provider adapters > sends Anthropic messages with x-api-key auth
TypeError: Cannot read properties of undefined (reading 'completeChat')

FAIL  electron/lib/ai-runtime.test.ts > OpenRouter AI runtime > defaults to OpenRouter when a stored OpenRouter key exists without an explicit active provider
TypeError: configuredProvider is not a function

FAIL  electron/lib/ai-runtime.test.ts > OpenRouter AI runtime > uses an explicit active provider and that provider's default model
TypeError: configuredProvider is not a function
```

### GREEN command/output

Command:

```bash
npm test -- --run electron/lib/ai-runtime.test.ts electron/lib/ai-providers.test.ts
```

Output:

```text
Test Files  2 passed (2)
Tests  15 passed (15)
```

## Files changed

- `electron/lib/ai-providers.ts`
- `electron/lib/ai-runtime.ts`
- `electron/lib/ai-providers.test.ts`
- `electron/lib/ai-runtime.test.ts`

## Self-review findings

- Kept the renderer-facing runtime contract unchanged: `ipc.callAIModel(systemPrompt, userPrompt)`.
- Kept raw provider keys in main-process credential access only; the new runtime path reads from `storeLib.getAIProviderApiKey()` and env fallback only in Electron main code.
- Stayed within Task 3 scope: no settings UI work, no preload IPC catalog methods, no unrelated migration changes.
- Kept OpenRouter as the default provider when its key is present and no explicit provider is set, per the task brief.

## Any concerns

- `aiConfigStatus()` remains OpenRouter-oriented in this task. That matches current scope and existing tests, but broader per-provider runtime health/status behavior will need follow-on work in later tasks.
