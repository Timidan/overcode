import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { AIProviderLogo } from "./AIProviderLogo";
import "./MemoryRecallModal.css";

interface Props {
  /** Where the memory was recalled for, e.g. a repo name. */
  subject: string;
  /** Full readable memory blocks, in recall order. */
  highlights: string[];
  itemCount: number;
  onClose: () => void;
}

// Keep in sync with --duration-exit; React unmounts instantly, so we hold the
// node for one exit animation before calling the parent's onClose.
const EXIT_MS = 140;

/** Centered, Cognee-attributed view of a full recalled memory. The quiet
 * one-line teasers open this when the user wants the whole status report. */
export function MemoryRecallModal({ subject, highlights, itemCount, onClose }: Props) {
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
        aria-label={`Cognee memory for ${subject}`}
      >
        <header className="memory-modal-header">
          <AIProviderLogo providerId="cognee" size="md" decorative />
          <div className="memory-modal-titleblock">
            <span className="memory-modal-title">Cognee memory recall</span>
            <small>
              {itemCount} memor{itemCount === 1 ? "y" : "ies"} recalled for {subject}
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
          {highlights.map((highlight, index) => (
            <p key={index}>{highlight}</p>
          ))}
        </div>
        <footer className="memory-modal-footer">
          Recalled live from Cognee Cloud. Structured extracts only; raw source and
          diffs are never stored.
        </footer>
      </div>
    </>
  );
}
