import { useEffect, useState } from "react";
import { ipc, type CommitStat } from "../lib/ipc";
import "./CommitGraph.css";

interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

const STATUS_LABEL: Record<string, string> = {
  A: "ADD",
  M: "MOD",
  D: "DEL",
  R: "REN",
  C: "CPY",
  T: "TYP",
  U: "CNF",
};

// Red is reserved for failure signals elsewhere in the app — keep the author
// palette to five non-alarming hues so the per-row color never reads as a
// problem state.
const AUTHOR_COLORS = [
  "var(--color-accent-green)",
  "var(--color-accent-blue)",
  "var(--color-accent-purple)",
  "var(--color-accent-amber)",
  "var(--color-accent-cyan)",
];

function authorColor(author: string): string {
  const key = (author || "unknown").trim().toLowerCase();
  let sum = 0;
  for (let i = 0; i < key.length; i += 1) {
    sum += key.charCodeAt(i);
  }
  return AUTHOR_COLORS[sum % AUTHOR_COLORS.length];
}

function isMergeCommit(commit: Commit): boolean {
  return /^Merge\b/.test(commit.message ?? "");
}

function statusClass(status?: string): string {
  if (!status) return "stat-row-status";
  return `stat-row-status stat-row-status-${status.toLowerCase()}`;
}

function statusText(status?: string): string {
  if (!status) return "MOD";
  return STATUS_LABEL[status] ?? status;
}

function normalizeCommitStat(value: unknown, hash: string): CommitStat {
  if (!value || typeof value !== "object") {
    return emptyCommitStat(hash);
  }

  const stat = value as Partial<CommitStat>;
  const files = Array.isArray(stat.files)
    ? stat.files
        .filter((file): file is CommitStat["files"][number] => (
          Boolean(file) &&
          typeof file === "object" &&
          typeof (file as { path?: unknown }).path === "string"
        ))
        .map((file) => ({
          path: file.path,
          insertions: safeNumber(file.insertions),
          deletions: safeNumber(file.deletions),
          binary: Boolean(file.binary),
          status: typeof file.status === "string" ? file.status : undefined,
          from: typeof file.from === "string" ? file.from : undefined,
        }))
    : [];

  return {
    hash: typeof stat.hash === "string" && stat.hash ? stat.hash : hash,
    files,
    insertions: safeNumber(stat.insertions),
    deletions: safeNumber(stat.deletions),
    changed: safeNumber(stat.changed, files.length),
    isRoot: Boolean(stat.isRoot),
  };
}

function emptyCommitStat(hash: string): CommitStat {
  return {
    hash,
    files: [],
    insertions: 0,
    deletions: 0,
    changed: 0,
    isRoot: false,
  };
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

interface Props {
  repoPath: string;
  branch?: string;
  onSelectCommit?: (hash: string) => void;
}

export function CommitGraph({ repoPath, branch = "main", onSelectCommit }: Props) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedStat, setSelectedStat] = useState<CommitStat | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [pageSize] = useState(100);

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const next = await ipc.getGitLog(repoPath, commits.length + pageSize);
      setCommits(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load commits");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCommits([]);
    setSelectedHash(null);
    setSelectedStat(null);
    setSelectedError(null);
    let cancelled = false;
    setLoading(true);
    setError(null);
    ipc
      .getGitLog(repoPath, pageSize)
      .then((next) => {
        if (cancelled) return;
        setCommits(next);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, pageSize]);

  async function selectCommit(commit: Commit) {
    onSelectCommit?.(commit.hash);

    if (selectedHash === commit.hash) {
      setSelectedHash(null);
      setSelectedStat(null);
      setSelectedError(null);
      return;
    }

    setSelectedHash(commit.hash);
    setSelectedStat(null);
    setSelectedError(null);
    setSelectedLoading(true);
    try {
      const stat = await ipc.getCommitStat(repoPath, commit.hash);
      setSelectedStat(normalizeCommitStat(stat, commit.hash));
    } catch (error) {
      setSelectedError(error instanceof Error ? error.message : "Failed to load commit details");
    } finally {
      setSelectedLoading(false);
    }
  }

  if (loading && commits.length === 0) {
    return <div className="commit-graph-state">Loading commits…</div>;
  }
  if (error && commits.length === 0) {
    return (
      <div className="commit-graph-state">
        <div className="commit-graph-error">
          Unable to load commits from this repository.
        </div>
        <div className="commit-graph-hint">
          This workspace may not expose a readable Git history yet. Open a local Git repository to see commits.
        </div>
      </div>
    );
  }
  if (commits.length === 0) {
    return <div className="commit-graph-state">No commits yet.</div>;
  }

  return (
    <div className="commit-graph">
      <div className="commit-history-summary">
        <span>{commits.length} commits loaded</span>
        <span>{branch}</span>
      </div>

      <ol className="commit-list" aria-label="Commit history">
        {commits.map((commit) => {
          const selected = commit.hash === selectedHash;
          const merge = isMergeCommit(commit);
          const dotColor = merge ? "var(--color-accent-purple)" : authorColor(commit.author);
          return (
          <li key={commit.hash} className="commit-list-item">
            <button
              type="button"
              className={`commit-list-button${selected ? " commit-list-button-active" : ""}${merge ? " commit-list-button-merge" : ""}`}
              onClick={() => void selectCommit(commit)}
              title={commit.hash}
              aria-expanded={selected}
            >
              {merge ? (
                <span
                  className="commit-list-glyph commit-list-glyph-merge"
                  style={{ color: dotColor }}
                  aria-hidden="true"
                  title="Merge commit"
                >
                  Y
                </span>
              ) : (
                <span
                  className="commit-list-dot"
                  style={{ background: dotColor }}
                  aria-hidden="true"
                />
              )}
              <span className="commit-list-main">
                <span className="commit-list-message">{firstLine(commit.message)}</span>
                <span className="commit-list-meta">
                  {commit.author || "unknown"} · {formatCommitDate(commit.date)}
                </span>
              </span>
              <code className="commit-list-hash">{shortHash(commit.hash)}</code>
            </button>
            {selected && (
              <div className="commit-detail" aria-live="polite">
                <div className="commit-detail-head">
                  <span>{shortHash(commit.hash)}</span>
                  <span>{commit.author || "unknown"}</span>
                  <span>{formatCommitDate(commit.date)}</span>
                </div>
                {selectedLoading && (
                  <div className="commit-detail-state">Loading file changes…</div>
                )}
                {!selectedLoading && selectedError && (
                  <div className="commit-detail-state commit-detail-error">
                    {selectedError}
                  </div>
                )}
                {!selectedLoading && !selectedError && selectedStat && (
                  <CommitStatView stat={selectedStat} />
                )}
              </div>
            )}
          </li>
          );
        })}
      </ol>

      <button
        className="commit-graph-more"
        type="button"
        title="Fetch the next 100 commits from this repository"
        onClick={loadMore}
        disabled={loading}
      >
        {loading ? "Loading…" : "Load 100 more"}
      </button>
    </div>
  );
}

function firstLine(value: string): string {
  return value.split("\n")[0]?.trim() || "(no commit message)";
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

function formatCommitDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "unknown date";
  return new Date(timestamp).toLocaleString();
}

function CommitStatView({ stat }: { stat: CommitStat }) {
  const files = Array.isArray(stat.files) ? stat.files : [];
  let maxRowTotal = 0;
  for (const file of files) {
    const total = file.insertions + file.deletions;
    if (total > maxRowTotal) maxRowTotal = total;
  }

  if (files.length === 0) {
    return (
      <div className="commit-detail-state">
        No file changes available for this commit.
      </div>
    );
  }

  return (
    <div className="commit-stat">
      <ul className="commit-stat-list">
        {files.map((file) => {
          const total = file.insertions + file.deletions;
          const insWidth = maxRowTotal === 0 ? 0 : (file.insertions / maxRowTotal) * 100;
          const delWidth = maxRowTotal === 0 ? 0 : (file.deletions / maxRowTotal) * 100;
          return (
            <li key={`${file.from ?? ""}::${file.path}`} className="commit-stat-row">
              <span className={statusClass(file.status)} title={file.status ?? "MOD"}>
                {statusText(file.status)}
              </span>
              <span className="commit-stat-path" title={file.from ? `${file.from} → ${file.path}` : file.path}>
                {file.from ? `${file.from} → ${file.path}` : file.path}
              </span>
              <span className="commit-stat-numbers">
                {file.binary ? (
                  <span className="commit-stat-binary">binary</span>
                ) : (
                  <>
                    <span className="commit-stat-ins">+{file.insertions}</span>
                    <span className="commit-stat-del">-{file.deletions}</span>
                  </>
                )}
              </span>
              <span className="commit-stat-bar" aria-hidden="true">
                <span className="commit-stat-bar-ins" style={{ width: `${insWidth}%` }} />
                <span className="commit-stat-bar-del" style={{ width: `${delWidth}%` }} />
              </span>
              <span className="commit-stat-total sr-only">
                {total} changes ({file.insertions} insertions, {file.deletions} deletions)
              </span>
            </li>
          );
        })}
      </ul>
      <div className="commit-stat-totals">
        <span>
          {stat.changed} file{stat.changed === 1 ? "" : "s"} changed
        </span>
        {stat.insertions > 0 && (
          <span className="commit-stat-ins">+{stat.insertions} insertions</span>
        )}
        {stat.deletions > 0 && (
          <span className="commit-stat-del">-{stat.deletions} deletions</span>
        )}
        {stat.isRoot && <span className="commit-stat-meta">root commit</span>}
      </div>
    </div>
  );
}
