import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Copy,
  GitBranch,
  ListChecks,
  Tag,
} from "@phosphor-icons/react";
import { useAIPanel } from "../../store/useAIPanel";
import { useNav } from "../../store/useNav";
import {
  summarizeGitHubIssueStructured,
  type IssueTriagePayload,
} from "../../lib/ai-features";
import type {
  GraniteEnvelope,
  IssueTriageData,
  Severity,
} from "../../lib/ai-structured";
import { AISummaryCard } from "./AIResultViews";
import "./IssueTriage.css";

interface Props {
  payload?: IssueTriagePayload | null;
}

type View = "picker" | "loading" | "result" | "error";

export function IssueTriage({ payload: explicitPayload }: Props) {
  const { payload: storePayload } = useAIPanel();
  const incoming = (explicitPayload ?? storePayload) as IssueTriagePayload | null;
  const navigate = useNav((s) => s.navigate);
  const closePanel = useAIPanel((s) => s.close);

  const [view, setView] = useState<View>(incoming ? "loading" : "picker");
  const [content, setContent] = useState<GraniteEnvelope<IssueTriageData> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const initialRunRef = useRef(false);

  const runTriage = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!incoming) return;
      setView("loading");
      setError(null);
      setContent(null);
      setApplied(false);
      setCopyState("idle");
      try {
        const result = await summarizeGitHubIssueStructured(incoming, options);
        setContent(result);
        setView("result");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to triage issue");
        setView("error");
      }
    },
    [incoming],
  );

  // Auto-run once when we first receive a payload.
  useEffect(() => {
    if (!incoming) return;
    if (initialRunRef.current) return;
    initialRunRef.current = true;
    void runTriage();
  }, [incoming, runTriage]);

  const reset = useCallback(() => {
    setContent(null);
    setError(null);
    setApplied(false);
    setCopyState("idle");
    initialRunRef.current = false;
    setView(incoming ? "loading" : "picker");
    if (incoming) void runTriage({ force: true });
  }, [incoming, runTriage]);

  const copyDraft = useCallback(async () => {
    if (!content) return;
    const text = formatTriageForClipboard(content, incoming);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("error");
    }
  }, [content, incoming]);

  // ----- PICKER (no payload) -----
  if (!incoming) {
    return (
      <div className="issue-triage">
        <section className="issue-triage-picker">
          <div className="issue-triage-picker-title">Open an issue to triage</div>
          <p className="issue-triage-picker-body">
            Issue triage needs an issue payload. Navigate to the Issues screen
            and pick one — the AI panel will reopen with the right context.
          </p>
          <button
            type="button"
            className="issue-triage-cta"
            onClick={() => {
              navigate("issues");
              closePanel();
            }}
          >
            Go to issues
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="issue-triage">
      <header className="issue-triage-meta">
        <span className="issue-triage-meta-label">Issue</span>
        <span className="issue-triage-meta-value">
          #{incoming.issue.number} · {incoming.repoName ?? "github"}
        </span>
      </header>

      {view === "loading" && (
        <div className="issue-triage-loading" role="status" aria-live="polite">
          <span className="ai-stream-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="issue-triage-loading-caption">
            Watson is triaging…
          </span>
        </div>
      )}

      {view === "error" && error && (
        <div className="issue-triage-error" role="alert">
          <div className="issue-triage-error-label">Triage failed</div>
          <p>{error}</p>
          <button
            type="button"
            className="issue-triage-error-retry"
            onClick={() => runTriage({ force: true })}
          >
            Retry
          </button>
        </div>
      )}

      {view === "result" && content && (
        <div className="issue-triage-result motion-rise">
          <AISummaryCard result={content} />

          <PrioritySection data={content.data} />

          {content.data.problem && (
            <section className="issue-triage-block">
              <div className="ai-section-label">Problem</div>
              <p>{content.data.problem}</p>
            </section>
          )}

          <LikelyModules data={content.data} />

          {content.data.ambiguities.length > 0 && (
            <ListBlock
              icon={<ListChecks size={13} />}
              label="Ambiguities"
              items={content.data.ambiguities}
            />
          )}

          {content.data.suggestedPlan.length > 0 && (
            <ListBlock
              icon={<ListChecks size={13} />}
              label="Suggested plan"
              items={content.data.suggestedPlan}
              ordered
            />
          )}

          {content.data.acceptanceChecks.length > 0 && (
            <ListBlock
              icon={<ListChecks size={13} />}
              label="Acceptance checks"
              items={content.data.acceptanceChecks}
            />
          )}

          {content.data.suggestedBranchName && (
            <section className="issue-triage-block">
              <div className="ai-section-label">Suggested branch</div>
              <code className="issue-triage-branch">
                <GitBranch size={11} weight="bold" />
                <span>{content.data.suggestedBranchName}</span>
              </code>
            </section>
          )}

          <section className="ai-suggested-comment">
            <div className="ai-section-label">Draft response</div>
            <p>{buildDraftResponse(content, incoming)}</p>
          </section>

          <footer className="issue-triage-actions">
            <button
              type="button"
              className="issue-triage-action"
              onClick={copyDraft}
              title="Copy draft response to clipboard"
            >
              <Copy size={13} />
              <span>{copyState === "copied" ? "Copied" : "Copy draft"}</span>
            </button>
            <button
              type="button"
              className="issue-triage-action"
              onClick={() => setApplied(true)}
              disabled={applied}
              title="Mark suggested labels as applied locally"
            >
              <Tag size={13} />
              <span>{applied ? "Applied" : "Apply labels"}</span>
            </button>
            <button
              type="button"
              className="issue-triage-action"
              onClick={reset}
              title="Re-run Watson"
            >
              <ArrowClockwise size={13} />
              <span>Re-run</span>
            </button>
            <button
              type="button"
              className="issue-triage-action"
              onClick={() => {
                setContent(null);
                setError(null);
                setCopyState("idle");
                initialRunRef.current = false;
                setView("picker");
              }}
              title="Reset triage view"
            >
              <ArrowCounterClockwise size={13} />
              <span>Reset</span>
            </button>
          </footer>
          {copyState === "error" && (
            <div className="issue-triage-toast issue-triage-toast-error">
              Clipboard write failed.
            </div>
          )}
          {applied && (
            <div className="issue-triage-toast">
              Labels applied locally. Re-fetch the issue to confirm.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PrioritySection({ data }: { data: IssueTriageData }) {
  const filled = data.priority === "high" ? 3 : data.priority === "medium" ? 2 : 1;
  return (
    <section className={`issue-triage-priority issue-triage-priority-${data.priority}`}>
      <span className="issue-triage-priority-pill">{labelForPriority(data.priority)}</span>
      <span
        className="issue-triage-priority-glyph"
        aria-label={`${filled} of 3 priority dots`}
        title={`${data.priority} priority`}
      >
        <span className={filled >= 1 ? "is-on" : "is-off"}>&#9679;</span>
        <span className={filled >= 2 ? "is-on" : "is-off"}>&#9679;</span>
        <span className={filled >= 3 ? "is-on" : "is-off"}>&#9679;</span>
      </span>
      <span className="issue-triage-priority-reason">
        {data.problem ? firstSentence(data.problem) : "Priority assigned by Watson."}
      </span>
    </section>
  );
}

function LikelyModules({ data }: { data: IssueTriageData }) {
  if (data.likelyModules.length === 0) return null;
  return (
    <section className="ai-module-map">
      <div className="ai-section-label">Likely modules</div>
      {data.likelyModules.slice(0, 8).map((module) => (
        <article
          key={`${module.name}:${module.paths.join(",")}`}
          className="ai-module-row"
        >
          <div className="ai-module-heading">
            <span>{module.name}</span>
            {module.reason && <code>{truncate(module.reason, 64)}</code>}
          </div>
          {module.paths.length > 0 && (
            <div className="ai-file-list">
              {module.paths.slice(0, 6).map((path) => (
                <span key={path}>{path}</span>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function ListBlock({
  icon,
  label,
  items,
  ordered = false,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
  ordered?: boolean;
}) {
  if (items.length === 0) return null;
  const ListTag = ordered ? "ol" : "ul";
  return (
    <section className="ai-list-block">
      <div className="ai-section-label issue-triage-label-with-icon">
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </div>
      <ListTag>
        {items.slice(0, 8).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ListTag>
    </section>
  );
}

function labelForPriority(value: Severity): string {
  switch (value) {
    case "high":
      return "High priority";
    case "low":
      return "Low priority";
    default:
      return "Medium priority";
  }
}

function firstSentence(value: string): string {
  return (
    value
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)[0]
      ?.trim()
      .slice(0, 220) ?? ""
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function buildDraftResponse(
  envelope: GraniteEnvelope<IssueTriageData>,
  payload: IssueTriagePayload,
): string {
  const data = envelope.data;
  const lines: string[] = [];
  lines.push(`Thanks for opening #${payload.issue.number}.`);
  if (envelope.summary) lines.push(envelope.summary);
  if (data.problem && data.problem !== envelope.summary) {
    lines.push(`We read this as: ${data.problem}`);
  }
  if (data.ambiguities.length > 0) {
    lines.push(
      `Before we move on this, could you confirm: ${data.ambiguities[0]}`,
    );
  }
  if (data.suggestedPlan.length > 0) {
    lines.push(`Planned next step: ${data.suggestedPlan[0]}`);
  }
  return lines.join(" ");
}

function formatTriageForClipboard(
  envelope: GraniteEnvelope<IssueTriageData>,
  payload: IssueTriagePayload | null,
): string {
  const data = envelope.data;
  const lines: string[] = [];
  if (payload) {
    lines.push(`# Triage: ${payload.repoName ?? "github"} #${payload.issue.number}`);
  } else {
    lines.push("# Triage");
  }
  lines.push("");
  lines.push(envelope.summary);
  lines.push("");
  lines.push(`Priority: ${data.priority}`);
  if (data.problem) lines.push(`Problem: ${data.problem}`);
  if (data.suggestedBranchName) {
    lines.push(`Suggested branch: ${data.suggestedBranchName}`);
  }
  if (data.suggestedPlan.length > 0) {
    lines.push("");
    lines.push("## Plan");
    for (const step of data.suggestedPlan) lines.push(`- ${step}`);
  }
  if (data.acceptanceChecks.length > 0) {
    lines.push("");
    lines.push("## Acceptance checks");
    for (const step of data.acceptanceChecks) lines.push(`- ${step}`);
  }
  lines.push("");
  lines.push("## Draft response");
  lines.push(buildDraftResponse(envelope, payload ?? defaultPayload(envelope)));
  return lines.join("\n");
}

function defaultPayload(envelope: GraniteEnvelope<IssueTriageData>): IssueTriagePayload {
  return {
    issue: {
      repoFullName: "unknown/unknown",
      number: 0,
      title: "",
      author: "",
      state: "open",
      labels: [],
      assignees: [],
      comments: 0,
      updated_at: null,
      html_url: "",
      body: envelope.summary,
      locked: false,
      milestone: null,
      commentsData: [],
      linkedPullRequests: [],
    },
  };
}
