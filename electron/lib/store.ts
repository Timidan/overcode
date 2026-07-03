import Store from "electron-store";
import { safeStorage } from "electron";
import nodePath from "node:path";
import { homedir } from "node:os";
import type {
  AIProviderCredentialSource,
  AIProviderCredentialUpdate,
  AIProviderId,
} from "./ai-provider-types";

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
  ai_provider_id?: AIProviderId;
  ai_model_id?: string;
  ai_model_paid_ack?: Record<string, boolean>;
  openrouter_base_url?: string;
  // Secrets live in StoredSettings (encrypted-on-disk when safeStorage is
  // available). The plain string field below is legacy and kept only so
  // older configs can be migrated forward. Never write to it directly.
  openrouter_api_key?: string;
  hidden_repo_ids?: string[];
}

interface StoredSettings extends Settings {
  openrouter_api_key_secret?: StoredSecret;
  ai_provider_secrets?: Partial<Record<AIProviderId, StoredSecret>>;
  ai_provider_base_urls?: Partial<Record<AIProviderId, string>>;
}

export interface StoreSchema {
  accounts: {
    github?: StoredAccount;
    gitlab?: StoredAccount;
  };
  repositories: Repository[];
  discovered_workspaces: WorkspaceCandidate[];
  ignored_workspaces: string[];
  ai_cache: Record<string, unknown>;
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
  settings: StoredSettings;
}

// Initialize electron-store with schema
const store = new Store<StoreSchema>({
  cwd: nodePath.join(homedir(), ".overcode"),
  defaults: {
    accounts: {},
    repositories: [],
    discovered_workspaces: [],
    ignored_workspaces: [],
    ai_cache: {},
    ai_audit_log: [],
    remote_data_cache: {},
    activity: [],
    settings: {
      watch_directories: ["~/projects", "~/Desktop/persona", "~/Desktop"],
    },
  },
});

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
// AI CACHE CRUD
// ============================================================

export function getCache(key: string): unknown {
  const cache = store.get("ai_cache", {});
  return cache[key];
}

export function setCache(key: string, value: unknown): void {
  const cache = store.get("ai_cache", {});
  cache[key] = value;
  store.set("ai_cache", cache);
}

export function listCacheKeys(): string[] {
  const cache = store.get("ai_cache", {});
  return Object.keys(cache);
}

export function deleteCache(key: string): void {
  const cache = store.get("ai_cache", {});
  delete cache[key];
  store.set("ai_cache", cache);
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
// AI PROVIDER CREDENTIALS (encrypted at rest when safeStorage works)
// ============================================================

const providerEnvKeys: Record<AIProviderId, string[]> = {
  openrouter: ["OPENROUTER_API_KEY", "OPENROUTER"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  nvidia: ["NVIDIA_API_KEY", "NIM_API_KEY", "NVAPI_KEY"],
};

const providerBaseUrlEnvKeys: Record<AIProviderId, string[]> = {
  openrouter: ["OPENROUTER_BASE_URL"],
  openai: [],
  anthropic: [],
  gemini: [],
  nvidia: ["NVIDIA_BASE_URL", "NIM_BASE_URL"],
};

function readSecret(field: "openrouter_api_key"): string | undefined {
  const stored = store.get("settings") as StoredSettings | undefined;
  if (!stored) return undefined;
  const secretField = `${field}_secret` as "openrouter_api_key_secret";
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

function readLegacyOpenRouterApiKey(stored: StoredSettings): string | undefined {
  const secret = stored.openrouter_api_key_secret;
  if (secret) {
    const decrypted = decryptSecret(secret);
    if (decrypted !== undefined) return decrypted;
  }
  return stored.openrouter_api_key;
}

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

export function getOpenRouterApiKey(): string | undefined {
  return getAIProviderApiKey("openrouter");
}

export function getOpenRouterBaseUrl(): string | undefined {
  return getAIProviderBaseUrl("openrouter");
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
  } else if (update.providerId === "openrouter") {
    const legacyApiKey = readLegacyOpenRouterApiKey(current);
    if (legacyApiKey !== undefined && next.ai_provider_secrets?.openrouter === undefined) {
      next.ai_provider_secrets!.openrouter = encryptSecret(legacyApiKey);
    }
  }

  if (update.baseUrl !== undefined) {
    if (update.baseUrl === null) delete next.ai_provider_base_urls![update.providerId];
    else next.ai_provider_base_urls![update.providerId] = update.baseUrl;
  } else if (update.providerId === "openrouter") {
    const legacyBaseUrl = current.openrouter_base_url;
    if (legacyBaseUrl !== undefined && next.ai_provider_base_urls?.openrouter === undefined) {
      next.ai_provider_base_urls!.openrouter = legacyBaseUrl;
    }
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
    : ["openrouter", "openai", "anthropic", "gemini", "nvidia"];
  return Object.fromEntries(
    providers.map((id) => {
      const storedKey = Boolean(getAIProviderApiKey(id));
      const envKey = providerEnvKeys[id].some((key) => Boolean(process.env[key]?.trim()));
      const storedBaseUrl = Boolean(getAIProviderBaseUrl(id));
      const envBaseUrl = providerBaseUrlEnvKeys[id].some((key) => Boolean(process.env[key]?.trim()));
      return [
        id,
        {
          api_key: storedKey ? "stored" : envKey ? "env" : "none",
          base_url: storedBaseUrl ? "stored" : envBaseUrl ? "env" : "default",
        },
      ];
    }),
  ) as Record<AIProviderId, AIProviderCredentialSourceStatus>;
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
