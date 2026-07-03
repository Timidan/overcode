const ENDPOINT_ENV = ["COGNEE_API_URL", "COGNEE_SERVICE_URL", "COGNEE_BASE_URL"] as const;
const PREFERRED_ENDPOINT_ENV = "COGNEE_API_URL";
const REQUEST_TIMEOUT_MS = 8_000;
// Recall is a server-side LLM round trip (GRAPH_COMPLETION); a cold first
// query regularly exceeds the storage timeout, so it gets its own ceiling.
const RECALL_TIMEOUT_MS = 30_000;
const DEFAULT_DATASET_NAME = "overcode_memory";

type CogneeEndpointEnv = (typeof ENDPOINT_ENV)[number];
type RequiredCogneeEnv = typeof PREFERRED_ENDPOINT_ENV;
type MemoryOperation = "remember" | "recall" | "improve" | "forget";

export type MemoryDocumentKind =
  | "repository"
  | "pull_request"
  | "issue"
  | "summary"
  | "fact"
  | "note";

export interface MemoryDocument {
  id: string;
  kind: MemoryDocumentKind;
  title: string;
  summary: string;
  tags?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface MemoryRememberInput {
  documents: MemoryDocument[];
  datasetName?: string;
  sessionId?: string;
  nodeSet?: string[];
}

export interface MemoryRecallQuery {
  query: string;
  datasets?: string[];
  limit?: number;
  filters?: Record<string, string | number | boolean | null>;
  nodeSet?: string[];
}

export interface MemoryImproveInput {
  datasetName?: string;
  documentId?: string;
  feedback: string;
  accepted?: boolean;
}

export interface MemoryForgetInput {
  datasetName?: string;
  id?: string;
}

export interface MemoryStatus {
  enabled: boolean;
  configured: boolean;
  endpointVerified: boolean;
  missing: RequiredCogneeEnv[];
  auth: "api-key" | "none";
  endpoint?: string;
  endpointSource?: CogneeEndpointEnv;
  requestTimeoutMs: number;
  reason?: string;
}

export interface MemoryResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  error?: string;
}

export interface MemoryRememberResult extends MemoryResult {
  stored: number;
}

export interface MemoryRecallItem {
  id: string;
  title: string;
  summary: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryRecallResult extends MemoryResult {
  items: MemoryRecallItem[];
}

export interface MemoryImproveResult extends MemoryResult {
  accepted: boolean;
}

export interface MemoryForgetResult extends MemoryResult {
  forgotten: boolean;
}

export interface MemoryUsageResult extends MemoryResult {
  storageUsedInBytes: number;
  storageLimitInBytes: number;
}

const COGNEE_ROUTES: Record<MemoryOperation, string | null> = {
  remember: "/api/v1/remember",
  recall: "/api/v1/recall",
  improve: "/api/v1/cognify",
  forget: "/api/v1/forget",
};

const DISALLOWED_PAYLOAD_KEYS = [
  "authorization",
  "api_key",
  "apikey",
  "diff",
  "env",
  "password",
  "patch",
  "raw_source",
  "secret",
  "source_code",
  "token",
];

function envValue(name: CogneeEndpointEnv): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function optionalApiKey(): string | undefined {
  const value = process.env.COGNEE_API_KEY?.trim();
  return value || undefined;
}

function endpointConfig(): { url?: string; source?: CogneeEndpointEnv } {
  for (const name of ENDPOINT_ENV) {
    const value = envValue(name);
    if (value) {
      return {
        url: value.replace(/\/+$/, ""),
        source: name,
      };
    }
  }
  return {};
}

function configStatus(): Omit<MemoryStatus, "enabled" | "endpointVerified"> {
  const endpoint = endpointConfig();
  const missing: RequiredCogneeEnv[] = endpoint.url ? [] : [PREFERRED_ENDPOINT_ENV];
  return {
    configured: missing.length === 0,
    missing,
    auth: optionalApiKey() ? "api-key" : "none",
    endpoint: endpoint.url,
    endpointSource: endpoint.source,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  };
}

function routeFor(operation: MemoryOperation): string | null {
  return COGNEE_ROUTES[operation];
}

export function cogneeStatus(): MemoryStatus {
  const base = configStatus();
  return {
    ...base,
    enabled: base.configured,
    endpointVerified: false,
    reason: base.configured ? undefined : `Missing ${ENDPOINT_ENV.join(" or ")}.`,
  };
}

export async function verifiedCogneeStatus(): Promise<MemoryStatus> {
  const base = cogneeStatus();
  if (!base.configured) return base;

  try {
    await cogneeFetch<unknown>("health", "GET", "/health");
    return { ...base, endpointVerified: true, reason: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed.";
    return {
      ...base,
      endpointVerified: false,
      reason: `Cognee endpoint is unreachable: ${message}`,
    };
  }
}

function disabledResult(): MemoryResult | null {
  const status = cogneeStatus();
  if (status.enabled) return null;
  return {
    ok: false,
    skipped: true,
    reason: status.reason,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} cannot be empty.`);
  if (trimmed.length > max) throw new Error(`${name} exceeds ${max} characters.`);
  return trimmed;
}

function assertNoUnsafePayloadShape(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoUnsafePayloadShape(item, `${path}[${index}]`),
    );
    return;
  }
  if (!isPlainObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (DISALLOWED_PAYLOAD_KEYS.includes(normalized)) {
      throw new Error(`${path}.${key} is not accepted by the memory adapter.`);
    }
    assertNoUnsafePayloadShape(child, `${path}.${key}`);
  }
}

function readStringList(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  if (value.length > 20) throw new Error(`${name} cannot contain more than 20 items.`);
  return value.map((item, index) => boundedString(item, `${name}[${index}]`, 80));
}

function datasetName(value: unknown): string {
  if (value === undefined) return DEFAULT_DATASET_NAME;
  return boundedString(value, "datasetName", 120);
}

function readScalarRecord(
  value: unknown,
  name: string,
): Record<string, string | number | boolean | null> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`${name} must be an object.`);
  const entries = Object.entries(value);
  if (entries.length > 40) throw new Error(`${name} cannot contain more than 40 keys.`);
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z0-9:_-]{1,80}$/.test(key)) {
      throw new Error(`${name}.${key} has an unsupported key.`);
    }
    if (
      item !== null &&
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    ) {
      throw new Error(`${name}.${key} must be a string, number, boolean, or null.`);
    }
    output[key] = typeof item === "string" ? item.slice(0, 500) : item;
  }
  return output;
}

function readDocument(value: unknown, index: number): MemoryDocument {
  if (!isPlainObject(value)) throw new Error(`documents[${index}] must be an object.`);
  const kind = value.kind;
  if (
    kind !== "repository" &&
    kind !== "pull_request" &&
    kind !== "issue" &&
    kind !== "summary" &&
    kind !== "fact" &&
    kind !== "note"
  ) {
    throw new Error(`documents[${index}].kind is unsupported.`);
  }
  return {
    id: boundedString(value.id, `documents[${index}].id`, 200),
    kind,
    title: boundedString(value.title, `documents[${index}].title`, 300),
    summary: boundedString(value.summary, `documents[${index}].summary`, 8_000),
    tags: readStringList(value.tags, `documents[${index}].tags`),
    metadata: readScalarRecord(value.metadata, `documents[${index}].metadata`),
  };
}

function readRememberInput(value: unknown): MemoryRememberInput {
  assertNoUnsafePayloadShape(value);
  if (!isPlainObject(value)) throw new Error("Remember payload must be an object.");
  if (!Array.isArray(value.documents)) {
    throw new Error("Remember payload must include documents.");
  }
  if (value.documents.length > 25) {
    throw new Error("Remember payload cannot contain more than 25 documents.");
  }
  return {
    documents: value.documents.map(readDocument),
    datasetName: datasetName(value.datasetName),
    sessionId:
      value.sessionId === undefined
        ? undefined
        : boundedString(value.sessionId, "sessionId", 120),
    nodeSet: readStringList(value.nodeSet, "nodeSet"),
  };
}

function readRecallQuery(value: unknown): MemoryRecallQuery {
  assertNoUnsafePayloadShape(value);
  if (!isPlainObject(value)) throw new Error("Recall payload must be an object.");
  const limit = value.limit === undefined ? undefined : Number(value.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
    throw new Error("Recall limit must be an integer between 1 and 20.");
  }
  return {
    query: boundedString(value.query, "query", 500),
    datasets:
      value.datasets === undefined
        ? [DEFAULT_DATASET_NAME]
        : readStringList(value.datasets, "datasets"),
    limit,
    filters: readScalarRecord(value.filters, "filters"),
    nodeSet: readStringList(value.nodeSet, "nodeSet"),
  };
}

function readImproveInput(value: unknown): MemoryImproveInput {
  assertNoUnsafePayloadShape(value);
  if (!isPlainObject(value)) throw new Error("Improve payload must be an object.");
  return {
    datasetName: datasetName(value.datasetName),
    documentId:
      value.documentId === undefined
        ? undefined
        : boundedString(value.documentId, "documentId", 200),
    feedback: boundedString(value.feedback, "feedback", 2_000),
    accepted: value.accepted === undefined ? undefined : value.accepted === true,
  };
}

function readForgetInput(value: unknown): MemoryForgetInput {
  assertNoUnsafePayloadShape(value);
  if (!isPlainObject(value)) throw new Error("Forget payload must be an object.");
  return {
    datasetName: datasetName(value.datasetName),
    id: value.id === undefined ? undefined : boundedString(value.id, "id", 200),
  };
}

function validationError(error: unknown): MemoryResult {
  return {
    ok: false,
    skipped: true,
    error: error instanceof Error ? error.message : "Invalid memory request.",
  };
}

async function cogneeFetch<T>(
  label: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: BodyInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const baseUrl = endpointConfig().url;
  if (!baseUrl) {
    throw new Error("Cognee is not enabled.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {};
  const apiKey = optionalApiKey();
  if (apiKey) headers["X-Api-Key"] = apiKey;
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Cognee ${label} failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Cognee ${label} timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const OPERATION_TIMEOUTS: Record<MemoryOperation, number> = {
  remember: REQUEST_TIMEOUT_MS,
  recall: RECALL_TIMEOUT_MS,
  improve: REQUEST_TIMEOUT_MS,
  forget: REQUEST_TIMEOUT_MS,
};

async function postCognee<T>(operation: MemoryOperation, body: BodyInit): Promise<T> {
  const route = routeFor(operation);
  if (!route) throw new Error("Cognee is not enabled.");
  return cogneeFetch<T>(operation, "POST", route, body, OPERATION_TIMEOUTS[operation]);
}

function sanitizeDocumentId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "memory-item";
}

function readServerList(response: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(response)) return response.filter(isPlainObject);
  if (isPlainObject(response)) {
    for (const key of ["items", "datasets", "data", "results"]) {
      const value = response[key];
      if (Array.isArray(value)) return value.filter(isPlainObject);
    }
  }
  return [];
}

async function findDatasetId(name: string): Promise<string | undefined> {
  const response = await cogneeFetch<unknown>("forget", "GET", "/api/v1/datasets/");
  for (const item of readServerList(response)) {
    if (item.name === name && typeof item.id === "string") return item.id;
  }
  return undefined;
}

async function datasetIsProcessing(datasetId: string): Promise<boolean> {
  const response = await cogneeFetch<unknown>(
    "forget",
    "GET",
    `/api/v1/datasets/status?dataset_ids=${encodeURIComponent(datasetId)}`,
  );
  if (!isPlainObject(response)) return false;
  return response[datasetId] === "DATASET_PROCESSING_STARTED";
}

async function findDataItemId(datasetId: string, documentId: string): Promise<string | undefined> {
  const safeId = sanitizeDocumentId(documentId);
  const response = await cogneeFetch<unknown>(
    "forget",
    "GET",
    `/api/v1/datasets/${datasetId}/data`,
  );
  for (const item of readServerList(response)) {
    if (typeof item.name !== "string" || typeof item.id !== "string") continue;
    if (item.name.replace(/\.json$/i, "") === safeId) return item.id;
  }
  return undefined;
}

function serviceError(error: unknown): MemoryResult {
  return {
    ok: false,
    skipped: false,
    error: error instanceof Error ? error.message : "Cognee request failed.",
  };
}

function rememberBody(payload: MemoryRememberInput): FormData {
  const body = new FormData();
  for (const document of payload.documents) {
    const documentFile = new Blob([JSON.stringify(document, null, 2)], {
      type: "application/json",
    });
    body.append("data", documentFile, `${sanitizeDocumentId(document.id)}.json`);
  }
  body.set("datasetName", payload.datasetName ?? DEFAULT_DATASET_NAME);
  // Session-routed remembers land in the session cache instead of the dataset's
  // data records, which makes them unaddressable for id-specific forget — so
  // session attribution stays strictly opt-in.
  if (payload.sessionId) body.set("session_id", payload.sessionId);
  for (const nodeSet of payload.nodeSet ?? []) {
    body.append("node_set", nodeSet);
  }
  body.set("run_in_background", "true");
  return body;
}

function recallBody(payload: MemoryRecallQuery): string {
  return JSON.stringify({
    query: payload.query,
    datasets: payload.datasets ?? [DEFAULT_DATASET_NAME],
    searchType: "GRAPH_COMPLETION",
    topK: payload.limit ?? 10,
    onlyContext: true,
    includeReferences: true,
    nodeName: payload.nodeSet?.length ? payload.nodeSet : undefined,
  });
}

function improveBody(payload: MemoryImproveInput): string {
  return JSON.stringify({
    datasets: [payload.datasetName ?? DEFAULT_DATASET_NAME],
    runInBackground: true,
    customPrompt: payload.feedback,
  });
}

function forgetBody(payload: MemoryForgetInput): string {
  return JSON.stringify({
    dataset: payload.datasetName ?? DEFAULT_DATASET_NAME,
    memoryOnly: true,
  });
}

function recallText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function normalizeRecallItems(response: unknown): MemoryRecallItem[] {
  const source = Array.isArray(response)
    ? response
    : isPlainObject(response) && Array.isArray(response.results)
      ? response.results
      : isPlainObject(response) && Array.isArray(response.items)
        ? response.items
        : [];

  return source.slice(0, 20).map((item, index) => {
    if (!isPlainObject(item)) {
      return {
        id: `cognee:${index}`,
        title: `Memory result ${index + 1}`,
        summary: recallText(item).slice(0, 2_000),
      };
    }
    const id = recallText(item.id ?? item.uuid ?? `cognee:${index}`).slice(0, 200);
    const summary = recallText(
      item.summary ?? item.text ?? item.content ?? item.result ?? item,
    ).slice(0, 2_000);
    const score = typeof item.score === "number" ? item.score : undefined;
    return {
      id,
      title: recallText(item.title ?? item.name ?? `Memory result ${index + 1}`).slice(
        0,
        300,
      ),
      summary,
      score,
      metadata: isPlainObject(item.metadata) ? item.metadata : undefined,
    };
  });
}

export async function cogneeUsage(): Promise<MemoryUsageResult> {
  const empty = { storageUsedInBytes: 0, storageLimitInBytes: 0 };
  const disabled = disabledResult();
  if (disabled) return { ...disabled, ...empty };

  try {
    const response = await cogneeFetch<unknown>("usage", "GET", "/api/v1/quotas/usage");
    if (!isPlainObject(response)) {
      return { ok: false, skipped: false, ...empty, error: "Unexpected usage response." };
    }
    return {
      ok: true,
      skipped: false,
      storageUsedInBytes:
        typeof response.storageUsedInBytes === "number" ? response.storageUsedInBytes : 0,
      storageLimitInBytes:
        typeof response.storageLimitInBytes === "number" ? response.storageLimitInBytes : 0,
    };
  } catch (error) {
    return { ...serviceError(error), ...empty };
  }
}

export async function rememberMemory(raw: unknown): Promise<MemoryRememberResult> {
  let payload: MemoryRememberInput;
  try {
    payload = readRememberInput(raw);
  } catch (error) {
    return { ...validationError(error), stored: 0 };
  }

  const disabled = disabledResult();
  if (disabled) return { ...disabled, stored: 0 };

  try {
    await postCognee<unknown>("remember", rememberBody(payload));
    return { ok: true, skipped: false, stored: payload.documents.length };
  } catch (error) {
    return { ...serviceError(error), stored: 0 };
  }
}

export async function recallMemory(raw: unknown): Promise<MemoryRecallResult> {
  let payload: MemoryRecallQuery;
  try {
    payload = readRecallQuery(raw);
  } catch (error) {
    return { ...validationError(error), items: [] };
  }

  const disabled = disabledResult();
  if (disabled) return { ...disabled, items: [] };

  try {
    const response = await postCognee<unknown>("recall", recallBody(payload));
    return {
      ok: true,
      skipped: false,
      items: normalizeRecallItems(response),
    };
  } catch (error) {
    return { ...serviceError(error), items: [] };
  }
}

export async function improveMemory(raw: unknown): Promise<MemoryImproveResult> {
  let payload: MemoryImproveInput;
  try {
    payload = readImproveInput(raw);
  } catch (error) {
    return { ...validationError(error), accepted: false };
  }

  const disabled = disabledResult();
  if (disabled) return { ...disabled, accepted: false };

  try {
    await postCognee<unknown>("improve", improveBody(payload));
    return { ok: true, skipped: false, accepted: true };
  } catch (error) {
    return { ...serviceError(error), accepted: false };
  }
}

export async function forgetMemory(raw: unknown): Promise<MemoryForgetResult> {
  let payload: MemoryForgetInput;
  try {
    payload = readForgetInput(raw);
  } catch (error) {
    return { ...validationError(error), forgotten: false };
  }

  const disabled = disabledResult();
  if (disabled) return { ...disabled, forgotten: false };

  if (payload.id) {
    const dataset = payload.datasetName ?? DEFAULT_DATASET_NAME;
    try {
      const datasetId = await findDatasetId(dataset);
      if (!datasetId) {
        return {
          ok: false,
          skipped: false,
          forgotten: false,
          reason: `Dataset "${dataset}" was not found on the Cognee server.`,
        };
      }
      if (await datasetIsProcessing(datasetId)) {
        return {
          ok: false,
          skipped: false,
          forgotten: false,
          reason: `Dataset "${dataset}" is still processing on the Cognee server; retry the forget in a moment.`,
        };
      }
      const dataId = await findDataItemId(datasetId, payload.id);
      if (!dataId) {
        return {
          ok: false,
          skipped: false,
          forgotten: false,
          reason: `No stored memory matched id "${payload.id}" in dataset "${dataset}".`,
        };
      }
      try {
        await cogneeFetch<unknown>(
          "forget",
          "DELETE",
          `/api/v1/datasets/${datasetId}/data/${dataId}`,
        );
      } catch (error) {
        return {
          ...serviceError(error),
          forgotten: false,
          reason:
            "Cognee could not delete the memory yet; it may still be processing. Retry in a moment.",
        };
      }
      return { ok: true, skipped: false, forgotten: true };
    } catch (error) {
      return { ...serviceError(error), forgotten: false };
    }
  }

  try {
    await postCognee<unknown>("forget", forgetBody(payload));
    return { ok: true, skipped: false, forgotten: true };
  } catch (error) {
    return { ...serviceError(error), forgotten: false };
  }
}
