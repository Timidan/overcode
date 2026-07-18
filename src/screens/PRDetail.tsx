import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowSquareOut,
  GithubLogo,
  GitlabLogo,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  Copy,
  Folder,
  PaperPlaneTilt,
  GitBranch,
  Code as CodeIcon,
  Sparkle,
} from "@phosphor-icons/react";
import { Sidebar } from "../components/Sidebar";
import { CodeInspector } from "../components/CodeInspector";
import { PRMessage } from "../components/PRMessage";
import { ipc, type PullRequestDetail, type PullRequestFile } from "../lib/ipc";
import {
  summarizePullRequestFileChangeStructured,
  summarizePullRequestHunksStructured,
  summarizePullRequestStructured,
  type WorktreeComparePayload,
} from "../lib/ai-features";
import type {
  AIEnvelope,
  PRFileChangeData,
  PRHunkReviewData,
  PRReviewData,
} from "../lib/ai-structured";
import { cogneeRepositoryMemory } from "../lib/cognee-repository-memory";
import { PRHunkReviewSummary, PRReviewSummary } from "../components/ai/AIResultViews";
import { useNav, type PRDetailRef } from "../store/useNav";
import { useAIPanel } from "../store/useAIPanel";
import {
  loadPullRequestLocalContext,
  type PullRequestLocalContext,
} from "../lib/pr-local-context";
import "./PRDetail.css";

type TabKey = "overview" | "files" | "conversation" | "checks" | "ai";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "files", label: "Files" },
  { key: "conversation", label: "Conversation" },
  { key: "checks", label: "Checks" },
  { key: "ai", label: "AI summary" },
];

interface InspectorState {
  filePath: string;
  patch?: string;
  highlightRange?: [number, number];
}

interface FileChangeSummaryState {
  loading?: boolean;
  error?: string;
  result?: AIEnvelope<PRFileChangeData>;
}

function fetchDetail(ref: PRDetailRef): Promise<PullRequestDetail> {
  const request =
    ref.provider === "github"
      ? ipc.getGitHubPRDetail(ref.repoFullName, ref.number)
      : ref.projectId
        ? ipc.getGitLabMRDetail(ref.projectId, ref.number)
        : Promise.reject(new Error("GitLab MR requires a project id."));

  return request.then((detail) => normalizePullRequestDetail(detail, ref));
}

function normalizePullRequestDetail(
  value: unknown,
  fallback: PRDetailRef,
): PullRequestDetail {
  const detail = asObject(value);
  const provider =
    detail.provider === "github" || detail.provider === "gitlab"
      ? detail.provider
      : fallback.provider;
  const number = asNumber(detail.number, fallback.number);
  const numberPrefix = detail.numberPrefix === "!" || detail.numberPrefix === "#"
    ? detail.numberPrefix
    : provider === "github"
      ? "#"
      : "!";

  return {
    id: asString(detail.id) || `${provider}:${fallback.repoFullName}:${number}`,
    provider,
    repoFullName: asString(detail.repoFullName) || fallback.repoFullName,
    number,
    numberPrefix,
    title: asString(detail.title) || "Untitled pull request",
    body: asString(detail.body),
    author: asString(detail.author) || "unknown",
    source_branch: asString(detail.source_branch),
    target_branch: asString(detail.target_branch),
    status: asString(detail.status) || "open",
    draft: detail.draft === true,
    url: asString(detail.url),
    updated_at: asString(detail.updated_at) || new Date(0).toISOString(),
    files: asArray(detail.files).map(normalizePullRequestFile).filter(isPresent),
    commits: asArray(detail.commits).map(normalizePullRequestCommit).filter(isPresent),
    comments: asArray(detail.comments).map(normalizeReviewThreadItem).filter(isPresent),
    reviewComments: asArray(detail.reviewComments)
      .map(normalizeReviewThreadItem)
      .filter(isPresent),
    reviews: asArray(detail.reviews).map(normalizeReviewThreadItem).filter(isPresent),
    checks: asArray(detail.checks).map(normalizePullRequestCheck).filter(isPresent),
  };
}

function normalizePullRequestFile(value: unknown): PullRequestFile | null {
  const file = asObject(value);
  const path = asString(file.path) || asString(file.filename);
  if (!path) return null;
  return {
    path,
    status: normalizeFileStatus(file.status),
    additions: asNumber(file.additions, 0),
    deletions: asNumber(file.deletions, 0),
    patch: optionalString(file.patch),
    previous_path: optionalString(file.previous_path ?? file.previous_filename),
  };
}

function normalizePullRequestCommit(
  value: unknown,
): PullRequestDetail["commits"][number] | null {
  const commit = asObject(value);
  const sha = asString(commit.sha);
  if (!sha) return null;
  return {
    sha,
    message: asString(commit.message),
    author: asString(commit.author) || "unknown",
    date: asString(commit.date),
    url: optionalString(commit.url),
  };
}

function normalizeReviewThreadItem(
  value: unknown,
): PullRequestDetail["comments"][number] | null {
  const item = asObject(value);
  const id = asString(item.id);
  return {
    id: id || `${asString(item.author) || "unknown"}:${asString(item.created_at)}`,
    author: asString(item.author) || "unknown",
    body: asString(item.body),
    created_at: asString(item.created_at),
    updated_at: optionalString(item.updated_at),
    file_path: optionalString(item.file_path),
    line: typeof item.line === "number" && Number.isFinite(item.line)
      ? item.line
      : undefined,
    url: optionalString(item.url),
  };
}

function normalizePullRequestCheck(
  value: unknown,
): PullRequestDetail["checks"][number] | null {
  const check = asObject(value);
  const name = asString(check.name);
  if (!name) return null;
  return {
    id: asString(check.id) || name,
    name,
    status: asString(check.status) || "unknown",
    conclusion: asString(check.conclusion) || null,
    url: optionalString(check.url),
    updated_at: asString(check.updated_at) || null,
  };
}

function normalizeFileStatus(value: unknown): PullRequestFile["status"] {
  if (
    value === "added" ||
    value === "modified" ||
    value === "removed" ||
    value === "renamed"
  ) {
    return value;
  }
  return "unknown";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  const stringValue = asString(value);
  return stringValue || undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

async function postComment(ref: PRDetailRef, body: string): Promise<void> {
  if (ref.provider === "github") {
    await ipc.commentOnGitHubPR(ref.repoFullName, ref.number, body);
    return;
  }
  if (!ref.projectId) throw new Error("GitLab MR requires a project id.");
  await ipc.commentOnGitLabMR(ref.projectId, ref.number, body);
}

export function PRDetail() {
  const { prRef, navigate } = useNav();
  const [detail, setDetail] = useState<PullRequestDetail | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localCtx, setLocalCtx] = useState<PullRequestLocalContext | null>(null);
  const [localCtxLoading, setLocalCtxLoading] = useState(false);
  const [inspector, setInspector] = useState<InspectorState | null>(null);

  const closeAIPanel = useAIPanel((s) => s.close);
  const openAIPanel = useAIPanel((s) => s.open);
  const aiPanelOpen = useAIPanel((s) => s.isOpen);

  useEffect(() => {
    let cancelled = false;
    if (!prRef) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchDetail(prRef)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PR detail");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prRef]);

  // Resolve local-repo mapping + git status whenever the PR detail changes.
  useEffect(() => {
    if (!detail) {
      setLocalCtx(null);
      return;
    }
    let cancelled = false;
    setLocalCtxLoading(true);
    loadPullRequestLocalContext(detail)
      .then((result) => {
        if (!cancelled) setLocalCtx(result);
      })
      .catch(() => {
        if (!cancelled) setLocalCtx(null);
      })
      .finally(() => {
        if (!cancelled) setLocalCtxLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detail]);

  // Close the inspector panel whenever the PR ref changes — stale file paths
  // should never bleed across navigations.
  useEffect(() => {
    setInspector(null);
  }, [prRef]);

  const localRepoPath = localCtx?.mapping.candidate?.local_path ?? null;
  // NOTE on `ref` propagation: <CodeInspector ref={...}> would let us pin
  // the read to the PR's head, but `ref` is a reserved JSX prop on React 18
  // function components and is stripped before reaching the component.
  // CodeInspector consumes `ref` directly from its own props (no
  // forwardRef) — that's a footgun in its public API. We've been told not
  // to refactor it, so we let the inspector read from the working tree of
  // the local clone. The LocalContextStrip surfaces a warning when the
  // checkout is on a different branch so reviewers aren't fooled.
  // TODO: when CodeInspector adopts `gitRef` (or forwardRef), wire
  // detail.source_branch through here.

  const openInspectorAt = useCallback(
    (state: InspectorState) => {
      if (!localRepoPath) return;
      // Coordination: AIPanel is z-index 900, inspector is z-index 60. They
      // occupy the same slot on the right edge, so the AIPanel would cover
      // the inspector. Close AIPanel when opening the inspector.
      if (aiPanelOpen) closeAIPanel();
      setInspector(state);
    },
    [localRepoPath, aiPanelOpen, closeAIPanel],
  );

  if (!prRef) {
    return (
      <div className="pr-detail-container">
        <Sidebar />
        <main className="pr-detail-main">
          <div className="pr-detail-empty">No pull request selected.</div>
        </main>
      </div>
    );
  }

  return (
    <div className="pr-detail-container">
      <Sidebar />
      <main className="pr-detail-main">
        <header className="pr-detail-header">
          <button
            type="button"
            className="pr-detail-back"
            onClick={() => navigate("prs")}
            aria-label="Back to pull requests"
            title="Back to pull requests"
          >
            <ArrowLeft size={14} />
          </button>
          <PRDetailHeading detail={detail} fallback={prRef} />
          {detail && (
            <a
              className="pr-detail-link"
              href={detail.url}
              target="_blank"
              rel="noreferrer"
              title="Open in browser"
            >
              <ArrowSquareOut size={14} />
            </a>
          )}
        </header>

        <LocalContextStrip
          detail={detail}
          ctx={localCtx}
          loading={localCtxLoading}
          onOpenSettings={() => navigate("settings")}
          onCompare={(payload) => openAIPanel("worktree", payload)}
        />

        <nav className="pr-detail-tabs" aria-label="Pull request sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`pr-detail-tab${tab === t.key ? " is-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {detail && (
                <span className="pr-detail-tab-count">{tabCount(detail, t.key)}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="pr-detail-scroll">
          {loading && <div className="pr-detail-empty">Loading pull request…</div>}
          {error && <div className="pr-detail-error">{error}</div>}

          {detail && !loading && !error && (
            <section className="pr-detail-body">
              {tab === "overview" && <OverviewTab detail={detail} />}
              {tab === "files" && (
                <FilesTab
                  detail={detail}
                  localRepoPath={localRepoPath}
                  onOpenFile={(file) =>
                    openInspectorAt({
                      filePath: file.path,
                      patch: file.patch,
                    })
                  }
                />
              )}
              {tab === "conversation" && (
                <ConversationTab
                  detail={detail}
                  canInspect={!!localRepoPath}
                  onJumpToFile={(filePath, line) =>
                    openInspectorAt({
                      filePath,
                      highlightRange:
                        typeof line === "number" && line > 0
                          ? [line, line]
                          : undefined,
                    })
                  }
                />
              )}
              {tab === "checks" && <ChecksTab detail={detail} />}
              {tab === "ai" && <AISummaryTab detail={detail} prRef={prRef} />}
            </section>
          )}
        </div>
      </main>

      {localRepoPath && (
        <CodeInspector
          variant="panel"
          open={!!inspector}
          repoPath={localRepoPath}
          filePath={inspector?.filePath ?? ""}
          gitRef={detail?.source_branch}
          patch={inspector?.patch}
          highlightRange={inspector?.highlightRange}
          onClose={() => setInspector(null)}
        />
      )}
    </div>
  );
}

function tabCount(detail: PullRequestDetail, key: TabKey): string {
  switch (key) {
    case "files":
      return String(detail.files.length);
    case "conversation":
      return String(detail.comments.length + detail.reviewComments.length + detail.reviews.length);
    case "checks":
      return String(detail.checks.length);
    default:
      return "";
  }
}

function PRDetailHeading({
  detail,
  fallback,
}: {
  detail: PullRequestDetail | null;
  fallback: PRDetailRef;
}) {
  const provider = detail?.provider ?? fallback.provider;
  const repo = detail?.repoFullName ?? fallback.repoFullName;
  const numberPrefix = detail?.numberPrefix ?? (provider === "github" ? "#" : "!");
  const number = detail?.number ?? fallback.number;
  const title = detail?.title ?? "Loading…";
  const status = detail?.status ?? "loading";

  return (
    <div className="pr-detail-heading">
      <span className="pr-detail-platform">
        {provider === "github" ? (
          <GithubLogo size={14} weight="fill" color="var(--color-text-secondary)" />
        ) : (
          <GitlabLogo size={14} weight="fill" color="var(--color-accent-purple)" />
        )}
        <span>{repo}</span>
        <span className="pr-detail-number">
          {numberPrefix}
          {number}
        </span>
        <span className={`pr-detail-status pr-detail-status-${status}`}>{status}</span>
      </span>
      <h1 className="pr-detail-title">{title}</h1>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// LOCAL CONTEXT STRIP
// ────────────────────────────────────────────────────────────────────────────

function LocalContextStrip({
  detail,
  ctx,
  loading,
  onOpenSettings,
  onCompare,
}: {
  detail: PullRequestDetail | null;
  ctx: PullRequestLocalContext | null;
  loading: boolean;
  onOpenSettings: () => void;
  onCompare: (payload: WorktreeComparePayload) => void;
}) {
  const [checkoutCopyState, setCheckoutCopyState] =
    useState<"idle" | "copied" | "error">("idle");

  if (loading || !detail) {
    return (
      <section className="pr-local-strip pr-local-strip-loading" aria-live="polite">
        <span className="pr-local-label">Local</span>
        <span className="skel-line pr-local-skel" />
      </section>
    );
  }

  const candidate = ctx?.mapping.candidate;

  if (!candidate) {
    return (
      <section className="pr-local-strip pr-local-strip-empty">
        <div className="pr-local-left">
          <span className="pr-local-label">Local</span>
          <span className="pr-local-empty-caption">PR has no local checkout</span>
        </div>
        <div className="pr-local-actions">
          <button
            type="button"
            className="pr-local-action"
            onClick={onOpenSettings}
            title="Add a workspace directory in Settings"
          >
            <Folder size={12} />
            <span>Add workspace directory</span>
          </button>
        </div>
      </section>
    );
  }

  const status = ctx?.status ?? null;
  const dirtyCount = status?.files.length ?? 0;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const currentBranch = status?.branch ?? "";
  const sourceBranch = detail.source_branch;
  const onSourceBranch =
    currentBranch.length > 0 && currentBranch === sourceBranch;
  const editorUrl = buildEditorUrl(candidate.local_path);
  const comparePayload = ctx?.compareInput
    ? worktreePayloadFromCompareInput(ctx, detail)
    : null;

  async function copyCheckoutCommand() {
    const cmd = `git checkout ${sourceBranch}`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCheckoutCopyState("copied");
      window.setTimeout(() => setCheckoutCopyState("idle"), 1600);
    } catch {
      setCheckoutCopyState("error");
    }
  }

  return (
    <section className="pr-local-strip">
      <div className="pr-local-left">
        <span className="pr-local-label">Local</span>
        <span className="pr-local-repo" title={candidate.local_path}>
          {candidate.name}
        </span>
        <span className="pr-local-sep" aria-hidden="true">
          ·
        </span>
        <span className="pr-local-branch">
          <GitBranch size={11} />
          <span className="pr-local-branch-name">{detail.source_branch}</span>
        </span>
        <span className="pr-local-divergence">
          <span className="pr-local-ahead" title="Commits ahead of base">
            +{ahead}
          </span>
          <span className="pr-local-behind" title="Commits behind base">
            -{behind}
          </span>
        </span>
        {dirtyCount > 0 && (
          <span className="pr-local-dirty" title={`${dirtyCount} uncommitted files`}>
            ◆ {dirtyCount} dirty
          </span>
        )}
        {!onSourceBranch && currentBranch && (
          <span className="pr-local-warn" title="Local checkout is on a different branch">
            On {currentBranch}
          </span>
        )}
      </div>
      <div className="pr-local-actions">
        <button
          type="button"
          className="pr-local-action pr-local-action-primary"
          onClick={copyCheckoutCommand}
          title={`Copy: git checkout ${detail.source_branch}`}
        >
          <GitBranch size={12} />
          <span>
            {checkoutCopyState === "copied" ? "Copied" : "Copy checkout command"}
          </span>
        </button>
        {comparePayload && (
          <button
            type="button"
            className="pr-local-action"
            onClick={() => onCompare(comparePayload)}
            title="Compare this PR branch/worktree with AI"
          >
            <GitBranch size={12} />
            <span>Compare local</span>
          </button>
        )}
        <a
          className="pr-local-action"
          href={editorUrl}
          title={`Open ${candidate.local_path} in editor`}
        >
          <CodeIcon size={12} />
          <span>Open in editor</span>
        </a>
      </div>
      {checkoutCopyState === "error" && (
        <span className="pr-local-copy-error">Clipboard write failed.</span>
      )}
    </section>
  );
}

function worktreePayloadFromCompareInput(
  ctx: PullRequestLocalContext,
  detail: PullRequestDetail,
): WorktreeComparePayload | null {
  const input = ctx.compareInput;
  if (!input) return null;
  return {
    repoId: ctx.mapping.status.localRepoId ?? detail.repoFullName,
    repoName: ctx.mapping.candidate?.name ?? detail.repoFullName,
    repoPath: input.repoPath,
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
  };
}

function buildEditorUrl(absolutePath: string): string {
  // vscode:// is widely registered as the default editor handler on dev
  // machines. Anchor target=_blank not needed — Electron will hand the URL
  // off to the OS protocol handler.
  return `vscode://file${absolutePath}`;
}

// ────────────────────────────────────────────────────────────────────────────
// TABS
// ────────────────────────────────────────────────────────────────────────────

function OverviewTab({ detail }: { detail: PullRequestDetail }) {
  const additions = detail.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = detail.files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div className="pr-overview">
      <div className="pr-overview-grid">
        <Stat label="Author" value={detail.author} />
        <Stat label="Source" value={detail.source_branch} />
        <Stat label="Target" value={detail.target_branch} />
        <Stat label="Updated" value={new Date(detail.updated_at).toLocaleString()} />
        <Stat label="Files" value={String(detail.files.length)} />
        <Stat
          label="Diff"
          value={
            <span className="pr-stat-delta">
              <span className="pr-stat-add">+{additions}</span>
              <span className="pr-stat-sep">/</span>
              <span className="pr-stat-del">−{deletions}</span>
            </span>
          }
        />
      </div>

      <section className="pr-overview-body">
        <div className="section-label">Description</div>
        {detail.body.trim() ? (
          <div className="pr-overview-prose">
            <PRMessage body={detail.body} />
          </div>
        ) : (
          <div className="pr-detail-muted">No description provided.</div>
        )}
      </section>

      <section className="pr-overview-summary">
        <div className="section-label">Checks summary</div>
        <ChecksSummary detail={detail} />
      </section>
    </div>
  );
}

function FilesTab({
  detail,
  localRepoPath,
  onOpenFile,
}: {
  detail: PullRequestDetail;
  localRepoPath: string | null;
  onOpenFile: (file: PullRequestFile) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [fileSummaries, setFileSummaries] = useState<
    Record<string, FileChangeSummaryState>
  >({});

  useEffect(() => {
    setFileSummaries({});
  }, [detail.provider, detail.repoFullName, detail.number, detail.updated_at]);

  if (detail.files.length === 0) {
    return <div className="pr-detail-empty">No files in this PR.</div>;
  }

  const canInspect = !!localRepoPath;
  const totalAdditions = detail.files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = detail.files.reduce((sum, f) => sum + f.deletions, 0);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(detail.files.map((file) => `${file.path}-${file.previous_path ?? ""}`)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  async function summarizeFileChange(file: PullRequestFile, force = false) {
    const key = fileChangeKey(file);
    setFileSummaries((prev) => ({
      ...prev,
      [key]: { ...prev[key], loading: true, error: undefined },
    }));
    try {
      const memory = await cogneeRepositoryMemory.recall({
        source: "pr file review",
        repoName: detail.repoFullName,
        branch: detail.source_branch,
        paths: [file.path],
        prNumber: detail.number,
        subject: file.path,
        tags: ["pull-request", "file-review"],
      });
      const result = await summarizePullRequestFileChangeStructured(detail, file, {
        force,
        memoryContext: memory?.context,
      });
      setFileSummaries((prev) => ({
        ...prev,
        [key]: { loading: false, result },
      }));
      void cogneeRepositoryMemory.remember({
        source: "pr file review",
        repoName: detail.repoFullName,
        branch: detail.source_branch,
        paths: [file.path],
        prNumber: detail.number,
        subject: file.path,
        title: `PR file review for ${detail.repoFullName} ${detail.numberPrefix}${detail.number}`,
        summary: [
          `${file.path}: ${result.summary}`,
          result.data.changedBehavior,
          result.data.reviewFocus.slice(0, 4).join(" | "),
        ].filter(Boolean).join(" "),
        tags: ["pull-request", "file-review"],
        data: {
          risk: result.data.risk,
          suggested_check_count: result.data.suggestedChecks.length,
          confidence: result.confidence,
        },
      });
      if (result.data.suggestedChecks.length > 0) {
        void cogneeRepositoryMemory.remember({
          source: "testing memory",
          repoName: detail.repoFullName,
          branch: detail.source_branch,
          paths: [file.path],
          prNumber: detail.number,
          subject: file.path,
          title: `Testing memory for ${detail.repoFullName} ${detail.numberPrefix}${detail.number}`,
          summary: [
            `Suggested checks from PR file review for ${file.path}.`,
            result.data.suggestedChecks.slice(0, 6).join(" | "),
          ].filter(Boolean).join(" "),
          tags: ["testing", "pull-request", "file-review"],
          data: {
            suggested_check_count: result.data.suggestedChecks.length,
            confidence: result.confidence,
          },
        });
      }
    } catch (err) {
      setFileSummaries((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : "AI file change summary failed.",
        },
      }));
    }
  }

  return (
    <div className="pr-files">
      <div className="pr-files-summary">
        <span>
          {detail.files.length} file{detail.files.length === 1 ? "" : "s"}
        </span>
        <span className="pr-file-additions">+{totalAdditions}</span>
        <span className="pr-file-deletions">-{totalDeletions}</span>
        <span className="pr-files-summary-spacer" />
        <button
          type="button"
          className="pr-files-toggle-all"
          onClick={expanded.size === detail.files.length ? collapseAll : expandAll}
        >
          {expanded.size === detail.files.length ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {!canInspect && (
        <div className="pr-files-tip">
          Link a local clone to inspect files at ref — expand a row to read the patch inline.
        </div>
      )}
      {detail.files.map((file) => {
        const key = fileChangeKey(file);
        const isExpanded = expanded.has(key);
        const summaryState = fileSummaries[key];
        const total = file.additions + file.deletions;
        // Per-file ratio mini-bar — total = 80px, split by add/del share.
        const barWidth = 80;
        const addPx =
          total === 0 ? 0 : Math.round((file.additions / total) * barWidth);
        const delPx = total === 0 ? 0 : barWidth - addPx;
        return (
          <article key={key} className="pr-file">
            <header className="pr-file-header">
              <button
                type="button"
                className="pr-file-peek"
                onClick={() => toggle(key)}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? "Collapse file" : "Expand file"}
                title={isExpanded ? "Hide diff" : "Show diff"}
              >
                {isExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
              </button>
              <span className={`pr-file-status pr-file-status-${file.status}`}>
                {file.status}
              </span>
              {canInspect ? (
                <button
                  type="button"
                  className="pr-file-path pr-file-path-button"
                  onClick={() => onOpenFile(file)}
                  title="Open file in inspector panel"
                >
                  {file.path}
                </button>
              ) : (
                <span className="pr-file-path">{file.path}</span>
              )}
              <button
                type="button"
                className="pr-file-ai"
                onClick={() => summarizeFileChange(file, !!summaryState?.result)}
                disabled={summaryState?.loading}
                title={
                  file.patch
                    ? "Ask the active AI provider what this file added and removed"
                    : "Ask the active AI provider with provider metadata only"
                }
              >
                <Sparkle size={11} weight="bold" />
                <span>
                  {summaryState?.loading
                    ? "AI…"
                    : summaryState?.result
                      ? "Refresh"
                      : "AI"}
                </span>
              </button>
              <svg
                className="pr-file-ratio"
                width={barWidth}
                height={6}
                viewBox={`0 0 ${barWidth} 6`}
                aria-hidden="true"
                role="presentation"
              >
                {addPx > 0 && (
                  <rect x={0} y={0} width={addPx} height={6} className="pr-file-ratio-add" />
                )}
                {delPx > 0 && (
                  <rect x={addPx} y={0} width={delPx} height={6} className="pr-file-ratio-del" />
                )}
              </svg>
              <span className="pr-file-counts" title={`${total} changes`}>
                <span className="pr-file-additions">+{file.additions}</span>
                <span className="pr-file-deletions">−{file.deletions}</span>
              </span>
            </header>
            {summaryState?.loading && (
              <div className="pr-file-ai-summary pr-file-ai-summary-loading">
                The active AI provider is reading this file patch…
              </div>
            )}
            {summaryState?.error && (
              <div className="pr-file-ai-error">{summaryState.error}</div>
            )}
            {summaryState?.result && (
              <PRFileChangeSummary result={summaryState.result} />
            )}
            {isExpanded && (
              <div className="pr-file-body">
                {canInspect && localRepoPath ? (
                  <div className="pr-file-inline-inspector">
                    <CodeInspector
                      variant="inline"
                      repoPath={localRepoPath}
                      filePath={file.path}
                      gitRef={detail.source_branch}
                      patch={file.patch}
                    />
                  </div>
                ) : file.patch ? (
                  <pre className="pr-file-patch">{colorPatch(file.patch)}</pre>
                ) : (
                  <div className="pr-detail-muted pr-file-empty">
                    No patch available.
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function fileChangeKey(file: PullRequestFile): string {
  return `${file.path}-${file.previous_path ?? ""}`;
}

function PRFileChangeSummary({
  result,
}: {
  result: AIEnvelope<PRFileChangeData>;
}) {
  return (
    <section className="pr-file-ai-summary" aria-label="AI file change summary">
      <header className="pr-file-ai-summary-head">
        <span className="pr-file-ai-kicker">AI provider</span>
        <strong>{result.summary}</strong>
        <span className={`pr-file-ai-risk pr-file-ai-risk-${result.data.risk}`}>
          {result.data.risk} risk
        </span>
      </header>
      {result.data.changedBehavior && (
        <p className="pr-file-ai-behavior">{result.data.changedBehavior}</p>
      )}
      <div className="pr-file-ai-grid">
        <ChangeSummaryList title="Added" items={result.data.added} />
        <ChangeSummaryList title="Removed" items={result.data.removed} />
        <ChangeSummaryList title="Review focus" items={result.data.reviewFocus} />
        <ChangeSummaryList title="Checks" items={result.data.suggestedChecks} />
      </div>
      {result.warnings.length > 0 && (
        <div className="pr-file-ai-warning">{result.warnings[0]}</div>
      )}
    </section>
  );
}

function ChangeSummaryList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="pr-file-ai-list">
      <span>{title}</span>
      {items.length > 0 ? (
        <ul>
          {items.slice(0, 4).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>None surfaced.</p>
      )}
    </div>
  );
}

function colorPatch(patch: string) {
  return patch.split("\n").map((line, index) => {
    const className = line.startsWith("+")
      ? "pr-patch-add"
      : line.startsWith("-")
        ? "pr-patch-remove"
        : line.startsWith("@@")
          ? "pr-patch-hunk"
          : "pr-patch-context";
    return (
      <span key={index} className={`pr-patch-line ${className}`}>
        {line || " "}
        {"\n"}
      </span>
    );
  });
}

function ConversationTab({
  detail,
  canInspect,
  onJumpToFile,
}: {
  detail: PullRequestDetail;
  canInspect: boolean;
  onJumpToFile: (filePath: string, line?: number) => void;
}) {
  const items = useMemo(() => {
    const flat = [
      ...detail.reviews.map((item) => ({ kind: "review" as const, item })),
      ...detail.comments.map((item) => ({ kind: "comment" as const, item })),
      ...detail.reviewComments.map((item) => ({ kind: "review-comment" as const, item })),
    ];
    return flat.sort(
      (a, b) =>
        new Date(a.item.created_at).getTime() - new Date(b.item.created_at).getTime(),
    );
  }, [detail]);

  if (items.length === 0) {
    return <div className="pr-detail-empty">No conversation yet.</div>;
  }

  return (
    <div className="pr-conversation">
      {items.map((entry, index) => {
        const filePath = entry.item.file_path;
        const showJump = canInspect && !!filePath;
        return (
          <article key={`${entry.kind}:${entry.item.id || index}`} className="pr-comment">
            <header className="pr-comment-header">
              <span className="pr-comment-author">@{entry.item.author}</span>
              <span className="pr-comment-kind">{labelForKind(entry.kind)}</span>
              {filePath && (
                <span className="pr-comment-location">
                  {filePath}
                  {entry.item.line ? `:${entry.item.line}` : ""}
                </span>
              )}
              {showJump && filePath && (
                <button
                  type="button"
                  className="pr-comment-jump"
                  onClick={() => onJumpToFile(filePath, entry.item.line)}
                  title={`Jump to ${filePath}${entry.item.line ? `:${entry.item.line}` : ""}`}
                >
                  Jump to file
                </button>
              )}
              <span className="pr-comment-time">
                {entry.item.created_at
                  ? new Date(entry.item.created_at).toLocaleString()
                  : ""}
              </span>
            </header>
            <div className="pr-comment-body">
              <PRMessage body={entry.item.body || ""} onJumpToFile={onJumpToFile} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function labelForKind(kind: "review" | "comment" | "review-comment"): string {
  if (kind === "review") return "review";
  if (kind === "review-comment") return "inline";
  return "comment";
}

function ChecksTab({ detail }: { detail: PullRequestDetail }) {
  if (detail.checks.length === 0) {
    return <div className="pr-detail-empty">No CI checks reported.</div>;
  }
  return (
    <div className="pr-checks">
      <ChecksHeadline detail={detail} />
      {detail.checks.map((check) => (
        <article key={check.id} className={`pr-check pr-check-${check.conclusion ?? check.status}`}>
          <div className="pr-check-name">{check.name}</div>
          <div className="pr-check-meta">
            <span className="pr-check-status">{check.status}</span>
            {check.conclusion && (
              <span className="pr-check-conclusion">{check.conclusion}</span>
            )}
            {check.updated_at && (
              <span className="pr-check-time">
                {new Date(check.updated_at).toLocaleString()}
              </span>
            )}
            {check.url && (
              <a href={check.url} target="_blank" rel="noreferrer" className="pr-check-link">
                <ArrowSquareOut size={12} />
              </a>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * One-line headline above the per-check list. Tone is picked from the
 * worst-status check present: any failing → red; else any pending → amber;
 * else all-passing → green.
 */
function ChecksHeadline({ detail }: { detail: PullRequestDetail }) {
  const total = detail.checks.length;
  let passing = 0;
  let failing = 0;
  let pending = 0;
  for (const check of detail.checks) {
    const key = (check.conclusion ?? check.status ?? "").toLowerCase();
    if (key === "success") passing += 1;
    else if (key === "failure" || key === "failed") failing += 1;
    else if (
      key === "pending" ||
      key === "queued" ||
      key === "in_progress" ||
      key === "running"
    )
      pending += 1;
  }

  let tone: "pass" | "fail" | "pending";
  let label: string;
  if (failing > 0) {
    tone = "fail";
    label = `${failing} failing · ${passing} passing`;
  } else if (pending > 0) {
    tone = "pending";
    label = `${pending} pending · ${passing} passing`;
  } else {
    tone = "pass";
    label = `All ${total} check${total === 1 ? "" : "s"} passing`;
  }

  return (
    <div className={`pr-checks-headline pr-checks-headline-${tone}`}>
      <span className="pr-checks-headline-dot" aria-hidden="true">●</span>
      <span>{label}</span>
    </div>
  );
}

function ChecksSummary({ detail }: { detail: PullRequestDetail }) {
  if (detail.checks.length === 0) {
    return <div className="pr-detail-muted">No CI checks reported.</div>;
  }
  const counts = detail.checks.reduce<Record<string, number>>((acc, check) => {
    const key = check.conclusion ?? check.status ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="pr-checks-summary">
      {Object.entries(counts).map(([key, value]) => (
        <span key={key} className={`pr-check-pill pr-check-pill-${key}`}>
          {key}: {value}
        </span>
      ))}
    </div>
  );
}

function AISummaryTab({
  detail,
  prRef,
}: {
  detail: PullRequestDetail;
  prRef: PRDetailRef;
}) {
  const [summary, setSummary] =
    useState<AIEnvelope<PRReviewData> | null>(null);
  const [hunkReview, setHunkReview] =
    useState<AIEnvelope<PRHunkReviewData> | null>(null);
  const [loading, setLoading] = useState(false);
  const [hunkLoading, setHunkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hunkError, setHunkError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState(false);
  const [confirmingPost, setConfirmingPost] = useState(false);
  const [memoryUsed, setMemoryUsed] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  // Opening this tab must never spend tokens by itself: generation only runs
  // from the explicit button below.
  useEffect(() => {
    setSummary(null);
    setError(null);
    setHunkReview(null);
    setHunkError(null);
    setCopyState("idle");
    setMemoryUsed(null);
    setConfirmingPost(false);
  }, [detail]);

  async function generate(force: boolean) {
    setLoading(true);
    setError(null);
    setCopyState("idle");
    try {
      const memory = await cogneeRepositoryMemory.recall({
        source: "pr review",
        repoName: detail.repoFullName,
        branch: detail.source_branch,
        paths: detail.files.map((file) => file.path),
        prNumber: detail.number,
        subject: detail.title,
        tags: ["pull-request", "review"],
      });
      const result = await summarizePullRequestStructured(detail, {
        force,
        memoryContext: memory?.context,
      });
      setSummary(result);
      setMemoryUsed(memory ? memory.summary : null);
      void rememberPRReviewMemory(detail, result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setLoading(false);
    }
  }

  async function reviewHunks(force = false) {
    setHunkLoading(true);
    setHunkError(null);
    try {
      const memory = await cogneeRepositoryMemory.recall({
        source: "pr hunk review",
        repoName: detail.repoFullName,
        branch: detail.source_branch,
        paths: detail.files.map((file) => file.path),
        prNumber: detail.number,
        subject: detail.title,
        tags: ["pull-request", "hunk-review"],
      });
      const result = await summarizePullRequestHunksStructured(detail, {
        force,
        memoryContext: memory?.context,
      });
      setHunkReview(result);
      void cogneeRepositoryMemory.remember({
        source: "pr hunk review",
        repoName: detail.repoFullName,
        branch: detail.source_branch,
        paths: result.data.hunks.map((hunk) => hunk.file),
        prNumber: detail.number,
        subject: detail.title,
        title: `PR hunk review for ${detail.repoFullName} ${detail.numberPrefix}${detail.number}`,
        summary: [
          result.summary,
          `Overall: ${result.data.overall}`,
          result.data.questions.slice(0, 4).join(" | "),
          result.data.tests.slice(0, 4).join(" | "),
        ].filter(Boolean).join(" "),
        tags: ["pull-request", "hunk-review"],
        data: {
          overall: result.data.overall,
          hunk_count: result.data.hunks.length,
          question_count: result.data.questions.length,
          test_count: result.data.tests.length,
          confidence: result.confidence,
        },
      });
      if (result.data.tests.length > 0) {
        void cogneeRepositoryMemory.remember({
          source: "testing memory",
          repoName: detail.repoFullName,
          branch: detail.source_branch,
          paths: result.data.hunks.map((hunk) => hunk.file),
          prNumber: detail.number,
          subject: detail.title,
          title: `Testing memory for ${detail.repoFullName} ${detail.numberPrefix}${detail.number}`,
          summary: [
            "Suggested checks from PR hunk review.",
            result.data.tests.slice(0, 6).join(" | "),
          ].filter(Boolean).join(" "),
          tags: ["testing", "pull-request", "hunk-review"],
          data: {
            test_count: result.data.tests.length,
            confidence: result.confidence,
          },
        });
      }
    } catch (err: unknown) {
      setHunkError(err instanceof Error ? err.message : "Failed to review hunks");
    } finally {
      setHunkLoading(false);
    }
  }

  async function copySummary() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(formatPRSummaryForClipboard(summary));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("error");
    }
  }

  async function postSuggested() {
    if (!summary) return;
    setPosting(true);
    setPostError(null);
    setPostSuccess(false);
    try {
      const suggested = summary.data.suggestedComment || summary.summary;
      await postComment(prRef, suggested);
      setPostSuccess(true);
      setConfirmingPost(false);
    } catch (err: unknown) {
      setPostError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="pr-ai">
      <div className="pr-ai-actions">
        <button
          type="button"
          className={`pr-action${summary ? "" : " pr-action-primary"}`}
          onClick={() => void generate(Boolean(summary))}
          disabled={loading}
          title="Generate a review summary with the active AI provider (uses your provider tokens)"
        >
          <ArrowsClockwise size={12} />
          <span>
            {loading ? "Generating…" : summary ? "Regenerate" : "Generate summary"}
          </span>
        </button>
        <button
          type="button"
          className="pr-action"
          onClick={copySummary}
          disabled={!summary}
        >
          <Copy size={12} />
          <span>{copyState === "copied" ? "Copied" : "Copy"}</span>
        </button>
        <button
          type="button"
          className="pr-action"
          onClick={() => void reviewHunks(!!hunkReview)}
          disabled={hunkLoading}
          title="Ask AI to review the changed hunks section by section"
        >
          <ArrowsClockwise size={12} className={hunkLoading ? "motion-spin" : undefined} />
          <span>{hunkLoading ? "Reviewing…" : hunkReview ? "Refresh hunks" : "Review hunks"}</span>
        </button>
        <button
          type="button"
          className="pr-action pr-action-primary"
          onClick={() => setConfirmingPost(true)}
          disabled={!summary || posting || confirmingPost}
          title="Review the suggested reviewer response before posting"
        >
          <PaperPlaneTilt size={12} />
          <span>Post as comment</span>
        </button>
      </div>
      {error && <div className="pr-detail-error">{error}</div>}
      {hunkError && <div className="pr-detail-error">{hunkError}</div>}
      {copyState === "error" && (
        <div className="pr-detail-error">Clipboard write failed.</div>
      )}
      {postError && <div className="pr-detail-error">{postError}</div>}
      {postSuccess && (
        <div className="pr-detail-note">Suggested response posted to the PR.</div>
      )}
      {confirmingPost && summary && (
        <div className="pr-post-confirm">
          <div className="section-label">This exact comment will be posted</div>
          <pre className="pr-post-confirm-body">
            {summary.data.suggestedComment || summary.summary}
          </pre>
          <div className="pr-post-confirm-actions">
            <button
              type="button"
              className="pr-action pr-action-primary"
              onClick={postSuggested}
              disabled={posting}
            >
              {posting ? "Posting…" : "Post comment"}
            </button>
            <button
              type="button"
              className="pr-action"
              onClick={() => setConfirmingPost(false)}
              disabled={posting}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!summary && !loading && !error && (
        <div className="pr-detail-empty">
          No summary yet. Generate one to get a memory-aware review briefing.
        </div>
      )}
      {loading && !summary && (
        <div className="pr-detail-empty">Generating summary with the active AI provider…</div>
      )}
      {summary && memoryUsed && (
        <div className="pr-detail-note" title="Recalled repository memory was included in the AI prompt">
          From memory: {memoryUsed} informed this summary.
        </div>
      )}
      {summary && <PRReviewSummary result={summary} />}
      {hunkLoading && !hunkReview && (
        <div className="pr-detail-empty">Reviewing diff hunks with the active AI provider…</div>
      )}
      {hunkReview && <PRHunkReviewSummary result={hunkReview} />}
    </div>
  );
}

function formatPRSummaryForClipboard(summary: AIEnvelope<PRReviewData>): string {
  return [
    summary.summary,
    "",
    `Readiness: ${summary.data.readiness}`,
    "",
    summary.data.changeSummary,
    "",
    "Risks:",
    ...summary.data.riskMatrix.map((risk) =>
      `- ${risk.severity}: ${risk.file ? `${risk.file} - ` : ""}${risk.concern}`,
    ),
    "",
    "Suggested comment:",
    summary.data.suggestedComment,
  ].join("\n").trim();
}

function rememberPRReviewMemory(
  detail: PullRequestDetail,
  result: AIEnvelope<PRReviewData>,
) {
  return cogneeRepositoryMemory.remember({
    source: "pr review",
    repoName: detail.repoFullName,
    branch: detail.source_branch,
    paths: detail.files.map((file) => file.path),
    prNumber: detail.number,
    subject: detail.title,
    title: `PR review for ${detail.repoFullName} ${detail.numberPrefix}${detail.number}`,
    summary: [
      result.summary,
      result.data.changeSummary,
      result.data.riskMatrix
        .slice(0, 4)
        .map((risk) => `${risk.severity}: ${risk.file ? `${risk.file} - ` : ""}${risk.concern}`)
        .join(" | "),
    ].filter(Boolean).join(" "),
    tags: ["pull-request", "review"],
    data: {
      readiness: result.data.readiness,
      risk_count: result.data.riskMatrix.length,
      blocker_count: result.data.blockers.length,
      failing_checks: result.data.ci.failing,
      confidence: result.confidence,
    },
  });
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="pr-stat">
      <div className="pr-stat-label">{label}</div>
      <div className="pr-stat-value">{value}</div>
    </div>
  );
}
