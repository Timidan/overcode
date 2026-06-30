import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, Check, Warning, X } from "@phosphor-icons/react";
import { AIProviderLogo } from "./AIProviderLogo";
import {
  ipc,
  type AIModelCatalogEntry,
  type AIProviderCredentialSourceStatus,
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

const providerDefaults: Record<AIProviderId, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

type Filter = "recommended" | "free" | "paid" | "coding" | "long_context" | "vision" | "all";
type SourceState = Partial<Record<AIProviderId, AIProviderCredentialSourceStatus>>;
type SettingsShape = { ai_model_id?: string };

export function AIProviderSettings() {
  const [providers, setProviders] = useState<AIProviderStatus[]>([]);
  const [credentialSources, setCredentialSources] = useState<SourceState>({});
  const [selectedProvider, setSelectedProvider] = useState<AIProviderId>("openrouter");
  const [models, setModels] = useState<AIModelCatalogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("recommended");
  const [query, setQuery] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [paidAcknowledged, setPaidAcknowledged] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [activating, setActivating] = useState(false);
  const [clearingCredentials, setClearingCredentials] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProviderStatus = providers.find((provider) => provider.providerId === selectedProvider);
  const selectedProviderSources = credentialSources[selectedProvider];
  const selectedCatalogModel = models.find((model) => model.id === selectedModel);
  const selectedModelIsManual = Boolean(selectedModel) && !selectedCatalogModel;
  const requiresBillingAck =
    Boolean(selectedModel) && (selectedModelIsManual || selectedCatalogModel?.free === false);

  const visibleModels = useMemo(
    () => filterModels(models, filter, query),
    [filter, models, query],
  );

  useEffect(() => {
    void refresh();
  }, []);

  async function readStoredModel(): Promise<string> {
    const stored = await ipc.getFromStore("settings").catch(() => null);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return "";
    return ((stored as SettingsShape).ai_model_id ?? "").trim();
  }

  async function loadCredentialSources(): Promise<SourceState> {
    const entries = await Promise.all(
      providerOrder.map(async (providerId) => {
        const result = await ipc.getAIProviderCredentialStatus(providerId) as unknown as Record<
          AIProviderId,
          AIProviderCredentialSourceStatus
        >;
        return [providerId, result[providerId]] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  async function refresh(nextProvider?: AIProviderId): Promise<void> {
    setLoadingProviders(true);
    setError(null);
    try {
      const [providerRows, sources, storedModel] = await Promise.all([
        ipc.listAIProviders(),
        loadCredentialSources(),
        readStoredModel(),
      ]);
      setProviders(providerRows);
      setCredentialSources(sources);
      const activeProvider = providerRows.find((provider) => provider.active)?.providerId ?? "openrouter";
      const providerId = nextProvider ?? activeProvider;
      setSelectedProvider(providerId);
      await refreshModels(providerId, providerId === activeProvider ? storedModel : "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load AI providers.");
      setModels([]);
    } finally {
      setLoadingProviders(false);
    }
  }

  async function refreshModels(providerId: AIProviderId, preferredModel = ""): Promise<void> {
    setLoadingModels(true);
    setError(null);
    try {
      const rows = await ipc.listAIModels(providerId);
      setModels(rows);
      const nextModel = chooseModel(rows, preferredModel);
      setSelectedModel(nextModel);
      setManualModel(nextModel && !rows.some((row) => row.id === nextModel) ? nextModel : "");
      setPaidAcknowledged(false);
    } catch (loadError) {
      setModels([]);
      setSelectedModel("");
      setManualModel("");
      setError(loadError instanceof Error ? loadError.message : "Failed to load model catalog.");
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleSelectProvider(providerId: AIProviderId): Promise<void> {
    if (providerId === selectedProvider && !loadingProviders) return;
    setSelectedProvider(providerId);
    setApiKey("");
    setBaseUrl("");
    setQuery("");
    setFilter("recommended");
    setMessage(null);
    await refresh(providerId);
  }

  async function handleSaveCredentials(): Promise<void> {
    const update: { providerId: AIProviderId; apiKey?: string | null; baseUrl?: string | null } = {
      providerId: selectedProvider,
    };
    if (apiKey.trim()) update.apiKey = apiKey.trim();
    if (baseUrl.trim()) update.baseUrl = baseUrl.trim();
    if (!("apiKey" in update) && !("baseUrl" in update)) {
      setError("Enter an API key or base URL before saving credentials.");
      return;
    }

    setSavingCredentials(true);
    setError(null);
    setMessage(null);
    try {
      await ipc.saveAIProviderCredentials(update);
      setApiKey("");
      setBaseUrl("");
      setMessage(`${providerNames[selectedProvider]} credentials saved.`);
      await refresh(selectedProvider);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save credentials.");
    } finally {
      setSavingCredentials(false);
    }
  }

  async function handleClearCredentials(): Promise<void> {
    setClearingCredentials(true);
    setError(null);
    setMessage(null);
    try {
      await ipc.saveAIProviderCredentials({
        providerId: selectedProvider,
        apiKey: null,
        baseUrl: null,
      });
      setApiKey("");
      setBaseUrl("");
      setMessage(
        `${providerNames[selectedProvider]} stored credentials cleared. Environment-variable fallback still applies if present.`,
      );
      await refresh(selectedProvider);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Failed to clear credentials.");
    } finally {
      setClearingCredentials(false);
    }
  }

  function handleSelectModel(modelId: string): void {
    setSelectedModel(modelId);
    setManualModel("");
    setPaidAcknowledged(false);
    setMessage(null);
  }

  function handleApplyManualModel(): void {
    const value = manualModel.trim();
    if (!value) {
      setError("Enter a model ID before selecting a manual model.");
      return;
    }
    setSelectedModel(value);
    setPaidAcknowledged(false);
    setError(null);
    setMessage("Manual model selected. Activation is still required.");
  }

  async function handleActivate(): Promise<void> {
    const modelId = selectedModel.trim();
    if (!modelId) {
      setError("Choose or enter a model before activating this provider.");
      return;
    }
    if (requiresBillingAck && !paidAcknowledged) {
      setError("Acknowledge provider billing before activating a paid or unknown-pricing model.");
      return;
    }

    setActivating(true);
    setError(null);
    setMessage(null);
    try {
      await ipc.setActiveAIProvider(selectedProvider, modelId);
      setMessage(`${providerNames[selectedProvider]} is now active on ${modelId}.`);
      await refresh(selectedProvider);
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Failed to activate provider.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <section className="settings-section ai-provider-settings">
      <div className="settings-section-header">
        <div>
          <div className="section-label">AI providers</div>
          <div className="settings-row-hint">
            Bring your own key, choose a provider, and activate the model Overcode uses. Catalog and status data stay passive and local here.
          </div>
        </div>
        <button
          type="button"
          className="settings-button"
          onClick={() => void refresh(selectedProvider)}
          disabled={loadingProviders || loadingModels || savingCredentials || activating}
          title="Refresh provider status and catalog"
        >
          <ArrowsClockwise
            size={12}
            className={loadingProviders || loadingModels ? "motion-spin" : undefined}
          />
          Refresh
        </button>
      </div>

      {message && (
        <div className="settings-toast" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}
      {error && (
        <div className="settings-toast ai-provider-settings-toast is-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="ai-provider-grid" role="list" aria-label="AI providers">
        {providerOrder.map((providerId) => {
          const provider = providers.find((item) => item.providerId === providerId);
          return (
            <button
              key={providerId}
              type="button"
              className={[
                "ai-provider-card",
                selectedProvider === providerId ? "is-selected" : "",
                provider?.active ? "is-active" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => void handleSelectProvider(providerId)}
            >
              <div className="ai-provider-card-top">
                <AIProviderLogo providerId={providerId} size="md" decorative />
                <span className="ai-provider-card-name">{providerNames[providerId]}</span>
              </div>
              <div className="ai-provider-card-state-row">
                <span className={`ai-provider-status-pill ${healthClass(provider?.health)}`}>
                  {provider?.active
                    ? "Active"
                    : provider?.configured
                      ? "Configured"
                      : "Not configured"}
                </span>
                <span className={`ai-provider-status-pill ${healthClass(provider?.health)}`}>
                  {healthLabel(provider?.health)}
                </span>
              </div>
              <div className="ai-provider-card-meta">
                {provider?.reason ?? "Provider metadata is available locally."}
              </div>
            </button>
          );
        })}
      </div>

      <div className="ai-provider-workspace">
        <div className="ai-provider-panel">
          <div className="ai-provider-panel-header">
            <AIProviderLogo providerId={selectedProvider} size="lg" decorative />
            <div className="settings-row-text">
              <div className="settings-row-title">{providerNames[selectedProvider]}</div>
              <div className="settings-row-hint">
                {selectedProviderStatus?.configured
                  ? "Credentials are available. Update them here only when you need to replace local values."
                  : "Paste a key to configure this provider on the current device."}
              </div>
            </div>
          </div>

          <div className="ai-provider-source-grid">
            <StatusTile
              label="API key"
              value={credentialLabel(selectedProviderSources?.api_key)}
              tone={sourceTone(selectedProviderSources?.api_key)}
            />
            <StatusTile
              label="Base URL"
              value={baseUrlLabel(selectedProviderSources?.base_url)}
              tone={sourceTone(selectedProviderSources?.base_url)}
            />
            <StatusTile
              label="Health"
              value={healthLabel(selectedProviderStatus?.health)}
              tone={healthClass(selectedProviderStatus?.health)}
            />
          </div>

          <label className="ai-provider-field">
            <span>API key</span>
            <input
              className="settings-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                selectedProviderSources?.api_key === "stored"
                  ? "Stored locally. Enter a new key to replace it."
                  : `${providerNames[selectedProvider]} API key`
              }
            />
          </label>

          <label className="ai-provider-field">
            <span>Base URL</span>
            <input
              className="settings-input"
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={providerDefaults[selectedProvider]}
            />
          </label>

          <div className="settings-row-hint">
            Provider credentials stay on this device. Overcode does not send provider keys into Cognee memory records.
          </div>

          <div className="ai-provider-actions">
            <button
              type="button"
              className="settings-button"
              onClick={() => void handleSaveCredentials()}
              disabled={savingCredentials || clearingCredentials}
            >
              <Check size={12} />
              {savingCredentials ? "Saving..." : "Save credentials"}
            </button>
            <button
              type="button"
              className="settings-button settings-button-quiet"
              onClick={() => void handleClearCredentials()}
              disabled={savingCredentials || clearingCredentials}
              title="Remove stored credentials for this provider from the device"
            >
              <X size={12} />
              {clearingCredentials ? "Clearing..." : "Clear stored"}
            </button>
          </div>
        </div>

        <div className="ai-provider-panel ai-provider-model-panel">
          <div className="ai-provider-model-toolbar">
            <input
              className="settings-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models"
            />
            <div className="ai-provider-filter-row" role="tablist" aria-label="Model filters">
              {(["recommended", "free", "paid", "coding", "long_context", "vision", "all"] as Filter[])
                .map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`ai-provider-filter${filter === item ? " is-active" : ""}`}
                    onClick={() => setFilter(item)}
                  >
                    {filterLabel(item)}
                  </button>
                ))}
            </div>
          </div>

          <div className="settings-row-hint">
            Free and paid labels come from local catalog metadata. Refresh reloads local status and catalog paths only.
          </div>

          <div className="ai-provider-model-list" role="listbox" aria-label={`${providerNames[selectedProvider]} models`}>
            {loadingProviders || loadingModels ? (
              <div className="settings-empty">Loading provider catalog...</div>
            ) : visibleModels.length === 0 ? (
              <div className="settings-empty">
                {models.length === 0
                  ? "No catalog models available for this provider yet."
                  : "No models match the current filter."}
              </div>
            ) : (
              visibleModels.map((model) => {
                const selected = model.id === selectedModel;
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`ai-provider-model-row${selected ? " is-selected" : ""}`}
                    onClick={() => handleSelectModel(model.id)}
                    role="option"
                    aria-selected={selected}
                    title={model.id}
                  >
                    <div className="ai-provider-model-main">
                      <span className="ai-provider-model-name">{model.name}</span>
                      <span className="ai-provider-model-id">{model.id}</span>
                    </div>
                    <div className="ai-provider-model-meta">
                      <span className={`ai-provider-billing-pill ${model.free === false ? "is-paid" : "is-free"}`}>
                        {model.free === false ? "Paid" : "Free"}
                      </span>
                      {typeof model.contextLength === "number" && (
                        <span>{formatContextLength(model.contextLength)}</span>
                      )}
                      <span>{sourceLabel(model.source)}</span>
                    </div>
                    <div className="ai-provider-tag-row">
                      {model.tags.map((tag) => (
                        <span key={tag} className="ai-provider-tag">
                          {filterLabel(tag)}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="ai-provider-manual-row">
            <input
              className="settings-input"
              type="text"
              spellCheck={false}
              value={manualModel}
              onChange={(event) => setManualModel(event.target.value)}
              placeholder={`${selectedProvider}/model-id or provider-native model name`}
            />
            <button
              type="button"
              className="settings-button"
              onClick={handleApplyManualModel}
              disabled={loadingModels}
            >
              Use manual model
            </button>
          </div>

          <div className="ai-provider-selection-summary">
            <div className="settings-row-text">
              <div className="settings-row-title">Selected model</div>
              <div className="settings-row-hint">
                {selectedModel
                  ? selectedCatalogModel
                    ? `${selectedCatalogModel.name} (${selectedCatalogModel.id})`
                    : `${selectedModel} (manual entry)`
                  : "Choose a model from the catalog or enter one manually."}
              </div>
            </div>
            <div className="ai-provider-activation">
              {requiresBillingAck && (
                <label className="ai-provider-billing-warning">
                  <input
                    type="checkbox"
                    checked={paidAcknowledged}
                    onChange={(event) => setPaidAcknowledged(event.target.checked)}
                  />
                  <span>
                    <Warning size={12} />
                    {selectedModelIsManual
                      ? "Manual model pricing is unknown. I understand this activation may use provider-billed capacity."
                      : "I understand this model is provider-billed and not covered by Overcode."}
                  </span>
                </label>
              )}
              <button
                type="button"
                className="settings-button"
                onClick={() => void handleActivate()}
                disabled={activating || loadingModels}
              >
                <Check size={12} />
                {activating ? "Activating..." : "Activate provider"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className={`ai-provider-status-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function chooseModel(models: AIModelCatalogEntry[], preferredModel: string): string {
  const trimmed = preferredModel.trim();
  if (trimmed && models.some((model) => model.id === trimmed)) return trimmed;
  if (trimmed) return trimmed;

  const recommendedFree = models.find((model) => model.free !== false && model.tags.includes("recommended"));
  if (recommendedFree) return recommendedFree.id;

  const free = models.find((model) => model.free !== false);
  if (free) return free.id;

  const recommended = models.find((model) => model.tags.includes("recommended"));
  if (recommended) return recommended.id;

  return models[0]?.id ?? trimmed;
}

function filterModels(models: AIModelCatalogEntry[], filter: Filter, query: string): AIModelCatalogEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  return models.filter((model) => {
    if (filter !== "all" && !matchesFilter(model, filter)) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      model.id,
      model.name,
      model.source,
      ...model.tags,
      ...model.modalities,
    ].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function matchesFilter(model: AIModelCatalogEntry, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "free":
      return model.free !== false || model.tags.includes("free");
    case "paid":
      return model.free === false || model.tags.includes("paid");
    default:
      return model.tags.includes(filter);
  }
}

function filterLabel(filter: Filter | AIModelCatalogEntry["tags"][number]): string {
  switch (filter) {
    case "recommended":
      return "Recommended";
    case "free":
      return "Free";
    case "paid":
      return "Paid";
    case "coding":
      return "Coding";
    case "long_context":
      return "Long context";
    case "vision":
      return "Vision";
    case "all":
      return "All";
  }
}

function healthLabel(status?: AIProviderStatus["health"]): string {
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

function healthClass(status?: AIProviderStatus["health"]): string {
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

function credentialLabel(source?: AIProviderCredentialSourceStatus["api_key"]): string {
  switch (source) {
    case "stored":
      return "Stored locally";
    case "env":
      return "From environment";
    case "none":
    default:
      return "Not set";
  }
}

function baseUrlLabel(source?: AIProviderCredentialSourceStatus["base_url"]): string {
  switch (source) {
    case "stored":
      return "Stored locally";
    case "env":
      return "From environment";
    case "default":
      return "Provider default";
    case "none":
    default:
      return "Not set";
  }
}

function sourceTone(source?: AIProviderCredentialSourceStatus["api_key"] | AIProviderCredentialSourceStatus["base_url"]): string {
  switch (source) {
    case "stored":
      return "is-available";
    case "env":
    case "default":
      return "is-unknown";
    case "none":
    default:
      return "is-not-configured";
  }
}

function sourceLabel(source: AIModelCatalogEntry["source"]): string {
  switch (source) {
    case "curated":
      return "Curated";
    case "live":
      return "Catalog";
    case "manual":
      return "Manual";
  }
}

function formatContextLength(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M ctx`;
  if (value >= 1_000) return `${Math.round(value / 1000)}K ctx`;
  return `${value} ctx`;
}
