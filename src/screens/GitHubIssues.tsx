import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MagnifyingGlass,
  GithubLogo,
  GitlabLogo,
  ChatCircle,
} from "@phosphor-icons/react";
import { Sidebar } from "../components/Sidebar";
import { BrutalistSelect } from "../components/BrutalistSelect";
import {
  ipc,
  type GitHubIssue,
  type GitHubRepo,
  type GitLabIssue,
  type GitLabProject,
} from "../lib/ipc";
import { useNav, type IssueProvider } from "../store/useNav";
import "./GitHubIssues.css";

type Filter = "all" | "open" | "closed" | "mentions";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "mentions", label: "Assigned to you" },
];

const PROVIDER_TABS: Array<{ key: IssueProvider; label: string }> = [
  { key: "github", label: "GitHub" },
  { key: "gitlab", label: "GitLab" },
];

const ISSUE_LIST_CACHE_TTL_MS = 60_000;
const issueListCache = new Map<
  string,
  { timestamp: number; issues: GitHubIssue[] | GitLabIssue[] }
>();

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function issueListCacheKey(
  provider: IssueProvider,
  repo: string | null,
  projects: GitLabProject[],
): string {
  if (provider === "github") return `github:${repo ?? ""}`;
  if (repo) return `gitlab:${repo}`;
  return `gitlab:all:${projects.map((project) => project.id).join(",")}`;
}

function readIssueListCache(
  key: string,
): GitHubIssue[] | GitLabIssue[] | null {
  const cached = issueListCache.get(key);
  if (!cached || Date.now() - cached.timestamp >= ISSUE_LIST_CACHE_TTL_MS) {
    return null;
  }
  return cached.issues;
}

export function GitHubIssues() {
  const {
    issueRepo,
    issueProvider,
    openIssueDetail,
    setIssueRepo,
    setIssueProvider,
  } = useNav();
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [gitlabProjects, setGitlabProjects] = useState<GitLabProject[]>([]);
  // Both providers normalise to `GitHubIssue` — `GitLabIssue` is a type
  // alias — so a single state holds either list.
  const [issues, setIssues] = useState<GitHubIssue[] | GitLabIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [search, setSearch] = useState("");
  const [authedGitHub, setAuthedGitHub] = useState(false);
  const [authedGitLab, setAuthedGitLab] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [authReloadKey, setAuthReloadKey] = useState(0);
  const [me, setMe] = useState<string | null>(null);
  const [meGitLab, setMeGitLab] = useState<string | null>(null);

  // Load auth + repos/projects for both providers so the picker can switch
  // between them without a second auth round trip.
  useEffect(() => {
    let cancelled = false;
    async function loadAuthAndRepos() {
      try {
        const status = await ipc.getAuthStatus().catch(() => ({
          github: false,
          gitlab: false,
          profiles: { github: null, gitlab: null },
        }));
        if (cancelled) return;
        setAuthedGitHub(status.github);
        setAuthedGitLab(status.gitlab);
        setMe(status.profiles?.github?.username ?? null);
        setMeGitLab(status.profiles?.gitlab?.username ?? null);
        const [ghRepos, glProjects] = await Promise.all([
          status.github
            ? ipc.getGitHubRepos().catch(() => [] as GitHubRepo[])
            : Promise.resolve([] as GitHubRepo[]),
          status.gitlab
            ? ipc.getGitLabProjects().catch(() => [] as GitLabProject[])
            : Promise.resolve([] as GitLabProject[]),
        ]);
        if (cancelled) return;
        setGithubRepos(ghRepos);
        setGitlabProjects(glProjects);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Failed to load repositories"));
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    }
    void loadAuthAndRepos();
    return () => {
      cancelled = true;
    };
  }, [authReloadKey]);

  // GitLab can't fan out to a unified inbox the way GitHub's /issues does:
  // GitLab requires a project id. When the GitLab tab is active without a
  // pinned project, we fan out a per-project fetch across the user's
  // projects and concatenate.
  const fetchIssues = useCallback(async (): Promise<GitHubIssue[] | GitLabIssue[]> => {
    if (issueProvider === "github") {
      return ipc.getGitHubIssues(issueRepo ?? undefined);
    }
    if (issueRepo) {
      const project = gitlabProjects.find(
        (proj) => proj.path_with_namespace === issueRepo,
      );
      if (!project) return [];
      return ipc.getGitLabIssues(String(project.id));
    }
    // Cross-project fan-out — bounded by the number of projects we've
    // already paged in. Failures on individual projects are swallowed so
    // one broken project doesn't take down the unified inbox view.
    if (gitlabProjects.length === 0) return [];
    const fetched = await Promise.all(
      gitlabProjects.map((project) =>
        ipc
          .getGitLabIssues(String(project.id))
          .catch(() => [] as GitLabIssue[]),
      ),
    );
    return fetched.flat();
  }, [issueProvider, issueRepo, gitlabProjects]);

  useEffect(() => {
    let cancelled = false;
    if (!authChecked) return;
    const authed = issueProvider === "github" ? authedGitHub : authedGitLab;
    if (!authed) {
      setIssues([]);
      setLoading(false);
      return;
    }
    const cacheKey = issueListCacheKey(issueProvider, issueRepo, gitlabProjects);
    const cached = readIssueListCache(cacheKey);
    if (cached) {
      setIssues(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchIssues()
      .then((list) => {
        issueListCache.set(cacheKey, { timestamp: Date.now(), issues: list });
        if (!cancelled) setIssues(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errorMessage(err, "Failed to load issues"));
          setIssues([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authChecked, authedGitHub, authedGitLab, issueProvider, issueRepo, gitlabProjects, fetchIssues]);

  const activeMe = issueProvider === "github" ? me : meGitLab;

  const counts = useMemo(() => {
    const open = issues.filter((issue) => issue.state === "open").length;
    const closed = issues.filter((issue) => issue.state === "closed").length;
    const mine = activeMe
      ? issues.filter((issue) => issue.assignees.includes(activeMe)).length
      : 0;
    return { all: issues.length, open, closed, mentions: mine };
  }, [issues, activeMe]);

  const visibleIssues = useMemo(() => {
    const query = search.trim().toLowerCase();
    return issues.filter((issue) => {
      if (filter === "open" && issue.state !== "open") return false;
      if (filter === "closed" && issue.state !== "closed") return false;
      if (filter === "mentions") {
        if (!activeMe) return false;
        if (!issue.assignees.includes(activeMe)) return false;
      }
      if (!query) return true;
      return (
        issue.title.toLowerCase().includes(query) ||
        String(issue.number).includes(query) ||
        issue.author.toLowerCase().includes(query)
      );
    });
  }, [issues, filter, search, activeMe]);

  const providerOptions = useMemo(() => {
    if (issueProvider === "github") {
      return [
        {
          value: "",
          label: "All repositories",
          hint: "Your unified GitHub issue inbox",
        },
        ...githubRepos.map((repo) => ({
          value: repo.full_name,
          label: repo.full_name,
        })),
      ];
    }
    return [
      {
        value: "",
        label: "All projects",
        hint: "Fan-out across your GitLab projects",
      },
      ...gitlabProjects.map((project) => ({
        value: project.path_with_namespace,
        label: project.path_with_namespace,
      })),
    ];
  }, [issueProvider, githubRepos, gitlabProjects]);

  const activeAuthed = issueProvider === "github" ? authedGitHub : authedGitLab;
  const providerLabel = issueProvider === "github" ? "GitHub" : "GitLab";
  const filteredOut =
    issues.length > 0 && (filter !== "all" || search.trim().length > 0);

  async function connectProvider() {
    setConnecting(true);
    setError(null);
    try {
      await ipc.connectAuth(issueProvider);
      // Re-run the full auth + repos/projects load; the issue fetch effect
      // keys off the auth flags and follows automatically.
      setAuthReloadKey((key) => key + 1);
    } catch (err) {
      setError(errorMessage(err, "Connection failed"));
    } finally {
      setConnecting(false);
    }
  }

  function retryFetch() {
    const cacheKey = issueListCacheKey(issueProvider, issueRepo, gitlabProjects);
    issueListCache.delete(cacheKey);
    setLoading(true);
    setError(null);
    fetchIssues()
      .then((list) => {
        issueListCache.set(cacheKey, { timestamp: Date.now(), issues: list });
        setIssues(list);
      })
      .catch((err: unknown) =>
        setError(errorMessage(err, "Failed to load issues")),
      )
      .finally(() => setLoading(false));
  }

  return (
    <div className="issues-screen-container">
      <Sidebar />
      <main className="issues-screen-main motion-rise">
        <header className="issues-screen-header">
          <h1 className="issues-screen-title">Issues</h1>
          <div className="issues-screen-meta">
            <div
              className="issues-provider-tabs"
              role="tablist"
              aria-label="Issue provider"
            >
              {PROVIDER_TABS.map((tab) => {
                const isActive = issueProvider === tab.key;
                const isDisabled =
                  tab.key === "github" ? !authedGitHub : !authedGitLab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`issues-provider-tab${isActive ? " is-active" : ""}`}
                    disabled={isDisabled && !isActive}
                    title={
                      isDisabled
                        ? `Connect ${tab.label} to view its issues`
                        : `Show ${tab.label} issues`
                    }
                    onClick={() => setIssueProvider(tab.key)}
                  >
                    {tab.key === "github" ? (
                      <GithubLogo size={12} weight="bold" />
                    ) : (
                      <GitlabLogo size={12} weight="bold" />
                    )}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="issues-repo-picker">
              {issueProvider === "github" ? (
                <GithubLogo size={13} weight="bold" />
              ) : (
                <GitlabLogo size={13} weight="bold" />
              )}
              <BrutalistSelect
                className="issues-repo-select"
                value={issueRepo ?? ""}
                onChange={(next) => setIssueRepo(next || null)}
                disabled={!activeAuthed}
                ariaLabel={
                  issueProvider === "github"
                    ? "GitHub repository"
                    : "GitLab project"
                }
                placeholder={
                  issueProvider === "github"
                    ? "All repositories"
                    : "All projects"
                }
                options={providerOptions}
              />
            </div>
          </div>
        </header>

        <section className="issues-toolbar" aria-label="Issue filters">
          <div className="issues-filter-row">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`issues-chip${filter === f.key ? " is-active" : ""}`}
                onClick={() => setFilter(f.key)}
                disabled={f.key === "mentions" && !activeMe}
                title={
                  f.key === "mentions" && !activeMe
                    ? `Connect ${issueProvider === "github" ? "GitHub" : "GitLab"} to filter by assignee`
                    : undefined
                }
              >
                <span>{f.label}</span>
                <span className="issues-chip-count">
                  {counts[f.key]}
                </span>
              </button>
            ))}
          </div>
          <label className="issues-search">
            <MagnifyingGlass size={12} aria-hidden="true" />
            <input
              type="text"
              className="issues-search-input"
              placeholder="Search title, #, author"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              spellCheck={false}
            />
          </label>
        </section>

        {error && (
          <div className="issues-error">
            <span>{error}</span>
            <button
              type="button"
              className="issues-error-retry"
              onClick={retryFetch}
            >
              Retry
            </button>
          </div>
        )}

        {loading && (
          <div className="issues-skel skel-block" aria-busy="true">
            <span className="skel-row" />
            <span className="skel-row" />
            <span className="skel-row" />
            <span className="skel-row" />
            <span className="skel-row" />
          </div>
        )}

        {!loading && !error && visibleIssues.length === 0 && (
          <div className="issues-empty">
            {!activeAuthed ? (
              <>
                <span>Connect {providerLabel} to see issues.</span>
                <button
                  type="button"
                  className="issues-error-retry"
                  onClick={() => void connectProvider()}
                  disabled={connecting}
                >
                  {connecting ? "Connecting…" : `Connect ${providerLabel}`}
                </button>
              </>
            ) : filteredOut ? (
              <>
                <span>
                  No {filter === "all" ? "" : `${filter} `}issues match
                  {search.trim() ? ` "${search.trim()}"` : " the active filter"}.
                </span>
                <button
                  type="button"
                  className="issues-error-retry"
                  onClick={() => {
                    setFilter("all");
                    setSearch("");
                  }}
                >
                  Clear filters
                </button>
              </>
            ) : issueRepo ? (
              <span>
                No issues for this {issueProvider === "github" ? "repository" : "project"}.
              </span>
            ) : (
              <span>No open {providerLabel} issues right now.</span>
            )}
          </div>
        )}

        {!loading && !error && visibleIssues.length > 0 && (
          <div className="issues-list">
            {visibleIssues.map((issue, index) => (
              <IssueCard
                key={`${issueProvider}:${issue.repoFullName}:${issue.number}`}
                issue={issue}
                provider={issueProvider}
                staggerIndex={index}
                onOpen={() =>
                  openIssueDetail({
                    repoFullName: issue.repoFullName,
                    number: issue.number,
                    provider: issueProvider,
                    projectId:
                      issueProvider === "gitlab"
                        ? String(
                            gitlabProjects.find(
                              (project) =>
                                project.path_with_namespace ===
                                issue.repoFullName,
                            )?.id ?? "",
                          )
                        : undefined,
                  })
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function IssueCard({
  issue,
  provider,
  onOpen,
  staggerIndex = 0,
}: {
  issue: GitHubIssue;
  provider: IssueProvider;
  onOpen: () => void;
  staggerIndex?: number;
}) {
  const accentClass = accentClassFor(issue);
  // GitLab issues are addressed by `!<iid>` in MRs and `#<iid>` in issues,
  // matching GitHub. Both providers use `#` for the issue prefix here.
  const numberPrefix = "#";
  return (
    <button
      type="button"
      className={`issue-card ${accentClass} motion-rise-stagger`}
      style={{ "--stagger-index": Math.min(staggerIndex, 8) } as React.CSSProperties}
      onClick={onOpen}
      aria-label={`${provider === "gitlab" ? "GitLab" : "GitHub"} issue ${numberPrefix}${issue.number}: ${issue.title}`}
    >
      <div className="issue-card-head">
        <span className="issue-card-number">
          {numberPrefix}
          {issue.number}
        </span>
        <span className={`issue-card-state issue-card-state-${issue.state}`}>
          {issue.state}
        </span>
        <span className="issue-card-repo">{issue.repoFullName}</span>
        <span className="issue-card-author">@{issue.author}</span>
      </div>
      <div className="issue-card-title">{issue.title}</div>
      {issue.labels.length > 0 && (
        <div className="issue-card-labels">
          {issue.labels.slice(0, 5).map((label) => {
            const hex = sanitizeLabelHex(label.color);
            return (
              <span
                key={label.name}
                className="issue-card-label"
                style={
                  hex
                    ? ({
                        borderColor: `#${hex}`,
                        ["--label-dot" as string]: `#${hex}`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                <span className="issue-card-label-dot" aria-hidden="true" />
                <span className="issue-card-label-text">{label.name}</span>
              </span>
            );
          })}
          {issue.labels.length > 5 && (
            <span className="issue-card-label issue-card-label-overflow">
              +{issue.labels.length - 5}
            </span>
          )}
        </div>
      )}
      <div className="issue-card-foot">
        {issue.assignees.length > 0 && (
          <div className="issue-card-assignees" aria-label="Assignees">
            {issue.assignees.slice(0, 3).map((assignee) => (
              <span key={assignee} className="issue-card-avatar" title={assignee}>
                {avatarInitials(assignee)}
              </span>
            ))}
            {issue.assignees.length > 3 && (
              <span className="issue-card-avatar issue-card-avatar-overflow">
                +{issue.assignees.length - 3}
              </span>
            )}
          </div>
        )}
        <span className="issue-card-comments" title="Comments">
          <ChatCircle size={11} weight="bold" />
          <span>{issue.comments}</span>
        </span>
        <span className="issue-card-updated">{formatUpdated(issue.updated_at)}</span>
      </div>
    </button>
  );
}

function accentClassFor(issue: GitHubIssue): string {
  if (issue.state === "closed") return "issue-card-accent-closed";
  // Amber is reserved for genuinely critical labels; a plain "bug" backlog
  // should not turn the grid amber.
  if (
    issue.labels.some((label) => /critical|security|p0/i.test(label.name))
  ) {
    return "issue-card-accent-amber";
  }
  return "issue-card-accent-open";
}

// GitHub returns label.color as a 6-char hex without the leading "#".
// Sanitize to defend against API drift — never trust into an inline style.
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

function formatUpdated(value: string | null): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  const date = new Date(time);
  const today = new Date();
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "2-digit",
  });
}
