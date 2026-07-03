import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStashLabels } from "../hooks/useStashLabels";
import { ipc } from "../lib/ipc";
import { useAIPanel } from "../store/useAIPanel";
import { useWorkingTree } from "../store/useWorkingTree";
import "./StashList.css";

interface StashListProps {
  repoId: string;
  repoName?: string;
  repoPath: string;
}

interface StashInspectState {
  loading: boolean;
  diff: string;
  files: string[];
  error: string | null;
}

export function StashList({ repoId, repoName, repoPath }: StashListProps) {
  const { stashes, labels, loading, refresh } = useStashLabels(repoId, repoPath);
  const openAIPanel = useAIPanel((state) => state.open);
  const dirtyPaths = useWorkingTree((s) => s.dirtyPathsByRepo[repoPath]);
  const [busy, setBusy] = useState<{ ref: string; action: "pop" | "drop" | "explain" } | null>(
    null,
  );
  const busyRef = busy?.ref ?? null;
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, StashInspectState>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExpandedRef(null);
    setDetails({});
    setError(null);
  }, [repoPath]);

  async function inspect(ref: string) {
    if (expandedRef === ref) {
      setExpandedRef(null);
      return;
    }
    setExpandedRef(ref);
    setError(null);
    if (details[ref] && !details[ref].error) return;

    setDetails((current) => ({
      ...current,
      [ref]: { loading: true, diff: "", files: [], error: null },
    }));
    try {
      const diff = await ipc.getStashDiff(repoPath, ref);
      setDetails((current) => ({
        ...current,
        [ref]: {
          loading: false,
          diff,
          files: extractDiffFiles(diff),
          error: null,
        },
      }));
    } catch (err) {
      setDetails((current) => ({
        ...current,
        [ref]: {
          loading: false,
          diff: "",
          files: [],
          error: err instanceof Error ? err.message : "Could not inspect stash",
        },
      }));
    }
  }

  async function explain(stash: { ref: string; message: string }) {
    setError(null);
    setBusy({ ref: stash.ref, action: "explain" });
    try {
      let detail = details[stash.ref];
      if (!detail || detail.error) {
        const diff = await ipc.getStashDiff(repoPath, stash.ref);
        detail = {
          loading: false,
          diff,
          files: extractDiffFiles(diff),
          error: null,
        };
        setDetails((current) => ({
          ...current,
          [stash.ref]: detail as StashInspectState,
        }));
      }
      openAIPanel("stash", {
        repoId,
        repoName,
        repoPath,
        ref: stash.ref,
        message: stash.message,
        diff: detail.diff,
        files: detail.files,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Stash explanation failed");
    } finally {
      setBusy(null);
    }
  }

  async function handlePop(ref: string) {
    setBusy({ ref, action: "pop" });
    setError(null);
    try {
      await ipc.stashPop(repoPath, ref);
      setExpandedRef(null);
      setDetails((current) => removeKey(current, ref));
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Stash pop failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDrop(ref: string) {
    setBusy({ ref, action: "drop" });
    setError(null);
    try {
      await ipc.stashDrop(repoPath, ref);
      setExpandedRef(null);
      setDetails((current) => removeKey(current, ref));
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Stash drop failed");
    } finally {
      setBusy(null);
    }
  }

  function handleRowKey(ref: string, event: ReactKeyboardEvent<HTMLDivElement>) {
    // Only toggle when the row itself is focused; Enter/Space on the nested
    // Pop/Drop buttons must keep their native behavior.
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void inspect(ref);
  }

  return (
    <div className="stash-list">
      <div className="stash-list-label">Stashes</div>
      {stashes.length === 0 && (
        <div className="stash-list-empty">
          {loading ? "Loading…" : "No stashes"}
        </div>
      )}
      {stashes.map((stash) => {
        const detail = details[stash.ref];
        const expanded = expandedRef === stash.ref;
        return (
        <div key={stash.ref} className="stash-entry">
          <div
            className="stash-item"
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            title={expanded ? "Hide stash files and diff" : "Inspect files and diff in this stash"}
            onClick={() => void inspect(stash.ref)}
            onKeyDown={(event) => handleRowKey(stash.ref, event)}
          >
            <div className="stash-ref" title={stash.ref}>
              {shortRef(stash.ref)}
            </div>
            <div className="stash-label">
              {loading && !labels[stash.ref]
                ? "…"
                : labels[stash.ref] || stash.message}
            </div>
            <StashTime date={stash.date} />
            <button
              type="button"
              className="stash-button"
              title="Apply this stash and remove it from the list"
              onClick={(event) => {
                event.stopPropagation();
                void handlePop(stash.ref);
              }}
              disabled={busyRef !== null}
            >
              {busy?.ref === stash.ref && busy.action === "pop" ? "Popping…" : "Pop"}
            </button>
            <button
              type="button"
              className="stash-button"
              title="Discard this stash"
              onClick={(event) => {
                event.stopPropagation();
                void handleDrop(stash.ref);
              }}
              disabled={busyRef !== null}
            >
              {busy?.ref === stash.ref && busy.action === "drop" ? "Dropping…" : "Drop"}
            </button>
          </div>
          {expanded && (
            <StashDetails
              detail={detail}
              message={stash.message}
              dirtyPaths={dirtyPaths}
              explaining={busy?.ref === stash.ref && busy.action === "explain"}
              busy={busyRef !== null}
              onExplain={() => void explain(stash)}
            />
          )}
        </div>
        );
      })}
      {error && <div className="stash-list-error">{error}</div>}
    </div>
  );
}

function StashDetails({
  detail,
  message,
  dirtyPaths,
  explaining,
  busy,
  onExplain,
}: {
  detail?: StashInspectState;
  message: string;
  dirtyPaths?: string[];
  explaining: boolean;
  busy: boolean;
  onExplain: () => void;
}) {
  if (!detail || detail.loading) {
    return <div className="stash-detail-state">Inspecting stash…</div>;
  }
  if (detail.error) {
    return <div className="stash-detail-state stash-detail-error">{detail.error}</div>;
  }
  const overlap = dirtyPaths
    ? detail.files.filter((file) => dirtyPaths.includes(file)).length
    : 0;
  return (
    <div className="stash-detail">
      <div className="stash-detail-head">
        <span>{detail.files.length} files</span>
        {overlap > 0 && (
          <span className="stash-overlap-note">
            touches {overlap} file{overlap === 1 ? "" : "s"} you're editing
          </span>
        )}
        {message && <span title={message}>{message}</span>}
        <button
          type="button"
          className="stash-button stash-detail-explain"
          title="Ask the active AI provider to explain this stash"
          onClick={onExplain}
          disabled={busy}
        >
          {explaining ? "Explaining…" : "Explain"}
        </button>
      </div>
      {detail.files.length > 0 ? (
        <ul className="stash-file-list">
          {detail.files.slice(0, 80).map((file) => (
            <li key={file} title={file}>{file}</li>
          ))}
        </ul>
      ) : (
        <div className="stash-detail-state">No file paths were returned for this stash.</div>
      )}
      {detail.diff.trim() && (
        <pre className="stash-diff-preview">{truncate(detail.diff, 24_000)}</pre>
      )}
    </div>
  );
}

const STALE_STASH_MS = 7 * 24 * 60 * 60 * 1000;

/** Render a relative time for a stash (e.g. "3h ago") with a stale tint after
 *  seven days. Renders nothing when the underlying timestamp is missing or
 *  unparseable — we don't manufacture dates. */
function StashTime({ date }: { date: string | undefined }) {
  if (!date) return null;
  const timestamp = Date.parse(date);
  if (Number.isNaN(timestamp)) return null;
  const age = Date.now() - timestamp;
  const stale = age > STALE_STASH_MS;
  return (
    <span
      className={`stash-time${stale ? " stash-time-stale" : ""}`}
      title={new Date(timestamp).toLocaleString()}
    >
      {formatRelativeAge(age)}
    </span>
  );
}

function formatRelativeAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Stash refs come in two shapes — git's symbolic "stash@{N}" form or the
 *  raw 40-char object SHA. Render the symbolic form whole; truncate SHAs
 *  to the first 7 chars so the row stays scannable. The full ref lives in
 *  the `title` for hover lookup. */
function shortRef(ref: string): string {
  if (/^stash@\{\d+\}$/.test(ref)) return ref;
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref.slice(0, 7);
  return ref.length > 12 ? `${ref.slice(0, 9)}…` : ref;
}

function extractDiffFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const next = match?.[2] || match?.[1];
      if (next && next !== "/dev/null") files.add(next);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      files.add(line.slice("+++ b/".length).trim());
      continue;
    }
    if (line.startsWith("--- a/")) {
      files.add(line.slice("--- a/".length).trim());
    }
  }
  return Array.from(files).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

function removeKey<T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
