import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkle } from "@phosphor-icons/react";
import { ipc } from "../lib/ipc";
import {
  buildCogneeWorkspaceBrief,
  buildCogneeWorkspaceBriefRecallRequest,
  buildCogneeWorkspaceBriefTeaser,
  type CogneeWorkspaceBrief,
} from "../lib/cognee-workspace-brief";
import { AIProviderLogo } from "./AIProviderLogo";
import { MemoryRecallModal } from "./MemoryRecallModal";
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
      text: `${pluralize(stats.prs, "pull request")} updated in the last 24h`,
      emphasis: stats.prs > 5 ? "attention" : "neutral",
    });
  }

  if (stats.commits > 0) {
    updates.push({
      text: `${pluralize(stats.commits, "commit")} in the last 24h`,
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
  const [memory, setMemory] = useState<CogneeWorkspaceBrief | null>(null);
  const [memoryDismissed, setMemoryDismissed] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const memoryRecallStarted = useRef(false);

  // One quiet workspace memory line, recalled once per mount. Empty, disabled,
  // or failed recall renders nothing at all; a narrow recall still renders with
  // an explicit coverage note so it never pretends one repo is the whole space.
  //
  // Deliberately no cancelled-flag cleanup: under StrictMode the double
  // effect invocation would discard the only recall the run-once ref allows,
  // so the line could never render in dev. A late setState after a true
  // unmount is a no-op in React 18.
  useEffect(() => {
    if (memoryRecallStarted.current || repositories.length === 0) return;
    memoryRecallStarted.current = true;
    const request = buildCogneeWorkspaceBriefRecallRequest(repositories, stats);
    if (!request) return;
    const recallRequest = request;

    async function recallWorkspaceBrief() {
      const first = await ipc.recallMemory(recallRequest);
      if (first.ok && !first.skipped && first.items.length > 0) return first;

      // The dashboard often performs the coldest recall of the session. One
      // retry covers Cognee Cloud's empty-first-response warmup without turning
      // the dashboard into a spinner.
      await new Promise((resolve) => window.setTimeout(resolve, 4_000));
      return ipc.recallMemory(recallRequest);
    }

    void recallWorkspaceBrief().then((recalled) => {
      if (!recalled.ok || recalled.skipped || recalled.items.length === 0) return;
      setMemory(buildCogneeWorkspaceBrief(recalled.items, repositories, stats));
    }).catch((error) => {
      console.warn("[cognee-workspace-brief-recall-failed]", error);
    });
  }, [repositories, stats]);

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
        {memory && !memoryDismissed && (
          <li className="morning-brief-update morning-brief-update-memory">
            <AIProviderLogo providerId="cognee" size="sm" decorative />
            <button
              type="button"
              className="morning-brief-memory-teaser"
              onClick={() => setMemoryOpen(true)}
              title="Open the Cognee workspace brief"
            >
              {truncateLine(buildCogneeWorkspaceBriefTeaser(memory), 140)}
            </button>
            <button
              type="button"
              className="morning-brief-dismiss"
              onClick={() => setMemoryDismissed(true)}
              aria-label="Dismiss memory line"
              title="Dismiss"
            >
              ×
            </button>
          </li>
        )}
      </ul>
      {memory && memoryOpen && (
        <MemoryRecallModal
          brief={memory}
          onClose={() => setMemoryOpen(false)}
        />
      )}
    </section>
  );
}

function truncateLine(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value;
}
