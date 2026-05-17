import { useCallback, useState } from "react";
import { ArrowClockwise, Copy } from "@phosphor-icons/react";
import {
  summarizeDailyStandupStructured,
  type StandupPayload,
} from "../../lib/ai-features";
import { buildStandupPayload, type StandupRange } from "../../lib/standup-data";
import type { GraniteEnvelope, StandupData } from "../../lib/ai-structured";
import { StandupSummary } from "./AIResultViews";
import "./DailyStandup.css";

type View = "idle" | "loading" | "result" | "error";

const RANGES: Array<{ value: StandupRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last24h", label: "Last 24h" },
];

export function DailyStandup({ payload }: { payload?: StandupPayload | null }) {
  const [range, setRange] = useState<StandupRange>("today");
  const [view, setView] = useState<View>(payload ? "loading" : "idle");
  const [content, setContent] = useState<GraniteEnvelope<StandupData> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [lastPayload, setLastPayload] = useState<StandupPayload | null>(payload ?? null);

  const generate = useCallback(
    async (force = false) => {
      setView("loading");
      setError(null);
      setCopyState("idle");
      try {
        const nextPayload = payload ?? await buildStandupPayload(range);
        setLastPayload(nextPayload);
        const result = await summarizeDailyStandupStructured(nextPayload, { force });
        setContent(result);
        setView("result");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not generate standup");
        setView("error");
      }
    },
    [payload, range],
  );

  async function copyDraft() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(formatStandup(content));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="daily-standup">
      <section className="standup-controls">
        <div>
          <div className="section-label">Aggregator</div>
          <p>
            Builds a greeting and daily digest from local commits, dirty workspaces,
            and remote PR activity.
          </p>
        </div>
        {!payload && (
          <div className="standup-range" role="radiogroup" aria-label="Standup range">
            {RANGES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`standup-range-button${range === item.value ? " is-active" : ""}`}
                onClick={() => setRange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="standup-generate"
          onClick={() => void generate(false)}
          disabled={view === "loading"}
        >
          <ArrowClockwise size={13} className={view === "loading" ? "motion-spin" : undefined} />
          <span>{view === "loading" ? "Generating..." : "Generate"}</span>
        </button>
      </section>

      {lastPayload && (
        <section className="standup-facts">
          <span>{lastPayload.commits.length} commits</span>
          <span>{lastPayload.pullRequests.length} PR updates</span>
          <span>{lastPayload.localChanges.length} dirty workspaces</span>
          <span>{lastPayload.rangeLabel}</span>
        </section>
      )}

      {view === "idle" && (
        <div className="standup-empty">
          Generate a standup digest for the selected range.
        </div>
      )}

      {view === "loading" && (
        <div className="standup-empty" role="status" aria-live="polite">
          Aggregating workspace activity and asking watsonx.ai...
        </div>
      )}

      {view === "error" && error && (
        <div className="standup-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void generate(true)}>
            Retry
          </button>
        </div>
      )}

      {view === "result" && content && (
        <div className="standup-result motion-rise">
          <StandupSummary
            result={content}
            displayGreeting={buildLocalGreeting(lastPayload?.userName)}
          />
          <footer className="standup-actions">
            <button type="button" className="standup-action" onClick={() => void copyDraft()}>
              <Copy size={13} />
              <span>{copyState === "copied" ? "Copied" : "Copy digest"}</span>
            </button>
            <button type="button" className="standup-action" onClick={() => void generate(true)}>
              <ArrowClockwise size={13} />
              <span>Re-run</span>
            </button>
          </footer>
          {copyState === "error" && <div className="standup-error">Clipboard write failed.</div>}
        </div>
      )}
    </div>
  );
}

function formatStandup(result: GraniteEnvelope<StandupData>): string {
  const data = result.data;
  return [
    data.greeting,
    "",
    data.headline || result.summary,
    "",
    data.slackDraft,
  ].filter(Boolean).join("\n");
}

function buildLocalGreeting(userName: string | undefined | null): string {
  const part = timeOfDay();
  const who = (userName ?? "").trim() || "developer";
  return `Good ${part}, ${who}.`;
}

function timeOfDay(): "morning" | "afternoon" | "evening" | "night" {
  const hour = new Date().getHours();
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}
