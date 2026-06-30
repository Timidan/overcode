import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowSquareOut,
  GithubLogo,
  GitlabLogo,
  Sparkle,
  GitPullRequest,
} from "@phosphor-icons/react";
import { Sidebar } from "../components/Sidebar";
import {
  ipc,
  type GitHubIssueDetail as IssueDetailType,
  type GitHubMilestoneSummary,
} from "../lib/ipc";
import { useNav } from "../store/useNav";
import { useAIPanel } from "../store/useAIPanel";
import {
  loadIssueLocalContext,
  summarizeIssueWithLocalContext,
  type IssueLocalContext,
} from "../lib/issue-local-context";
import type { AIEnvelope, IssueTriageData } from "../lib/ai-structured";
import "./GitHubIssueDetail.css";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function GitHubIssueDetail() {
  const {
    issueRepo,
    issueNumber,
    issueProvider,
    issueProjectId,
    navigate,
  } = useNav();
  const openAI = useAIPanel((s) => s.open);
  const [detail, setDetail] = useState<IssueDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triageStarting, setTriageStarting] = useState(false);
  const [localContext, setLocalContext] = useState<IssueLocalContext | null>(null);
  const [localContextLoading, setLocalContextLoading] = useState(false);
  const [inlineSummary, setInlineSummary] =
    useState<AIEnvelope<IssueTriageData> | null>(null);
  const [inlineSummaryLoading, setInlineSummaryLoading] = useState(false);
  const [inlineSummaryError, setInlineSummaryError] = useState<string | null>(null);

  // GitLab needs both the human-readable project path (for display, local
  // mapping, AI repoName) AND the numeric project id (for the API call).
  // GitHub only needs the `owner/name` string for both purposes.
  const fetchIssueDetail = useMemo(() => {
    if (!issueNumber) return null;
    if (issueProvider === "gitlab") {
      if (!issueProjectId) return null;
      return () => ipc.getGitLabIssueDetail(issueProjectId, issueNumber);
    }
    if (!issueRepo) return null;
    return () => ipc.getGitHubIssueDetail(issueRepo, issueNumber);
  }, [issueProvider, issueRepo, issueProjectId, issueNumber]);

  useEffect(() => {
    let cancelled = false;
    if (!fetchIssueDetail) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchIssueDetail()
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, "Failed to load issue"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchIssueDetail]);

  useEffect(() => {
    let cancelled = false;
    setLocalContext(null);
    setInlineSummary(null);
    setInlineSummaryError(null);
    if (!issueRepo || !detail) return;
    setLocalContextLoading(true);
    loadIssueLocalContext(issueProvider, issueRepo, detail)
      .then((context) => {
        if (!cancelled) setLocalContext(context);
      })
      .catch(() => {
        if (!cancelled) setLocalContext(null);
      })
      .finally(() => {
        if (!cancelled) setLocalContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [issueRepo, issueProvider, detail]);

  async function startTriage() {
    if (!issueRepo || !detail) return;
    setTriageStarting(true);
    try {
      // Build a triage payload that includes local repo context when available.
      const context =
        localContext ??
        (await loadIssueLocalContext(issueProvider, issueRepo, detail).catch(
          () => null,
        ));
      openAI(
        "issue_triage",
        context?.triagePayload ?? {
          issue: detail,
          repoName: issueRepo,
        },
      );
    } finally {
      setTriageStarting(false);
    }
  }

  async function runInlineSummary(force = false) {
    if (!issueRepo || !detail) return;
    setInlineSummaryLoading(true);
    setInlineSummaryError(null);
    try {
      const result = await summarizeIssueWithLocalContext(
        issueProvider,
        issueRepo,
        detail,
        { force },
      );
      setInlineSummary(result);
    } catch (err) {
      setInlineSummaryError(errorMessage(err, "Failed to summarize issue"));
    } finally {
      setInlineSummaryLoading(false);
    }
  }

  if (!issueRepo || !issueNumber) {
    return (
      <div className="issue-detail-container">
        <Sidebar />
        <main className="issue-detail-main">
          <div className="issue-detail-empty">No issue selected</div>
        </main>
      </div>
    );
  }

  return (
    <div className="issue-detail-container">
      <Sidebar />
      <main className="issue-detail-main motion-rise">
        <header className="issue-detail-header">
          <button
            type="button"
            className="issue-detail-back"
            onClick={() => navigate("issues")}
            aria-label="Back to issues"
            title="Back to issues"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="issue-detail-heading">
            <span className="issue-detail-meta">
              {issueProvider === "gitlab" ? (
                <GitlabLogo size={13} weight="bold" />
              ) : (
                <GithubLogo size={13} weight="bold" />
              )}
              <span>{issueRepo}</span>
              <span className="issue-detail-number">#{issueNumber}</span>
              {detail && (
                <span
                  className={`issue-detail-state issue-detail-state-${detail.state}`}
                >
                  {detail.state}
                </span>
              )}
            </span>
            <h1 className="issue-detail-title">
              {detail?.title ?? (loading ? "Loading…" : `Issue #${issueNumber}`)}
            </h1>
            {detail && (
              <span className="issue-detail-byline">
                Opened by @{detail.author}
                {detail.updated_at
                  ? ` · updated ${new Date(detail.updated_at).toLocaleString()}`
                  : ""}
              </span>
            )}
          </div>
          {detail?.html_url && (
            <a
              href={detail.html_url}
              target="_blank"
              rel="noreferrer"
              className="issue-detail-link"
              title={`Open on ${issueProvider === "gitlab" ? "GitLab" : "GitHub"}`}
            >
              <ArrowSquareOut size={14} />
            </a>
          )}
        </header>

        {error && (
          <div className="issue-detail-error">
            <span>{error}</span>
            <button
              type="button"
              className="issue-detail-retry"
              onClick={() => {
                if (!fetchIssueDetail) return;
                setLoading(true);
                setError(null);
                fetchIssueDetail()
                  .then(setDetail)
                  .catch((err: unknown) =>
                    setError(errorMessage(err, "Failed to load issue")),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Retry
            </button>
          </div>
        )}

        {loading && !error && (
          <div className="issue-detail-skel skel-block" aria-busy="true">
            <span className="skel-row" />
            <span className="skel-row" />
            <span className="skel-row" />
            <span className="skel-row" />
            <span className="skel-row" />
          </div>
        )}

        {detail && !loading && !error && (
          <section className="issue-detail-grid">
            <div className="issue-detail-body-col">
              <article className="issue-detail-body">
                <div className="section-label">Description</div>
                {detail.body.trim() ? (
                  <div className="issue-detail-prose">
                    <InlineMarkdown source={detail.body} />
                  </div>
                ) : (
                  <div className="issue-detail-muted">
                    No description provided.
                  </div>
                )}
              </article>
              <article className="issue-detail-thread">
                <div className="section-label">
                  Comments ({detail.commentsData.length})
                </div>
                {detail.commentsData.length === 0 ? (
                  <div className="issue-detail-muted">
                    No discussion comments yet.
                  </div>
                ) : (
                  <div className="issue-detail-comments">
                    {detail.commentsData.map((comment, index) => (
                      <div
                        key={comment.id || `${comment.author}:${index}`}
                        className="issue-comment"
                      >
                        <header className="issue-comment-head">
                          <span className="issue-comment-author">
                            @{comment.author}
                          </span>
                          <span className="issue-comment-time">
                            {comment.created_at
                              ? new Date(comment.created_at).toLocaleString()
                              : ""}
                          </span>
                        </header>
                        <div className="issue-comment-body">
                          {comment.body ? (
                            <InlineMarkdown source={comment.body} />
                          ) : (
                            <span className="issue-detail-muted">(empty)</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </div>

            <aside className="issue-detail-side">
              <SidebarSection label="Assignees">
                {detail.assignees.length === 0 ? (
                  <span className="issue-detail-muted">None</span>
                ) : (
                  <AssigneeStack assignees={detail.assignees} />
                )}
              </SidebarSection>

              <SidebarSection label="Labels">
                {detail.labels.length === 0 ? (
                  <span className="issue-detail-muted">None</span>
                ) : (
                  <div className="issue-side-chips">
                    {detail.labels.map((label) => {
                      const hex = sanitizeLabelHex(label.color);
                      return (
                        <span
                          key={label.name}
                          className="issue-side-chip"
                          style={
                            hex
                              ? ({
                                  borderColor: `#${hex}`,
                                  ["--label-dot" as string]: `#${hex}`,
                                } as React.CSSProperties)
                              : undefined
                          }
                          title={label.description ?? undefined}
                        >
                          <span className="issue-side-chip-dot" aria-hidden="true" />
                          <span className="issue-side-chip-text">{label.name}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </SidebarSection>

              <SidebarSection label="Milestone">
                {detail.milestone ? (
                  <MilestoneBlock milestone={detail.milestone} />
                ) : (
                  <span className="issue-detail-muted">None</span>
                )}
              </SidebarSection>

              <SidebarSection label="Linked PRs">
                {detail.linkedPullRequests.length === 0 ? (
                  <span className="issue-detail-muted">None linked</span>
                ) : (
                  <div className="issue-side-prs">
                    {detail.linkedPullRequests.map((pr) => (
                      <a
                        key={pr.number}
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`issue-side-pr issue-side-pr-${pr.state}`}
                      >
                        <GitPullRequest size={11} weight="bold" />
                        <span className="issue-side-pr-num">#{pr.number}</span>
                        <span className="issue-side-pr-title">{pr.title}</span>
                      </a>
                    ))}
                  </div>
                )}
              </SidebarSection>

              <button
                type="button"
                className="issue-triage-cta"
                onClick={startTriage}
                disabled={triageStarting}
                title="Open AI triage for this issue"
              >
                <Sparkle size={13} weight="fill" />
                <span>
                  {triageStarting ? "Opening…" : "AI triage"}
                </span>
              </button>

              <IssueIntelligencePanel
                context={localContext}
                contextLoading={localContextLoading}
                summary={inlineSummary}
                loading={inlineSummaryLoading}
                error={inlineSummaryError}
                onSummarize={() => void runInlineSummary(false)}
                onRefresh={() => void runInlineSummary(true)}
              />
            </aside>
          </section>
        )}
      </main>
    </div>
  );
}

function IssueIntelligencePanel({
  context,
  contextLoading,
  summary,
  loading,
  error,
  onSummarize,
  onRefresh,
}: {
  context: IssueLocalContext | null;
  contextLoading: boolean;
  summary: AIEnvelope<IssueTriageData> | null;
  loading: boolean;
  error: string | null;
  onSummarize: () => void;
  onRefresh: () => void;
}) {
  const candidate = context?.mapping.candidate;
  const status = context?.status;
  return (
    <section className="issue-intelligence">
      <div className="section-label">Issue intelligence</div>
      {contextLoading ? (
        <div className="issue-detail-muted">Resolving local workspace…</div>
      ) : candidate ? (
        <div className="issue-intel-facts">
          <span title={candidate.local_path}>Local: {candidate.name}</span>
          <span>{status?.fileTree.length ?? 0} files indexed</span>
          <span>{status?.files.length ?? 0} local changes</span>
        </div>
      ) : (
        <div className="issue-detail-muted">No pinned local workspace matched this issue repo.</div>
      )}

      <div className="issue-intel-actions">
        <button
          type="button"
          className="issue-intel-action"
          onClick={summary ? onRefresh : onSummarize}
          disabled={loading}
        >
          {loading ? "Summarizing…" : summary ? "Refresh AI" : "AI summary"}
        </button>
      </div>

      {error && <div className="issue-detail-error">{error}</div>}
      {summary && (
        <div className="issue-intel-summary">
          <div className={`issue-intel-priority issue-intel-priority-${summary.data.priority}`}>
            {summary.data.priority} priority
          </div>
          <p>{summary.summary}</p>
          {summary.data.likelyModules.length > 0 && (
            <div className="issue-intel-modules">
              {summary.data.likelyModules.slice(0, 3).map((module) => (
                <code key={module.name}>{module.name}</code>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SidebarSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="issue-side-section">
      <div className="section-label">{label}</div>
      <div className="issue-side-body">{children}</div>
    </section>
  );
}

// GitHub returns label.color as a 6-char hex (no leading "#"). Sanitize
// before letting it touch an inline style so a malformed API value can't
// inject CSS via the `borderColor` / `--label-dot` channels.
function sanitizeLabelHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/^#/, "").trim();
  return /^[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function avatarInitials(handle: string): string {
  const cleaned = handle.replace(/^@/, "");
  if (cleaned.length === 0) return "?";
  const parts = cleaned.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function AssigneeStack({ assignees }: { assignees: string[] }) {
  const visible = assignees.slice(0, 4);
  const overflow = assignees.length - visible.length;
  return (
    <div className="issue-side-assignees" aria-label="Assignees">
      {visible.map((assignee, index) => (
        <span
          key={assignee}
          className="issue-side-avatar"
          title={`@${assignee}`}
          style={index === 0 ? undefined : { marginLeft: "-4px" }}
        >
          {avatarInitials(assignee)}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="issue-side-avatar issue-side-avatar-overflow"
          style={{ marginLeft: "-4px" }}
          title={`+${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

// Milestone block. When the backend provides open/closed issue counts we
// render a determinate 60-segment bar plus a `{closed}/{total} closed`
// caption; otherwise we fall back to the indeterminate bar styling. The
// due-date clause is appended to the caption only when present.
const MILESTONE_BAR_SEGMENTS = 60;

function MilestoneBlock({ milestone }: { milestone: GitHubMilestoneSummary }) {
  const open = milestone.openIssues;
  const closed = milestone.closedIssues;
  const hasCounts = typeof open === "number" && typeof closed === "number";
  const total = hasCounts ? (open as number) + (closed as number) : 0;
  const ratio = hasCounts && total > 0 ? (closed as number) / total : null;
  const pct = ratio === null ? null : Math.round(ratio * 100);
  const fillSegments =
    ratio === null ? 0 : Math.round(MILESTONE_BAR_SEGMENTS * ratio);
  const fillPct = (fillSegments / MILESTONE_BAR_SEGMENTS) * 100;
  const dueLabel = formatMilestoneDate(milestone.dueOn);
  const captionParts: string[] = [];
  if (hasCounts && total > 0) {
    captionParts.push(`${closed}/${total} closed`);
  }
  if (dueLabel) {
    captionParts.push(`Due ${dueLabel}`);
  } else if (hasCounts && total > 0) {
    captionParts.push("No due date");
  }
  const caption = captionParts.join(" · ") || "In progress";

  return (
    <div className="issue-side-milestone">
      <div className="issue-side-milestone-headline">
        <span className="issue-side-milestone-title">{milestone.title}</span>
        {pct !== null && (
          <span className="issue-side-milestone-pct">{pct}%</span>
        )}
      </div>
      <div
        className="issue-side-milestone-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={hasCounts && total > 0 ? total : 100}
        aria-valuenow={hasCounts && total > 0 ? (closed as number) : undefined}
        aria-label={
          pct !== null
            ? `Milestone ${pct}% complete`
            : "Milestone progress (unknown)"
        }
      >
        <span
          className={
            pct === null
              ? "issue-side-milestone-bar-fill issue-side-milestone-bar-empty"
              : "issue-side-milestone-bar-fill"
          }
          style={pct === null ? undefined : { width: `${fillPct}%` }}
        />
      </div>
      <div className="issue-side-milestone-caption">{caption}</div>
    </div>
  );
}

function formatMilestoneDate(iso?: string): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  // Short, locale-friendly date — e.g. "May 17, 2026". Avoid time-of-day
  // since GitHub milestone due_on values are anchored to midnight UTC.
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// -----------------------------------------------------------------------
// Inline markdown renderer — handles bold / italic / code / link / lists /
// task lists / line breaks. XSS-safe by construction: every text fragment
// reaches the DOM via React children (which auto-escapes), and the only
// element types ever emitted are a fixed allowlist (strong/em/code/a/br/
// ul/li/p/input). Link hrefs are constrained by the regex to http(s)://
// URLs only, so javascript: / data: URLs cannot slip through. We never
// call dangerouslySetInnerHTML and never produce a string of HTML.
// -----------------------------------------------------------------------

type MdNode =
  | { kind: "text"; value: string }
  | { kind: "br" }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; href: string; value: string };

function parseInline(line: string): MdNode[] {
  const nodes: MdNode[] = [];
  const re =
    /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ kind: "text", value: line.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) nodes.push({ kind: "code", value: match[1] });
    else if (match[2] !== undefined) nodes.push({ kind: "bold", value: match[2] });
    else if (match[3] !== undefined) nodes.push({ kind: "italic", value: match[3] });
    else if (match[4] !== undefined && match[5] !== undefined) {
      nodes.push({ kind: "link", value: match[4], href: match[5] });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < line.length) {
    nodes.push({ kind: "text", value: line.slice(lastIndex) });
  }
  return nodes;
}

function renderInline(nodes: MdNode[], keyPrefix: string): React.ReactNode {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.kind) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "br":
        return <br key={key} />;
      case "bold":
        return <strong key={key}>{node.value}</strong>;
      case "italic":
        return <em key={key}>{node.value}</em>;
      case "code":
        return <code key={key} className="md-code">{node.value}</code>;
      case "link":
        return (
          <a key={key} className="md-link" href={node.href} target="_blank" rel="noreferrer">
            {node.value}
          </a>
        );
    }
  });
}

type MdBlock =
  | { kind: "para"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "checks"; items: Array<{ done: boolean; text: string }> };

function blockify(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const check = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (check) {
      const last = blocks[blocks.length - 1];
      const entry = { done: check[1].toLowerCase() === "x", text: check[2] };
      if (last && last.kind === "checks") last.items.push(entry);
      else blocks.push({ kind: "checks", items: [entry] });
    } else if (bullet) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "para") last.lines.push(line);
      else blocks.push({ kind: "para", lines: [line] });
    }
  }
  return blocks;
}

function InlineMarkdown({ source }: { source: string }): React.ReactElement {
  const blocks = useMemo(() => blockify(source), [source]);
  return (
    <>
      {blocks.map((block, blockIndex) => {
        if (block.kind === "ul") {
          return (
            <ul key={`b-${blockIndex}`} className="md-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(parseInline(item), `b${blockIndex}-i${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "checks") {
          return (
            <ul key={`b-${blockIndex}`} className="md-list md-checks">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="md-check">
                  <input type="checkbox" disabled readOnly checked={item.done} />
                  <span>{renderInline(parseInline(item.text), `b${blockIndex}-c${itemIndex}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={`b-${blockIndex}`} className="md-para">
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {renderInline(parseInline(line), `b${blockIndex}-l${lineIndex}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
