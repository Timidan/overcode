import { AIProviderLogo } from "./AIProviderLogo";
import "./WorktreeRecallCard.css";

export interface WorktreeRecallArtifact {
  id?: string;
  title?: string;
  label?: string;
  kind?: string;
  summary?: string;
  ref?: string;
  url?: string;
}

export interface WorktreeRecallResult {
  likelyIntent?: string;
  summary?: string;
  artifacts?: WorktreeRecallArtifact[];
  risks?: string[];
  decisions?: string[];
  suggestedNextAction?: string;
}

export type WorktreeRecallState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "disabled"; message: string }
  | { status: "error"; message: string }
  | { status: "empty"; message: string }
  | { status: "ready"; result: WorktreeRecallResult };

export function WorktreeRecallCard({
  state,
  onRetry,
}: {
  state?: WorktreeRecallState;
  onRetry?: () => void;
}) {
  if (!state || state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <div className="worktree-recall-card worktree-recall-state">
        <RecallHeader detail="Searching Cognee for related repository memory." />
      </div>
    );
  }

  if (state.status === "disabled") {
    return (
      <div className="worktree-recall-card worktree-recall-state">
        <RecallHeader detail="Cognee recall unavailable" />
        <span>{state.message}</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="worktree-recall-card worktree-recall-state is-error">
        <RecallHeader detail="Cognee recall failed" />
        <span>{state.message}</span>
        {onRetry && (
          <button type="button" className="worktree-recall-retry" onClick={onRetry}>
            Retry recall
          </button>
        )}
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div className="worktree-recall-card worktree-recall-state">
        <RecallHeader detail="No Cognee memory found" />
        <span>{state.message}</span>
      </div>
    );
  }

  const { result } = state;
  const artifacts = result.artifacts ?? [];
  const risks = result.risks ?? [];
  const decisions = result.decisions ?? [];
  const memoryCount = artifacts.length;

  return (
    <div className="worktree-recall-card">
      <RecallHeader
        detail={`${memoryCount} related memor${memoryCount === 1 ? "y" : "ies"}`}
      />
      {(result.likelyIntent || result.summary) && (
        <div className="worktree-recall-section">
          <span className="worktree-recall-kicker">Likely intent</span>
          <p>{result.likelyIntent || result.summary}</p>
        </div>
      )}

      {result.summary && result.summary !== result.likelyIntent && (
        <div className="worktree-recall-section">
          <span className="worktree-recall-kicker">Summary</span>
          <p>{result.summary}</p>
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="worktree-recall-section">
          <span className="worktree-recall-kicker">Related artifacts</span>
          <ul className="worktree-recall-list">
            {artifacts.slice(0, 5).map((artifact, index) => (
              <li key={artifact.id ?? artifact.ref ?? artifact.url ?? index}>
                <span>{artifact.title ?? artifact.label ?? artifact.ref ?? artifact.url ?? "Artifact"}</span>
                {artifact.kind && <code>{artifact.kind}</code>}
                {artifact.summary && <small>{artifact.summary}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(risks.length > 0 || decisions.length > 0) && (
        <div className="worktree-recall-grid">
          {risks.length > 0 && (
            <div className="worktree-recall-section">
              <span className="worktree-recall-kicker">Prior risks</span>
              <ul className="worktree-recall-list">
                {risks.slice(0, 4).map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </div>
          )}
          {decisions.length > 0 && (
            <div className="worktree-recall-section">
              <span className="worktree-recall-kicker">Prior decisions</span>
              <ul className="worktree-recall-list">
                {decisions.slice(0, 4).map((decision) => (
                  <li key={decision}>{decision}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {result.suggestedNextAction && (
        <div className="worktree-recall-section">
          <span className="worktree-recall-kicker">Next action</span>
          <p>{result.suggestedNextAction}</p>
        </div>
      )}
    </div>
  );
}

function RecallHeader({ detail }: { detail: string }) {
  return (
    <div className="worktree-recall-header">
      <AIProviderLogo providerId="cognee" size="sm" decorative />
      <div>
        <span>Cognee memory recall</span>
        <small>{detail}</small>
      </div>
    </div>
  );
}
