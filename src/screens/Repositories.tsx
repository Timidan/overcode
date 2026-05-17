import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Folder,
  Monitor,
  MagnifyingGlass,
  ArrowSquareOut,
  GithubLogo,
  GitlabLogo,
  Plus,
  EyeSlash,
  X,
  Copy,
  Sparkle,
  ArrowRight,
} from "@phosphor-icons/react";
import { Sidebar } from "../components/Sidebar";
import {
  ipc,
  type GitHubRepo,
  type GitLabProject,
  type WorkspaceCandidate,
} from "../lib/ipc";
import {
  autoDiscoverWorkspaces,
  discoverWorkspaces,
  findLinkedGitHubRepository,
  findLinkedGitLabRepository,
  ignoreDiscoveredWorkspace,
  loadDiscoveredWorkspaces,
  loadRepositories,
  pinDiscoveredWorkspace,
  type WorkspaceRepository,
} from "../lib/workspace-data";
import { useNav } from "../store/useNav";
import { useAIPanel } from "../store/useAIPanel";
import "./Repositories.css";

type LinkState = "local-only" | "linked" | "remote-only";
type TabKey = "pinned" | "discovered" | "github" | "gitlab";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "pinned", label: "Pinned" },
  { key: "discovered", label: "Discovered" },
  { key: "github", label: "GitHub" },
  { key: "gitlab", label: "GitLab" },
];

// Local mirror of the persisted settings shape. Only the fields this screen
// reads or writes need to be modeled; other fields are preserved verbatim
// during writes via the spread of the previously-stored object.
interface SettingsShape {
  watch_directories?: string[];
  hidden_repo_ids?: string[];
  [key: string]: unknown;
}

function lowerIncludes(value: string, needle: string): boolean {
  return value.toLowerCase().includes(needle);
}

async function readSettings(): Promise<SettingsShape> {
  const stored = await ipc.getFromStore("settings");
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }
  return stored as SettingsShape;
}

async function writeSettingsPatch(patch: Partial<SettingsShape>): Promise<SettingsShape> {
  const current = await readSettings();
  const next: SettingsShape = { ...current, ...patch };
  await ipc.setInStore("settings", next);
  return next;
}

export function Repositories() {
  const navigate = useNav((s) => s.navigate);
  const openAIPanel = useAIPanel((s) => s.open);

  const [pinned, setPinned] = useState<WorkspaceRepository[]>([]);
  const [discovered, setDiscovered] = useState<WorkspaceCandidate[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [gitlabProjects, setGitlabProjects] = useState<GitLabProject[]>([]);
  const [auth, setAuth] = useState({ github: false, gitlab: false });
  const [tab, setTab] = useState<TabKey>("pinned");
  const [filter, setFilter] = useState("");
  const [scanPath, setScanPath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState<number | null>(null);
  const [busyCandidate, setBusyCandidate] = useState<string | null>(null);

  // Curation state — selection + persisted hidden ids + transient toast.
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [watchDirs, setWatchDirs] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  // Quick-look right-slide panel. Only one repo open at a time; data is
  // lazy-loaded by the panel itself once we know which repo to inspect.
  const [quickLookId, setQuickLookId] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  async function refresh() {
    const [repos, cached, status, settings] = await Promise.all([
      loadRepositories(),
      loadDiscoveredWorkspaces(),
      ipc.getAuthStatus(),
      readSettings(),
    ]);
    setPinned(repos);
    setDiscovered(cached);
    setAuth(status);
    setHiddenIds(Array.isArray(settings.hidden_repo_ids) ? settings.hidden_repo_ids : []);
    setWatchDirs(Array.isArray(settings.watch_directories) ? settings.watch_directories : []);

    // Cache-first: render stored state, then refresh discovery in the background.
    void autoDiscoverWorkspaces().then((result) => {
      if (result) setDiscovered(result.discovered);
    });

    if (status.github) {
      try {
        setGithubRepos(await ipc.getGitHubRepos());
      } catch {
        setGithubRepos([]);
      }
    } else {
      setGithubRepos([]);
    }

    if (status.gitlab) {
      try {
        setGitlabProjects(await ipc.getGitLabProjects());
      } catch {
        setGitlabProjects([]);
      }
    } else {
      setGitlabProjects([]);
    }
  }

  useEffect(() => {
    refresh();
    function onFocus() {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  // Selection lives at the screen level so the bulk action bar can drive it,
  // but it is conceptually scoped to the discovered list. Switching tab or
  // filtering should clear it so users never act on hidden rows.
  useEffect(() => {
    setSelectedIds([]);
  }, [tab, filter]);

  async function scan() {
    setScanning(true);
    setScanError(null);
    setScanCount(null);
    try {
      const trimmed = scanPath.trim();
      const result = await discoverWorkspaces(trimmed ? trimmed : undefined);
      setDiscovered(result.discovered);
      setScanCount(result.discovered.length);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function onPin(candidate: WorkspaceCandidate) {
    setBusyCandidate(candidate.id);
    try {
      const result = await pinDiscoveredWorkspace(candidate);
      setPinned(result.repositories);
      setDiscovered(result.discovered);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Could not pin workspace");
    } finally {
      setBusyCandidate(null);
    }
  }

  async function onIgnore(candidate: WorkspaceCandidate) {
    setBusyCandidate(candidate.id);
    try {
      const result = await ignoreDiscoveredWorkspace(candidate);
      setDiscovered(result.discovered);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Could not ignore workspace");
    } finally {
      setBusyCandidate(null);
    }
  }

  // Hide forever: persist the id in settings.hidden_repo_ids. We don't touch
  // ignored_workspaces (that drives the scan-time filter); these are
  // user-curation hides that should be cheap to revisit in Settings.
  async function hideForever(ids: string[]) {
    if (ids.length === 0) return;
    const merged = Array.from(new Set([...hiddenIds, ...ids]));
    setHiddenIds(merged);
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
    await writeSettingsPatch({ hidden_repo_ids: merged });
  }

  async function bulkAddToWorkspace(ids: string[]) {
    if (ids.length === 0) return;
    const targets = discovered.filter((c) => ids.includes(c.id));
    for (const candidate of targets) {
      // Sequential to avoid racing the IPC store writes inside pinDiscoveredWorkspace.
      await onPin(candidate);
    }
    setSelectedIds([]);
  }

  function onOpenCandidate(candidate: WorkspaceCandidate) {
    navigate("repo-detail", candidate.id);
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      showToast("Path copied");
    } catch {
      showToast("Copy failed");
    }
  }

  async function openBriefForCandidate(candidate: WorkspaceCandidate) {
    // Sibling agent E may have moved the AI panel API; today the store still
    // exposes `open(feature, payload)` and the only "repo brief" feature key
    // recognised by the AI panel renderer is "brief" — see
    // src/lib/ai-features.ts AIFeature type and src/screens/RepoDetail.tsx.
    // We pass a minimal BriefPayload; the panel may fetch more on its own.
    openAIPanel("brief", {
      repoId: candidate.id,
      repoName: candidate.name,
      remoteUrl: candidate.remote_url,
    });
  }

  const needle = filter.trim().toLowerCase();

  // Discovered list with hidden_repo_ids filtered out — this is the only
  // place hidden ids should remove items from view. Pinned repos remain
  // unaffected on purpose: hiding a workspace should not remove an already
  // active one.
  const visibleDiscovered = useMemo(() => {
    if (hiddenIds.length === 0) return discovered;
    const blocked = new Set(hiddenIds);
    return discovered.filter((c) => !blocked.has(c.id));
  }, [discovered, hiddenIds]);

  const filteredPinned = useMemo(
    () =>
      needle
        ? pinned.filter(
            (r) => lowerIncludes(r.name, needle) || lowerIncludes(r.local_path, needle),
          )
        : pinned,
    [pinned, needle],
  );
  const filteredDiscovered = useMemo(
    () =>
      needle
        ? visibleDiscovered.filter(
            (c) => lowerIncludes(c.name, needle) || lowerIncludes(c.local_path, needle),
          )
        : visibleDiscovered,
    [visibleDiscovered, needle],
  );
  const filteredGithub = useMemo(
    () =>
      needle
        ? githubRepos.filter((r) => lowerIncludes(r.full_name, needle))
        : githubRepos,
    [githubRepos, needle],
  );
  const filteredGitlab = useMemo(
    () =>
      needle
        ? gitlabProjects.filter((p) => lowerIncludes(p.path_with_namespace, needle))
        : gitlabProjects,
    [gitlabProjects, needle],
  );

  function platformIcon(platform: WorkspaceRepository["platform"]) {
    if (platform === "github")
      return <GithubLogo size={14} weight="fill" color="var(--color-text-secondary)" />;
    if (platform === "gitlab")
      return <GitlabLogo size={14} weight="fill" color="var(--color-accent-purple)" />;
    return <Monitor size={14} color="var(--color-text-secondary)" />;
  }

  const linkedGithubLocalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const remote of githubRepos) {
      const linked = findLinkedGitHubRepository(remote, pinned);
      if (linked) ids.add(linked.id);
    }
    return ids;
  }, [githubRepos, pinned]);

  const linkedGitlabLocalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const remote of gitlabProjects) {
      const linked = findLinkedGitLabRepository(remote, pinned);
      if (linked) ids.add(linked.id);
    }
    return ids;
  }, [gitlabProjects, pinned]);

  function deriveLocalLinkState(repo: WorkspaceRepository): LinkState {
    if (repo.platform === "github") {
      return linkedGithubLocalIds.has(repo.id) ? "linked" : "local-only";
    }
    if (repo.platform === "gitlab") {
      return linkedGitlabLocalIds.has(repo.id) ? "linked" : "local-only";
    }
    return "local-only";
  }

  const tabCounts: Record<TabKey, number> = {
    pinned: pinned.length,
    discovered: visibleDiscovered.length,
    github: githubRepos.length,
    gitlab: gitlabProjects.length,
  };

  const quickLookRepo: WorkspaceCandidate | WorkspaceRepository | null = useMemo(() => {
    if (!quickLookId) return null;
    return (
      discovered.find((c) => c.id === quickLookId) ??
      pinned.find((r) => r.id === quickLookId) ??
      null
    );
  }, [quickLookId, discovered, pinned]);

  return (
    <div className="repos-container">
      <Sidebar />
      <main className="repos-main">
        <header className="repos-header">
          <h1 className="repos-title">Repositories</h1>
          <div className="repos-summary">
            <span>{pinned.length} pinned</span>
            <span>·</span>
            <span>{visibleDiscovered.length} discovered</span>
            <span>·</span>
            <span>{githubRepos.length} GitHub</span>
            <span>·</span>
            <span>{gitlabProjects.length} GitLab</span>
          </div>
        </header>

        <div className="repos-toolbar">
          <nav className="repos-tabs" aria-label="Repository source">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`repos-tab${tab === t.key ? " is-active" : ""}`}
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
              >
                <span>{t.label}</span>
                <span className="repos-tab-count">{tabCounts[t.key]}</span>
              </button>
            ))}
          </nav>
          <div className="repos-filter">
            <MagnifyingGlass size={14} />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name or path…"
              className="repos-filter-input"
              spellCheck={false}
              aria-label="Filter repositories"
            />
          </div>
        </div>

        <section className="repos-pane">
          {tab === "pinned" && (
            <PinnedPane
              repos={filteredPinned}
              total={pinned.length}
              filtering={needle.length > 0}
              deriveState={deriveLocalLinkState}
              onOpen={(id) => navigate("repo-detail", id)}
              platformIcon={platformIcon}
            />
          )}

          {tab === "discovered" && (
            <DiscoveredPane
              candidates={filteredDiscovered}
              total={visibleDiscovered.length}
              filtering={needle.length > 0}
              scanPath={scanPath}
              onScanPathChange={setScanPath}
              scanning={scanning}
              onScan={scan}
              scanError={scanError}
              scanCount={scanCount}
              busyCandidate={busyCandidate}
              onPin={onPin}
              onIgnore={onIgnore}
              onOpen={onOpenCandidate}
              onQuickLook={(id) => setQuickLookId(id)}
              onRevealPath={copyPath}
              onBrief={openBriefForCandidate}
              onHide={(id) => hideForever([id])}
              onBulkAdd={() => bulkAddToWorkspace(selectedIds)}
              onBulkHide={() => hideForever(selectedIds)}
              onBulkClear={() => setSelectedIds([])}
              selectedIds={selectedIds}
              onToggleSelected={(id, checked) =>
                setSelectedIds((current) =>
                  checked ? [...current, id] : current.filter((x) => x !== id),
                )
              }
              platformIcon={platformIcon}
              hasWatchDirs={watchDirs.length > 0}
            />
          )}

          {tab === "github" && (
            <GitHubPane
              repos={filteredGithub}
              total={githubRepos.length}
              connected={auth.github}
              pinned={pinned}
              onOpenLocal={(repoId) => navigate("repo-detail", repoId)}
              filtering={needle.length > 0}
            />
          )}

          {tab === "gitlab" && (
            <GitLabPane
              projects={filteredGitlab}
              total={gitlabProjects.length}
              connected={auth.gitlab}
              pinned={pinned}
              onOpenLocal={(repoId) => navigate("repo-detail", repoId)}
              filtering={needle.length > 0}
            />
          )}
        </section>

        {toast && (
          <div className="repos-toast" role="status">
            {toast}
          </div>
        )}
      </main>

      <QuickLookPanel
        repo={quickLookRepo}
        onClose={() => setQuickLookId(null)}
        onOpenFull={(id) => {
          setQuickLookId(null);
          navigate("repo-detail", id);
        }}
      />
    </div>
  );
}

function PinnedPane({
  repos,
  total,
  filtering,
  deriveState,
  onOpen,
  platformIcon,
}: {
  repos: WorkspaceRepository[];
  total: number;
  filtering: boolean;
  deriveState: (repo: WorkspaceRepository) => LinkState;
  onOpen: (id: string) => void;
  platformIcon: (platform: WorkspaceRepository["platform"]) => React.ReactNode;
}) {
  if (total === 0) {
    return (
      <PaneEmpty>
        No pinned workspaces yet. Switch to the Discovered tab to pin some.
      </PaneEmpty>
    );
  }
  if (repos.length === 0) {
    return <PaneEmpty>No matches for that filter.</PaneEmpty>;
  }
  return (
    <PaneList showingFiltered={filtering && repos.length !== total} count={repos.length} total={total}>
      {repos.map((r) => {
        const state = deriveState(r);
        return (
          <li key={r.id} className="repo-row">
            <button
              type="button"
              className="repo-row-button"
              title={`Open ${r.name} (${r.local_path})`}
              onClick={() => onOpen(r.id)}
            >
              <span className="repo-row-icons">
                <Folder size={14} className="repo-row-icon" />
                {state === "linked" && (
                  <span className="repo-row-icon-extra">{platformIcon(r.platform)}</span>
                )}
              </span>
              <span className="repo-row-name">{r.name}</span>
              <StateChip state={state} />
              <span className="repo-row-path">{r.local_path}</span>
            </button>
          </li>
        );
      })}
    </PaneList>
  );
}

function DiscoveredPane({
  candidates,
  total,
  filtering,
  scanPath,
  onScanPathChange,
  scanning,
  onScan,
  scanError,
  scanCount,
  busyCandidate,
  onPin,
  onIgnore,
  onOpen,
  onQuickLook,
  onRevealPath,
  onBrief,
  onHide,
  onBulkAdd,
  onBulkHide,
  onBulkClear,
  selectedIds,
  onToggleSelected,
  platformIcon,
  hasWatchDirs,
}: {
  candidates: WorkspaceCandidate[];
  total: number;
  filtering: boolean;
  scanPath: string;
  onScanPathChange: (value: string) => void;
  scanning: boolean;
  onScan: () => void;
  scanError: string | null;
  scanCount: number | null;
  busyCandidate: string | null;
  onPin: (c: WorkspaceCandidate) => void;
  onIgnore: (c: WorkspaceCandidate) => void;
  onOpen: (c: WorkspaceCandidate) => void;
  onQuickLook: (id: string) => void;
  onRevealPath: (path: string) => void;
  onBrief: (c: WorkspaceCandidate) => void;
  onHide: (id: string) => void;
  onBulkAdd: () => void;
  onBulkHide: () => void;
  onBulkClear: () => void;
  selectedIds: string[];
  onToggleSelected: (id: string, checked: boolean) => void;
  platformIcon: (platform: WorkspaceCandidate["platform"]) => React.ReactNode;
  hasWatchDirs: boolean;
}) {
  const selectedCount = selectedIds.length;
  return (
    <div className="repos-pane-body">
      <div className="repos-scan">
        <MagnifyingGlass size={14} />
        <input
          type="text"
          value={scanPath}
          onChange={(e) => onScanPathChange(e.target.value)}
          className="repos-scan-input"
          placeholder="Scan path (blank = defaults)"
          spellCheck={false}
        />
        <button
          type="button"
          className="repos-scan-button"
          title="Recursively scan for .git and .github workspaces"
          disabled={scanning}
          onClick={onScan}
        >
          {scanning ? "Scanning…" : "Scan"}
        </button>
      </div>
      {scanError && <div className="repos-error">{scanError}</div>}
      {scanCount !== null && !scanError && (
        <div className="repos-note">
          {scanCount} candidate{scanCount === 1 ? "" : "s"} ready for curation.
        </div>
      )}

      {selectedCount > 0 && (
        <div className="repos-bulkbar" role="region" aria-label="Bulk actions">
          <span className="repos-bulkbar-count">{selectedCount} selected</span>
          <div className="repos-bulkbar-actions">
            <button
              type="button"
              className="repos-bulk-action repos-bulk-action-primary"
              onClick={onBulkAdd}
            >
              Add to workspace
            </button>
            <button
              type="button"
              className="repos-bulk-action"
              onClick={onBulkHide}
            >
              Hide forever
            </button>
            <button
              type="button"
              className="repos-bulk-action repos-bulk-action-ghost"
              onClick={onBulkClear}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {scanning ? (
        <ScanSkeleton />
      ) : !hasWatchDirs && total === 0 ? (
        <PaneEmpty plain>Add a directory below to start scanning</PaneEmpty>
      ) : total === 0 ? (
        <PaneEmpty plain>No repositories found in watch directories.</PaneEmpty>
      ) : candidates.length === 0 ? (
        <PaneEmpty>No matches for that filter.</PaneEmpty>
      ) : (
        <PaneList showingFiltered={filtering && candidates.length !== total} count={candidates.length} total={total}>
          {candidates.map((candidate) => (
            <DiscoveredRow
              key={candidate.id}
              candidate={candidate}
              platformIcon={platformIcon(candidate.platform)}
              busy={busyCandidate === candidate.id}
              selected={selectedIds.includes(candidate.id)}
              onToggleSelected={(checked) => onToggleSelected(candidate.id, checked)}
              onPin={() => onPin(candidate)}
              onIgnore={() => onIgnore(candidate)}
              onOpen={() => onOpen(candidate)}
              onQuickLook={() => onQuickLook(candidate.id)}
              onRevealPath={() => onRevealPath(candidate.local_path)}
              onBrief={() => onBrief(candidate)}
              onHide={() => onHide(candidate.id)}
            />
          ))}
        </PaneList>
      )}
    </div>
  );
}

function GitHubPane({
  repos,
  total,
  connected,
  pinned,
  onOpenLocal,
  filtering,
}: {
  repos: GitHubRepo[];
  total: number;
  connected: boolean;
  pinned: WorkspaceRepository[];
  onOpenLocal: (repoId: string) => void;
  filtering: boolean;
}) {
  if (!connected) {
    return (
      <PaneEmpty plain>
        Connect GitHub / GitLab in Settings to see remote work.
      </PaneEmpty>
    );
  }
  if (total === 0) {
    return <PaneEmpty>No GitHub repositories returned.</PaneEmpty>;
  }
  if (repos.length === 0) {
    return <PaneEmpty>No matches for that filter.</PaneEmpty>;
  }
  return (
    <PaneList showingFiltered={filtering && repos.length !== total} count={repos.length} total={total}>
      {repos.map((r) => (
        <GitHubRepoRow
          key={r.id}
          repo={r}
          linked={findLinkedGitHubRepository(r, pinned)}
          onOpenLocal={onOpenLocal}
        />
      ))}
    </PaneList>
  );
}

function GitLabPane({
  projects,
  total,
  connected,
  pinned,
  onOpenLocal,
  filtering,
}: {
  projects: GitLabProject[];
  total: number;
  connected: boolean;
  pinned: WorkspaceRepository[];
  onOpenLocal: (repoId: string) => void;
  filtering: boolean;
}) {
  if (!connected) {
    return (
      <PaneEmpty plain>
        Connect GitHub / GitLab in Settings to see remote work.
      </PaneEmpty>
    );
  }
  if (total === 0) {
    return <PaneEmpty>No GitLab projects returned.</PaneEmpty>;
  }
  if (projects.length === 0) {
    return <PaneEmpty>No matches for that filter.</PaneEmpty>;
  }
  return (
    <PaneList showingFiltered={filtering && projects.length !== total} count={projects.length} total={total}>
      {projects.map((p) => (
        <GitLabRepoRow
          key={p.id}
          project={p}
          linked={findLinkedGitLabRepository(p, pinned)}
          onOpenLocal={onOpenLocal}
        />
      ))}
    </PaneList>
  );
}

function PaneEmpty({
  children,
  plain,
}: {
  children: React.ReactNode;
  plain?: boolean;
}) {
  return (
    <div className={`repos-empty${plain ? " repos-empty-plain" : ""}`}>
      {children}
    </div>
  );
}

function PaneList({
  children,
  showingFiltered,
  count,
  total,
}: {
  children: React.ReactNode;
  showingFiltered: boolean;
  count: number;
  total: number;
}) {
  return (
    <div className="repos-list-wrap">
      {showingFiltered && (
        <div className="repos-list-meta">
          {count} of {total} matching
        </div>
      )}
      <ul className="repos-list">{children}</ul>
    </div>
  );
}

function ScanSkeleton() {
  // Five skeleton rows mimic the discovered row layout (checkbox + icon +
  // name + path). Reuses .motion-shimmer from motion.css; reduced-motion is
  // already handled by the global guard.
  return (
    <ul className="repos-list repos-list-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, idx) => (
        <li key={idx} className="repo-row repo-row-skeleton">
          <div className="repo-skeleton-row">
            <span className="repo-skeleton-cell repo-skeleton-checkbox motion-shimmer" />
            <span className="repo-skeleton-cell repo-skeleton-icon motion-shimmer" />
            <span className="repo-skeleton-cell repo-skeleton-name motion-shimmer" />
            <span className="repo-skeleton-cell repo-skeleton-path motion-shimmer" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DiscoveredRow({
  candidate,
  platformIcon,
  busy,
  selected,
  onToggleSelected,
  onPin,
  onIgnore,
  onOpen,
  onQuickLook,
  onRevealPath,
  onBrief,
  onHide,
}: {
  candidate: WorkspaceCandidate;
  platformIcon: React.ReactNode;
  busy: boolean;
  selected: boolean;
  onToggleSelected: (checked: boolean) => void;
  onPin: () => void;
  onIgnore: () => void;
  onOpen: () => void;
  onQuickLook: () => void;
  onRevealPath: () => void;
  onBrief: () => void;
  onHide: () => void;
}) {
  // Treat legacy "remote" values as ".git" — they were a labeling bug from the
  // first scan implementation. New scans will only set .git or .github.
  const detectedLabel =
    candidate.detected_from === ".github" ? ".github" : ".git";

  function handleRowClick(e: ReactMouseEvent<HTMLButtonElement>) {
    // Cmd/Ctrl-click escapes to the full RepoDetail screen; the bare click
    // only opens the quick-look right-slide panel.
    if (e.metaKey || e.ctrlKey) {
      onOpen();
      return;
    }
    onQuickLook();
  }

  return (
    <li className={`repo-row repo-row-discovered${selected ? " is-selected" : ""}`}>
      <div className="repo-discovered-row">
        <label
          className="repo-checkbox"
          onClick={(e) => e.stopPropagation()}
          title={selected ? "Deselect" : "Select"}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggleSelected(e.target.checked)}
            aria-label={`Select ${candidate.name}`}
          />
          <span className="repo-checkbox-box" aria-hidden="true" />
        </label>
        <button
          type="button"
          className="repo-discovered-main"
          title={`Quick look · ${candidate.local_path} (⌘-click for full view)`}
          onClick={handleRowClick}
        >
          <span className="repo-row-icons">
            <Folder size={14} className="repo-row-icon" />
            <span className="repo-row-icon-extra">{platformIcon}</span>
          </span>
          <span className="repo-row-name">{candidate.name}</span>
          <span className="repo-detected-chip">{detectedLabel}</span>
          <span className="repo-row-path">{candidate.local_path}</span>
        </button>
        <div className="repo-row-actions-wrap">
          <div className="repo-row-hoverbar" aria-hidden="false">
            <button
              type="button"
              className="repo-hover-action"
              onClick={onOpen}
              title="Open full repo view"
            >
              Open
            </button>
            <button
              type="button"
              className="repo-hover-action"
              onClick={onRevealPath}
              title="Copy path to clipboard"
            >
              <Copy size={11} weight="bold" />
              <span>Reveal</span>
            </button>
            <button
              type="button"
              className="repo-hover-action"
              onClick={onBrief}
              title="Open AI repo brief"
            >
              <Sparkle size={11} weight="bold" />
              <span>Brief</span>
            </button>
            <button
              type="button"
              className="repo-hover-action repo-hover-action-danger"
              onClick={onHide}
              title="Hide this candidate forever (managed in Settings)"
            >
              <EyeSlash size={11} weight="bold" />
              <span>Hide</span>
            </button>
          </div>
          <div className="repo-discovered-actions">
            <button
              type="button"
              className="repo-action repo-action-primary"
              disabled={busy}
              onClick={onPin}
              title="Pin to active workspaces"
            >
              <Plus size={12} />
              <span>Add</span>
            </button>
            <button
              type="button"
              className="repo-action"
              disabled={busy}
              onClick={onIgnore}
              title="Ignore this path in future scans"
            >
              <EyeSlash size={12} />
              <span>Ignore</span>
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function StateChip({ state }: { state: LinkState }) {
  const label =
    state === "linked" ? "linked" : state === "local-only" ? "local only" : "remote only";
  return <span className={`repo-state-chip repo-state-${state}`}>{label}</span>;
}

function GitHubRepoRow({
  repo,
  linked,
  onOpenLocal,
}: {
  repo: GitHubRepo;
  linked?: WorkspaceRepository;
  onOpenLocal: (repoId: string) => void;
}) {
  if (linked) {
    return (
      <li className="repo-row">
        <button
          type="button"
          className="repo-row-button"
          title={`Open local workspace ${linked.local_path}`}
          onClick={() => onOpenLocal(linked.id)}
        >
          <span className="repo-row-icons">
            <GithubLogo
              size={14}
              weight="fill"
              className="repo-row-icon"
              color="var(--color-text-secondary)"
            />
            <span className="repo-row-icon-extra">
              <Folder size={12} color="var(--color-text-muted)" />
            </span>
          </span>
          <span className="repo-row-name">{repo.full_name}</span>
          <StateChip state="linked" />
          <span className="repo-row-path">{linked.local_path}</span>
        </button>
      </li>
    );
  }

  return (
    <li className="repo-row">
      <a className="repo-row-button" href={repo.html_url} target="_blank" rel="noreferrer">
        <span className="repo-row-icons">
          <GithubLogo
            size={14}
            weight="fill"
            className="repo-row-icon"
            color="var(--color-text-secondary)"
          />
        </span>
        <span className="repo-row-name">{repo.full_name}</span>
        <StateChip state="remote-only" />
        <span className="repo-row-path">
          <span className="repo-row-meta">{repo.default_branch}</span>
          <span className="repo-row-meta-sep">·</span>
          <span>{repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : ""}</span>
        </span>
        <ArrowSquareOut size={12} className="repo-row-ext" />
      </a>
    </li>
  );
}

function GitLabRepoRow({
  project,
  linked,
  onOpenLocal,
}: {
  project: GitLabProject;
  linked?: WorkspaceRepository;
  onOpenLocal: (repoId: string) => void;
}) {
  if (linked) {
    return (
      <li className="repo-row">
        <button
          type="button"
          className="repo-row-button"
          title={`Open local workspace ${linked.local_path}`}
          onClick={() => onOpenLocal(linked.id)}
        >
          <span className="repo-row-icons">
            <GitlabLogo
              size={14}
              weight="fill"
              className="repo-row-icon"
              color="var(--color-accent-purple)"
            />
            <span className="repo-row-icon-extra">
              <Folder size={12} color="var(--color-text-muted)" />
            </span>
          </span>
          <span className="repo-row-name">{project.path_with_namespace}</span>
          <StateChip state="linked" />
          <span className="repo-row-path">{linked.local_path}</span>
        </button>
      </li>
    );
  }

  return (
    <li className="repo-row">
      <a className="repo-row-button" href={project.web_url} target="_blank" rel="noreferrer">
        <span className="repo-row-icons">
          <GitlabLogo
            size={14}
            weight="fill"
            className="repo-row-icon"
            color="var(--color-accent-purple)"
          />
        </span>
        <span className="repo-row-name">{project.path_with_namespace}</span>
        <StateChip state="remote-only" />
        <span className="repo-row-path">
          <span className="repo-row-meta">{project.default_branch ?? "-"}</span>
          <span className="repo-row-meta-sep">·</span>
          <span>
            {project.last_activity_at
              ? new Date(project.last_activity_at).toLocaleDateString()
              : ""}
          </span>
        </span>
        <ArrowSquareOut size={12} className="repo-row-ext" />
      </a>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Quick-look right-slide panel
//
// State ownership:
//   - The parent screen owns `quickLookId` (which repo is open). The panel is
//     a pure presentational shell that fetches its own git status + log once
//     a repo is provided, and clears that local data when the id changes.
//   - The panel never closes itself except via the explicit `onClose` prop.
//
// The panel always stays mounted so the open/close transition runs both ways
// (transform: translateX(100%) → 0). When no repo is selected we toggle the
// `is-open` class off rather than unmounting.

interface QuickLookData {
  branch: string;
  ahead: number;
  behind: number;
  dirty: number;
  recentCommits: Array<{ hash: string; subject: string }>;
}

function QuickLookPanel({
  repo,
  onClose,
  onOpenFull,
}: {
  repo: WorkspaceCandidate | WorkspaceRepository | null;
  onClose: () => void;
  onOpenFull: (id: string) => void;
}) {
  const isOpen = repo !== null;
  const [data, setData] = useState<QuickLookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc-to-close + click-outside. We attach listeners only when open to keep
  // global keydown handlers minimal when the panel is dormant.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Reset when the repo changes — including unmount transitions. Reading the
  // git status synchronously after mount keeps the panel feeling fast.
  useEffect(() => {
    if (!repo) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const [status, log] = await Promise.all([
          ipc.getGitStatus(repo.local_path, { mode: "lite" }),
          ipc.getGitLog(repo.local_path, 5).catch(() => []),
        ]);
        if (cancelled) return;
        setData({
          branch: status.branch,
          ahead: status.ahead,
          behind: status.behind,
          dirty: status.files.length,
          recentCommits: log.slice(0, 5).map((c) => ({
            hash: c.hash.slice(0, 7),
            subject: c.message.split("\n")[0] ?? c.message,
          })),
        });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load repo state");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  return (
    <>
      {/* Click-catcher overlay — transparent, click anywhere outside the
          panel to close. Pointer events are gated on `is-open` so the
          underlying screen remains interactive when the panel is closed. */}
      <div
        className={`repos-quicklook-overlay${isOpen ? " is-open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`repos-quicklook${isOpen ? " is-open" : ""}`}
        role="dialog"
        aria-label="Repository quick look"
        aria-hidden={!isOpen}
      >
        <header className="repos-quicklook-head">
          <div className="repos-quicklook-eyebrow">Quick look</div>
          <button
            type="button"
            className="repos-quicklook-close"
            onClick={onClose}
            aria-label="Close quick look"
          >
            <X size={14} weight="bold" />
          </button>
        </header>
        {repo && (
          <div className="repos-quicklook-body">
            <div className="repos-quicklook-name" title={repo.local_path}>
              {repo.name}
            </div>
            <div className="repos-quicklook-path">{repo.local_path}</div>

            <dl className="repos-quicklook-stats">
              <div className="repos-quicklook-stat">
                <dt>Branch</dt>
                <dd>{data ? data.branch || "—" : loading ? "…" : "—"}</dd>
              </div>
              <div className="repos-quicklook-stat">
                <dt>Ahead</dt>
                <dd>{data ? data.ahead : loading ? "…" : "—"}</dd>
              </div>
              <div className="repos-quicklook-stat">
                <dt>Behind</dt>
                <dd>{data ? data.behind : loading ? "…" : "—"}</dd>
              </div>
              <div className="repos-quicklook-stat">
                <dt>Dirty</dt>
                <dd>{data ? data.dirty : loading ? "…" : "—"}</dd>
              </div>
            </dl>

            <div className="repos-quicklook-section-label">Recent commits</div>
            {loading && !data ? (
              <ul className="repos-quicklook-commits">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <li key={idx} className="repos-quicklook-commit-skeleton motion-shimmer" />
                ))}
              </ul>
            ) : error ? (
              <div className="repos-quicklook-error">{error}</div>
            ) : data && data.recentCommits.length > 0 ? (
              <ul className="repos-quicklook-commits">
                {data.recentCommits.map((commit) => (
                  <li key={commit.hash} className="repos-quicklook-commit">
                    <span className="repos-quicklook-commit-hash">{commit.hash}</span>
                    <span className="repos-quicklook-commit-subject">{commit.subject}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="repos-quicklook-muted">No commits found.</div>
            )}

            <button
              type="button"
              className="repos-quicklook-cta"
              onClick={() => onOpenFull(repo.id)}
            >
              <span>Open full view</span>
              <ArrowRight size={12} weight="bold" />
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
