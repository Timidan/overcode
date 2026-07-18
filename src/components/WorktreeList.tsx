import { useCallback, useEffect, useState } from "react";
import {
  ipc,
  type MemoryRecallItem,
  type WorktreeSummaryInput,
} from "../lib/ipc";
import { cogneeRepositoryMemory } from "../lib/cognee-repository-memory";
import { useAIPanel } from "../store/useAIPanel";
import {
  WorktreeRecallCard,
  type WorktreeRecallResult,
  type WorktreeRecallState,
} from "./WorktreeRecallCard";
import "./WorktreeList.css";

interface Worktree {
  path: string;
  branch: string;
  head: string;
  isMain?: boolean;
  locked?: boolean;
  prunable?: boolean;
  dirtyCount?: number;
  ahead?: number;
  behind?: number;
}

export function WorktreeList({
  repoId,
  repoName,
  repoPath,
}: {
  repoId: string;
  repoName: string;
  repoPath: string;
}) {
  const openAIPanel = useAIPanel((state) => state.open);
  const [trees, setTrees] = useState<Worktree[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-path busy sets: rows operate independently, so a single-path value
  // would let one row's completion clear another row's busy state.
  const [summarizingPaths, setSummarizingPaths] = useState<ReadonlySet<string>>(new Set());
  const [inspectingPaths, setInspectingPaths] = useState<ReadonlySet<string>>(new Set());
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [inspectDetails, setInspectDetails] = useState<Record<string, WorktreeInspectState>>({});
  const [recallDetails, setRecallDetails] = useState<Record<string, WorktreeRecallState>>({});
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadWorktrees = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await ipc.getWorktrees(repoPath);
        if (isCancelled()) return;
        setTrees(result as Worktree[]);
        setExpandedPath(null);
        setInspectDetails({});
        setRecallDetails({});
      } catch (err) {
        if (isCancelled()) return;
        setTrees([]);
        setLoadError(err instanceof Error ? err.message : "Could not load worktrees");
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [repoPath],
  );

  useEffect(() => {
    let cancelled = false;
    void loadWorktrees(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadWorktrees]);

  async function inspect(tree: Worktree) {
    if (expandedPath === tree.path) {
      setExpandedPath(null);
      return;
    }
    setExpandedPath(tree.path);
    setError(null);
    // Memory context appears unprompted when a row opens; the card's own
    // state machine handles loading/disabled/empty/error honestly.
    if (!recallDetails[tree.path]) void recall(tree);
    if (inspectDetails[tree.path] && !inspectDetails[tree.path].error) return;

    setInspectingPaths((current) => new Set(current).add(tree.path));
    setInspectDetails((current) => ({
      ...current,
      [tree.path]: { loading: true, input: null, error: null },
    }));
    try {
      const input = await ipc.getWorktreeSummaryInput(repoPath, tree.path);
      setInspectDetails((current) => ({
        ...current,
        [tree.path]: { loading: false, input, error: null },
      }));
    } catch (err) {
      setInspectDetails((current) => ({
        ...current,
        [tree.path]: {
          loading: false,
          input: null,
          error: err instanceof Error ? err.message : "Could not inspect worktree",
        },
      }));
    } finally {
      setInspectingPaths((current) => {
        const next = new Set(current);
        next.delete(tree.path);
        return next;
      });
    }
  }

  async function summarize(tree: Worktree) {
    setSummarizingPaths((current) => new Set(current).add(tree.path));
    setError(null);
    try {
      const input = await ipc.getWorktreeSummaryInput(repoPath, tree.path);
      openAIPanel("worktree", {
        repoId,
        repoName,
        repoPath,
        targetPath: input.targetPath,
        base: input.base,
        target: input.target,
        baseRef: input.baseRef,
        targetRef: input.targetRef,
        branch: input.branch,
        ahead: input.ahead,
        behind: input.behind,
        dirtyFiles: input.dirtyFiles,
        diffStat: input.diffStat,
        nameStatus: input.nameStatus,
        patch: input.patch,
        uncommittedDiff: input.uncommittedDiff,
        uniqueCommits: input.uniqueCommits,
        changedFiles: input.changedFiles,
        baseCandidates: input.baseCandidates,
        worktreeCandidates: input.worktreeCandidates,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not compare worktree");
    } finally {
      setSummarizingPaths((current) => {
        const next = new Set(current);
        next.delete(tree.path);
        return next;
      });
    }
  }

  async function recall(tree: Worktree) {
    setRecallDetails((current) => ({
      ...current,
      [tree.path]: { status: "loading" },
    }));

    try {
      const input = await ipc.getWorktreeSummaryInput(repoPath, tree.path);
      const recalled = await cogneeRepositoryMemory.recallWithStatus({
        source: "worktree inspection",
        repoId,
        repoName: repoName || repoPath,
        branch: input.branch || input.targetRef || undefined,
        paths: input.changedFiles,
        tags: ["worktree", "inspection"],
        limit: 6,
      }, { coldStartRetry: true });
      const recallState: WorktreeRecallState = recalled.status === "ready"
        ? { status: "ready", result: recallItemsToResult(recalled.memory.items) }
        : { status: recalled.status, message: recalled.message };
      setRecallDetails((current) => ({
        ...current,
        [tree.path]: recallState,
      }));
    } catch (err) {
      setRecallDetails((current) => ({
        ...current,
        [tree.path]: {
          status: "error",
          message: err instanceof Error ? err.message : "Could not recall worktree memory",
        },
      }));
    }
  }

  return (
    <section className="worktree-list">
      <header className="worktree-header">
        <span className="section-label">Worktrees</span>
        <span className="worktree-count">{trees.length}</span>
      </header>
      {loading ? (
        <div className="worktree-list-skeleton" aria-hidden="true">
          <span className="worktree-list-skeleton-row" />
          <span className="worktree-list-skeleton-row" />
        </div>
      ) : loadError ? (
        <div className="worktree-error" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => void loadWorktrees()}>
            Retry
          </button>
        </div>
      ) : trees.length === 0 ? (
        <div className="empty">
          No worktrees yet. Create one with git worktree add &lt;path&gt; &lt;branch&gt; to
          work on two branches at once.
        </div>
      ) : (
        <ul className="worktree-rows">
          {trees.map((t) => {
            const expanded = expandedPath === t.path;
            const detail = inspectDetails[t.path];
            const recallDetail = recallDetails[t.path];
            return (
              <li key={t.path} className="worktree-row">
                <div className="worktree-main">
                  <span className="worktree-branch">{t.branch || "(detached)"}</span>
                  {t.isMain && <span className="worktree-chip">main</span>}
                  {t.locked && <span className="worktree-chip">locked</span>}
                  {t.prunable && <span className="worktree-chip is-warning">prunable</span>}
                  <span className="worktree-path" title={t.path}>
                    {shortPath(t.path)}
                  </span>
                </div>
                <div className="worktree-meta">
                  <span title={`Commit ${t.head}`}>{t.head?.slice(0, 7)}</span>
                  <span title="Commits ahead and behind the base branch">
                    {t.ahead ?? 0} ahead · {t.behind ?? 0} behind
                  </span>
                  <span title="Uncommitted files in this worktree">
                    {t.dirtyCount ?? 0} uncommitted
                  </span>
                </div>
                <button
                  type="button"
                  className="worktree-inspect-button"
                  onClick={() => void inspect(t)}
                  disabled={inspectingPaths.has(t.path)}
                  title="Inspect changed files and recalled memory for this worktree"
                >
                  {inspectingPaths.has(t.path) ? "Inspecting…" : expanded ? "Hide" : "Inspect"}
                </button>
                <button
                  type="button"
                  className="worktree-ai-button"
                  onClick={() => summarize(t)}
                  disabled={summarizingPaths.has(t.path)}
                >
                  {summarizingPaths.has(t.path) ? "Summarizing…" : "Summarize"}
                </button>
                {expanded && detail && <WorktreeDetails detail={detail} />}
                {expanded && (
                  <WorktreeRecallCard
                    state={recallDetail}
                    onRetry={() => void recall(t)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <div className="worktree-error">{error}</div>}
    </section>
  );
}

interface WorktreeInspectState {
  loading: boolean;
  input: WorktreeSummaryInput | null;
  error: string | null;
}

function WorktreeDetails({ detail }: { detail?: WorktreeInspectState }) {
  if (!detail || detail.loading) {
    return <div className="worktree-detail-state">Inspecting worktree…</div>;
  }
  if (detail.error) {
    return <div className="worktree-detail-state worktree-detail-error">{detail.error}</div>;
  }
  const input = detail.input;
  if (!input) {
    return <div className="worktree-detail-state">No worktree detail returned.</div>;
  }
  const files = input.changedFiles.slice(0, 120);
  return (
    <div className="worktree-detail">
      <div className="worktree-detail-head">
        <span>
          {input.changedFiles.length} file{input.changedFiles.length === 1 ? "" : "s"} changed
          vs {input.baseRef}
        </span>
      </div>
      {files.length > 0 ? (
        <ul className="worktree-file-list">
          {files.map((file) => (
            <li key={file} title={file}>{file}</li>
          ))}
        </ul>
      ) : (
        <div className="worktree-detail-state">No changed files were returned for this worktree.</div>
      )}
      {input.diffStat.trim() && (
        <pre className="worktree-detail-stat">{input.diffStat}</pre>
      )}
      {input.uniqueCommits.length > 0 && (
        <div className="worktree-commit-list">
          {input.uniqueCommits.slice(0, 8).map((commit) => (
            <code key={commit}>{commit}</code>
          ))}
        </div>
      )}
    </div>
  );
}

function recallItemsToResult(items: MemoryRecallItem[]): WorktreeRecallResult {
  const first = items[0];
  return {
    likelyIntent: first.title,
    summary: first.summary,
    artifacts: items.map((item) => ({
      id: item.id,
      title: item.title,
      kind: "memory",
      summary: item.summary,
    })),
    risks: items
      .map((item) => metadataString(item.metadata, "risk"))
      .filter((item): item is string => Boolean(item))
      .slice(0, 4),
    decisions: items
      .map((item) => metadataString(item.metadata, "decision"))
      .filter((item): item is string => Boolean(item))
      .slice(0, 4),
  };
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Worktree paths are filesystem absolutes — too noisy in a narrow column.
 *  Show "~/parent/name" when under home, else the last two path components.
 *  Full path stays in the `title` attribute for hover lookup. */
function shortPath(p: string): string {
  if (!p) return "";
  const home = typeof window !== "undefined" ? window.localStorage?.getItem("overcode.home") ?? "" : "";
  let s = p;
  if (home && s.startsWith(home)) s = `~${s.slice(home.length)}`;
  const parts = s.split("/").filter(Boolean);
  if (parts.length <= 2) return s;
  return `…/${parts.slice(-2).join("/")}`;
}
