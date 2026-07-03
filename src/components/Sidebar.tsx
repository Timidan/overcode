import { useEffect, useState } from "react";
import {
  House,
  GitBranch,
  GearSix,
  Folder,
  WarningCircle,
} from "@phosphor-icons/react";
import { useNav } from "../store/useNav";
import { AIProviderLogo } from "./AIProviderLogo";
import {
  loadRepositories,
  WORKSPACE_REPOSITORIES_CHANGED_EVENT,
  type WorkspaceRepository,
} from "../lib/workspace-data";
import { ThemeToggle } from "./ThemeToggle";
import "./Sidebar.css";

// The keydown handler accepts Ctrl as well as Cmd, so the tooltips must not
// teach ⌘ on machines that don't have one.
const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";

type RepoLoadState = "loading" | "ready" | "error";

export function Sidebar() {
  const { screen, repoId, navigate } = useNav();
  const [repositories, setRepositories] = useState<WorkspaceRepository[]>([]);
  const [repoLoad, setRepoLoad] = useState<RepoLoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function refreshRepositories() {
      try {
        const loaded = await loadRepositories();
        if (!cancelled) {
          setRepositories(loaded.filter((repo) => Boolean(repo.local_path)));
          setRepoLoad("ready");
        }
      } catch {
        if (!cancelled) setRepoLoad("error");
      }
    }

    function onFocusOrVisibility() {
      if (document.visibilityState === "hidden") return;
      void refreshRepositories();
    }

    void refreshRepositories();
    window.addEventListener(WORKSPACE_REPOSITORIES_CHANGED_EVENT, refreshRepositories);
    window.addEventListener("focus", onFocusOrVisibility);
    document.addEventListener("visibilitychange", onFocusOrVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener(WORKSPACE_REPOSITORIES_CHANGED_EVENT, refreshRepositories);
      window.removeEventListener("focus", onFocusOrVisibility);
      document.removeEventListener("visibilitychange", onFocusOrVisibility);
    };
  }, []);

  return (
    <aside className="sidebar">
      <button
        type="button"
        className={`sidebar-icon ${screen === "dashboard" ? "active" : ""}`}
        onClick={() => navigate("dashboard")}
        aria-label="Dashboard"
        title={`Dashboard  ·  ${MOD}1`}
      >
        <House size={18} />
      </button>

      <button
        type="button"
        className={`sidebar-icon sidebar-icon-cognee ${screen === "cognee" ? "active" : ""}`}
        onClick={() => navigate("cognee")}
        aria-label="Cognee memory"
        title={`Cognee memory  ·  ${MOD}2`}
      >
        <AIProviderLogo providerId="cognee" size="sm" decorative />
      </button>

      <button
        type="button"
        className={`sidebar-icon ${screen === "repositories" ? "active" : ""}`}
        onClick={() => navigate("repositories")}
        aria-label="Repositories"
        title={`Repositories  ·  ${MOD}3`}
      >
        <Folder size={18} />
      </button>

      <button
        type="button"
        className={`sidebar-icon ${screen === "prs" ? "active" : ""}`}
        onClick={() => navigate("prs")}
        aria-label="Pull requests"
        title={`Pull requests  ·  ${MOD}4`}
      >
        <GitBranch size={18} />
      </button>

      <button
        type="button"
        className={`sidebar-icon ${screen === "issues" || screen === "issue-detail" ? "active" : ""}`}
        onClick={() => navigate("issues")}
        aria-label="Issues"
        title={`Issues  ·  ${MOD}5`}
      >
        <WarningCircle size={18} />
      </button>

      {repoLoad === "loading" && (
        <div className="sidebar-repos" aria-label="Loading pinned workspaces">
          <span className="sidebar-repo-skeleton" aria-hidden="true" />
          <span className="sidebar-repo-skeleton" aria-hidden="true" />
          <span className="sidebar-repo-skeleton" aria-hidden="true" />
        </div>
      )}

      {repoLoad === "error" && (
        <div className="sidebar-repos" aria-label="Pinned local workspaces">
          <span
            className="sidebar-repos-error"
            title="Workspaces unavailable"
            role="status"
            aria-live="polite"
            aria-label="Workspaces unavailable"
          >
            !
          </span>
        </div>
      )}

      {repoLoad === "ready" && repositories.length > 0 && (
        <div className="sidebar-repos" aria-label="Pinned local workspaces">
          {repositories.map((repository) => (
            <button
              key={repository.id}
              type="button"
              className={`sidebar-repo ${screen === "repo-detail" && repoId === repository.id ? "active" : ""}`}
              onClick={() => navigate("repo-detail", repository.id)}
              aria-label={`Open ${repository.name}`}
              title={`${repository.name}\n${repository.local_path}\n${repoStatusTitle(repository)}`}
            >
              <span className="sidebar-repo-initials">{repoInitials(repository.name)}</span>
              {repoStatusClass(repository) && (
                <span
                  className={`sidebar-repo-status ${repoStatusClass(repository)}`}
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>
      )}

      <ThemeToggle />

      <button
        type="button"
        className={`sidebar-icon ${screen === "settings" ? "active" : ""}`}
        onClick={() => navigate("settings")}
        aria-label="Settings"
        title="Settings"
      >
        <GearSix size={18} />
      </button>
    </aside>
  );
}

function repoInitials(name: string): string {
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Only dirty and conflict earn a dot; clean and unknown stay quiet.
function repoStatusClass(repository: WorkspaceRepository): string {
  if (repository.conflict) return "sidebar-repo-status-conflict";
  if (typeof repository.dirty_count === "number" && repository.dirty_count > 0) {
    return "sidebar-repo-status-dirty";
  }
  return "";
}

function repoStatusTitle(repository: WorkspaceRepository): string {
  if (repository.conflict) return "merge conflict";
  if (typeof repository.dirty_count !== "number") return "status unknown";
  if (repository.dirty_count === 0) return "no uncommitted changes";
  return `${repository.dirty_count} uncommitted change${repository.dirty_count === 1 ? "" : "s"}`;
}
