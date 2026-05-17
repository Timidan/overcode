import { useCallback, useEffect, useState } from "react";
import { ipc, type WorktreeSummaryInput } from "../lib/ipc";
import { useAIPanel } from "../store/useAIPanel";
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
  const [summarizingPath, setSummarizingPath] = useState<string | null>(null);
  const [inspectingPath, setInspectingPath] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [inspectDetails, setInspectDetails] = useState<Record<string, WorktreeInspectState>>({});
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
    if (inspectDetails[tree.path] && !inspectDetails[tree.path].error) return;

    setInspectingPath(tree.path);
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
      setInspectingPath(null);
    }
  }

  async function summarize(tree: Worktree) {
    setSummarizingPath(tree.path);
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
      setSummarizingPath(null);
    }
  }

  return (
    <section className="worktree-list">
      <header className="worktree-header">
        <span className="section-label">Worktrees</span>
        <span className="worktree-count">{trees.length}</span>
      </header>
      {loading ? (
        <div className="empty">Loading…</div>
      ) : loadError ? (
        <div className="worktree-error" role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={() => void loadWorktrees()}>
            Retry
          </button>
        </div>
      ) : trees.length === 0 ? (
        <div className="empty">No worktrees</div>
      ) : (
        <ul className="worktree-rows">
          {trees.map((t) => {
            const expanded = expandedPath === t.path;
            const detail = inspectDetails[t.path];
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
                  <span>{t.head?.slice(0, 7)}</span>
                  <span>+{t.ahead ?? 0}/-{t.behind ?? 0}</span>
                  <span>{t.dirtyCount ?? 0} dirty</span>
                </div>
                <button
                  type="button"
                  className="worktree-inspect-button"
                  onClick={() => void inspect(t)}
                  disabled={inspectingPath !== null || summarizingPath !== null}
                  title="Inspect changed files in this worktree"
                >
                  {inspectingPath === t.path ? "Inspecting…" : expanded ? "Hide" : "Inspect"}
                </button>
                <button
                  type="button"
                  className="worktree-ai-button"
                  onClick={() => summarize(t)}
                  disabled={summarizingPath !== null || inspectingPath !== null}
                >
                  {summarizingPath === t.path ? "Summarizing…" : "Summarize"}
                </button>
                {expanded && <WorktreeDetails detail={detail} />}
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
        <span>{input.changedFiles.length} files changed</span>
        <span>+{input.ahead}/-{input.behind} vs {input.baseRef}</span>
        <span>{input.dirtyFiles} dirty</span>
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
