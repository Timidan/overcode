import { useEffect, useMemo, useState } from "react";
import { Sparkle } from "@phosphor-icons/react";
import { ipc } from "../lib/ipc";
import { useAIPanel } from "../store/useAIPanel";
import type { DashboardStats, WorkspaceRepository } from "../lib/workspace-data";
import "./MorningBrief.css";

interface Props {
  stats: DashboardStats;
  repositories: WorkspaceRepository[];
}

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 23) return "Good evening";
  return "Burning the midnight oil";
}

function pluralize(value: number, singular: string, plural?: string): string {
  if (value === 1) return `1 ${singular}`;
  return `${value} ${plural ?? `${singular}s`}`;
}

interface QuickUpdate {
  text: string;
  emphasis?: "attention" | "calm" | "neutral";
}

function deriveQuickUpdates(
  stats: DashboardStats,
  repositories: WorkspaceRepository[],
): QuickUpdate[] {
  const updates: QuickUpdate[] = [];

  const dirty = stats.localChanges;
  if (dirty > 0) {
    const reposWithDirt = repositories.filter((r) => (r.local_path ?? "").length > 0).length;
    updates.push({
      text: `${pluralize(dirty, "uncommitted file")} across ${pluralize(reposWithDirt, "workspace")}`,
      emphasis: "attention",
    });
  }

  if (stats.prs > 0) {
    updates.push({
      text: `${pluralize(stats.prs, "pull request")} updated recently`,
      emphasis: stats.prs > 5 ? "attention" : "neutral",
    });
  }

  if (stats.commits > 0) {
    updates.push({
      text: `${pluralize(stats.commits, "commit")} in the last day`,
      emphasis: "neutral",
    });
  }

  if (updates.length === 0) {
    updates.push({
      text: "Workspace is clean. Nothing pending.",
      emphasis: "calm",
    });
  }

  return updates.slice(0, 3);
}

export function MorningBrief({ stats, repositories }: Props) {
  const openAIPanel = useAIPanel((s) => s.open);
  const [username, setUsername] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let cancelled = false;
    ipc.getAuthStatus().then((status) => {
      if (cancelled) return;
      // Preference order:
      //   1. GitHub connected → display name from profile
      //   2. GitLab connected → display name from profile
      //   3. Local-only workspace → git config user.name (or OS username)
      const githubName = status.profiles?.github?.username;
      const gitlabName = status.profiles?.gitlab?.username;
      const localName = status.profiles?.local?.name ?? null;
      setUsername(githubName ?? gitlabName ?? localName ?? null);
    }).catch(() => {
      // No auth wired and identity probe failed — leave username null.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-evaluate the greeting if the panel sits around through a clock-hour change.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const greeting = useMemo(() => greetingFor(now.getHours()), [now]);
  const updates = useMemo(
    () => deriveQuickUpdates(stats, repositories),
    [stats, repositories],
  );

  const formattedDate = useMemo(
    () =>
      now.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    [now],
  );

  return (
    <section className="morning-brief" aria-label="Workspace brief">
      <div className="morning-brief-greeting">
        <span className="morning-brief-hello">{greeting}</span>
        {username && (
          <>
            <span className="morning-brief-comma">,</span>
            <span className="morning-brief-name">{username}</span>
          </>
        )}
        <span className="morning-brief-dot" aria-hidden="true">·</span>
        <span className="morning-brief-date">{formattedDate}</span>
        <button
          type="button"
          className="morning-brief-standup"
          title="Generate today's standup with the active AI provider"
          onClick={() => openAIPanel("standup", undefined)}
        >
          <Sparkle size={12} weight="bold" />
          Generate standup
        </button>
      </div>
      <ul className="morning-brief-updates">
        {updates.map((update, index) => (
          <li
            key={index}
            className={`morning-brief-update morning-brief-update-${update.emphasis ?? "neutral"}`}
          >
            <span className="morning-brief-bullet" aria-hidden="true" />
            {update.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
