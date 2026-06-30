import { Monitor, GithubLogo, GitlabLogo } from "@phosphor-icons/react";
import { BranchBadge } from "./BranchBadge";
import { StatusDot } from "./StatusDot";
import { useAIPanel } from "../store/useAIPanel";
import { useNav } from "../store/useNav";
import {
  ipc,
  type GitHubPR,
  type GitLabMR,
} from "../lib/ipc";
import "./ActivityItem.css";

interface Activity {
  id: string;
  repo_id: string;
  type: string;
  title: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

interface Repository {
  id: string;
  name: string;
  platform: "github" | "gitlab" | "local";
  local_path?: string;
  remote_url?: string;
}

interface ActivityItemProps {
  item: Activity;
  repository?: Repository;
}

const PLATFORM_COLOR: Record<Repository["platform"], string> = {
  github: "var(--brand-github)",
  gitlab: "var(--brand-gitlab)",
  local: "var(--color-text-secondary)",
};

const PLATFORM_BG: Record<Repository["platform"], string> = {
  github: "var(--color-bg-app)",
  gitlab: "var(--color-bg-app)",
  local: "var(--color-bg-app)",
};

const IMPACT_NO_LOCAL_PATH =
  "Impact analysis unavailable: this repository does not have a local path.";
const IMPACT_NO_HASH =
  "Impact analysis unavailable: this activity does not include a commit hash.";
const IMPACT_NO_DIFF =
  "Impact analysis unavailable: no real git diff was returned for this change.";
const BRIEF_NO_LOCAL_PATH =
  "Repo brief unavailable: this repository does not have a local path.";
const BRIEF_NO_DATA =
  "Repo brief unavailable: no real repository data was returned for this workspace.";

type EventGlyphKind = "commit" | "pr-open" | "pr-merged" | "pr-closed" | "dirty" | null;

/**
 * Derive a tiny per-row glyph from the activity shape. Returns `null` for
 * activity types that don't have a meaningful glyph (e.g. CI runs already
 * have a status lozenge elsewhere). The kinds map to existing
 * `WorkspaceActivity.type` strings produced by `populateActivityFromRepos`
 * and `collectProviderActivity` in `lib/workspace-data.ts`.
 */
function eventGlyphKind(activityType: string, metadata: Record<string, unknown>): EventGlyphKind {
  if (activityType === "commit" || activityType === "push") return "commit";
  if (activityType === "stash" || activityType === "fs_change") return "dirty";
  if (activityType === "pr_merged") return "pr-merged";
  if (activityType === "pr_opened") {
    const state = typeof metadata.state === "string" ? metadata.state : null;
    if (state === "closed") return "pr-closed";
    return "pr-open";
  }
  if (activityType === "pr_closed") return "pr-closed";
  return null;
}

function EventGlyph({ kind }: { kind: EventGlyphKind }) {
  if (!kind) return null;
  if (kind === "commit") {
    return (
      <svg
        className="activity-item-glyph"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        <circle cx="5" cy="5" r="3" fill="var(--color-accent-blue)" />
      </svg>
    );
  }
  if (kind === "dirty") {
    return (
      <svg
        className="activity-item-glyph"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        <circle cx="5" cy="5" r="3" fill="var(--color-accent-amber)" />
      </svg>
    );
  }
  // PR fork glyph: two stems converging into a single line — a tiny "merge/fork" mark.
  const color =
    kind === "pr-merged"
      ? "var(--color-accent-purple)"
      : kind === "pr-closed"
        ? "var(--color-accent-red)"
        : "var(--color-accent-green)";
  return (
    <svg
      className="activity-item-glyph"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path
        d="M2 1 L2 5 Q2 7 4 7 L8 7 M8 1 L8 7"
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="square"
      />
    </svg>
  );
}

function PlatformAvatar({ platform }: { platform: Repository["platform"] | undefined }) {
  const resolved: Repository["platform"] = platform ?? "local";
  const color = PLATFORM_COLOR[resolved];
  const background = PLATFORM_BG[resolved];
  const icon =
    resolved === "github" ? (
      <GithubLogo size={14} color={color} weight="fill" />
    ) : resolved === "gitlab" ? (
      <GitlabLogo size={14} color={color} weight="fill" />
    ) : (
      <Monitor size={14} color={color} />
    );
  return (
    <div className="activity-item-avatar" style={{ background }}>
      {icon}
    </div>
  );
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  return rtf.format(-days, "day");
}

export function ActivityItem({ item, repository }: ActivityItemProps) {
  const { open } = useAIPanel();
  const navigate = useNav((s) => s.navigate);
  const repoLabel = repository?.name ?? metadataString(item.metadata, "repo") ?? "unknown";
  const platform = repository?.platform ?? metadataPlatform(item.metadata);

  const openRepo = () => {
    if (repository) navigate("repo-detail", repository.id);
  };

  async function handleAnalyzeImpact() {
    if (!repository?.local_path) {
      open("impact", {
        diff: IMPACT_NO_LOCAL_PATH,
        fileTree: [],
        unavailableReason: IMPACT_NO_LOCAL_PATH,
      });
      return;
    }
    const hash = typeof item.metadata?.hash === "string" ? item.metadata.hash : null;
    if (!hash) {
      open("impact", {
        diff: IMPACT_NO_HASH,
        fileTree: [],
        unavailableReason: IMPACT_NO_HASH,
      });
      return;
    }
    const diff = await ipc.showCommit(repository.local_path, hash).catch(() => "");
    if (!diff.trim()) {
      open("impact", {
        diff: IMPACT_NO_DIFF,
        fileTree: [],
        unavailableReason: IMPACT_NO_DIFF,
      });
      return;
    }
    open("impact", { diff, fileTree: extractDiffPaths(diff) });
  }

  async function handleGetBriefed() {
    if (!repository?.local_path) {
      open("brief", {
        repoId: repository?.id ?? item.repo_id,
        repoName: repoLabel,
        unavailableReason: BRIEF_NO_LOCAL_PATH,
      });
      return;
    }

    const [status, log, openPRs] = await Promise.all([
      ipc.getGitStatus(repository.local_path).catch(() => null),
      ipc.getGitLog(repository.local_path, 20).catch(() => []),
      loadOpenPRTitles(repository),
    ]);
    const recentCommits = log
      .map((c) => c.message.split("\n")[0])
      .filter(Boolean);
    const changedFiles = status?.files.map((file) => file.path).filter(Boolean) ?? [];
    const hasStatusData = Boolean(
      status &&
        (status.files.length > 0 ||
          status.ahead > 0 ||
          status.behind > 0 ||
          status.branch !== "HEAD"),
    );

    if (
      !hasStatusData &&
      recentCommits.length === 0 &&
      openPRs.length === 0
    ) {
      open("brief", {
        repoId: repository.id,
        repoName: repository.name,
        unavailableReason: BRIEF_NO_DATA,
      });
      return;
    }

    open("brief", {
      repoId: repository.id,
      repoName: repository.name,
      remoteUrl: repository.remote_url,
      branch: status?.branch,
      tree: status?.fileTree ?? [],
      readme: [status?.packageSummary, status?.readme].filter(Boolean).join("\n\n"),
      recentCommits,
      openPRs,
      changedFiles,
    });
  }

  const branch = typeof item.metadata?.branch === "string" ? item.metadata.branch : null;
  const showImpact = item.type === "commit" || item.type === "push";
  const impactUnavailableTitle = !repository?.local_path
    ? IMPACT_NO_LOCAL_PATH
    : typeof item.metadata?.hash !== "string"
      ? IMPACT_NO_HASH
      : "Analyze this change with OpenRouter AI";
  const briefUnavailableTitle = !repository?.local_path
    ? BRIEF_NO_LOCAL_PATH
    : "Generate an onboarding brief for this repository";

  return (
    <div className="activity-item">
      <PlatformAvatar platform={platform} />

      <div className="activity-item-content">
        <div className="activity-item-line-top">
          <button
            type="button"
            className="activity-item-repo"
            onClick={openRepo}
            disabled={!repository}
            title={repository ? `Open ${repoLabel}` : repoLabel}
          >
            {repoLabel}
          </button>
          {branch && <BranchBadge branch={branch} />}
        </div>
        <div className="activity-item-line-bottom">
          <EventGlyph kind={eventGlyphKind(item.type, item.metadata)} />
          <span className="activity-item-line-text">{item.title}</span>
        </div>
      </div>

      <div className="activity-item-actions">
        {showImpact && (
          <button
            type="button"
            className="activity-item-button"
            title={impactUnavailableTitle}
            onClick={handleAnalyzeImpact}
          >
            Analyze Impact
          </button>
        )}
        <button
          type="button"
          className="activity-item-button"
          title={briefUnavailableTitle}
          onClick={handleGetBriefed}
        >
          Get Briefed
        </button>
      </div>

      <div className="activity-item-time">{timeAgo(item.timestamp)}</div>
      <StatusDot type={item.type} />
    </div>
  );
}

function extractDiffPaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      addPath(paths, match?.[1]);
      addPath(paths, match?.[2]);
    } else if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      addPath(paths, line.slice(6));
    }
  }
  return [...paths];
}

function addPath(paths: Set<string>, path: string | undefined): void {
  if (!path || path === "/dev/null") return;
  paths.add(path);
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataPlatform(
  metadata: Record<string, unknown>,
): Repository["platform"] | undefined {
  return metadata.platform === "github" || metadata.platform === "gitlab"
    ? metadata.platform
    : undefined;
}

async function loadOpenPRTitles(repository: Repository): Promise<string[]> {
  const remoteProject = parseRemoteProject(repository);
  if (!remoteProject) return [];

  try {
    if (repository.platform === "github") {
      const prs = await ipc.getGitHubPRs(remoteProject);
      return prs.map(formatGitHubPR);
    }
    if (repository.platform === "gitlab") {
      const mrs = await ipc.getGitLabMRs(remoteProject);
      return mrs.map(formatGitLabMR);
    }
  } catch {
    return [];
  }

  return [];
}

function parseRemoteProject(repository: Repository): string | null {
  const remote = repository.remote_url?.trim();
  if (!remote) return null;

  const sshMatch = remote.match(/^[^@]+@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1]) return sshMatch[1];

  try {
    const url = new URL(remote);
    const path = url.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
    return path || null;
  } catch {
    return null;
  }
}

function formatGitHubPR(pr: GitHubPR): string {
  return `#${pr.number} ${pr.title}`;
}

function formatGitLabMR(mr: GitLabMR): string {
  return `!${mr.iid} ${mr.title}`;
}
