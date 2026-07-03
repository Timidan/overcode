import { useEffect, useMemo, useRef, useState } from "react";
import {
  House,
  GitBranch,
  Folder,
  Sparkle,
  GearSix,
  ArrowsClockwise,
  MagnifyingGlass,
  ArrowRight,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { useCommandPalette } from "../store/useCommandPalette";
import { useNav, type Screen } from "../store/useNav";
import { useAIPanel } from "../store/useAIPanel";
import { BrandLogo } from "./BrandLogo";
import {
  loadRepositories,
  type WorkspaceRepository,
} from "../lib/workspace-data";
import "./CommandPalette.css";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: PhosphorIcon;
  section: "Navigate" | "Repositories" | "Actions";
  run: () => void;
  keywords?: string;
}

function fuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let i = 0;
  for (const ch of n) {
    i = h.indexOf(ch, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette();
  const navigate = useNav((s) => s.navigate);
  const toggleAI = useAIPanel((s) => s.toggle);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [repos, setRepos] = useState<WorkspaceRepository[]>([]);
  const [repoLoadError, setRepoLoadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActive(0);
    setRepos([]);
    setRepoLoadError(null);
    let cancelled = false;
    loadRepositories()
      .then((r) => {
        if (!cancelled) setRepos(r);
      })
      .catch((error) => {
        if (!cancelled) {
          setRepos([]);
          setRepoLoadError(
            error instanceof Error
              ? error.message
              : "Failed to load repositories",
          );
          console.error("[CommandPalette] Failed to load repositories:", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const commands: Command[] = useMemo(() => {
    const navItems: Array<{
      id: string;
      label: string;
      hint?: string;
      icon: PhosphorIcon;
      screen: Screen;
    }> = [
      {
        id: "nav-dashboard",
        label: "Dashboard",
        icon: House,
        screen: "dashboard",
      },
      {
        id: "nav-repos",
        label: "Repositories",
        icon: Folder,
        screen: "repositories",
      },
      { id: "nav-prs", label: "Pull requests", icon: GitBranch, screen: "prs" },
      {
        id: "nav-settings",
        label: "Settings",
        icon: GearSix,
        screen: "settings",
      },
    ];

    const navCommands: Command[] = navItems.map((item) => ({
      id: item.id,
      label: item.label,
      hint: "Go to",
      icon: item.icon,
      section: "Navigate",
      run: () => {
        navigate(item.screen);
        close();
      },
    }));

    const actionCommands: Command[] = [
      {
        id: "act-ai",
        label: "Toggle AI panel",
        icon: Sparkle,
        section: "Actions",
        hint: `${navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+"}.`,
        run: () => {
          toggleAI();
          close();
        },
      },
      {
        id: "act-refresh",
        label: "Refresh dashboard",
        icon: ArrowsClockwise,
        section: "Actions",
        run: () => {
          navigate("dashboard");
          close();
        },
      },
    ];

    const repoCommands: Command[] = repos.map((repo) => ({
      id: `repo-${repo.id}`,
      label: repo.name,
      hint: repo.local_path,
      icon: Folder,
      section: "Repositories",
      keywords: `${repo.name} ${repo.local_path} ${repo.platform ?? ""}`,
      run: () => {
        navigate("repo-detail", repo.id);
        close();
      },
    }));

    return [...navCommands, ...repoCommands, ...actionCommands];
  }, [repos, navigate, toggleAI, close]);

  const filtered = useMemo(() => {
    if (!query) return commands;
    return commands.filter((c) => fuzzy(c.keywords ?? c.label, query));
  }, [commands, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        filtered[active]?.run();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, filtered, active, close]);

  if (!isOpen) return null;

  let lastSection: Command["section"] | null = null;

  return (
    <div className="cmdk-overlay" onClick={close} role="presentation">
      <div
        className="cmdk-panel motion-rise"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk-input-row">
          <MagnifyingGlass size={14} className="cmdk-input-icon" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Type to search · ↑↓ to navigate · ↵ to select"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>
        <div className="cmdk-list">
          {repoLoadError && (
            <div className="cmdk-error">
              Failed to load repositories: {repoLoadError}
            </div>
          )}
          {filtered.length === 0 && !repoLoadError && (
            <div className="cmdk-empty">No commands match "{query}".</div>
          )}
          {filtered.map((cmd, idx) => {
            const Icon = cmd.icon;
            const showHeader = cmd.section !== lastSection;
            lastSection = cmd.section;
            return (
              <div key={cmd.id}>
                {showHeader && (
                  <div
                    className={`cmdk-section cmdk-section--${cmd.section.toLowerCase()}`}
                  >
                    {cmd.section}
                  </div>
                )}
                <button
                  type="button"
                  className={`cmdk-item ${idx === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => cmd.run()}
                >
                  <Icon size={14} weight="bold" className="cmdk-item-icon" />
                  <span className="cmdk-item-label">{cmd.label}</span>
                  {cmd.hint && (
                    <span className="cmdk-item-hint">{cmd.hint}</span>
                  )}
                  <ArrowRight size={12} className="cmdk-item-arrow" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk-footer">
          <span>
            <kbd className="cmdk-kbd">⌘K</kbd> anywhere
          </span>
          <BrandLogo variant="icon" className="cmdk-footer-brand" />
        </div>
      </div>
    </div>
  );
}
