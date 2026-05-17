import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  X,
} from "@phosphor-icons/react";
import { ipc, type GitStatus } from "../lib/ipc";
import { mapConcurrent } from "../lib/concurrency";
import {
  loadRepositories,
  type WorkspaceRepository,
} from "../lib/workspace-data";
import { useLocalChanges } from "../store/useLocalChanges";
import { useNav } from "../store/useNav";
import "./LocalChangesPanel.css";

type StatusFilter = "all" | "M" | "A" | "D" | "?";

interface RepoChanges {
  repo: WorkspaceRepository;
  status: GitStatus;
  error?: string;
}

const STATUS_OPTIONS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "M", label: "Modified" },
  { key: "A", label: "Added" },
  { key: "D", label: "Deleted" },
  { key: "?", label: "Untracked" },
];
const MAX_LOCAL_CHANGES_CONCURRENCY = 6;

const STATUS_BAR_ORDER: Array<{ code: string; label: string; color: string }> =
  [
    { code: "M", label: "Modified", color: "var(--color-accent-amber)" },
    { code: "A", label: "Added", color: "var(--color-accent-green)" },
    { code: "D", label: "Deleted", color: "var(--color-accent-red)" },
    { code: "R", label: "Renamed", color: "var(--color-accent-blue)" },
    { code: "?", label: "Untracked", color: "var(--color-accent-purple)" },
    { code: "U", label: "Conflict", color: "var(--color-accent-red)" },
  ];

interface StatusFileSummary {
  status: string;
}

/** Build the M/A/D/?/U/R segmented bar for a repo. Segments scale to the
 *  100px total; uses `<title>` so each colored chunk hovers to a label
 *  without needing a separate legend row. Empty files arrays render an empty
 *  bar (no segments). */
function StatusBreakdownBar({ files }: { files: StatusFileSummary[] }) {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const code = STATUS_BAR_ORDER.some((s) => s.code === file.status)
      ? file.status
      : "M";
    counts[code] = (counts[code] ?? 0) + 1;
  }
  const total = files.length;
  if (total === 0) {
    return (
      <svg
        className="lcp-status-bar"
        width="100"
        height="6"
        viewBox="0 0 100 6"
        aria-hidden="true"
      >
        <rect
          x="0"
          y="0"
          width="100"
          height="6"
          fill="var(--color-border-subtle)"
        />
      </svg>
    );
  }
  let cursor = 0;
  const segments: Array<{
    code: string;
    label: string;
    color: string;
    x: number;
    width: number;
  }> = [];
  for (const entry of STATUS_BAR_ORDER) {
    const count = counts[entry.code] ?? 0;
    if (count === 0) continue;
    const width = (count / total) * 100;
    segments.push({ ...entry, x: cursor, width });
    cursor += width;
  }
  return (
    <svg
      className="lcp-status-bar"
      width="100"
      height="6"
      viewBox="0 0 100 6"
      aria-hidden="false"
    >
      <rect
        x="0"
        y="0"
        width="100"
        height="6"
        fill="var(--color-border-subtle)"
      />
      {segments.map((seg) => (
        <rect
          key={seg.code}
          x={seg.x}
          y="0"
          width={seg.width}
          height="6"
          fill={seg.color}
        >
          <title>{`${seg.label}: ${counts[seg.code]}`}</title>
        </rect>
      ))}
    </svg>
  );
}

function statusBadgeClass(code: string): string {
  switch (code) {
    case "M":
      return "lcp-status-badge lcp-status-m";
    case "A":
      return "lcp-status-badge lcp-status-a";
    case "D":
      return "lcp-status-badge lcp-status-d";
    case "R":
      return "lcp-status-badge lcp-status-r";
    case "?":
      return "lcp-status-badge lcp-status-q";
    case "U":
      return "lcp-status-badge lcp-status-u";
    default:
      return "lcp-status-badge";
  }
}

export function LocalChangesPanel() {
  const { isOpen, close, refreshTick } = useLocalChanges();
  const navigate = useNav((s) => s.navigate);

  const [data, setData] = useState<RepoChanges[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout>();

  // Debounce search input
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 200);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [search]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const repos = await loadRepositories();
      const withLocal = repos.filter((r) => Boolean(r.local_path));
      const results = await mapConcurrent(
        withLocal,
        MAX_LOCAL_CHANGES_CONCURRENCY,
        async (repo): Promise<RepoChanges | null> => {
          try {
            const status = await ipc.getGitStatus(repo.local_path!, {
              mode: "lite",
            });
            if (!status.files.length) return null;
            return { repo, status };
          } catch (e) {
            return {
              repo,
              status: {
                files: [],
                branch: "?",
                ahead: 0,
                behind: 0,
                diff: "",
                stagedDiff: "",
                fileTree: [],
                readme: "",
                packageSummary: "",
                environmentWarnings: [],
                secretWarnings: [],
                testCommands: [],
              },
              error: e instanceof Error ? e.message : "Failed to read status",
            };
          }
        },
      );
      const cleaned = results.filter((r): r is RepoChanges => r !== null);
      setData(cleaned);
      // Default collapsed state: keep first 3 open, collapse rest.
      const next: Record<string, boolean> = {};
      cleaned.forEach((entry, idx) => {
        next[entry.repo.id] = idx >= 3;
      });
      setCollapsed(next);
      setLastFetched(Date.now());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load workspace repos",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Fire on every open (refreshTick bumps each call to open()).
  useEffect(() => {
    if (!isOpen) return;
    void refresh();
  }, [isOpen, refreshTick, refresh]);

  // Esc closes.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const filtered = useMemo<RepoChanges[]>(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return data
      .map<RepoChanges>((entry) => {
        const files = entry.status.files.filter((f) => {
          const filePath = f.path ?? "";
          if (statusFilter !== "all" && f.status !== statusFilter) return false;
          if (
            q &&
            !filePath.toLowerCase().includes(q) &&
            !entry.repo.name.toLowerCase().includes(q)
          ) {
            return false;
          }
          return true;
        });
        return { ...entry, status: { ...entry.status, files } };
      })
      .filter((entry) => entry.status.files.length > 0 || entry.error);
  }, [data, statusFilter, debouncedSearch]);

  const totalFiles = useMemo(
    () => filtered.reduce((sum, entry) => sum + entry.status.files.length, 0),
    [filtered],
  );

  const toggle = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openRepo = (repoId: string) => {
    close();
    navigate("repo-detail", repoId);
  };

  return (
    <>
      <aside
        className={`lcp-panel${isOpen ? " is-open" : ""}`}
        role="complementary"
        aria-label="Local changes"
        aria-hidden={!isOpen}
      >
        <header className="lcp-header">
          <div className="lcp-header-title">
            <span className="lcp-title-label">Local changes</span>
            <span className="lcp-title-meta">
              {loading
                ? "Scanning workspace…"
                : `${totalFiles} files across ${filtered.length} repos`}
            </span>
          </div>
          <button
            type="button"
            className="lcp-iconbtn"
            onClick={() => void refresh()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh local changes"
          >
            <ArrowsClockwise
              size={14}
              className={loading ? "motion-spin" : undefined}
            />
          </button>
          <button
            type="button"
            className="lcp-iconbtn"
            onClick={close}
            title="Close"
            aria-label="Close local changes"
          >
            <X size={14} />
          </button>
        </header>

        <div className="lcp-filter">
          <input
            type="text"
            className="lcp-search"
            placeholder="Filter by path or repo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
          />
          <div
            className="lcp-chips"
            role="radiogroup"
            aria-label="Status filter"
          >
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={statusFilter === opt.key}
                className={`lcp-chip${statusFilter === opt.key ? " is-active" : ""}`}
                onClick={() => setStatusFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lcp-body">
          {loading && data.length === 0 && (
            <>
              <div className="lcp-skel" />
              <div className="lcp-skel" />
              <div className="lcp-skel" />
              <div className="lcp-skel" />
              <div className="lcp-skel" />
            </>
          )}

          {!loading && error && <div className="lcp-error">{error}</div>}

          {!loading && !error && filtered.length === 0 && (
            <div className="lcp-empty">
              No local changes detected. Working trees are clean.
            </div>
          )}

          {!error &&
            filtered.map((entry) => {
              const isCollapsed = collapsed[entry.repo.id];
              return (
                <section key={entry.repo.id} className="lcp-section">
                  <button
                    type="button"
                    className="lcp-section-header"
                    onClick={() => toggle(entry.repo.id)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="lcp-section-caret" aria-hidden="true">
                      {isCollapsed ? (
                        <CaretRight size={12} />
                      ) : (
                        <CaretDown size={12} />
                      )}
                    </span>
                    <span className="lcp-section-name">{entry.repo.name}</span>
                    <span className="lcp-section-branch">
                      {entry.status.branch}
                    </span>
                    <span className="lcp-section-count">
                      {entry.status.files.length} dirty
                    </span>
                    <StatusBreakdownBar files={entry.status.files} />
                  </button>
                  {!isCollapsed && (
                    <div className="lcp-section-body">
                      {entry.error && (
                        <div className="lcp-error">{entry.error}</div>
                      )}
                      {entry.status.files.map((file, index) => {
                        const filePath = file.path || "(unknown file)";
                        return (
                          <button
                            key={`${entry.repo.id}:${filePath}:${index}`}
                            type="button"
                            className="lcp-file-row"
                            onClick={() => openRepo(entry.repo.id)}
                            title={`Open ${entry.repo.name} to inspect ${filePath}`}
                          >
                            <span className={statusBadgeClass(file.status)}>
                              {file.status}
                            </span>
                            <span className="lcp-file-path">{filePath}</span>
                            {file.staged && (
                              <span className="lcp-staged-pill">staged</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
        </div>

        <footer className="lcp-footer">
          <span>
            {lastFetched
              ? `Last scanned ${formatAge(Date.now() - lastFetched)} ago`
              : "Not yet scanned"}
          </span>
          <button
            type="button"
            className="lcp-footer-action"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </button>
        </footer>
      </aside>
    </>
  );
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}
