import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import type { CogneeWorkspaceBrief } from "../lib/cognee-workspace-brief";
import { AIProviderLogo } from "./AIProviderLogo";
import "./MemoryRecallModal.css";

interface Props {
  brief: CogneeWorkspaceBrief;
  onClose: () => void;
}

// Keep in sync with --duration-exit; React unmounts instantly, so we hold the
// node for one exit animation before calling the parent's onClose.
const EXIT_MS = 140;

/** Centered, Cognee-attributed view of a full recalled memory. The quiet
 * one-line teasers open this when the user wants the whole status report. */
export function MemoryRecallModal({ brief, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const closingClass = closing ? " is-closing" : "";

  return (
    <>
      <div
        className={`memory-modal-backdrop${closingClass}`}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        className={`memory-modal${closingClass}`}
        role="dialog"
        aria-modal="true"
        aria-label="Cognee workspace memory brief"
      >
        <header className="memory-modal-header">
          <AIProviderLogo providerId="cognee" size="md" decorative />
          <div className="memory-modal-titleblock">
            <span className="memory-modal-title">Cognee workspace brief</span>
            <small>
              {brief.itemCount} memor{brief.itemCount === 1 ? "y" : "ies"} · {brief.coverageLabel}
            </small>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="memory-modal-close"
            onClick={requestClose}
            aria-label="Close memory view"
            title="Close"
          >
            <X size={14} weight="bold" />
          </button>
        </header>
        <div className="memory-modal-body">
          <section className="memory-modal-hero" aria-label="Workspace summary">
            <div>
              <span className="memory-modal-kicker">Workspace signal</span>
              <p>{brief.headline}</p>
            </div>
            <div className="memory-modal-coverage">
              <span>{brief.coverageLabel}</span>
              <small>Cognee coverage</small>
            </div>
          </section>

          <section className="memory-modal-panel" aria-label="Cognee coverage">
            <span className="memory-modal-kicker">Coverage</span>
            <p>{brief.coverageNote}</p>
          </section>

          <section className="memory-modal-panel" aria-label="Repository signals">
            <div className="memory-modal-section-head">
              <span className="memory-modal-kicker">Repository signals</span>
              <small>{brief.repoSignals.length} shown</small>
            </div>
            <ul className="memory-modal-repo-list">
              {brief.repoSignals.map((repo) => (
                <li key={repo.repo}>
                  <div>
                    <span className="memory-modal-repo-name">{repo.repo}</span>
                    <small>{repo.platform}{repo.dirtyCount > 0 ? ` · ${repo.dirtyCount} dirty` : ""}</small>
                  </div>
                  <p>{repo.note}</p>
                  <span className={`memory-modal-chip${repo.hasMemory ? " is-live" : ""}`}>
                    {repo.hasMemory ? "recalled" : "no memory yet"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="memory-modal-panel" aria-label="Recalled memory">
            <div className="memory-modal-section-head">
              <span className="memory-modal-kicker">Recalled memory</span>
              <small>{brief.itemCount} items</small>
            </div>
            <ul className="memory-modal-memory-list">
              {brief.memories.map((memory) => (
                <li key={memory.id}>
                  <div className="memory-modal-memory-head">
                    <span>{memory.title}</span>
                    <small>{memory.repo}</small>
                  </div>
                  <p>{memory.summary}</p>
                  {memory.references.length > 0 && (
                    <div className="memory-modal-reference-row">
                      {memory.references.map((reference) => (
                        <code key={reference}>{reference}</code>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="memory-modal-split">
            <div className="memory-modal-panel">
              <span className="memory-modal-kicker">Watchpoints</span>
              <MemoryBulletList emptyLabel="No risks recalled yet." items={brief.watchpoints} />
            </div>
            <div className="memory-modal-panel">
              <span className="memory-modal-kicker">Next actions</span>
              <MemoryBulletList emptyLabel="No next actions inferred yet." items={brief.nextActions} />
            </div>
          </section>
        </div>
        <footer className="memory-modal-footer">
          Recalled live from Cognee Cloud and structured locally by Overcode. Raw source,
          secrets, and full diffs are never stored in this dashboard view.
        </footer>
      </div>
    </>
  );
}

function MemoryBulletList({ emptyLabel, items }: { emptyLabel: string; items: string[] }) {
  if (items.length === 0) {
    return <p className="memory-modal-empty">{emptyLabel}</p>;
  }
  return (
    <ul className="memory-modal-bullet-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
