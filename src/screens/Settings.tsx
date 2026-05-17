import { useEffect, useState } from "react";
import { Plus, X, ArrowsClockwise, Warning, Eye } from "@phosphor-icons/react";
import { Sidebar } from "../components/Sidebar";
import {
  ProviderConnectionPill,
  type Provider,
  type ProviderState,
} from "../components/ProviderConnectionPill";
import {
  ipc,
  type AIModelHealth,
  type AIModelHealthStatus,
  type AIStatus,
  type WatsonxCredentialSource,
  type WatsonxCredentialSourceStatus,
} from "../lib/ipc";
import "./Settings.css";

interface SettingsShape {
  watch_directories: string[];
  watsonx_model_id?: string;
  // IDs of discovered workspaces the user explicitly chose to hide forever.
  // Set from the Repositories curation screen; revisited in the Hidden
  // repositories section below.
  hidden_repo_ids?: string[];
}

interface AIAuditEntry {
  id: string;
  feature: string;
  model: string;
  status: "ok" | "error";
  promptChars: number;
  responseChars: number;
  durationMs: number;
  timestamp: number;
  error?: string;
}

interface AIGovernanceState {
  cacheKeys: string[];
  audit: AIAuditEntry[];
}

const KNOWN_MODELS = [
  "ibm/granite-4-h-small",
  "ibm/granite-3-3-8b-instruct",
  "ibm/granite-3-2-8b-instruct",
  "mistralai/mistral-large",
] as const;

function healthLabel(status?: AIModelHealthStatus): string {
  switch (status) {
    case "available":
      return "Available";
    case "unavailable":
      return "Unavailable";
    case "not_configured":
      return "Not configured";
    case "unknown":
    default:
      return "Unknown";
  }
}

function healthClass(status?: AIModelHealthStatus): string {
  switch (status) {
    case "available":
      return "is-available";
    case "unavailable":
      return "is-unavailable";
    case "not_configured":
      return "is-not-configured";
    case "unknown":
    default:
      return "is-unknown";
  }
}

function modelHealthTitle(model: string, health?: AIModelHealth): string {
  const label = healthLabel(health?.status);
  return health?.reason
    ? `${model}: ${label} - ${health.reason}`
    : `${model}: ${label}`;
}

function historyBoxClass(status?: AIModelHealthStatus): string {
  switch (status) {
    case "available":
      return "is-available";
    case "unavailable":
      return "is-unavailable";
    case "not_configured":
      return "is-not-configured";
    case "unknown":
      return "is-unknown";
    default:
      return "is-empty";
  }
}

function historyBoxTitle(
  entry: { status: AIModelHealthStatus; checkedAt: number; latencyMs?: number },
): string {
  const iso = new Date(entry.checkedAt).toISOString();
  const ms = typeof entry.latencyMs === "number"
    ? ` - ${Math.round(entry.latencyMs)}ms`
    : "";
  return `${iso} - ${healthLabel(entry.status)}${ms}`;
}

function CredentialBadge({
  label,
  source,
}: {
  label: string;
  source: WatsonxCredentialSource | undefined;
}) {
  const status = source ?? "none";
  const text =
    status === "stored"
      ? "Stored (encrypted on device)"
      : status === "env"
        ? "From environment"
        : "Not set";
  return (
    <div className={`settings-credential-badge is-${status}`}>
      <span className="settings-credential-badge-label">{label}</span>
      <span className="settings-credential-badge-status">{text}</span>
    </div>
  );
}

function prettyHiddenId(id: string): { prefix: string; rest: string } {
  const idx = id.indexOf(":");
  if (idx === -1) return { prefix: "", rest: id };
  return { prefix: id.slice(0, idx), rest: id.slice(idx + 1) };
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<SettingsShape>({
    watch_directories: [],
  });
  const [newPath, setNewPath] = useState("");
  const [auth, setAuth] = useState({ github: false, gitlab: false });
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [modelInput, setModelInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshingAI, setRefreshingAI] = useState(false);
  const [governance, setGovernance] = useState<AIGovernanceState>({
    cacheKeys: [],
    audit: [],
  });
  const [credSource, setCredSource] = useState<WatsonxCredentialSourceStatus | null>(null);
  const [credForm, setCredForm] = useState({ api_key: "", project_id: "", url: "" });
  const [savingCreds, setSavingCreds] = useState(false);

  async function refreshAI() {
    setRefreshingAI(true);
    try {
      const [ai, governanceState] = await Promise.all([
        ipc.getAIStatus(),
        loadGovernanceState(),
      ]);
      setAiStatus(ai);
      setGovernance(governanceState);
    } finally {
      setRefreshingAI(false);
    }
  }

  async function refresh() {
    const [stored, status, ai, governanceState, creds] = await Promise.all([
      ipc.getFromStore("settings"),
      ipc.getAuthStatus(),
      ipc.getAIStatus(),
      loadGovernanceState(),
      ipc.getWatsonxCredentialStatus(),
    ]);
    const storedSettings =
      (stored as SettingsShape | undefined) ?? {
        watch_directories: ["~/projects"],
      };
    setSettings(storedSettings);
    setAuth(status);
    setAiStatus(ai);
    setGovernance(governanceState);
    setModelInput(storedSettings.watsonx_model_id ?? "");
    setCredSource(creds);
  }

  async function saveCredentials() {
    const update: { api_key?: string | null; project_id?: string | null; url?: string | null } = {};
    if (credForm.api_key.trim()) update.api_key = credForm.api_key.trim();
    if (credForm.project_id.trim()) update.project_id = credForm.project_id.trim();
    if (credForm.url.trim()) update.url = credForm.url.trim();
    if (Object.keys(update).length === 0) {
      setMessage("Enter at least one credential to save.");
      return;
    }
    setSavingCreds(true);
    try {
      await ipc.saveWatsonxCredentials(update);
      setCredForm({ api_key: "", project_id: "", url: "" });
      setMessage("watsonx.ai credentials saved. Re-checking status…");
      const [creds, ai] = await Promise.all([
        ipc.getWatsonxCredentialStatus(),
        ipc.getAIStatus(),
      ]);
      setCredSource(creds);
      setAiStatus(ai);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to save credentials.");
    } finally {
      setSavingCreds(false);
    }
  }

  async function clearStoredCredentials() {
    setSavingCreds(true);
    try {
      await ipc.saveWatsonxCredentials({ api_key: null, project_id: null, url: null });
      setCredForm({ api_key: "", project_id: "", url: "" });
      setMessage("Stored credentials cleared. Environment-variable fallback (if any) is still in effect.");
      const [creds, ai] = await Promise.all([
        ipc.getWatsonxCredentialStatus(),
        ipc.getAIStatus(),
      ]);
      setCredSource(creds);
      setAiStatus(ai);
    } finally {
      setSavingCreds(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function persistSettings(next: SettingsShape) {
    setSettings(next);
    await ipc.setInStore("settings", next);
  }

  async function addPath() {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    if (settings.watch_directories.includes(trimmed)) {
      setMessage(`${trimmed} is already on the list.`);
      return;
    }
    await persistSettings({
      ...settings,
      watch_directories: [...settings.watch_directories, trimmed],
    });
    setNewPath("");
    setMessage(`Added ${trimmed}. Use Scan on the Repositories screen to load it.`);
  }

  async function removePath(path: string) {
    await persistSettings({
      ...settings,
      watch_directories: settings.watch_directories.filter((p) => p !== path),
    });
  }

  async function unhideRepo(id: string) {
    const current = Array.isArray(settings.hidden_repo_ids) ? settings.hidden_repo_ids : [];
    await persistSettings({
      ...settings,
      hidden_repo_ids: current.filter((existing) => existing !== id),
    });
    setMessage(`Unhid ${prettyHiddenId(id)}. It will reappear on the next scan.`);
  }

  async function unhideAllRepos() {
    if (!settings.hidden_repo_ids || settings.hidden_repo_ids.length === 0) return;
    await persistSettings({ ...settings, hidden_repo_ids: [] });
    setMessage("All hidden repositories restored.");
  }

  async function saveModel() {
    const next: SettingsShape = {
      ...settings,
      watsonx_model_id: modelInput.trim() || undefined,
    };
    await persistSettings(next);
    setMessage("watsonx.ai model preference saved. Next AI request will use it.");
    setAiStatus(await ipc.getAIStatus());
  }

  async function handleConnect(provider: Provider) {
    setBusy(provider);
    try {
      await ipc.connectAuth(provider);
      setAuth(await ipc.getAuthStatus());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect(provider: Provider) {
    setBusy(provider);
    try {
      await ipc.disconnectAuth(provider);
      setAuth(await ipc.getAuthStatus());
    } finally {
      setBusy(null);
    }
  }

  function accountState(provider: Provider): ProviderState {
    if (busy === provider) return "connecting";
    return auth[provider] ? "connected" : "disconnected";
  }

  const selectedModel = modelInput.trim() || aiStatus?.model || "";
  const healthByModel = new Map<string, AIModelHealth>(
    aiStatus?.health.map((entry) => [entry.model, entry] as const) ?? [],
  );
  const activeModel = aiStatus?.model;
  const activeHealth = activeModel
    ? aiStatus?.health.find((entry) => entry.model === activeModel)
    : undefined;
  const cacheFeatureCounts = summarizeCacheKeys(governance.cacheKeys);

  return (
    <div className="settings-container">
      <Sidebar />
      <main className="settings-main">
        <header className="settings-header">
          <h1 className="settings-title">Settings</h1>
        </header>

        {message && (
          <div className="settings-toast" onClick={() => setMessage(null)}>
            {message}
          </div>
        )}

        <section className="settings-section">
          <div className="section-label">Workspace directories</div>
          <div className="settings-row-hint settings-hint-block">
            Folders that Overcode scans for local Git repositories. Use <code>~</code> for your home directory.
          </div>
          <ul className="settings-list">
            {settings.watch_directories.length === 0 && (
              <li className="settings-empty">No directories yet.</li>
            )}
            {settings.watch_directories.map((p) => (
              <li key={p} className="settings-list-item">
                <span className="settings-list-text">{p}</span>
                <button
                  type="button"
                  className="settings-icon-button"
                  title={`Remove ${p}`}
                  onClick={() => removePath(p)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="settings-add-row">
            <input
              type="text"
              className="settings-input"
              placeholder="~/some-folder"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") addPath();
              }}
            />
            <button
              type="button"
              className="settings-button"
              title="Add to watch list"
              onClick={addPath}
            >
              <Plus size={12} />
              Add
            </button>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="section-label">Hidden repositories</div>
            {settings.hidden_repo_ids && settings.hidden_repo_ids.length > 0 && (
              <button
                type="button"
                className="settings-button settings-button-quiet"
                title="Restore every hidden repository"
                onClick={unhideAllRepos}
              >
                <Eye size={12} />
                Unhide all
              </button>
            )}
          </div>
          <div className="settings-row-hint settings-hint-block">
            Repositories you removed from the discovered list using <em>Hide</em>. They stay out of the Repositories screen until restored here.
          </div>
          <ul className="settings-list">
            {(!settings.hidden_repo_ids || settings.hidden_repo_ids.length === 0) && (
              <li className="settings-empty">Nothing hidden.</li>
            )}
            {settings.hidden_repo_ids?.map((id) => {
              const { prefix, rest } = prettyHiddenId(id);
              return (
                <li key={id} className="settings-list-item">
                  <span className="settings-list-text settings-hidden-id">
                    {prefix && <span className="settings-hidden-id-prefix">{prefix}</span>}
                    <span className="settings-hidden-id-rest">{rest}</span>
                  </span>
                  <button
                    type="button"
                    className="settings-icon-button"
                    title={`Unhide ${id}`}
                    onClick={() => unhideRepo(id)}
                  >
                    <Eye size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="settings-section">
          <div className="section-label">watsonx.ai</div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">Status</div>
              <div className="settings-row-hint settings-status-line">
                Active model: <code>{aiStatus?.model ?? "—"}</code>
                <span
                  className={`settings-health-pill ${healthClass(activeHealth?.status)}`}
                >
                  <span
                    className={`settings-health-dot ${healthClass(activeHealth?.status)}`}
                    aria-hidden="true"
                  />
                  {healthLabel(activeHealth?.status)}
                </span>
                {activeHealth?.history && activeHealth.history.length > 0 && (
                  <span
                    className="settings-health-history"
                    aria-label="Last 5 probe results"
                  >
                    {activeHealth.history.map((entry, idx) => (
                      <span
                        key={`${entry.checkedAt}-${idx}`}
                        className={`settings-health-history-box ${historyBoxClass(entry.status)}`}
                        title={historyBoxTitle(entry)}
                      />
                    ))}
                  </span>
                )}
              </div>
              {aiStatus && !aiStatus.configured && (
                <div className="settings-warning">
                  <Warning size={12} />
                  Missing: {aiStatus.missing.join(", ")}
                </div>
              )}
            </div>
            <button
              type="button"
              className="settings-button"
              title="Re-check watsonx configuration"
              onClick={refreshAI}
              disabled={refreshingAI}
            >
              <ArrowsClockwise
                size={12}
                className={refreshingAI ? "motion-spin" : undefined}
              />
              Refresh
            </button>
          </div>
          <div
            className="settings-model-list"
            role="radiogroup"
            aria-label="watsonx.ai models"
          >
            {KNOWN_MODELS.map((model) => {
              const health = healthByModel.get(model);
              const selected = selectedModel === model;
              return (
                <button
                  key={model}
                  type="button"
                  className={`settings-model-option${selected ? " is-selected" : ""}`}
                  role="radio"
                  aria-checked={selected}
                  title={modelHealthTitle(model, health)}
                  onClick={() => setModelInput(model)}
                >
                  <span
                    className={`settings-health-dot ${healthClass(health?.status)}`}
                    aria-hidden="true"
                  />
                  <span className="settings-model-name">{model}</span>
                  <span className={`settings-model-health ${healthClass(health?.status)}`}>
                    {healthLabel(health?.status)}
                  </span>
                  {health?.reason && (
                    <span className="settings-model-reason">{health.reason}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="settings-row-hint settings-hint-block">
            Granite models are retired regularly. Type any model ID below or pick one above.
          </div>
          <div className="settings-add-row">
            <input
              type="text"
              list="watsonx-models"
              className="settings-input"
              placeholder="ibm/granite-4-h-small"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              spellCheck={false}
            />
            <datalist id="watsonx-models">
              {KNOWN_MODELS.map((m) => (
                <option value={m} key={m} />
              ))}
            </datalist>
            <button
              type="button"
              className="settings-button"
              title="Save model preference"
              onClick={saveModel}
            >
              Save
            </button>
          </div>

          <div className="settings-credentials">
            <div className="section-label settings-credentials-label">Credentials</div>
            <div className="settings-row-hint settings-hint-block">
              Required to use any AI feature. Stored on this device only, encrypted with the OS keystore when available. Values entered here take precedence over the matching <code>WATSONX_*</code> environment variables, which still work when running from source (<code>npm run dev</code>).
            </div>

            <div className="settings-credential-status-row">
              <CredentialBadge label="API key" source={credSource?.api_key} />
              <CredentialBadge label="Project ID" source={credSource?.project_id} />
              <CredentialBadge label="URL" source={credSource?.url} />
            </div>

            <div className="settings-credential-form">
              <label className="settings-credential-field">
                <span className="settings-credential-label">API key</span>
                <input
                  type="password"
                  className="settings-input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={credSource?.api_key === "stored" ? "Stored. Enter a new value to replace." : "Paste your watsonx.ai API key"}
                  value={credForm.api_key}
                  onChange={(e) => setCredForm((s) => ({ ...s, api_key: e.target.value }))}
                />
              </label>
              <label className="settings-credential-field">
                <span className="settings-credential-label">Project ID</span>
                <input
                  type="password"
                  className="settings-input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={credSource?.project_id === "stored" ? "Stored. Enter a new value to replace." : "Project ID from IBM Cloud watsonx.ai"}
                  value={credForm.project_id}
                  onChange={(e) => setCredForm((s) => ({ ...s, project_id: e.target.value }))}
                />
              </label>
              <label className="settings-credential-field">
                <span className="settings-credential-label">Region URL</span>
                <input
                  type="url"
                  className="settings-input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://us-south.ml.cloud.ibm.com"
                  value={credForm.url}
                  onChange={(e) => setCredForm((s) => ({ ...s, url: e.target.value }))}
                />
              </label>
              <div className="settings-credential-actions">
                <button
                  type="button"
                  className="settings-button"
                  onClick={saveCredentials}
                  disabled={savingCreds}
                >
                  {savingCreds ? "Saving…" : "Save credentials"}
                </button>
                <button
                  type="button"
                  className="settings-button settings-button-quiet"
                  onClick={clearStoredCredentials}
                  disabled={savingCreds}
                  title="Remove all stored credentials from this device. Env vars (if set) still apply."
                >
                  Clear stored
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-label">AI governance</div>
          <div className="settings-governance-grid">
            <div className="settings-governance-card">
              <span>Cached AI outputs</span>
              <strong>{governance.cacheKeys.length}</strong>
              <div className="settings-cache-tags">
                {cacheFeatureCounts.slice(0, 6).map(([feature, count]) => (
                  <code key={feature}>{feature}: {count}</code>
                ))}
              </div>
            </div>
            <div className="settings-governance-card">
              <span>Audit events</span>
              <strong>{governance.audit.length}</strong>
              <div className="settings-row-hint">
                Metadata only: feature, model, size, status, latency. Prompt bodies are not stored.
              </div>
            </div>
          </div>
          <div className="settings-policy-list" aria-label="AI input policy">
            <div>Environment files and git internals are blocked from file inspection.</div>
            <div>Diffs and README data are bounded before they reach watsonx.ai.</div>
            <div>OAuth tokens and watsonx credentials stay in the main process.</div>
          </div>
          <div className="settings-audit-list">
            {governance.audit.length === 0 ? (
              <div className="settings-empty">No AI requests recorded yet.</div>
            ) : (
              governance.audit.slice(0, 8).map((entry) => (
                <div key={entry.id} className={`settings-audit-row is-${entry.status}`}>
                  <span className="settings-audit-feature">{entry.feature}</span>
                  <span className="settings-audit-model">{entry.model}</span>
                  <span>{entry.promptChars} in / {entry.responseChars} out</span>
                  <span>{entry.durationMs}ms</span>
                  <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  {entry.error && <span className="settings-audit-error">{entry.error}</span>}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-label">Accounts</div>
          <div className="settings-accounts">
            <ProviderConnectionPill
              provider="github"
              variant="row"
              state={accountState("github")}
              onConnect={() => handleConnect("github")}
              onDisconnect={() => handleDisconnect("github")}
            />
            <ProviderConnectionPill
              provider="gitlab"
              variant="row"
              state={accountState("gitlab")}
              onConnect={() => handleConnect("gitlab")}
              onDisconnect={() => handleDisconnect("gitlab")}
            />
          </div>
        </section>

        <section className="settings-section">
          <div className="section-label">About</div>
          <div className="settings-about-row">
            <span className="settings-about-brand" aria-label="Overcode logo">
              <img
                className="settings-about-lockup settings-about-lockup-dark"
                src="brand/current/overcode-logo-dark.svg"
                alt=""
                draggable={false}
              />
              <img
                className="settings-about-lockup settings-about-lockup-light"
                src="brand/current/overcode-logo-light.svg"
                alt=""
                draggable={false}
              />
            </span>
            <div className="settings-row-text">
              <div className="settings-row-title">Overcode</div>
              <div className="settings-row-hint">
                Built with IBM Bob. Powered by watsonx.ai Granite. One calm signal across local, GitHub, and GitLab workspaces.
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}

async function loadGovernanceState(): Promise<AIGovernanceState> {
  const [cacheRaw, auditRaw] = await Promise.all([
    ipc.getFromStore("granite_cache").catch(() => ({})),
    ipc.getFromStore("ai_audit_log").catch(() => []),
  ]);
  const cacheKeys =
    cacheRaw && typeof cacheRaw === "object" && !Array.isArray(cacheRaw)
      ? Object.keys(cacheRaw)
      : [];
  const audit = Array.isArray(auditRaw)
    ? auditRaw.filter(isAIAuditEntry).slice(0, 120)
    : [];
  return { cacheKeys, audit };
}

function isAIAuditEntry(value: unknown): value is AIAuditEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<AIAuditEntry>;
  return (
    typeof item.id === "string" &&
    typeof item.feature === "string" &&
    typeof item.model === "string" &&
    (item.status === "ok" || item.status === "error") &&
    typeof item.promptChars === "number" &&
    typeof item.responseChars === "number" &&
    typeof item.durationMs === "number" &&
    typeof item.timestamp === "number"
  );
}

function summarizeCacheKeys(keys: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    const feature = key.split(":")[0] || "unknown";
    counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}
