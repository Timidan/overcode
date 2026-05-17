import { useState } from "react";
import {
  ChatCircle,
  ArrowSquareOut,
  GithubLogo,
  GitlabLogo,
  GitBranch,
} from "@phosphor-icons/react";
import {
  commentOnCollaborationItem,
  type PRCardData,
  type PRStatus,
} from "../lib/collaboration";
import type { PullRequestCheckSummary } from "../lib/ipc";
import { useNav } from "../store/useNav";
import "./PRCard.css";

export type { PRCardData, PRStatus } from "../lib/collaboration";

interface Props {
  pr: PRCardData;
}

type CheckBucket = "passing" | "failing" | "pending";

// Cap the number of rendered pills so a noisy CI matrix doesn't push the
// PR tile out of the grid. Anything over this collapses into a `+N` chip.
const PILL_CAP = 8;

/**
 * Render a thin strip of small colored pills derived from the PR's CI
 * rollup. Reads from the new optional `pr.checks` field populated by
 * `collaboration.ts` (it taps the existing per-repo pipeline fetch); when
 * the field is absent we render nothing rather than fabricating an
 * "overall" lozenge — the existing status lozenge already covers PR-level
 * state.
 */
function PRChecksStrip({ pr }: { pr: PRCardData }) {
  const checks = pr.checks;
  if (!checks || checks.total <= 0) return null;
  const pills = buildPills(checks);
  if (pills.length === 0) return null;
  const overflow = checks.total - pills.length;
  const aria = `${checks.passing} passing, ${checks.failing} failing, ${checks.pending} pending`;
  return (
    <div className="pr-checks-strip" aria-label={`${checks.total} CI checks: ${aria}`}>
      {pills.map((bucket, index) => (
        <span
          key={`${bucket}-${index}`}
          className={`pr-check-pill pr-check-pill-${bucket}`}
          title={pillTitle(bucket)}
          aria-label={pillTitle(bucket)}
        />
      ))}
      {overflow > 0 && (
        <span
          className="pr-check-pill-overflow"
          title={`${overflow} additional checks`}
          aria-label={`${overflow} additional checks`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function buildPills(checks: PullRequestCheckSummary): CheckBucket[] {
  // Render failing first, then pending, then passing — failure deserves
  // immediate eye contact in the tile.
  const ordered: CheckBucket[] = [];
  for (let i = 0; i < checks.failing && ordered.length < PILL_CAP; i += 1) {
    ordered.push("failing");
  }
  for (let i = 0; i < checks.pending && ordered.length < PILL_CAP; i += 1) {
    ordered.push("pending");
  }
  for (let i = 0; i < checks.passing && ordered.length < PILL_CAP; i += 1) {
    ordered.push("passing");
  }
  return ordered;
}

function pillTitle(bucket: CheckBucket): string {
  if (bucket === "passing") return "Passing check";
  if (bucket === "failing") return "Failing check";
  return "Pending check";
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function statusLabel(status: PRStatus): string {
  if (status === "changes-requested") return "Changes";
  // PRStatus is a short lowercase enum (e.g. "open", "merged"); just capitalize.
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function authorInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function localMappingLabel(pr: PRCardData): string | null {
  const mapping = pr.localMapping;
  if (!mapping) return null;
  if (mapping.state === "matched") {
    return mapping.branchLikelyLocal ? "Local" : "Local repo";
  }
  if (mapping.state === "likely") return "Likely local";
  if (mapping.state === "ambiguous") return "Multi local";
  return "Remote";
}

function localMappingTitle(pr: PRCardData): string | undefined {
  const mapping = pr.localMapping;
  if (!mapping) return undefined;
  if (mapping.localPath) return `Mapped to ${mapping.localPath}`;
  if (mapping.state === "ambiguous") {
    return "Multiple pinned local workspaces may match this remote repository";
  }
  return "No pinned local workspace matches this remote repository";
}

export function PRCard({ pr }: Props) {
  const openPRDetail = useNav((s) => s.openPRDetail);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mappingLabel = localMappingLabel(pr);

  function openDetail() {
    openPRDetail({
      provider: pr.platform,
      repoFullName: pr.repoFullName,
      projectId:
        pr.commentTarget.platform === "gitlab"
          ? pr.commentTarget.projectId
          : undefined,
      number: pr.number,
    });
  }

  async function submitComment() {
    if (!comment.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await commentOnCollaborationItem(pr, comment);
      setComment("");
      setCommenting(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }

  return (
    <article className={`pr-tile pr-status-${pr.status}`}>
      <button
        type="button"
        className="pr-tile-surface"
        onClick={openDetail}
        title={`Open ${pr.numberPrefix}${pr.number} detail view`}
      >
        <header className="pr-tile-top">
          <span className="pr-tile-platform">
            {pr.platform === "github" ? (
              <GithubLogo size={14} weight="fill" color={pr.platformColor} />
            ) : (
              <GitlabLogo size={14} weight="fill" color={pr.platformColor} />
            )}
            <span className="pr-tile-repo">{pr.repoFullName}</span>
            <span className="pr-tile-number">
              {pr.numberPrefix}
              {pr.number}
            </span>
          </span>
          <span className={`pr-tile-lozenge pr-lozenge-${pr.status}`}>
            {statusLabel(pr.status)}
          </span>
        </header>

        <h3 className="pr-tile-title" title={pr.title}>
          {pr.title}
        </h3>

        <div className="pr-tile-branches">
          <GitBranch size={12} className="pr-tile-branch-icon" />
          <span className="pr-tile-branch pr-tile-branch-source">
            {pr.source_branch}
          </span>
          <span className="pr-tile-branch-arrow">→</span>
          <span className="pr-tile-branch pr-tile-branch-target">
            {pr.target_branch}
          </span>
          {mappingLabel && (
            <span
              className={`pr-tile-local-badge pr-local-${pr.localMapping?.state}`}
              title={localMappingTitle(pr)}
            >
              {mappingLabel}
            </span>
          )}
        </div>
      </button>

      <PRChecksStrip pr={pr} />

      <footer className="pr-tile-footer">
        <div className="pr-tile-author" title={pr.author}>
          <span className="pr-tile-avatar" aria-hidden="true">
            {authorInitials(pr.author)}
          </span>
          <span className="pr-tile-author-name">{pr.author}</span>
          <span className="pr-tile-dot" aria-hidden="true">
            ·
          </span>
          <span className="pr-tile-time">{timeAgo(pr.updated_at)}</span>
        </div>
        <div className="pr-tile-actions">
          <button
            type="button"
            className={`pr-tile-icon-button${commenting ? " is-active" : ""}`}
            title={commenting ? "Cancel comment" : "Leave a comment"}
            onClick={() => setCommenting((v) => !v)}
            aria-pressed={commenting}
          >
            <ChatCircle size={14} />
          </button>
          <a
            className="pr-tile-icon-button"
            title="Open in browser"
            href={pr.url}
            target="_blank"
            rel="noreferrer"
          >
            <ArrowSquareOut size={14} />
          </a>
        </div>
      </footer>

      {commenting && (
        <div className="pr-tile-comment-form">
          <textarea
            className="pr-comment-input"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Leave a comment…"
            rows={3}
          />
          {error && <div className="pr-comment-error">{error}</div>}
          <div className="pr-comment-actions">
            <button
              type="button"
              className="pr-button"
              disabled={posting}
              onClick={submitComment}
            >
              {posting ? "Posting…" : "Submit"}
            </button>
            <button
              type="button"
              className="pr-button pr-button-secondary"
              onClick={() => {
                setCommenting(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
