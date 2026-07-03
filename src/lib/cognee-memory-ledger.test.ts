import { beforeEach, describe, expect, it } from "vitest";

import type { MemoryRememberInput, MemoryRecallQuery } from "./ipc";
import {
  clearCogneeMemoryLedger,
  loadCogneeMemoryLedger,
  recordCogneeMemoryEvent,
} from "./cognee-memory-ledger";

function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("Cognee memory ledger", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeStorage();
    clearCogneeMemoryLedger(storage);
  });

  it("tracks successful sanitized ingestion volume from remember calls", () => {
    const payload: MemoryRememberInput = {
      datasetName: "overcode_memory",
      documents: [
        {
          id: "impact:one",
          kind: "summary",
          title: "Impact analysis for overcode",
          summary: "Adds a dedicated Cognee dashboard.",
          tags: ["impact", "ai-output"],
          metadata: {
            repo: "overcode",
            branch: "feature/cognee-dashboard",
          },
        },
        {
          id: "worktree:one",
          kind: "summary",
          title: "Cognee worktree memory for overcode",
          summary: "Worktree compare memory was retained.",
          tags: ["cognee", "worktree", "ai-output"],
          metadata: {
            repo: "overcode",
            branch: "feature/cognee-dashboard",
          },
        },
      ],
    };

    recordCogneeMemoryEvent(
      {
        operation: "remember",
        payload,
        result: { ok: true, skipped: false, stored: 2 },
        startedAt: "2026-07-01T10:00:00.000Z",
        durationMs: 83,
      },
      storage,
    );

    const snapshot = loadCogneeMemoryLedger(storage);
    expect(snapshot.summary.ingestedRecords).toBe(2);
    expect(snapshot.summary.remembered).toBe(1);
    expect(snapshot.summary.sanitizedBytesIngested).toBeGreaterThan(100);
    expect(snapshot.summary.estimatedTokensIngested).toBe(
      Math.ceil(snapshot.summary.sanitizedBytesIngested / 4),
    );
    expect(snapshot.events[0]).toMatchObject({
      operation: "remember",
      status: "succeeded",
      datasetName: "overcode_memory",
      repo: "overcode",
      branch: "feature/cognee-dashboard",
      documentCount: 2,
      storedCount: 2,
    });
    expect(snapshot.breakdownBySource).toEqual([
      { source: "impact analysis", events: 1, records: 2, bytes: snapshot.events[0].payloadBytes },
    ]);
  });

  it("reports recall hit rate without counting skipped recalls as hits", () => {
    const query: MemoryRecallQuery = {
      query: "Recall Overcode memory for repo overcode.",
      limit: 5,
      filters: { repo: "overcode" },
    };

    recordCogneeMemoryEvent(
      {
        operation: "recall",
        payload: query,
        result: {
          ok: true,
          skipped: false,
          items: [
            {
              id: "impact:one",
              title: "Impact analysis for overcode",
              summary: "Adds a dedicated Cognee dashboard.",
            },
          ],
        },
        startedAt: "2026-07-01T10:01:00.000Z",
        durationMs: 41,
      },
      storage,
    );
    recordCogneeMemoryEvent(
      {
        operation: "recall",
        payload: query,
        result: {
          ok: false,
          skipped: true,
          reason: "Cognee memory is disabled.",
          items: [],
        },
        startedAt: "2026-07-01T10:02:00.000Z",
        durationMs: 3,
      },
      storage,
    );

    const snapshot = loadCogneeMemoryLedger(storage);
    expect(snapshot.summary.recallQueries).toBe(2);
    expect(snapshot.summary.recallHits).toBe(1);
    expect(snapshot.summary.skipped).toBe(1);
    expect(snapshot.summary.recallHitRate).toBe(50);
    expect(snapshot.events[0]).toMatchObject({
      operation: "recall",
      status: "skipped",
      recallItemCount: 0,
    });
    expect(snapshot.events[1]).toMatchObject({
      operation: "recall",
      status: "succeeded",
      recallItemCount: 1,
      repo: "overcode",
    });
  });

  it("does not create dataset volume rows from recall query payloads", () => {
    recordCogneeMemoryEvent(
      {
        operation: "recall",
        payload: {
          query: "Recall Overcode memory for repo overcode.",
          datasets: ["overcode_memory"],
          limit: 5,
        },
        result: {
          ok: true,
          skipped: false,
          items: [],
        },
        startedAt: "2026-07-01T10:02:00.000Z",
        durationMs: 9,
      },
      storage,
    );

    const snapshot = loadCogneeMemoryLedger(storage);

    expect(snapshot.summary.sanitizedBytesIngested).toBe(0);
    expect(snapshot.breakdownByDataset).toEqual([]);
    expect(snapshot.events[0].payloadBytes).toBeGreaterThan(0);
  });

  it("counts successful improve payload bytes as dashboard data volume without inventing records", () => {
    recordCogneeMemoryEvent(
      {
        operation: "improve",
        payload: {
          datasetName: "overcode_memory",
          feedback: "Dashboard-triggered improvement pass for Overcode memory.",
          accepted: true,
        },
        result: { ok: true, skipped: false, accepted: true },
        startedAt: "2026-07-01T10:03:00.000Z",
        durationMs: 17,
      },
      storage,
    );

    const snapshot = loadCogneeMemoryLedger(storage);
    const payloadBytes = snapshot.events[0].payloadBytes;

    expect(payloadBytes).toBeGreaterThan(0);
    expect(snapshot.summary.ingestedRecords).toBe(0);
    expect(snapshot.summary.sanitizedBytesIngested).toBe(payloadBytes);
    expect(snapshot.summary.estimatedTokensIngested).toBe(Math.ceil(payloadBytes / 4));
    expect(snapshot.breakdownByDataset).toEqual([
      {
        datasetName: "overcode_memory",
        events: 1,
        records: 0,
        bytes: payloadBytes,
      },
    ]);
    expect(snapshot.breakdownBySource).toEqual([]);
  });

  it("caps retained history so dashboard storage cannot grow without bound", () => {
    for (let index = 0; index < 5; index += 1) {
      recordCogneeMemoryEvent(
        {
          operation: "improve",
          payload: {
            datasetName: "overcode_memory",
            feedback: `feedback ${index}`,
          },
          result: { ok: true, skipped: false, accepted: true },
          startedAt: `2026-07-01T10:0${index}:00.000Z`,
          durationMs: index,
        },
        storage,
        { maxEvents: 3 },
      );
    }

    const snapshot = loadCogneeMemoryLedger(storage);
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.events.map((event) => event.startedAt)).toEqual([
      "2026-07-01T10:04:00.000Z",
      "2026-07-01T10:03:00.000Z",
      "2026-07-01T10:02:00.000Z",
    ]);
  });

  it("ignores malformed stored events before they can render NaN dashboard metrics", () => {
    storage.setItem(
      "overcode:cognee-memory-ledger:v1",
      JSON.stringify({
        events: [
          {
            id: "partial-event",
            operation: "remember",
            status: "succeeded",
            source: "manual memory",
            startedAt: "2026-07-01T10:05:00.000Z",
          },
        ],
      }),
    );

    const snapshot = loadCogneeMemoryLedger(storage);

    expect(snapshot.events).toEqual([]);
    expect(snapshot.summary.totalEvents).toBe(0);
    expect(snapshot.summary.sanitizedBytesIngested).toBe(0);
  });
});
