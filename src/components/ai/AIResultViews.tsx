import type { ReactNode } from "react";
import {
  CheckCircle,
  Files,
  GitBranch,
  ListChecks,
  Warning,
} from "@phosphor-icons/react";
import type {
  AIEnvelope,
  CodeExplanationData,
  ImpactData,
  PRHunkReviewData,
  PRReviewData,
  RepoBriefData,
  Severity,
  StashExplainData,
  StandupData,
  WorktreeCompareData,
} from "../../lib/ai-structured";
import type { ImpactPayload } from "../../lib/ai-features";
import "./AIResultViews.css";

export function AISummaryCard<T>({ result }: { result: AIEnvelope<T> }) {
  return (
    <section className="ai-summary-card">
      <div className="ai-summary-topline">
        <span className={`ai-confidence ai-confidence-${result.confidence}`}>
          {result.confidence}
        </span>
        <span className="ai-schema">schema v{result.schemaVersion}</span>
      </div>
      <p>{result.summary}</p>
      {result.warnings.length > 0 && (
        <div className="ai-warning-row">
          {result.warnings.slice(0, 3).map((warning) => (
            <span key={warning} className="ai-warning-chip">
              {warning}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function ImpactResult({
  result,
  memoryUsed,
}: {
  result: AIEnvelope<ImpactData>;
  memoryUsed?: ImpactPayload["memoryUsed"];
}) {
  return (
    <div className="ai-result-stack">
      <AISummaryCard result={result} />
      {memoryUsed && <AIMemoryUsed memoryUsed={memoryUsed} />}
      {result.data.intent && (
        <AIInsight
          label="Intent"
          value={result.data.intent}
          icon={<GitBranch size={13} aria-hidden="true" />}
        />
      )}
      <ModuleMap
        modules={result.data.modules.map((module) => ({
          name: module.name,
          files: module.paths,
          meta: module.changeType,
        }))}
      />
      <RiskMatrix
        risks={result.data.risks.map((risk) => ({
          severity: risk.severity,
          title: risk.area,
          body: risk.reason,
          files: risk.files,
        }))}
      />
      <CheckList checks={result.data.checks} />
      {result.data.recommendation && (
        <AIInsight
          label="Recommendation"
          value={result.data.recommendation}
          icon={<CheckCircle size={13} aria-hidden="true" />}
        />
      )}
    </div>
  );
}

function AIMemoryUsed({
  memoryUsed,
}: {
  memoryUsed: NonNullable<ImpactPayload["memoryUsed"]>;
}) {
  const graphRows = memoryUsed.graphPath?.filter(Boolean).slice(0, 4) ?? [];
  const references = memoryUsed.references?.filter(Boolean).slice(0, 8) ?? [];

  return (
    <section className="ai-memory-used">
      <div className="ai-section-label">Cognee memory used</div>
      {memoryUsed.summary && <p>{memoryUsed.summary}</p>}
      {graphRows.length > 0 && (
        <div className="ai-memory-paths">
          {graphRows.map((row) => (
            <code key={row}>{row}</code>
          ))}
        </div>
      )}
      {references.length > 0 && (
        <div className="ai-file-list">
          {references.map((reference) => (
            <span key={reference}>{reference}</span>
          ))}
        </div>
      )}
    </section>
  );
}

export function RepoBriefResult({
  result,
}: {
  result: AIEnvelope<RepoBriefData>;
}) {
  return (
    <div className="ai-result-stack">
      <AISummaryCard result={result} />
      {result.data.purpose && (
        <AIInsight
          label="Purpose"
          value={result.data.purpose}
          icon={<Files size={13} aria-hidden="true" />}
        />
      )}
      <ModuleMap
        modules={result.data.keyModules.map((module) => ({
          name: module.name,
          files: [module.path].filter(Boolean),
          meta: module.role,
        }))}
      />
      <AIList
        label="Recent activity"
        items={result.data.recentActivity.map(
          (item) => `${item.label}${item.evidence ? ` - ${item.evidence}` : ""}`,
        )}
      />
      <AIList label="Onboarding path" items={result.data.onboardingPath} ordered />
      <AIList label="Worth knowing" items={result.data.notableRisks} />
    </div>
  );
}

export function PRReviewSummary({
  result,
}: {
  result: AIEnvelope<PRReviewData>;
}) {
  return (
    <div className="ai-result-stack">
      <AISummaryCard result={result} />
      <section className="ai-readiness-row">
        <span className={`ai-readiness ai-readiness-${result.data.readiness}`}>
          {formatReadiness(result.data.readiness)}
        </span>
        <span>
          CI {result.data.ci.passing} passing / {result.data.ci.failing} failing /{" "}
          {result.data.ci.pending} pending
        </span>
      </section>
      {result.data.changeSummary && (
        <AIInsight
          label="Change summary"
          value={result.data.changeSummary}
          icon={<GitBranch size={13} aria-hidden="true" />}
        />
      )}
      <RiskMatrix
        risks={result.data.riskMatrix.map((risk) => ({
          severity: risk.severity,
          title: risk.concern,
          body: risk.evidence,
          files: risk.file ? [risk.file] : [],
        }))}
      />
      <AIList
        label="Blockers"
        items={result.data.blockers.map((blocker) => `${blocker.source}: ${blocker.text}`)}
      />
      <AIList label="CI notes" items={result.data.ci.notable} />
      {result.data.suggestedComment && (
        <section className="ai-suggested-comment">
          <div className="ai-section-label">Suggested comment</div>
          <p>{result.data.suggestedComment}</p>
        </section>
      )}
    </div>
  );
}

export function PRHunkReviewSummary({
  result,
}: {
  result: AIEnvelope<PRHunkReviewData>;
}) {
  return (
    <div className="ai-result-stack">
      <AISummaryCard result={result} />
      <section className="ai-readiness-row">
        <span className={`ai-readiness ai-hunk-overall-${result.data.overall}`}>
          {result.data.overall.replace(/_/g, " ")}
        </span>
        <span>{result.data.hunks.length} reviewed hunks</span>
      </section>
      {result.data.hunks.length > 0 && (
        <section className="ai-hunk-review">
          <div className="ai-section-label">Hunk notes</div>
          {result.data.hunks.slice(0, 10).map((hunk) => (
            <article
              key={`${hunk.file}:${hunk.header}:${hunk.note}`}
              className={`ai-hunk-row ai-hunk-${hunk.verdict}`}
            >
              <div className="ai-hunk-head">
                <span>{hunk.verdict.replace(/_/g, " ")}</span>
                <strong>{hunk.file}</strong>
                <code>{hunk.header}</code>
              </div>
              <p>{hunk.note}</p>
              {hunk.suggestedCheck && <code>{hunk.suggestedCheck}</code>}
            </article>
          ))}
        </section>
      )}
      <AIList label="Reviewer questions" items={result.data.questions} />
      <AIList label="Suggested checks" items={result.data.tests} />
    </div>
  );
}

export function StandupSummary({
  result,
  displayGreeting,
}: {
  result: AIEnvelope<StandupData>;
  displayGreeting?: string;
}) {
  const greetingText =
    displayGreeting?.trim() || result.data.greeting || "Good day, developer";
  return (
    <div className="ai-result-stack">
      <section className="ai-standup-greeting">
        <span>{greetingText}</span>
        <p>{result.data.headline || result.summary}</p>
      </section>
      <AISummaryCard result={result} />
      <div className="standup-digest">
        <AIList
          label="Yesterday"
          items={result.data.yesterday}
          placeholder="No commits or PRs yet."
        />
        <AIList
          label="Today"
          items={result.data.today}
          placeholder="No plans set."
        />
        <AIList
          label="Blockers"
          items={result.data.blockers}
          placeholder="No blockers."
        />
      </div>
      {result.data.notableRepos.length > 0 && (
        <section className="ai-module-map">
          <div className="ai-section-label">Notable repos</div>
          {result.data.notableRepos.slice(0, 8).map((repo) => (
            <article key={`${repo.repo}:${repo.note}`} className="ai-module-row">
              <div className="ai-module-heading">
                <span>{repo.repo}</span>
              </div>
              <p>{repo.note}</p>
            </article>
          ))}
        </section>
      )}
      {result.data.slackDraft && (
        <section className="ai-suggested-comment ai-slack-draft">
          <div className="ai-section-label">Slack-ready draft</div>
          <p>{result.data.slackDraft}</p>
        </section>
      )}
    </div>
  );
}

export function WorktreeCompareSummary({
  result,
}: {
  result: AIEnvelope<WorktreeCompareData>;
}) {
  return (
    <div className="ai-result-stack">
      <AISummaryCard result={result} />
      <section className="ai-compare-strip">
        <Metric label="Base" value={result.data.base} />
        <Metric label="Target" value={result.data.target} />
        <Metric label="Ahead" value={String(result.data.ahead)} />
        <Metric label="Behind" value={String(result.data.behind)} />
        <Metric label="Dirty" value={String(result.data.dirtyFiles)} />
      </section>
      <section className="ai-readiness-row">
        <span className={`ai-readiness ai-readiness-${result.data.readiness}`}>
          {formatReadiness(result.data.readiness)}
        </span>
        <ReadinessReasoning
          readiness={result.data.readiness}
          text={result.data.intent}
        />
      </section>
      <ModuleMap
        modules={result.data.moduleMap.map((module) => ({
          name: module.module,
          files: module.files,
          meta: module.risk,
          severity: module.risk,
        }))}
      />
      <AIList label="Next actions" items={result.data.nextActions} ordered />
      {result.data.prDraft && (
        <section className="ai-suggested-comment">
          <div className="ai-section-label">PR draft</div>
          <strong>{result.data.prDraft.title}</strong>
          <p>{result.data.prDraft.body}</p>
        </section>
      )}
    </div>
  );
}

export function StashExplainResult({
  result,
}: {
  result: AIEnvelope<StashExplainData>;
}) {
  return (
    <div className="ai-result-stack">
      <AISummaryCard result={result} />
      {result.data.label && (
        <AIInsight
          label="Label"
          value={result.data.label}
          icon={<GitBranch size={13} aria-hidden="true" />}
        />
      )}
      {result.data.intent && (
        <AIInsight
          label="Intent"
          value={result.data.intent}
          icon={<Files size={13} aria-hidden="true" />}
        />
      )}
      <ModuleMap
        modules={groupStashFiles(result.data.files).map(([name, files]) => ({
          name,
          files,
          meta: `${files.length} file${files.length === 1 ? "" : "s"}`,
        }))}
      />
      <AIList label="Added" items={result.data.added} />
      <AIList label="Removed" items={result.data.removed} />
      <RiskMatrix
        risks={result.data.risks.map((risk) => ({
          severity: risk.severity,
          title: "Stash risk",
          body: risk.text,
          files: risk.files,
        }))}
      />
      <AIList label="Suggested actions" items={result.data.suggestedActions} ordered />
    </div>
  );
}

export function CodeExplanationResult({
  result,
}: {
  result: AIEnvelope<CodeExplanationData>;
}) {
  return (
    <div className="ai-result-stack">
      <AISummaryCard result={result} />
      {result.data.subject && (
        <AIInsight
          label="Subject"
          value={result.data.subject}
          icon={<Files size={13} aria-hidden="true" />}
        />
      )}
      {result.data.purpose && (
        <AIInsight
          label="Purpose"
          value={result.data.purpose}
          icon={<GitBranch size={13} aria-hidden="true" />}
        />
      )}
      <AIList label="Key points" items={result.data.keyPoints} />
      <RiskMatrix
        risks={result.data.risks.map((risk) => ({
          severity: risk.severity,
          title: "Review risk",
          body: risk.text,
          files: [],
        }))}
      />
      <AIList label="Suggested checks" items={result.data.suggestedChecks} />
    </div>
  );
}

function AIInsight({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <section className="ai-insight">
      <div className="ai-insight-icon">{icon}</div>
      <div>
        <div className="ai-section-label">{label}</div>
        <p>{value}</p>
      </div>
    </section>
  );
}

function groupStashFiles(files: string[]): Array<[string, string[]]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const module = file.includes("/") ? file.split("/")[0] || "root" : "root";
    const list = groups.get(module) ?? [];
    list.push(file);
    groups.set(module, list);
  }
  return Array.from(groups.entries()).slice(0, 8);
}

function ModuleMap({
  modules,
}: {
  modules: Array<{ name: string; files: string[]; meta?: string; severity?: Severity }>;
}) {
  if (modules.length === 0) return null;
  return (
    <section className="ai-module-map">
      <div className="ai-section-label">Module map</div>
      {modules.slice(0, 8).map((module) => (
        <article
          key={`${module.name}:${module.files.join(",")}`}
          className={`ai-module-row${module.severity ? ` ai-module-${module.severity}` : ""}`}
        >
          <div className="ai-module-heading">
            <span>{module.name}</span>
            {module.meta && <code>{module.meta}</code>}
          </div>
          {module.files.length > 0 && (
            <div className="ai-file-list">
              {module.files.slice(0, 6).map((file) => (
                <span key={file}>{file}</span>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function RiskMatrix({
  risks,
}: {
  risks: Array<{ severity: Severity; title: string; body: string; files: string[] }>;
}) {
  if (risks.length === 0) return null;
  return (
    <section className="ai-risk-matrix">
      <div className="ai-section-label">Risk matrix</div>
      {risks.slice(0, 8).map((risk) => (
        <article key={`${risk.title}:${risk.body}`} className={`ai-risk ai-risk-${risk.severity}`}>
          <div className="ai-risk-head">
            <Warning size={13} aria-hidden="true" />
            <span>{risk.severity}</span>
            <strong>{risk.title}</strong>
          </div>
          {risk.body && <p>{risk.body}</p>}
          {risk.files.length > 0 && (
            <div className="ai-file-list">
              {risk.files.slice(0, 5).map((file) => (
                <span key={file}>{file}</span>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function CheckList({ checks }: { checks: Array<{ command?: string; reason: string }> }) {
  if (checks.length === 0) return null;
  return (
    <section className="ai-check-list">
      <div className="ai-section-label">Checks</div>
      {checks.slice(0, 6).map((check) => (
        <div key={`${check.command ?? ""}:${check.reason}`} className="ai-check-row">
          <ListChecks size={13} aria-hidden="true" />
          <span>{check.reason}</span>
          {check.command && <code>{check.command}</code>}
        </div>
      ))}
    </section>
  );
}

function AIList({
  label,
  items,
  ordered = false,
  placeholder,
}: {
  label: string;
  items: string[];
  ordered?: boolean;
  placeholder?: string;
}) {
  if (items.length === 0) {
    if (!placeholder) return null;
    return (
      <section className="ai-list-block ai-list-empty-block">
        <div className="ai-section-label">{label}</div>
        <p className="ai-list-empty">{placeholder}</p>
      </section>
    );
  }
  const ListTag = ordered ? "ol" : "ul";
  return (
    <section className="ai-list-block">
      <div className="ai-section-label">{label}</div>
      <ListTag>
        {items.slice(0, 8).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ListTag>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ai-metric">
      <span>{label}</span>
      <strong>{value || "0"}</strong>
    </div>
  );
}

function formatReadiness(value: string): string {
  return value.replace(/_/g, " ");
}

// Split the worktree compare "intent" reasoning paragraph into short
// clauses. We only break on "; " or ". " when there are at least two
// distinct fragments — single-sentence intents fall back to plain text.
function ReadinessReasoning({
  readiness,
  text,
}: {
  readiness: WorktreeCompareData["readiness"];
  text: string;
}) {
  const clean = text?.trim() ?? "";
  if (!clean) return null;
  const fragments = clean
    .split(/(?<=[.;])\s+/)
    .map((part) => part.replace(/[;.\s]+$/, "").trim())
    .filter((part) => part.length > 0);
  if (fragments.length < 2) {
    return <span className="ai-readiness-text">{clean}</span>;
  }
  const glyphClass =
    readiness === "not_ready"
      ? "ai-readiness-glyph ai-readiness-glyph-red"
      : readiness === "reviewable"
        ? "ai-readiness-glyph ai-readiness-glyph-amber"
        : "ai-readiness-glyph ai-readiness-glyph-green";
  return (
    <ul className="ai-readiness-clauses">
      {fragments.slice(0, 5).map((fragment, index) => (
        <li key={index}>
          <span className={glyphClass} aria-hidden="true">
            &#9679;
          </span>
          <span>{fragment}</span>
        </li>
      ))}
    </ul>
  );
}
