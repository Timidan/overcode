import { useCallback, useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "@phosphor-icons/react";
import { ipc } from "../lib/ipc";
import "./DivergenceIndicator.css";

interface Props {
  repoPath: string;
  branch: string;
  remote?: string;
}

export function DivergenceIndicator({ repoPath, branch, remote = "origin" }: Props) {
  const [div, setDiv] = useState({ ahead: 0, behind: 0 });
  const [busy, setBusy] = useState<"idle" | "push" | "pull">("idle");
  const [flash, setFlash] = useState<"success" | "error" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [divergenceError, setDivergenceError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await ipc.getDivergence(repoPath, branch);
      setDiv(result);
      setDivergenceError(null);
    } catch (err) {
      setDiv({ ahead: 0, behind: 0 });
      setDivergenceError(err instanceof Error ? err.message : "Unable to read branch divergence");
    }
  }, [branch, repoPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handlePush() {
    setBusy("push");
    setError(null);
    try {
      await ipc.gitPush(repoPath, remote, branch);
      setFlash("success");
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Push failed");
      setFlash("error");
    } finally {
      setBusy("idle");
      setTimeout(() => setFlash(null), 1500);
    }
  }

  const inSync = div.ahead === 0 && div.behind === 0;

  return (
    <section className={`divergence ${flash ? `flash-${flash}` : ""}`}>
      <header className="divergence-header">
        <span className="section-label">Branch state</span>
        <span className="divergence-branch">{branch}</span>
      </header>
      <p className="divergence-text">
        {divergenceError ? (
          <>Branch divergence unavailable for <span className="mono">{remote}/{branch}</span></>
        ) : (
          <>Relative to <span className="mono">{remote}/{branch}</span></>
        )}
      </p>
      {!divergenceError && (
        <div className="divergence-tiles">
          {inSync ? (
            <span className="divergence-tile divergence-tile-sync">
              <span className="divergence-tile-dot" aria-hidden="true">●</span>
              <span>in sync</span>
            </span>
          ) : (
            <>
              <span
                className={`divergence-tile divergence-tile-ahead${div.ahead === 0 ? " is-zero" : ""}`}
                key={`ahead-${div.ahead}`}
              >
                <ArrowUp size={11} weight="bold" className="motion-arrow-up" />
                <span>ahead {div.ahead}</span>
              </span>
              <span
                className={`divergence-tile divergence-tile-behind${div.behind === 0 ? " is-zero" : ""}`}
                key={`behind-${div.behind}`}
              >
                <ArrowDown size={11} weight="bold" className="motion-arrow-down" />
                <span>behind {div.behind}</span>
              </span>
            </>
          )}
        </div>
      )}
      <div className="divergence-actions">
        <button
          type="button"
          className="action-button"
          disabled={busy !== "idle"}
          onClick={handlePush}
          title="Push to remote"
        >
          {busy === "push" ? "Pushing…" : "Push"}
        </button>
      </div>
      {divergenceError && <div className="divergence-error">{divergenceError}</div>}
      {error && <div className="divergence-error">{error}</div>}
    </section>
  );
}
