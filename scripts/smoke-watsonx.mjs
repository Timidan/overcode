import fs from "node:fs";

const MODELS = [
  "ibm/granite-4-h-small",
  "ibm/granite-3-3-8b-instruct",
  "ibm/granite-3-2-8b-instruct",
  "mistralai/mistral-large",
];
const WATSONX_API_VERSION = "2023-05-29";

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
  return text.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 220);
}

async function readReason(response) {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body);
    return redact(
      parsed?.errors?.[0]?.message || parsed?.message || response.statusText,
    );
  } catch {
    return redact(body || response.statusText);
  }
}

const env = loadDotEnv();
const required = ["WATSONX_API_KEY", "WATSONX_PROJECT_ID", "WATSONX_URL"];
const missing = required.filter((key) => !env[key]);

console.log(JSON.stringify({ configured: missing.length === 0, missing }, null, 2));
if (missing.length > 0) process.exit(1);

const tokenResponse = await fetch("https://iam.cloud.ibm.com/identity/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ibm:params:oauth:grant-type:apikey",
    apikey: env.WATSONX_API_KEY,
  }),
});

console.log(
  JSON.stringify(
    { iam: { ok: tokenResponse.ok, status: tokenResponse.status } },
    null,
    2,
  ),
);
if (!tokenResponse.ok) process.exit(1);

const { access_token: token } = await tokenResponse.json();
const baseUrl = env.WATSONX_URL.replace(/\/+$/, "");
const results = [];

for (const model of MODELS) {
  const response = await fetch(
    `${baseUrl}/ml/v1/chat/completions?version=${WATSONX_API_VERSION}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        project_id: env.WATSONX_PROJECT_ID,
        messages: [
          { role: "system", content: "Return one concise word." },
          { role: "user", content: "health check" },
        ],
        max_tokens: 8,
        temperature: 0,
      }),
    },
  );
  const payload = response.ok ? await response.json().catch(() => ({})) : null;
  const generated =
    typeof payload?.choices?.[0]?.message?.content === "string"
      ? payload.choices[0].message.content.trim()
      : "";

  results.push({
    model,
    ok: response.ok,
    status: response.status,
    generatedLength: generated.length,
    reason: response.ok ? "" : await readReason(response),
  });
}

console.log(JSON.stringify({ models: results }, null, 2));
process.exit(results.some((entry) => entry.ok) ? 0 : 1);
