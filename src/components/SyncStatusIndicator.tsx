import { useMemo } from "react";
import type { WorkspaceActivity } from "../lib/workspace-data";
import "./SyncStatusIndicator.css";

const BUCKET_COUNT = 4;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = WINDOW_MS / BUCKET_COUNT;
const COMMIT_TYPES = new Set(["commit", "push"]);

type SyncState = "quiet" | "busy" | "alert";

interface Props {
  activity?: WorkspaceActivity[];
  dirtyCount?: number;
}

export function SyncStatusIndicator({ activity = [], dirtyCount = 0 }: Props) {
  const { buckets, total, state } = useMemo(() => {
    const now = Date.now();
    const buckets = new Array(BUCKET_COUNT).fill(0);
    let total = 0;
    for (const item of activity) {
      if (!COMMIT_TYPES.has(item.type)) continue;
      const age = now - item.timestamp;
      if (age < 0 || age >= WINDOW_MS) continue;
      const slot = BUCKET_COUNT - 1 - Math.floor(age / BUCKET_MS);
      buckets[slot] += 1;
      total += 1;
    }
    const state: SyncState =
      dirtyCount > 0 ? "alert" : total > 0 ? "busy" : "quiet";
    return { buckets, total, state };
  }, [activity, dirtyCount]);

  const max = Math.max(1, ...buckets);
  const label =
    state === "alert"
      ? `${dirtyCount} dirty`
      : state === "busy"
        ? `${total} commit${total === 1 ? "" : "s"} today`
        : "quiet";

  return (
    <div className={`sync-status sync-status-${state}`}>
      <span className="sync-bars" aria-hidden="true">
        {buckets.map((value, i) => {
          const heightPct = state === "quiet" ? 30 : Math.max(15, (value / max) * 100);
          return <span key={i} className="sync-bar" style={{ height: `${heightPct}%` }} />;
        })}
      </span>
      <span className="sync-status-label">{label}</span>
    </div>
  );
}
