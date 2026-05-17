import Store from "electron-store";
import { safeStorage } from "electron";
import nodePath from "node:path";
import { homedir } from "node:os";

// Type definitions matching PRD section 10 schema
export interface Account {
  username: string;
  token: string;
  avatar_url: string;
}

interface StoredAccount {
  username: string;
  token?: string;
  token_encrypted?: string;
  token_encoding?: "safeStorage:v1";
  avatar_url: string;
}

interface StoredSecret {
  value?: string;
  value_encrypted?: string;
  encoding?: "safeStorage:v1";
}

export interface Repository {
  id: string;
  name: string;
  platform: "github" | "gitlab" | "local";
  remote_url?: string;
  local_path: string;
  last_synced?: number;
}

export interface WorkspaceCandidate {
  id: string;
  name: string;
  local_path: string;
  platform: "github" | "gitlab" | "local";
  remote_url?: string;
  detected_from: ".git" | ".github" | "remote";
  discovered_at: number;
  last_seen_at: number;
}

export interface ActivityItem {
  id: string;
  repo_id: string;
  type: string;
  title: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface Settings {
  watch_directories: string[];
  watsonx_model_id?: string;
  watsonx_url?: string;
  // Secrets live in StoredSettings (encrypted-on-disk when safeStorage is
  // available). The plain string fields below are LEGACY and kept only so
  // older configs can be migrated forward. Never write to them directly.
  watsonx_api_key?: string;
  watsonx_project_id?: string;
  hidden_repo_ids?: string[];
}

interface StoredSettings extends Settings {
  watsonx_api_key_secret?: StoredSecret;
  watsonx_project_id_secret?: StoredSecret;
}

export interface StoreSchema {
  accounts: {
    github?: StoredAccount;
    gitlab?: StoredAccount;
  };
  repositories: Repository[];
  discovered_workspaces: WorkspaceCandidate[];
  ignored_workspaces: string[];
  granite_cache: Record<string, unknown>;
  ai_audit_log: Array<{
    id: string;
    feature: string;
    model: string;
    status: "ok" | "error";
    promptChars: number;
    responseChars: number;
    durationMs: number;
    timestamp: number;
    error?: string;
  }>;
  remote_data_cache: Record<string, unknown>;
  activity: ActivityItem[];
  settings: Settings;
}

// Initialize electron-store with schema
const store = new Store<StoreSchema>({
  cwd: nodePath.join(homedir(), ".overcode"),
  defaults: {
    accounts: {},
    repositories: [],
    discovered_workspaces: [],
    ignored_workspaces: [],
    granite_cache: {},
    ai_audit_log: [],
    remote_data_cache: {},
    activity: [],
    settings: {
      watch_directories: ["~/projects", "~/Desktop/persona", "~/Desktop"],
    },
  },
});

// One-time startup migration: if a legacy plaintext credential field is sitting
// in the on-disk settings (from a pre-v0.1.0 build, or from any future write
// path that bypasses writeSecret()), promote it to the encrypted _secret slot
// and drop the plain field. Run synchronously at module load so the renderer
// never sees the legacy field via store:set's merge-preserve path.
(function migrateLegacyWatsonxCredentials(): void {
  try {
    const current = store.get("settings") as StoredSettings | undefined;
    if (!current) return;
    let touched = false;
    const next: StoredSettings = { ...current };
    for (const field of ["watsonx_api_key", "watsonx_project_id"] as const) {
      const legacy = next[field];
      if (typeof legacy === "string" && legacy.length > 0) {
        const secretField = `${field}_secret` as
          | "watsonx_api_key_secret"
          | "watsonx_project_id_secret";
        if (!next[secretField]) {
          if (safeStorage.isEncryptionAvailable()) {
            next[secretField] = {
              value_encrypted: safeStorage.encryptString(legacy).toString("base64"),
              encoding: "safeStorage:v1",
            };
          } else {
            next[secretField] = { value: legacy };
          }
        }
        delete next[field];
        touched = true;
      }
    }
    if (touched) store.set("settings", next);
  } catch {
    // Migration is best-effort. If it fails the legacy field stays put;
    // store:set's merge-preserve will still keep it out of the renderer.
  }
})();

// ============================================================
// REPOSITORY CRUD
// ============================================================

export function getRepo(id: string): Repository | undefined {
  const repos = store.get("repositories", []);
  return repos.find((r) => r.id === id);
}

export function setRepo(repo: Repository): void {
  const repos = store.get("repositories", []);
  const index = repos.findIndex((r) => r.id === repo.id);

  if (index >= 0) {
    repos[index] = repo;
  } else {
    repos.push(repo);
  }

  store.set("repositories", repos);
}

export function listRepos(): Repository[] {
  return store.get("repositories", []);
}

export function deleteRepo(id: string): void {
  const repos = store.get("repositories", []);
  store.set(
    "repositories",
    repos.filter((r) => r.id !== id),
  );
}

// ============================================================
// ACTIVITY CRUD (with 500-entry cap)
// ============================================================

export function getActivity(limit?: number): ActivityItem[] {
  const activity = store.get("activity", []);
  return limit ? activity.slice(0, limit) : activity;
}

export function addActivity(item: ActivityItem): void {
  const activity = store.get("activity", []);

  // Add new item at the beginning (most recent first)
  activity.unshift(item);

  // Cap at 500 entries - prune oldest
  if (activity.length > 500) {
    activity.splice(500);
  }

  store.set("activity", activity);
}

export function clearActivity(): void {
  store.set("activity", []);
}

// ============================================================
// GRANITE CACHE CRUD
// ============================================================

export function getCache(key: string): unknown {
  const cache = store.get("granite_cache", {});
  return cache[key];
}

export function setCache(key: string, value: unknown): void {
  const cache = store.get("granite_cache", {});
  cache[key] = value;
  store.set("granite_cache", cache);
}

export function listCacheKeys(): string[] {
  const cache = store.get("granite_cache", {});
  return Object.keys(cache);
}

export function deleteCache(key: string): void {
  const cache = store.get("granite_cache", {});
  delete cache[key];
  store.set("granite_cache", cache);
}

// ============================================================
// ACCOUNTS
// ============================================================

export function getAccount(provider: "github" | "gitlab"): Account | undefined {
  const accounts = store.get("accounts", {});
  const account = accounts[provider];
  if (!account) return undefined;
  const token = decryptToken(account);
  if (!token) return undefined;
  return {
    username: account.username,
    token,
    avatar_url: account.avatar_url,
  };
}

export function setAccount(
  provider: "github" | "gitlab",
  account: Account,
): void {
  const accounts = store.get("accounts", {});
  accounts[provider] = {
    username: account.username,
    avatar_url: account.avatar_url,
    ...encryptToken(account.token),
  };
  store.set("accounts", accounts);
}

export function deleteAccount(provider: "github" | "gitlab"): void {
  const accounts = store.get("accounts", {});
  delete accounts[provider];
  store.set("accounts", accounts);
}

// ============================================================
// SETTINGS
// ============================================================

export function getSettings(): Settings {
  return store.get("settings", { watch_directories: ["~/projects"] });
}

export function updateSettings(settings: Partial<Settings>): void {
  const current = getSettings();
  store.set("settings", { ...current, ...settings });
}

// ============================================================
// WATSONX CREDENTIALS (encrypted at rest when safeStorage works)
// ============================================================

function readSecret(field: "watsonx_api_key" | "watsonx_project_id"): string | undefined {
  const stored = store.get("settings") as StoredSettings | undefined;
  if (!stored) return undefined;
  const secretField = `${field}_secret` as
    | "watsonx_api_key_secret"
    | "watsonx_project_id_secret";
  const secret = stored[secretField];
  if (secret) {
    if (secret.value_encrypted && secret.encoding === "safeStorage:v1") {
      if (!safeStorage.isEncryptionAvailable()) return undefined;
      try {
        return safeStorage.decryptString(
          Buffer.from(secret.value_encrypted, "base64"),
        );
      } catch {
        return undefined;
      }
    }
    if (secret.value) return secret.value;
  }
  // Legacy plain-text field migration path.
  return stored[field];
}

function writeSecret(
  field: "watsonx_api_key" | "watsonx_project_id",
  value: string | null,
): void {
  const current = store.get("settings") as StoredSettings | undefined;
  const next: StoredSettings = { ...(current ?? { watch_directories: [] }) };
  const secretField = `${field}_secret` as
    | "watsonx_api_key_secret"
    | "watsonx_project_id_secret";

  // Always clear the legacy plain field so it never lingers post-migration.
  delete next[field];

  if (value === null || value === "") {
    delete next[secretField];
  } else if (safeStorage.isEncryptionAvailable()) {
    next[secretField] = {
      value_encrypted: safeStorage.encryptString(value).toString("base64"),
      encoding: "safeStorage:v1",
    };
  } else {
    next[secretField] = { value };
  }
  store.set("settings", next);
}

export function getWatsonxApiKey(): string | undefined {
  return readSecret("watsonx_api_key");
}

export function getWatsonxProjectId(): string | undefined {
  return readSecret("watsonx_project_id");
}

export function getWatsonxUrl(): string | undefined {
  const stored = store.get("settings") as StoredSettings | undefined;
  return stored?.watsonx_url?.trim() || undefined;
}

export interface WatsonxCredentialUpdate {
  api_key?: string | null;
  project_id?: string | null;
  url?: string | null;
}

export function saveWatsonxCredentials(update: WatsonxCredentialUpdate): void {
  if (update.api_key !== undefined) writeSecret("watsonx_api_key", update.api_key);
  if (update.project_id !== undefined) writeSecret("watsonx_project_id", update.project_id);
  if (update.url !== undefined) {
    const current = store.get("settings") as StoredSettings | undefined;
    const next: StoredSettings = { ...(current ?? { watch_directories: [] }) };
    if (update.url === null || update.url === "") {
      delete next.watsonx_url;
    } else {
      next.watsonx_url = update.url.trim();
    }
    store.set("settings", next);
  }
}

export interface WatsonxCredentialStatus {
  api_key: boolean;
  project_id: boolean;
  url: boolean;
}

export function watsonxCredentialStatus(): WatsonxCredentialStatus {
  return {
    api_key: !!getWatsonxApiKey(),
    project_id: !!getWatsonxProjectId(),
    url: !!getWatsonxUrl(),
  };
}

// ============================================================
// GENERIC STORE ACCESS (for IPC)
// ============================================================

export function getStoreValue(key: string): unknown {
  return store.get(key);
}

export function setStoreValue(key: string, value: unknown): void {
  store.set(key, value);
}

export function listStoreKeys(): string[] {
  return Object.keys(store.store);
}

function encryptToken(token: string): Pick<StoredAccount, "token" | "token_encrypted" | "token_encoding"> {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      token_encrypted: safeStorage.encryptString(token).toString("base64"),
      token_encoding: "safeStorage:v1",
    };
  }
  return { token };
}

function decryptToken(account: StoredAccount): string | undefined {
  if (account.token_encrypted && account.token_encoding === "safeStorage:v1") {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(account.token_encrypted, "base64"));
    } catch {
      return undefined;
    }
  }
  return account.token;
}

export default store;
