import { useEffect, useState } from "react";
import { Plus, X, ArrowsClockwise, Warning, Eye } from "@phosphor-icons/react";
import { AIProviderSettings } from "../components/AIProviderSettings";
import { Sidebar } from "../components/Sidebar";
import { AIProviderLogo } from "../components/AIProviderLogo";
import {
  ProviderConnectionPill,
  type Provider,
  type ProviderState,
} from "../components/ProviderConnectionPill";
import {
  ipc,
  type MemoryStatus,
} from "../lib/ipc";
import "./Settings.css";

interface SettingsShape {
  watch_directories: string[];
  ai_model_id?: string;
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

const MEMORY_DATASET_NAME = "overcode_memory";
const MEMORY_IMPROVE_FEEDBACK =
  "Refine Overcode workspace memory for recurring risks, decisions, modules, and conventions.";

function memoryStatusLabel(status: MemoryStatus | null): string {
  if (!status) return "Unknown";
  if (!status.enabled) return "Disabled";
  if (!status.configured) return "Not configured";
  if (!status.endpointVerified) return "Endpoint unverified";
  return "Enabled";
}

function memoryStatusClass(status: MemoryStatus | null): string {
  if (!status || !status.enabled || !status.configured) return "is-not-configured";
  return status.endpointVerified ? "is-available" : "is-unavailable";
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
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [governance, setGovernance] = useState<AIGovernanceState>({
    cacheKeys: [],
    audit: [],
  });
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryAction, setMemoryAction] = useState<"improve" | "forget" | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);

  async function refresh() {
    const [stored, status, governanceState] = await Promise.all([
      ipc.getFromStore("settings"),
      ipc.getAuthStatus(),
      loadGovernanceState(),
    ]);
    const storedSettings =
      (stored as SettingsShape | undefined) ?? {
        watch_directories: ["~/projects"],
      };
    setSettings(storedSettings);
    setAuth(status);
    setGovernance(governanceState);
  }

  async function refreshMemoryStatus() {
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      setMemoryStatus(await ipc.getMemoryStatus());
    } catch (e) {
      setMemoryStatus(null);
      setMemoryError(e instanceof Error ? e.message : "Failed to load memory status.");
    } finally {
      setMemoryLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    refreshMemoryStatus();
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
    setMessage(`Unhid ${prettyHiddenId(id).rest}. It will reappear on the next scan.`);
  }

  async function unhideAllRepos() {
    if (!settings.hidden_repo_ids || settings.hidden_repo_ids.length === 0) return;
    await persistSettings({ ...settings, hidden_repo_ids: [] });
    setMessage("All hidden repositories restored.");
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

  async function improveMemory() {
    setMemoryAction("improve");
    setMemoryError(null);
    try {
      const result = await ipc.improveMemory({
        datasetName: MEMORY_DATASET_NAME,
        feedback: MEMORY_IMPROVE_FEEDBACK,
        accepted: true,
      });
      if (!result.ok || result.skipped) {
        const detail = result.error ?? result.reason ?? "Memory improve was skipped.";
        setMessage(`Memory improve not applied: ${detail}`);
      } else {
        setMessage("Repo memory improvement requested.");
      }
      await refreshMemoryStatus();
    } catch (e) {
      setMemoryError(e instanceof Error ? e.message : "Failed to improve repo memory.");
    } finally {
      setMemoryAction(null);
    }
  }

  async function forgetMemory() {
    setMemoryAction("forget");
    setMemoryError(null);
    try {
      const result = await ipc.forgetMemory({ datasetName: MEMORY_DATASET_NAME });
      if (!result.ok || result.skipped || !result.forgotten) {
        const detail = result.error ?? result.reason ?? "Memory forget was skipped.";
        setMessage(`Repo memory not cleared: ${detail}`);
      } else {
        setMessage("Configured Overcode memory dataset cleared.");
      }
      await refreshMemoryStatus();
    } catch (e) {
      setMemoryError(e instanceof Error ? e.message : "Failed to clear repo memory.");
    } finally {
      setMemoryAction(null);
    }
  }

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

        <AIProviderSettings />

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
            <div>Diffs and README data are bounded before they reach the AI provider.</div>
            <div>OAuth tokens and AI provider credentials stay in the main process.</div>
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
          <div className="settings-section-header">
            <div className="section-label">Workspace memory governance</div>
            <button
              type="button"
              className="settings-button settings-button-quiet"
              title="Refresh Cognee memory status"
              onClick={refreshMemoryStatus}
              disabled={memoryLoading || memoryAction !== null}
            >
              <ArrowsClockwise
                size={12}
                className={memoryLoading ? "motion-spin" : undefined}
              />
              Refresh
            </button>
          </div>
          <div className="settings-memory-brand">
            <AIProviderLogo providerId="cognee" size="md" decorative />
            <span>Memory retention powered by Cognee</span>
          </div>
          <div className="settings-row-hint settings-hint-block">
            Cognee memory stores structured extracts and references only. Raw source, full diffs, secrets, and credentials are not sent as memory records.
          </div>
          <div className="settings-memory-grid">
            <div className="settings-memory-field">
              <span>Status</span>
              <strong className={`settings-memory-status ${memoryStatusClass(memoryStatus)}`}>
                {memoryLoading && !memoryStatus ? "Loading..." : memoryStatusLabel(memoryStatus)}
              </strong>
            </div>
            <div className="settings-memory-field">
              <span>Endpoint</span>
              <code>{memoryStatus?.endpoint ?? "Not set"}</code>
            </div>
            <div className="settings-memory-field">
              <span>Auth mode</span>
              <strong>{memoryStatus?.auth === "api-key" ? "API key" : "None"}</strong>
            </div>
            <div className="settings-memory-field">
              <span>Timeout</span>
              <strong>
                {typeof memoryStatus?.requestTimeoutMs === "number"
                  ? `${memoryStatus.requestTimeoutMs}ms`
                  : "Unknown"}
              </strong>
            </div>
          </div>
          {memoryStatus && (!memoryStatus.configured || memoryStatus.missing.length > 0) && (
            <div className="settings-warning">
              <Warning size={12} />
              Missing: {memoryStatus.missing.length > 0 ? memoryStatus.missing.join(", ") : "Cognee configuration"}
            </div>
          )}
          {memoryStatus?.reason && (
            <div className="settings-row-hint">{memoryStatus.reason}</div>
          )}
          {memoryError && (
            <div className="settings-warning">
              <Warning size={12} />
              {memoryError}
            </div>
          )}
          <div className="settings-memory-actions">
            <button
              type="button"
              className="settings-button"
              title="Ask Cognee to refine the Overcode memory dataset"
              onClick={improveMemory}
              disabled={memoryAction !== null}
            >
              {memoryAction === "improve" ? "Improving..." : "Improve repo memory"}
            </button>
            <button
              type="button"
              className="settings-button settings-button-danger"
              title="Clear the configured Overcode memory dataset"
              onClick={forgetMemory}
              disabled={memoryAction !== null}
            >
              {memoryAction === "forget" ? "Clearing..." : "Forget repo memory"}
            </button>
          </div>
          <div className="settings-row-hint">
            Forget clears the configured <code>{MEMORY_DATASET_NAME}</code> dataset used by Overcode workspace memory.
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
                Preparing for Cognee-backed repository memory, with BYOK AI providers available for workspace operations.
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
    ipc.getFromStore("ai_cache").catch(() => ({})),
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
