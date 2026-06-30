import { useCallback, useEffect, useState } from "react";
import {
  ipc,
  type MemoryRecallItem,
  type MemoryRecallQuery,
  type WorktreeSummaryInput,
} from "../lib/ipc";
import { useAIPanel } from "../store/useAIPanel";
import {
  WorktreeRecallCard,
  type WorktreeRecallArtifact,
  type WorktreeRecallGraphPath,
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
  const [summarizingPath, setSummarizingPath] = useState<string | null>(null);
  const [inspectingPath, setInspectingPath] = useState<string | null>(null);
  const [recallingPath, setRecallingPath] = useState<string | null>(null);
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

  async function recall(tree: Worktree) {
    setExpandedPath(tree.path);
    setRecallingPath(tree.path);
    setError(null);
    setRecallDetails((current) => ({
      ...current,
      [tree.path]: { status: "loading" },
    }));

    try {
      const input = await ipc.getWorktreeSummaryInput(repoPath, tree.path);
      const recallIpc = ipc as typeof ipc & WorktreeRecallIPC;

      if (typeof recallIpc.recallMemory !== "function") {
        setRecallDetails((current) => ({
          ...current,
          [tree.path]: {
            status: "disabled",
            message: "Cognee recall is not wired in this build. Expected ipc.recallMemory(request).",
          },
        }));
        return;
      }

      const response = await recallIpc.recallMemory(buildRecallRequest(repoName, repoPath, input));
      setRecallDetails((current) => ({
        ...current,
        [tree.path]: normalizeRecallResponse(response),
      }));
    } catch (err) {
      setRecallDetails((current) => ({
        ...current,
        [tree.path]: {
          status: "error",
          message: err instanceof Error ? err.message : "Could not recall worktree memory",
        },
      }));
    } finally {
      setRecallingPath(null);
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
                  <span>{t.head?.slice(0, 7)}</span>
                  <span>+{t.ahead ?? 0}/-{t.behind ?? 0}</span>
                  <span>{t.dirtyCount ?? 0} dirty</span>
                </div>
                <button
                  type="button"
                  className="worktree-inspect-button"
                  onClick={() => void inspect(t)}
                  disabled={inspectingPath !== null || summarizingPath !== null || recallingPath !== null}
                  title="Inspect changed files in this worktree"
                >
                  {inspectingPath === t.path ? "Inspecting…" : expanded ? "Hide" : "Inspect"}
                </button>
                <button
                  type="button"
                  className="worktree-recall-button"
                  onClick={() => void recall(t)}
                  disabled={
                    recallingPath !== null || summarizingPath !== null || inspectingPath !== null
                  }
                  title="Recall related Cognee memory for this worktree"
                >
                  {recallingPath === t.path ? "Recalling…" : "Recall"}
                </button>
                <button
                  type="button"
                  className="worktree-ai-button"
                  onClick={() => summarize(t)}
                  disabled={summarizingPath !== null || inspectingPath !== null || recallingPath !== null}
                >
                  {summarizingPath === t.path ? "Summarizing…" : "Summarize"}
                </button>
                {expanded && detail && <WorktreeDetails detail={detail} />}
                {expanded && <WorktreeRecallCard state={recallDetail} />}
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

interface WorktreeRecallIPC {
  recallMemory?: (request: MemoryRecallQuery) => Promise<unknown>;
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

function buildRecallRequest(
  repoName: string,
  repoPath: string,
  input: WorktreeSummaryInput,
): MemoryRecallQuery {
  const changedFiles = input.changedFiles.filter(Boolean).slice(0, 12);
  const uniqueCommits = input.uniqueCommits.filter(Boolean).slice(0, 6);
  const branch = input.branch || input.targetRef || "(detached)";
  const queryParts = [
    `Recall Overcode memory for repo ${repoName || repoPath}`,
    `on branch ${branch}`,
    changedFiles.length > 0 ? `touching files ${changedFiles.join(", ")}` : "",
    uniqueCommits.length > 0 ? `with commits ${uniqueCommits.join(", ")}` : "",
    input.diffStat.trim() ? `with diff stat ${compactWhitespace(input.diffStat).slice(0, 160)}` : "",
  ].filter(Boolean);

  return {
    query: limitRecallQuery(`${queryParts.join(" ")}.`),
    limit: 6,
    filters: {
      repo: repoName || repoPath,
      branch,
    },
  };
}

function normalizeRecallResponse(response: unknown): WorktreeRecallState {
  if (!isRecord(response)) {
    return { status: "empty", message: "No Cognee memory matched this worktree." };
  }

  if (response.disabled === true || response.status === "disabled" || response.skipped === true) {
    return {
      status: "disabled",
      message:
        stringValue(response.message) ||
        stringValue(response.reason) ||
        stringValue(response.error) ||
        "Cognee memory is disabled or unconfigured.",
    };
  }

  if (response.ok === false) {
    return {
      status: "error",
      message:
        stringValue(response.error) ||
        stringValue(response.reason) ||
        "Cognee memory recall did not complete.",
    };
  }

  const recalledItems = arrayValue(response.items)
    .map(normalizeRecallItem)
    .filter((item): item is MemoryRecallItem => item !== null);
  if (recalledItems.length > 0) {
    return { status: "ready", result: recallItemsToResult(recalledItems) };
  }

  if (response.status === "empty" || response.empty === true) {
    return {
      status: "empty",
      message: stringValue(response.message) || "No Cognee memory matched this worktree.",
    };
  }

  const source = isRecord(response.result) ? response.result : response;
  const result: WorktreeRecallResult = {
    likelyIntent: stringValue(source.likelyIntent) || stringValue(source.intent),
    summary: stringValue(source.summary),
    artifacts: arrayValue(source.artifacts ?? source.relatedArtifacts)
      .map(normalizeArtifact)
      .filter((item): item is WorktreeRecallArtifact => item !== null),
    risks: stringList(source.risks ?? source.priorRisks),
    decisions: stringList(source.decisions ?? source.priorDecisions),
    graphPaths: arrayValue(source.graphPaths ?? source.paths)
      .map(normalizeGraphPath)
      .filter((item): item is WorktreeRecallGraphPath => item !== null),
    suggestedNextAction:
      stringValue(source.suggestedNextAction) || stringValue(source.nextAction),
  };

  const hasResult =
    Boolean(result.likelyIntent || result.summary || result.suggestedNextAction) ||
    Boolean(result.artifacts?.length || result.risks?.length || result.decisions?.length) ||
    Boolean(result.graphPaths?.length);

  if (!hasResult) {
    return { status: "empty", message: "Cognee returned no usable memory for this worktree." };
  }

  return { status: "ready", result };
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
      .map((item) => metadataString(item.metadata, "risk") ?? metadataString(item.metadata, "severity"))
      .filter((item): item is string => Boolean(item))
      .slice(0, 4),
    decisions: items
      .map((item) => metadataString(item.metadata, "decision"))
      .filter((item): item is string => Boolean(item))
      .slice(0, 4),
    graphPaths: items.map((item) => ({
      from: "worktree",
      kind: "RECALLS",
      to: `memory:${item.id}`,
      summary: item.title,
    })),
    suggestedNextAction:
      "Review the recalled memory before summarizing, rebasing, or preparing this worktree for review.",
  };
}

function normalizeRecallItem(value: unknown): MemoryRecallItem | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const title = stringValue(value.title);
  const summary = stringValue(value.summary);
  if (!id || !title || !summary) return null;
  return {
    id,
    title,
    summary,
    score: typeof value.score === "number" ? value.score : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

function normalizeArtifact(value: unknown): WorktreeRecallArtifact | null {
  if (typeof value === "string") return { title: value };
  if (!isRecord(value)) return null;

  return {
    id: stringValue(value.id),
    title: stringValue(value.title),
    label: stringValue(value.label),
    kind: stringValue(value.kind),
    summary: stringValue(value.summary),
    ref: stringValue(value.ref),
    url: stringValue(value.url),
  };
}

function normalizeGraphPath(value: unknown): WorktreeRecallGraphPath | null {
  if (typeof value === "string") return { nodes: value.split("->").map((part) => part.trim()) };
  if (!isRecord(value)) return null;

  return {
    from: stringValue(value.from),
    to: stringValue(value.to),
    kind: stringValue(value.kind),
    summary: stringValue(value.summary),
    nodes: stringList(value.nodes),
  };
}

function stringList(value: unknown): string[] {
  return arrayValue(value).map(stringValue).filter((item): item is string => Boolean(item));
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function limitRecallQuery(value: string): string {
  return value.length > 480 ? `${value.slice(0, 477)}...` : value;
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
