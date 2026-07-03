import type { CogneeMemoryLedgerEvent } from "../lib/cognee-memory-ledger";

export interface CogneeStatusPillState {
  label: string;
  tone: "good" | "danger" | "muted";
}

export function describeCogneeStatusPill(
  status: { configured: boolean; endpointVerified: boolean } | null,
  error: string | null,
): CogneeStatusPillState {
  if (error) return { label: "Status error", tone: "danger" };
  if (!status || !status.configured) return { label: "Not configured", tone: "muted" };
  if (status.endpointVerified) return { label: "Online", tone: "good" };
  return { label: "Unreachable", tone: "danger" };
}

export function formatCogneeEventDataLabel(event: CogneeMemoryLedgerEvent): string {
  switch (event.operation) {
    case "remember":
      return `${formatRecordCount(event.storedCount)} / ${formatBytes(event.payloadBytes)} ingested`;
    case "recall":
      return `${formatNumber(event.recallItemCount)} ${pluralize(
        event.recallItemCount,
        "hit",
      )} / ${formatBytes(event.payloadBytes)} query`;
    case "improve":
      return `${formatBytes(event.payloadBytes)} improve payload`;
    case "forget":
      return `${formatBytes(event.payloadBytes)} forget payload`;
  }
}

export function formatCloudStorage(
  usage: { storageUsedInBytes: number; storageLimitInBytes: number } | null,
): string {
  if (!usage || usage.storageLimitInBytes <= 0) return "Unavailable";
  return `${formatBytes(usage.storageUsedInBytes)} of ${formatBytes(usage.storageLimitInBytes)}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${formatNumber(bytes)} B`;
}

export function formatRecordCount(value: number): string {
  return `${formatNumber(value)} ${pluralize(value, "record")}`;
}

export function formatEventCount(value: number): string {
  return `${formatNumber(value)} ${pluralize(value, "event")}`;
}

function pluralize(value: number, singular: string): string {
  return value === 1 ? singular : `${singular}s`;
}
