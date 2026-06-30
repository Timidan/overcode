import fs from "node:fs";

const DEFAULT_MODEL = "openrouter/free";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

function loadDotEnv() {
  const env = {};
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = process.env[key] || value;
  }
  return env;
}

function redact(text) {
  return text.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 260);
}

async function readReason(response) {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body);
    return redact(parsed?.error?.message || parsed?.message || response.statusText);
  } catch {
    return redact(body || response.statusText);
  }
}

const env = loadDotEnv();
const apiKey = env.OPENROUTER_API_KEY || env.OPENROUTER || "";
const model = env.OPENROUTER_MODEL || DEFAULT_MODEL;
const baseUrl = (env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

console.log(
  JSON.stringify(
    {
      configured: Boolean(apiKey),
      apiKeySource: env.OPENROUTER_API_KEY
        ? "OPENROUTER_API_KEY"
        : env.OPENROUTER
          ? "OPENROUTER"
          : null,
      model,
      baseUrl,
    },
    null,
    2,
  ),
);

if (!apiKey) {
  console.log(
    JSON.stringify(
      {
        openrouter: {
          skipped: true,
          reason: "OPENROUTER_API_KEY or OPENROUTER missing; no live smoke request sent.",
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const response = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "HTTP-Referer": "https://github.com/Timidan/overcode",
    "X-Title": "Overcode",
  },
  body: JSON.stringify({
    model,
    messages: [
      { role: "system", content: "Return one concise word." },
      { role: "user", content: "health check" },
    ],
    max_tokens: 8,
    temperature: 0,
  }),
});

const payload = response.ok ? await response.json().catch(() => ({})) : null;
const generated =
  typeof payload?.choices?.[0]?.message?.content === "string"
    ? payload.choices[0].message.content.trim()
    : "";

console.log(
  JSON.stringify(
    {
      openrouter: {
        ok: response.ok,
        status: response.status,
        model,
        generatedLength: generated.length,
        reason: response.ok ? "" : await readReason(response),
      },
    },
    null,
    2,
  ),
);

process.exit(response.ok ? 0 : 1);
