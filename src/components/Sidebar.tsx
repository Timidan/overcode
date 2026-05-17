import { useEffect, useState } from "react";
import {
  Code,
  House,
  GitBranch,
  GearSix,
  Folder,
  WarningCircle,
} from "@phosphor-icons/react";
import { useNav } from "../store/useNav";
import {
  loadRepositories,
  WORKSPACE_REPOSITORIES_CHANGED_EVENT,
  type WorkspaceRepository,
} from "../lib/workspace-data";
import { ThemeToggle } from "./ThemeToggle";
import "./Sidebar.css";

export function Sidebar() {
  const { screen, repoId, navigate } = useNav();
  const [repositories, setRepositories] = useState<WorkspaceRepository[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function refreshRepositories() {
      const loaded = await loadRepositories().catch(() => []);
      if (!cancelled) {
        setRepositories(loaded.filter((repo) => Boolean(repo.local_path)));
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
        title="Dashboard  ·  ⌘1"
      >
        <Code size={18} />
      </button>

      <button
        type="button"
        className={`sidebar-icon ${screen === "repositories" || screen === "repo-detail" ? "active" : ""}`}
        onClick={() => navigate("repositories")}
        aria-label="Repositories"
        title="Repositories  ·  ⌘2"
      >
        <House size={18} />
      </button>

      <button
        type="button"
        className={`sidebar-icon ${screen === "prs" ? "active" : ""}`}
        onClick={() => navigate("prs")}
        aria-label="Pull Requests"
        title="Pull Requests  ·  ⌘3"
      >
        <GitBranch size={18} />
      </button>

      <button
        type="button"
        className={`sidebar-icon ${screen === "issues" || screen === "issue-detail" ? "active" : ""}`}
        onClick={() => navigate("issues")}
        aria-label="Issues"
        title="Issues  ·  ⌘5"
      >
        <WarningCircle size={18} />
      </button>

      {repositories.length > 0 && (
        <div className="sidebar-repos" aria-label="Pinned local workspaces">
          {repositories.map((repository) => (
            <button
              key={repository.id}
              type="button"
              className={`sidebar-repo ${screen === "repo-detail" && repoId === repository.id ? "active" : ""}`}
              onClick={() => navigate("repo-detail", repository.id)}
              aria-label={`Open ${repository.name}`}
              title={`${repository.name}\n${repository.local_path}`}
            >
              <Folder size={13} weight="bold" />
              <span className="sidebar-repo-initials">{repoInitials(repository.name)}</span>
              <span
                className={`sidebar-repo-status ${repoStatusClass(repository)}`}
                aria-hidden="true"
                title={repoStatusTitle(repository)}
              />
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

function repoStatusClass(repository: WorkspaceRepository): string {
  if (repository.conflict) return "sidebar-repo-status-conflict";
  if (typeof repository.dirty_count !== "number") {
    return "sidebar-repo-status-unknown";
  }
  if (repository.dirty_count === 0) return "sidebar-repo-status-clean";
  return "sidebar-repo-status-dirty";
}

function repoStatusTitle(repository: WorkspaceRepository): string {
  const dirty = repository.dirty_count ?? 0;
  return `${dirty} dirty${repository.conflict ? " · conflict" : ""}`;
}
