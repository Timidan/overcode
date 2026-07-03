export type AIProviderId = "openrouter" | "openai" | "anthropic" | "gemini" | "nvidia";

export type AIProviderCredentialSource = "stored" | "env" | "none";

export type AIProviderBaseUrlSource = "stored" | "env" | "default" | "none";

export type AIModelHealthStatus =
  | "available"
  | "unavailable"
  | "not_configured"
  | "unknown";

export interface AIModelHealthHistoryEntry {
  status: AIModelHealthStatus;
  checkedAt: number;
  latencyMs?: number;
}

export interface AIModelHealth {
  model: string;
  status: AIModelHealthStatus;
  reason?: string;
  checkedAt: number | null;
  latencyMs?: number;
  history?: AIModelHealthHistoryEntry[];
}

export interface AIProviderStatus {
  providerId: AIProviderId;
  configured: boolean;
  active: boolean;
  credentialSource: AIProviderCredentialSource;
  baseUrlSource?: AIProviderBaseUrlSource;
  health: AIModelHealthStatus;
  reason?: string;
  account?: AIProviderAccountStatus;
}

export interface AIProviderAccountStatus {
  plan: "free" | "paid" | "unknown";
  isFreeTier?: boolean;
  freeModelDailyLimit?: number;
  freeModelNote?: string;
  limit?: number | null;
  limitRemaining?: number | null;
  usage?: number;
  usageDaily?: number;
  checkedAt: number;
}

export interface AIProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
}

export interface AIProviderCredentialUpdate {
  providerId: AIProviderId;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export type AIModelTag =
  | "recommended"
  | "coding"
  | "long_context"
  | "vision"
  | "paid"
  | "free";

export interface AIModelCatalogEntry {
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
  tags: AIModelTag[];
  source: "live" | "curated" | "manual";
}

export interface AIChatRequest {
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface AIProviderAdapter {
  id: AIProviderId;
  displayName: string;
  defaultBaseUrl?: string;
  defaultModel: string;
  listModels(credentials: AIProviderCredentials): Promise<AIModelCatalogEntry[]>;
  healthCheck(
    credentials: AIProviderCredentials,
    modelId: string,
  ): Promise<AIModelHealth>;
  completeChat(request: AIChatRequest): Promise<string>;
}
