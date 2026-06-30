const RENDERER_HIDDEN_SETTINGS_FIELDS = [
  "openrouter_api_key",
  "openrouter_api_key_secret",
  "openrouter_base_url",
  "ai_provider_secrets",
  "ai_provider_base_urls",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeSettingsForRendererRead(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!RENDERER_HIDDEN_SETTINGS_FIELDS.includes(
      key as (typeof RENDERER_HIDDEN_SETTINGS_FIELDS)[number],
    )) {
      sanitized[key] = fieldValue;
    }
  }
  return sanitized;
}

export function sanitizeSettingsForRendererWrite(
  value: unknown,
  existingValue: unknown,
): unknown {
  if (!isRecord(value)) return value;

  const sanitized = { ...value };
  const existing = isRecord(existingValue) ? existingValue : {};

  for (const key of RENDERER_HIDDEN_SETTINGS_FIELDS) {
    if (existing[key] !== undefined) sanitized[key] = existing[key];
    else delete sanitized[key];
  }

  return sanitized;
}

