import { useEffect, useState } from "react";
import {
  Pulse,
  ArrowRight,
  GitBranch,
  Shield,
  TerminalWindow,
  Warning,
} from "@phosphor-icons/react";
import {
  loadWorkspaceHealthRadar,
  type WorkspaceHealthRadar as WorkspaceHealthRadarData,
} from "../lib/workspace-health";
import { useNav } from "../store/useNav";
import "./WorkspaceHealthRadar.css";

export function WorkspaceHealthRadar({ refreshKey }: { refreshKey: number }) {
  const navigate = useNav((state) => state.navigate);
  const [radar, setRadar] = useState<WorkspaceHealthRadarData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadWorkspaceHealthRadar()
      .then((result) => {
        if (!cancelled) setRadar(result);
      })
      .catch(() => {
        if (!cancelled) setRadar(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const items = radar?.items.slice(0, 6) ?? [];
  const maxScore = items.reduce((max, item) => Math.max(max, item.score), 0);
  // 75th-percentile cutoff for the amber-accent mini-bar. Computed from the
  // visible items, not the global radar — keeps the accent reserved for
  // "the worst in view".
  const p75Cutoff = computePercentile(items.map((item) => item.score), 0.75);

  return (
    <section className="workspace-radar" aria-label="Workspace health radar">
      <header className="workspace-radar-header">
        <div>
          <div className="section-label">Workspace health radar</div>
          <p>
            Local repos ranked by dirty state, stashes, worktrees, divergence,
            security signals, and validation hints.
          </p>
        </div>
        {radar && (
          <div className="workspace-radar-totals">
            <Metric label="Repos" value={radar.totals.repos} />
            <Metric label="Attention" value={radar.totals.attention} />
            <Metric label="Dirty" value={radar.totals.dirtyFiles} />
            <Metric label="Warnings" value={radar.totals.warnings} />
            <Metric label="Commands" value={radar.totals.validationCommands} />
          </div>
        )}
      </header>

      {loading ? (
        <div className="workspace-radar-empty">Scanning local workspace health…</div>
      ) : items.length === 0 ? (
        <div className="workspace-radar-empty">No pinned local workspaces to rank yet.</div>
      ) : (
        <div className="workspace-radar-list">
          {items.map((item) => (
            <article
              key={item.repo.id}
              className={`workspace-radar-row workspace-radar-${item.priority}`}
            >
              <div className="workspace-radar-score">
                <Pulse size={14} aria-hidden="true" />
                <span>{item.score}</span>
                <ScoreBar
                  score={item.score}
                  max={maxScore}
                  isHigh={item.score > p75Cutoff && item.score > 0}
                />
              </div>
              <div className="workspace-radar-main">
                <div className="workspace-radar-title">
                  <span>{item.repo.name}</span>
                  <code>{item.branch}</code>
                </div>
                <div className="workspace-radar-reasons">
                  {item.reasons.length > 0
                    ? item.reasons.map((reason) => <span key={reason}>{reason}</span>)
                    : <span>clear</span>}
                </div>
              </div>
              <div className="workspace-radar-stats">
                <span title="Dirty files">{item.dirtyFiles} dirty</span>
                <span title="Stashes">{item.stashes} stash</span>
                <span title="Worktrees">{item.worktrees} trees</span>
                <span title="Divergence">
                  <GitBranch size={12} aria-hidden="true" />
                  +{item.ahead}/-{item.behind}
                </span>
                <span title="Environment warnings">
                  <Warning size={12} aria-hidden="true" />
                  {item.warnings.length}
                </span>
                <span title="Masked secret warnings">
                  <Shield size={12} aria-hidden="true" />
                  {item.secretWarnings.length}
                </span>
                <span title="Suggested validation commands">
                  <TerminalWindow size={12} aria-hidden="true" />
                  {item.testCommands.length}
                </span>
              </div>
              <button
                type="button"
                className="workspace-radar-open"
                onClick={() => navigate("repo-detail", item.repo.id)}
                title={`Open ${item.repo.name}`}
              >
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="workspace-radar-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScoreBar({
  score,
  max,
  isHigh,
}: {
  score: number;
  max: number;
  isHigh: boolean;
}) {
  const width = 60;
  const fillPx = max <= 0 ? 0 : Math.max(0, Math.min(width, Math.round((score / max) * width)));
  return (
    <svg
      className={`workspace-radar-bar${isHigh ? " is-high" : ""}`}
      width={width}
      height={6}
      viewBox={`0 0 ${width} 6`}
      aria-hidden="true"
      role="presentation"
    >
      {fillPx > 0 && (
        <rect x={0} y={0} width={fillPx} height={6} className="workspace-radar-bar-fill" />
      )}
    </svg>
  );
}

function computePercentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}
