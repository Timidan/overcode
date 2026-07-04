import type {
  MemoryForgetInput,
  MemoryImproveInput,
  MemoryRecallQuery,
  MemoryRememberInput,
  MemoryResult,
} from "./ipc";

export const COGNEE_MEMORY_LEDGER_CHANGED_EVENT = "overcode:cognee-memory-ledger-changed";

const LEDGER_STORAGE_KEY = "overcode:cognee-memory-ledger:v1";
const DEFAULT_MAX_EVENTS = 200;

export type CogneeMemoryOperation = "remember" | "recall" | "improve" | "forget";
export type CogneeMemoryEventStatus = "succeeded" | "skipped" | "failed";

export interface CogneeMemoryLedgerEvent {
  id: string;
  operation: CogneeMemoryOperation;
  status: CogneeMemoryEventStatus;
  source: string;
  startedAt: string;
  durationMs: number;
  datasetName?: string;
  repo?: string;
  branch?: string;
  query?: string;
  documentCount: number;
  storedCount: number;
  recallItemCount: number;
  payloadBytes: number;
  estimatedTokens: number;
  accepted?: boolean;
  forgotten?: boolean;
  reason?: string;
  error?: string;
  titles: string[];
}

export interface CogneeMemoryLedgerSummary {
  totalEvents: number;
  remembered: number;
  recalled: number;
  improved: number;
  forgotten: number;
  skipped: number;
  failed: number;
  ingestedRecords: number;
  sanitizedBytesIngested: number;
  estimatedTokensIngested: number;
  recallQueries: number;
  recallHits: number;
  recallHitRate: number;
  lastEvent?: CogneeMemoryLedgerEvent;
}

export interface CogneeMemorySourceBreakdown {
  source: string;
  events: number;
  records: number;
  bytes: number;
}

export interface CogneeMemoryDatasetBreakdown {
  datasetName: string;
  events: number;
  records: number;
  bytes: number;
}

export interface CogneeMemoryLedgerSnapshot {
  events: CogneeMemoryLedgerEvent[];
  summary: CogneeMemoryLedgerSummary;
  breakdownBySource: CogneeMemorySourceBreakdown[];
  breakdownByDataset: CogneeMemoryDatasetBreakdown[];
}

export interface CogneeMemoryLedgerStore {
  events: CogneeMemoryLedgerEvent[];
}

interface RecordCogneeMemoryEventOptions {
  maxEvents?: number;
}

type MemoryPayload =
  | MemoryRememberInput
  | MemoryRecallQuery
  | MemoryImproveInput
  | MemoryForgetInput
  | unknown;

type MemoryOperationResult =
  | (MemoryResult & Record<string, unknown>)
  | Record<string, unknown>
  | unknown;

export interface RecordCogneeMemoryEventInput {
  operation: CogneeMemoryOperation;
  payload: MemoryPayload;
  result: MemoryOperationResult;
  startedAt: string;
  durationMs: number;
}

export function loadCogneeMemoryLedger(storage = getDefaultStorage()): CogneeMemoryLedgerSnapshot {
  const events = readEvents(storage);
  return buildSnapshot(events);
}

export function loadCogneeMemoryLedgerFromStore(
  value: unknown,
): CogneeMemoryLedgerSnapshot {
  return buildSnapshot(readEventsFromStore(value));
}

export function exportCogneeMemoryLedgerStore(
  storage = getDefaultStorage(),
): CogneeMemoryLedgerStore {
  return { events: readEvents(storage) };
}

export function replaceCogneeMemoryLedgerStore(
  value: unknown,
  storage = getDefaultStorage(),
): CogneeMemoryLedgerSnapshot {
  const events = readEventsFromStore(value).slice(0, DEFAULT_MAX_EVENTS);
  writeEvents(events, storage);
  return buildSnapshot(events);
}

export function mergeCogneeMemoryLedgerStore(
  value: unknown,
  storage = getDefaultStorage(),
  maxEvents = DEFAULT_MAX_EVENTS,
): CogneeMemoryLedgerSnapshot {
  const events = mergeEvents(readEvents(storage), readEventsFromStore(value), maxEvents);
  writeEvents(events, storage);
  return buildSnapshot(events);
}

export function clearCogneeMemoryLedger(storage = getDefaultStorage()): void {
  try {
    storage?.removeItem(LEDGER_STORAGE_KEY);
  } catch {
    // Local dashboard telemetry should never break the workflow it observes.
  }
}

export function recordCogneeMemoryEvent(
  input: RecordCogneeMemoryEventInput,
  storage = getDefaultStorage(),
  options: RecordCogneeMemoryEventOptions = {},
): CogneeMemoryLedgerEvent {
  const payloadRecord = asRecord(input.payload);
  const resultRecord = asRecord(input.result);
  const status = eventStatus(resultRecord);
  const payloadBytes = byteLength(stableStringify(input.payload));
  const event: CogneeMemoryLedgerEvent = {
    id: buildEventId(input, payloadBytes),
    operation: input.operation,
    status,
    source: inferSource(input.operation, payloadRecord),
    startedAt: input.startedAt,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    datasetName: inferDatasetName(input.operation, payloadRecord),
    repo: inferRepo(input.operation, payloadRecord),
    branch: inferBranch(input.operation, payloadRecord),
    query: typeof payloadRecord.query === "string" ? payloadRecord.query : undefined,
    documentCount: inferDocumentCount(input.operation, payloadRecord),
    storedCount: inferStoredCount(input.operation, payloadRecord, resultRecord, status),
    recallItemCount: inferRecallItemCount(input.operation, resultRecord),
    payloadBytes,
    estimatedTokens: estimateTokens(payloadBytes),
    accepted: typeof resultRecord.accepted === "boolean" ? resultRecord.accepted : undefined,
    forgotten: typeof resultRecord.forgotten === "boolean" ? resultRecord.forgotten : undefined,
    reason: typeof resultRecord.reason === "string" ? resultRecord.reason : undefined,
    error: typeof resultRecord.error === "string" ? resultRecord.error : undefined,
    titles: inferTitles(payloadRecord),
  };

  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const nextEvents = [event, ...readEvents(storage)].slice(0, maxEvents);
  writeEvents(nextEvents, storage);
  emitLedgerChanged(event);
  return event;
}

function buildSnapshot(events: CogneeMemoryLedgerEvent[]): CogneeMemoryLedgerSnapshot {
  const summary = summarizeEvents(events);
  return {
    events,
    summary,
    breakdownBySource: groupEvents(events.filter(countsAsIngested), (event) => event.source),
    breakdownByDataset: groupEvents(
      events.filter(countsAsDataVolume),
      (event) => event.datasetName ?? "default",
    ).map((entry) => ({
      datasetName: entry.source,
      events: entry.events,
      records: entry.records,
      bytes: entry.bytes,
    })),
  };
}

function summarizeEvents(events: CogneeMemoryLedgerEvent[]): CogneeMemoryLedgerSummary {
  const recalled = events.filter((event) => event.operation === "recall").length;
  const recallHits = events.filter(
    (event) => event.operation === "recall" && event.recallItemCount > 0,
  ).length;
  const sanitizedBytesIngested = events.reduce(
    (total, event) => total + (countsAsDataVolume(event) ? event.payloadBytes : 0),
    0,
  );

  return {
    totalEvents: events.length,
    remembered: events.filter((event) => event.operation === "remember").length,
    recalled,
    improved: events.filter((event) => event.operation === "improve").length,
    forgotten: events.filter((event) => event.operation === "forget").length,
    skipped: events.filter((event) => event.status === "skipped").length,
    failed: events.filter((event) => event.status === "failed").length,
    ingestedRecords: events.reduce(
      (total, event) => total + (countsAsIngested(event) ? event.storedCount : 0),
      0,
    ),
    sanitizedBytesIngested,
    estimatedTokensIngested: estimateTokens(sanitizedBytesIngested),
    recallQueries: recalled,
    recallHits,
    recallHitRate: recalled > 0 ? Math.round((recallHits / recalled) * 100) : 0,
    lastEvent: events[0],
  };
}

function groupEvents(
  events: CogneeMemoryLedgerEvent[],
  getGroup: (event: CogneeMemoryLedgerEvent) => string,
): CogneeMemorySourceBreakdown[] {
  const groups = new Map<string, CogneeMemorySourceBreakdown>();

  for (const event of events) {
    const source = getGroup(event);
    const existing = groups.get(source) ?? { source, events: 0, records: 0, bytes: 0 };
    existing.events += 1;
    if (countsAsIngested(event)) {
      existing.records += event.storedCount;
    }
    if (countsAsDataVolume(event)) {
      existing.bytes += event.payloadBytes;
    }
    groups.set(source, existing);
  }

  return [...groups.values()].sort((left, right) => {
    if (right.records !== left.records) return right.records - left.records;
    if (right.events !== left.events) return right.events - left.events;
    return left.source.localeCompare(right.source);
  });
}

function countsAsIngested(event: CogneeMemoryLedgerEvent): boolean {
  return event.operation === "remember" && event.status === "succeeded" && event.storedCount > 0;
}

function countsAsDataVolume(event: CogneeMemoryLedgerEvent): boolean {
  if (event.status !== "succeeded") return false;
  if (event.operation === "remember") return event.storedCount > 0;
  if (event.operation === "improve") return event.accepted !== false;
  return false;
}

function readEvents(storage: Storage | undefined): CogneeMemoryLedgerEvent[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return [];
    return readEventsFromStore(JSON.parse(raw));
  } catch {
    return [];
  }
}

function readEventsFromStore(value: unknown): CogneeMemoryLedgerEvent[] {
  const store = asRecord(value);
  return Array.isArray(store.events) ? store.events.filter(isLedgerEvent) : [];
}

function writeEvents(events: CogneeMemoryLedgerEvent[], storage: Storage | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(LEDGER_STORAGE_KEY, JSON.stringify({ events }));
  } catch {
    // Dashboard telemetry is best-effort and local-only.
  }
}

function mergeEvents(
  localEvents: CogneeMemoryLedgerEvent[],
  durableEvents: CogneeMemoryLedgerEvent[],
  maxEvents: number,
): CogneeMemoryLedgerEvent[] {
  const byId = new Map<string, CogneeMemoryLedgerEvent>();
  for (const event of [...localEvents, ...durableEvents]) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()]
    .sort((left, right) => eventTime(right) - eventTime(left))
    .slice(0, Math.max(1, maxEvents));
}

function eventStatus(result: Record<string, unknown>): CogneeMemoryEventStatus {
  if (result.skipped === true) return "skipped";
  if (result.ok === false || typeof result.error === "string") return "failed";
  return "succeeded";
}

function inferSource(
  operation: CogneeMemoryOperation,
  payload: Record<string, unknown>,
): string {
  const documents = asRecordArray(payload.documents);
  const firstDocument = documents[0];
  const metadata = asRecord(firstDocument?.metadata);
  const metadataSource = stringValue(metadata.source);
  if (metadataSource) return metadataSource;

  const tags = documents.flatMap((document) => stringArray(document.tags));
  const title = stringValue(firstDocument?.title)?.toLowerCase() ?? "";
  if (tags.includes("impact") || title.includes("impact analysis")) return "impact analysis";
  if (tags.includes("worktree") || title.includes("worktree")) return "worktree compare";

  if (operation === "recall") return "memory recall";
  if (operation === "improve") return "memory improvement";
  if (operation === "forget") return "memory governance";
  return "manual memory";
}

function inferDatasetName(
  operation: CogneeMemoryOperation,
  payload: Record<string, unknown>,
): string | undefined {
  if (typeof payload.datasetName === "string" && payload.datasetName.trim()) {
    return payload.datasetName.trim();
  }
  if (operation === "recall") {
    const datasets = stringArray(payload.datasets);
    return datasets[0];
  }
  return undefined;
}

function inferRepo(
  operation: CogneeMemoryOperation,
  payload: Record<string, unknown>,
): string | undefined {
  const documents = asRecordArray(payload.documents);
  for (const document of documents) {
    const metadata = asRecord(document.metadata);
    const repo = stringValue(metadata.repo) ?? stringValue(metadata.repository);
    if (repo) return repo;
  }

  const filters = asRecord(payload.filters);
  const filteredRepo = stringValue(filters.repo) ?? stringValue(filters.repository);
  if (filteredRepo) return filteredRepo;

  if (operation === "recall" && typeof payload.query === "string") {
    return payload.query.match(/\brepo\s+([^\s.]+)/i)?.[1];
  }

  return undefined;
}

function inferBranch(
  operation: CogneeMemoryOperation,
  payload: Record<string, unknown>,
): string | undefined {
  const documents = asRecordArray(payload.documents);
  for (const document of documents) {
    const branch = stringValue(asRecord(document.metadata).branch);
    if (branch) return branch;
  }

  const filters = asRecord(payload.filters);
  const filteredBranch = stringValue(filters.branch);
  if (filteredBranch) return filteredBranch;

  if (operation === "recall" && typeof payload.query === "string") {
    return payload.query.match(/\bbranch\s+([^\s.]+)/i)?.[1];
  }

  return undefined;
}

function inferDocumentCount(
  operation: CogneeMemoryOperation,
  payload: Record<string, unknown>,
): number {
  if (operation !== "remember") return 0;
  return asRecordArray(payload.documents).length;
}

function inferStoredCount(
  operation: CogneeMemoryOperation,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
  status: CogneeMemoryEventStatus,
): number {
  if (operation !== "remember") return 0;
  if (typeof result.stored === "number" && Number.isFinite(result.stored)) {
    return Math.max(0, Math.round(result.stored));
  }
  return status === "succeeded" ? inferDocumentCount(operation, payload) : 0;
}

function inferRecallItemCount(
  operation: CogneeMemoryOperation,
  result: Record<string, unknown>,
): number {
  if (operation !== "recall") return 0;
  return Array.isArray(result.items) ? result.items.length : 0;
}

function inferTitles(payload: Record<string, unknown>): string[] {
  return asRecordArray(payload.documents)
    .map((document) => stringValue(document.title))
    .filter((title): title is string => Boolean(title))
    .slice(0, 6);
}

function isLedgerEvent(value: unknown): value is CogneeMemoryLedgerEvent {
  const event = asRecord(value);
  return (
    typeof event.id === "string" &&
    isOperation(event.operation) &&
    isStatus(event.status) &&
    typeof event.source === "string" &&
    typeof event.startedAt === "string" &&
    isFiniteNumber(event.durationMs) &&
    isFiniteNumber(event.documentCount) &&
    isFiniteNumber(event.storedCount) &&
    isFiniteNumber(event.recallItemCount) &&
    isFiniteNumber(event.payloadBytes) &&
    isFiniteNumber(event.estimatedTokens) &&
    Array.isArray(event.titles)
  );
}

function isOperation(value: unknown): value is CogneeMemoryOperation {
  return value === "remember" || value === "recall" || value === "improve" || value === "forget";
}

function isStatus(value: unknown): value is CogneeMemoryEventStatus {
  return value === "succeeded" || value === "skipped" || value === "failed";
}

function buildEventId(input: RecordCogneeMemoryEventInput, payloadBytes: number): string {
  return `${Date.parse(input.startedAt) || Date.now()}-${input.operation}-${hashText(
    `${input.startedAt}:${input.operation}:${payloadBytes}`,
  )}`;
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function estimateTokens(bytes: number): number {
  return Math.ceil(Math.max(0, bytes) / 4);
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function eventTime(event: CogneeMemoryLedgerEvent): number {
  return Date.parse(event.startedAt) || 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length) : [];
}

function getDefaultStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function emitLedgerChanged(event: CogneeMemoryLedgerEvent | undefined): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent(COGNEE_MEMORY_LEDGER_CHANGED_EVENT, { detail: event }));
  } catch {
    // Some test and browser fallback environments do not expose CustomEvent.
  }
}
