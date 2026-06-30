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

export interface WorktreeRecallGraphPath {
  from?: string;
  to?: string;
  kind?: string;
  summary?: string;
  nodes?: string[];
}

export interface WorktreeRecallResult {
  likelyIntent?: string;
  summary?: string;
  artifacts?: WorktreeRecallArtifact[];
  risks?: string[];
  decisions?: string[];
  graphPaths?: WorktreeRecallGraphPath[];
  suggestedNextAction?: string;
}

export type WorktreeRecallState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "disabled"; message: string }
  | { status: "error"; message: string }
  | { status: "empty"; message: string }
  | { status: "ready"; result: WorktreeRecallResult };

export function WorktreeRecallCard({ state }: { state?: WorktreeRecallState }) {
  if (!state || state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <div className="worktree-recall-card worktree-recall-state">
        Recalling related worktree memory...
      </div>
    );
  }

  if (state.status === "disabled") {
    return (
      <div className="worktree-recall-card worktree-recall-state">
        <span className="worktree-recall-kicker">Recall unavailable</span>
        <span>{state.message}</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="worktree-recall-card worktree-recall-state is-error">
        <span className="worktree-recall-kicker">Recall failed</span>
        <span>{state.message}</span>
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div className="worktree-recall-card worktree-recall-state">
        <span className="worktree-recall-kicker">No memory found</span>
        <span>{state.message}</span>
      </div>
    );
  }

  const { result } = state;
  const artifacts = result.artifacts ?? [];
  const risks = result.risks ?? [];
  const decisions = result.decisions ?? [];
  const graphPaths = result.graphPaths ?? [];

  return (
    <div className="worktree-recall-card">
      <div className="worktree-recall-section">
        <span className="worktree-recall-kicker">Likely intent</span>
        <p>{result.likelyIntent || result.summary || "Memory returned context without an intent summary."}</p>
      </div>

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

      {graphPaths.length > 0 && (
        <div className="worktree-recall-section">
          <span className="worktree-recall-kicker">Graph paths</span>
          <ul className="worktree-recall-paths">
            {graphPaths.slice(0, 6).map((path, index) => (
              <li key={`${path.from ?? path.nodes?.[0] ?? "path"}-${index}`}>
                <code>{formatGraphPath(path)}</code>
                {path.summary && <small>{path.summary}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="worktree-recall-section">
        <span className="worktree-recall-kicker">Next action</span>
        <p>{result.suggestedNextAction || "Inspect the related artifacts before summarizing or merging this worktree."}</p>
      </div>
    </div>
  );
}

function formatGraphPath(path: WorktreeRecallGraphPath): string {
  if (path.nodes?.length) {
    return path.nodes.join(" -> ");
  }

  const from = path.from ?? "memory";
  const to = path.to ?? "worktree";
  return path.kind ? `${from} -[${path.kind}]-> ${to}` : `${from} -> ${to}`;
}
