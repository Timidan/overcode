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
  COGNEE_MEMORY_LEDGER_CHANGED_EVENT,
  type CogneeMemoryLedgerSnapshot,
} from "../lib/cognee-memory-ledger";
import { cogneeRepositoryMemory } from "../lib/cognee-repository-memory";
import {
  loadWorkspaceHealthRadar,
  type WorkspaceHealthRadar as WorkspaceHealthRadarData,
} from "../lib/workspace-health";
import { useNav } from "../store/useNav";
import "./WorkspaceHealthRadar.css";

export function WorkspaceHealthRadar({ refreshKey }: { refreshKey: number }) {
  const navigate = useNav((state) => state.navigate);
  const [radar, setRadar] = useState<WorkspaceHealthRadarData | null>(null);
  const [memory, setMemory] = useState<CogneeMemoryLedgerSnapshot>(() =>
    cogneeRepositoryMemory.loadLedger(),
  );
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

  useEffect(() => {
    function refreshMemory() {
      setMemory(cogneeRepositoryMemory.loadLedger());
    }

    void cogneeRepositoryMemory
      .hydrateLedger()
      .then(setMemory)
      .catch(refreshMemory);
    window.addEventListener(COGNEE_MEMORY_LEDGER_CHANGED_EVENT, refreshMemory);
    return () => {
      window.removeEventListener(COGNEE_MEMORY_LEDGER_CHANGED_EVENT, refreshMemory);
    };
  }, []);

  const items = radar?.items.slice(0, 6) ?? [];
  const maxScore = items.reduce((max, item) => Math.max(max, item.score), 0);

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
          </div>
        )}
      </header>

      {loading ? (
        <div className="workspace-radar-skeleton" aria-hidden="true">
          <span className="workspace-radar-skeleton-row" />
          <span className="workspace-radar-skeleton-row" />
        </div>
      ) : items.length === 0 ? (
        <div className="workspace-radar-empty">No pinned local workspaces to rank yet.</div>
      ) : (
        <div className="workspace-radar-list">
          {items.map((item) => {
            const highPriority =
              item.priority === "attention" || item.priority === "blocked";
            const memoryNote = highPriority
              ? memoryNoteForRepo(memory, item.repo.id, item.repo.name)
              : null;
            return (
              <article
                key={item.repo.id}
                className={`workspace-radar-row workspace-radar-${item.priority}`}
                onClick={() => navigate("repo-detail", item.repo.id)}
              >
                <div className="workspace-radar-score">
                  <Pulse size={14} aria-hidden="true" />
                  <span>{item.score}</span>
                  <ScoreBar score={item.score} max={maxScore} isHigh={highPriority} />
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
                    {memoryNote && (
                      <span className="workspace-radar-memory-note">
                        memory: {memoryNote}
                      </span>
                    )}
                  </div>
                </div>
                <div className="workspace-radar-stats">
                  {item.stashes > 0 && (
                    <span title="Stashes">{item.stashes} stash</span>
                  )}
                  {item.worktrees > 0 && (
                    <span title="Worktrees">{item.worktrees} trees</span>
                  )}
                  {(item.ahead > 0 || item.behind > 0) && (
                    <span title="Commits ahead and behind the remote">
                      <GitBranch size={12} aria-hidden="true" />
                      {item.ahead} ahead · {item.behind} behind
                    </span>
                  )}
                  {item.warnings.length > 0 && (
                    <span title="Environment warnings">
                      <Warning size={12} aria-hidden="true" />
                      {item.warnings.length}
                    </span>
                  )}
                  {item.secretWarnings.length > 0 && (
                    <span title="Masked secret warnings">
                      <Shield size={12} aria-hidden="true" />
                      {item.secretWarnings.length}
                    </span>
                  )}
                  {item.testCommands.length > 0 && (
                    <span title="Suggested checks">
                      <TerminalWindow size={12} aria-hidden="true" />
                      {item.testCommands.length}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="workspace-radar-open"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate("repo-detail", item.repo.id);
                  }}
                  title={`Open ${item.repo.name}`}
                >
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </article>
            );
          })}
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

/** Latest remembered title for a repo, shown as a reason chip on rows that
 * already need attention. Returns null when memory has nothing useful. */
function memoryNoteForRepo(
  snapshot: CogneeMemoryLedgerSnapshot,
  repoId: string,
  repoName: string,
): string | null {
  const event = snapshot.events.find((entry) => {
    if (!entry.repo) return false;
    if (entry.repo !== repoId && entry.repo !== repoName) return false;
    return entry.titles.length > 0;
  });
  const title = event?.titles[0];
  if (!title) return null;
  return title.length > 60 ? `${title.slice(0, 57)}...` : title;
}
