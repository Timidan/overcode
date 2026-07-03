import { describe, expect, it } from "vitest";

import type { CogneeMemoryLedgerEvent } from "../lib/cognee-memory-ledger";
import {
  describeCogneeStatusPill,
  formatCloudStorage,
  formatCogneeEventDataLabel,
  formatEventCount,
  formatRecordCount,
} from "./cognee-dashboard-format";

function event(
  operation: CogneeMemoryLedgerEvent["operation"],
  overrides: Partial<CogneeMemoryLedgerEvent> = {},
): CogneeMemoryLedgerEvent {
  return {
    id: `${operation}:one`,
    operation,
    status: "succeeded",
    source: "memory recall",
    startedAt: "2026-07-01T10:00:00.000Z",
    durationMs: 12,
    documentCount: 0,
    storedCount: 0,
    recallItemCount: 0,
    payloadBytes: 0,
    estimatedTokens: 0,
    titles: [],
    ...overrides,
  };
}

describe("Cognee dashboard event labels", () => {
  it("formats record counts without broken singular labels", () => {
    expect(formatRecordCount(0)).toBe("0 records");
    expect(formatRecordCount(1)).toBe("1 record");
    expect(formatRecordCount(2)).toBe("2 records");
  });

  it("formats event counts without broken singular labels", () => {
    expect(formatEventCount(0)).toBe("0 events");
    expect(formatEventCount(1)).toBe("1 event");
    expect(formatEventCount(2)).toBe("2 events");
  });

  it("labels remember payload bytes as ingested memory data", () => {
    expect(
      formatCogneeEventDataLabel(
        event("remember", {
          storedCount: 1,
          payloadBytes: 1180,
        }),
      ),
    ).toBe("1 record / 1.2 KB ingested");
  });

  it("labels recall payload bytes as query data rather than ingested data", () => {
    expect(
      formatCogneeEventDataLabel(
        event("recall", {
          recallItemCount: 0,
          payloadBytes: 91,
        }),
      ),
    ).toBe("0 hits / 91 B query");
  });

  it("labels improve payload bytes as an improvement payload", () => {
    expect(
      formatCogneeEventDataLabel(
        event("improve", {
          payloadBytes: 120,
        }),
      ),
    ).toBe("120 B improve payload");
  });
});

describe("Cloud storage label", () => {
  it("formats used and limit bytes from the quotas endpoint", () => {
    expect(
      formatCloudStorage({ storageUsedInBytes: 1_048_576, storageLimitInBytes: 536_870_912 }),
    ).toBe("1.0 MB of 512.0 MB");
  });

  it("reports unavailable usage plainly", () => {
    expect(formatCloudStorage(null)).toBe("Unavailable");
  });
});

describe("Cognee status pill", () => {
  it("shows Online only when the endpoint is actually verified", () => {
    expect(
      describeCogneeStatusPill({ configured: true, endpointVerified: true }, null),
    ).toEqual({ label: "Online", tone: "good" });
  });

  it("shows Unreachable when configured but the health check failed", () => {
    expect(
      describeCogneeStatusPill({ configured: true, endpointVerified: false }, null),
    ).toEqual({ label: "Unreachable", tone: "danger" });
  });

  it("shows Not configured when no endpoint is set", () => {
    expect(
      describeCogneeStatusPill({ configured: false, endpointVerified: false }, null),
    ).toEqual({ label: "Not configured", tone: "muted" });
    expect(describeCogneeStatusPill(null, null)).toEqual({
      label: "Not configured",
      tone: "muted",
    });
  });

  it("shows Status error when reading status failed", () => {
    expect(
      describeCogneeStatusPill({ configured: true, endpointVerified: true }, "boom"),
    ).toEqual({ label: "Status error", tone: "danger" });
  });
});
