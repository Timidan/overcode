import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowLeft, Code, Sparkle } from "@phosphor-icons/react";
import { Sidebar } from "../components/Sidebar";
import { CommitGraph } from "../components/CommitGraph";
import { DivergenceIndicator } from "../components/DivergenceIndicator";
import { UncommittedFiles } from "../components/UncommittedFiles";
import { StashList } from "../components/StashList";
import { WorktreeList } from "../components/WorktreeList";
import { EnvironmentWarnings } from "../components/EnvironmentWarnings";
import { BranchBadge } from "../components/BranchBadge";
import { useNav } from "../store/useNav";
import { useAIPanel } from "../store/useAIPanel";
import { ipc } from "../lib/ipc";
import { extractCogneeMemoryHighlight } from "../lib/cognee-workflow-memory";
import { recallCogneeWorkflowMemory } from "../lib/cognee-workflow-runtime";
import {
  loadRepositoryById,
  type WorkspaceRepository,
} from "../lib/workspace-data";
import "./RepoDetail.css";

type ColumnSizes = [number, number, number];
type SidecarSizes = [number, number, number, number];

const DEFAULT_COLUMN_SIZES: ColumnSizes = [41, 29, 30];
const DEFAULT_SIDECAR_SIZES: SidecarSizes = [25, 23, 25, 27];
const MIN_COLUMN_SIZE = 18;
const MIN_SIDECAR_SIZE = 10;
const RESIZE_KEY_STEP = 3;

export function RepoDetail() {
  const { repoId, navigate } = useNav();
  const openAIPanel = useAIPanel((s) => s.open);
  const [repo, setRepo] = useState<WorkspaceRepository | null>(null);
  const [repoMissing, setRepoMissing] = useState(false);
  const [branch, setBranch] = useState<string>("main");
  const [memoryLine, setMemoryLine] = useState<string | null>(null);
  const [memoryDismissed, setMemoryDismissed] = useState(false);
  const [aiBusy, setAiBusy] = useState<"impact" | "commit" | "brief" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [columnSizes, setColumnSizes] = useState<ColumnSizes>(DEFAULT_COLUMN_SIZES);
  const [sidecarSizes, setSidecarSizes] = useState<SidecarSizes>(DEFAULT_SIDECAR_SIZES);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sidecarStackRef = useRef<HTMLDivElement | null>(null);

  const columnStyle = useMemo(
    () => ({
      "--repo-col-graph": `${columnSizes[0]}fr`,
      "--repo-col-tree": `${columnSizes[1]}fr`,
      "--repo-col-sidecars": `${columnSizes[2]}fr`,
    }) as CSSProperties & Record<string, string>,
    [columnSizes],
  );

  const sidecarStyle = useMemo(
    () => ({
      gridTemplateRows: `${sidecarSizes[0]}fr 7px ${sidecarSizes[1]}fr 7px ${sidecarSizes[2]}fr 7px ${sidecarSizes[3]}fr`,
    }),
    [sidecarSizes],
  );

  useEffect(() => {
    let cancelled = false;
    // Full reset so a previous repo never bleeds into the next one.
    setRepoMissing(false);
    setRepo(null);
    setBranch("main");
    setMemoryLine(null);
    setMemoryDismissed(false);
    async function load() {
      if (!repoId) {
        setRepoMissing(true);
        return;
      }
      const found = await loadRepositoryById(repoId).catch(() => null);
      if (cancelled) return;
      if (!found) {
        setRepoMissing(true);
        return;
      }
      setRepo(found);
      try {
        const status = await ipc.getGitStatus(found.local_path, { mode: "lite" });
        if (!cancelled) setBranch(status.branch);
      } catch {
        // Non-git workspace candidates can still open; keep the default branch label.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  // One quiet recall for this repo; empty/disabled/error memory renders nothing.
  useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    // Branch is deliberately omitted: this is a once-per-repo recall and a
    // stale branch filter would hide valid memory.
    recallCogneeWorkflowMemory(
      {
        source: "repo detail",
        repoId: repo.id,
        repoName: repo.name,
        subject: "recent analysis, risks, and decisions",
        limit: 3,
      },
      undefined,
      { retryOnEmpty: true },
    ).then((memory) => {
      if (cancelled || !memory) return;
      const line = extractCogneeMemoryHighlight(memory.context);
      if (line) setMemoryLine(line.length > 160 ? `${line.slice(0, 157)}...` : line);
    });
    return () => {
      cancelled = true;
    };
    // Recall once per repo open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.id]);

  async function openImpactAnalysis() {
    if (!repo) return;
    setAiBusy("impact");
    setAiError(null);
    try {
      const status = await ipc.getGitStatus(repo.local_path, { mode: "diff" });
      const diff = [status.stagedDiff, status.diff].filter(Boolean).join("\n\n");
      openAIPanel("impact", {
        repoId: repo.id,
        repoName: repo.name,
        branch: status.branch,
        diff: diff || status.files.map((file) => `${file.status} ${file.path}`).join("\n"),
        fileTree: status.files.map((file) => file.path),
        unavailableReason:
          !diff && status.files.length === 0
            ? "Impact analysis unavailable: this workspace has no uncommitted changes."
            : undefined,
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Could not prepare impact analysis");
    } finally {
      setAiBusy(null);
    }
  }

  async function openRepoBrief() {
    if (!repo) return;
    setAiBusy("brief");
    setAiError(null);
    try {
      const [status, log] = await Promise.all([
        ipc.getGitStatus(repo.local_path),
        ipc.getGitLog(repo.local_path, 20).catch(() => []),
      ]);
      openAIPanel("brief", {
        repoId: repo.id,
        repoName: repo.name,
        remoteUrl: repo.remote_url,
        branch: status.branch,
        tree: status.fileTree,
        readme: [status.packageSummary, status.readme].filter(Boolean).join("\n\n"),
        recentCommits: log.map((commit) => commit.message.split("\n")[0]),
        changedFiles: status.files.map((file) => file.path),
        openPRs: [],
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Could not prepare repo brief");
    } finally {
      setAiBusy(null);
    }
  }

  const startColumnResize = useCallback(
    (index: 0 | 1, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const width = bodyRef.current?.getBoundingClientRect().width ?? 0;
      if (width <= 0) return;
      const startX = event.clientX;
      const startSizes = columnSizes;

      function onPointerMove(moveEvent: PointerEvent) {
        const delta = ((moveEvent.clientX - startX) / width) * 100;
        setColumnSizes(resizePair(startSizes, index, delta, MIN_COLUMN_SIZE));
      }

      function onPointerUp() {
        document.documentElement.classList.remove("repo-detail-resizing-x");
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }

      document.documentElement.classList.add("repo-detail-resizing-x");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [columnSizes],
  );

  const startSidecarResize = useCallback(
    (index: 0 | 1 | 2, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const height = sidecarStackRef.current?.getBoundingClientRect().height ?? 0;
      if (height <= 0) return;
      const startY = event.clientY;
      const startSizes = sidecarSizes;

      function onPointerMove(moveEvent: PointerEvent) {
        const delta = ((moveEvent.clientY - startY) / height) * 100;
        setSidecarSizes(resizePair(startSizes, index, delta, MIN_SIDECAR_SIZE));
      }

      function onPointerUp() {
        document.documentElement.classList.remove("repo-detail-resizing-y");
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }

      document.documentElement.classList.add("repo-detail-resizing-y");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [sidecarSizes],
  );

  function handleColumnResizeKey(
    index: 0 | 1,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -RESIZE_KEY_STEP : RESIZE_KEY_STEP;
    setColumnSizes((current) => resizePair(current, index, delta, MIN_COLUMN_SIZE));
  }

  function handleSidecarResizeKey(
    index: 0 | 1 | 2,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? -RESIZE_KEY_STEP : RESIZE_KEY_STEP;
    setSidecarSizes((current) => resizePair(current, index, delta, MIN_SIDECAR_SIZE));
  }

  if (repoMissing) {
    return (
      <div className="repo-detail-container">
        <Sidebar />
        <main className="repo-detail-main">
          <div className="repo-detail-missing">
            <div className="repo-detail-missing-title">Repository not found</div>
            <p>This workspace may have been removed or renamed.</p>
            <button
              type="button"
              className="back-button repo-detail-missing-back"
              onClick={() => navigate("dashboard")}
            >
              <ArrowLeft size={14} /> Back to dashboard
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="repo-detail-container">
        <Sidebar />
        <main className="repo-detail-main">
          <div className="repo-detail-skeleton" aria-hidden="true">
            <span className="repo-detail-skeleton-row" />
            <span className="repo-detail-skeleton-row" />
            <span className="repo-detail-skeleton-row is-tall" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="repo-detail-container">
      <Sidebar />
      <main className="repo-detail-main">
        <header className="repo-detail-header">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate("dashboard")}
            aria-label="Back to dashboard"
            title="Back to dashboard"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="repo-detail-title">{repo.name}</h1>
          <BranchBadge branch={branch} />
          <span className="repo-detail-platform">{repo.platform}</span>
        </header>

        {memoryLine && !memoryDismissed && (
          <div className="repo-memory-strip" role="note">
            <span className="repo-memory-strip-label">From memory</span>
            <span className="repo-memory-strip-text">{memoryLine}</span>
            <button
              type="button"
              className="repo-memory-strip-dismiss"
              onClick={() => setMemoryDismissed(true)}
              aria-label="Dismiss memory note"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        <section className="repo-ai-actions" aria-label="AI actions for this workspace">
          <div className="section-label">AI for this workspace</div>
          <div className="repo-ai-buttons">
            <button
              type="button"
              className="repo-ai-button"
              onClick={openImpactAnalysis}
              disabled={aiBusy !== null}
              title="Analyze local changes with the active AI provider"
            >
              <Sparkle size={13} />
              {aiBusy === "impact" ? "Preparing..." : "Analyze impact"}
            </button>
            <button
              type="button"
              className="repo-ai-button"
              onClick={openRepoBrief}
              disabled={aiBusy !== null}
              title="Generate a repository onboarding brief"
            >
              <Code size={13} />
              {aiBusy === "brief" ? "Preparing..." : "Repo brief"}
            </button>
          </div>
          {aiError && <div className="repo-ai-error">{aiError}</div>}
        </section>

        <div className="repo-detail-body" ref={bodyRef} style={columnStyle}>
          <section className="repo-detail-column repo-detail-column-graph">
            <div className="repo-detail-column-head">
              <span className="section-label">Commit history</span>
            </div>
            <div className="repo-detail-column-body">
              <CommitGraph repoPath={repo.local_path} branch={branch} />
            </div>
          </section>

          <div
            className="repo-resize-handle repo-resize-handle-x"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize commit history and working tree columns"
            tabIndex={0}
            onPointerDown={(event) => startColumnResize(0, event)}
            onKeyDown={(event) => handleColumnResizeKey(0, event)}
          />

          <section className="repo-detail-column repo-detail-column-tree">
            <div className="repo-detail-column-head">
              <span className="section-label">Working tree</span>
            </div>
            <div className="repo-pane repo-pane-grow">
              <div className="repo-pane-body">
                <UncommittedFiles
                  repoPath={repo.local_path}
                  repoId={repo.id}
                  repoName={repo.name}
                />
              </div>
            </div>
          </section>

          <div
            className="repo-resize-handle repo-resize-handle-x"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize working tree and sidecars columns"
            tabIndex={0}
            onPointerDown={(event) => startColumnResize(1, event)}
            onKeyDown={(event) => handleColumnResizeKey(1, event)}
          />

          <aside
            className="repo-detail-column repo-detail-column-sidecars"
            aria-label="Branch state, stashes, worktrees, and environment"
          >
            <div className="repo-sidecar-stack" ref={sidecarStackRef} style={sidecarStyle}>
              <div className="repo-pane">
                <div className="repo-pane-body">
                  <DivergenceIndicator
                    repoPath={repo.local_path}
                    branch={branch}
                    remote="origin"
                  />
                </div>
              </div>
              <div
                className="repo-resize-handle repo-resize-handle-y"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize branch state and stashes panes"
                tabIndex={0}
                onPointerDown={(event) => startSidecarResize(0, event)}
                onKeyDown={(event) => handleSidecarResizeKey(0, event)}
              />
              <div className="repo-pane">
                <div className="repo-pane-body">
                  <StashList repoId={repo.id} repoName={repo.name} repoPath={repo.local_path} />
                </div>
              </div>
              <div
                className="repo-resize-handle repo-resize-handle-y"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize stashes and worktrees panes"
                tabIndex={0}
                onPointerDown={(event) => startSidecarResize(1, event)}
                onKeyDown={(event) => handleSidecarResizeKey(1, event)}
              />
              <div className="repo-pane">
                <div className="repo-pane-body">
                  <WorktreeList
                    repoId={repo.id}
                    repoName={repo.name}
                    repoPath={repo.local_path}
                  />
                </div>
              </div>
              <div
                className="repo-resize-handle repo-resize-handle-y"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize worktrees and dev environment panes"
                tabIndex={0}
                onPointerDown={(event) => startSidecarResize(2, event)}
                onKeyDown={(event) => handleSidecarResizeKey(2, event)}
              />
              <div className="repo-pane">
                <div className="repo-pane-body">
                  <EnvironmentWarnings repoPath={repo.local_path} />
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function resizePair<T extends number[]>(
  sizes: T,
  index: number,
  delta: number,
  min: number,
): T {
  const next = [...sizes] as number[];
  const pairTotal = next[index] + next[index + 1];
  const nextLeading = clamp(next[index] + delta, min, pairTotal - min);
  next[index] = nextLeading;
  next[index + 1] = pairTotal - nextLeading;
  return next as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
