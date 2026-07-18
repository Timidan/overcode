import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import type { RecalledCogneeRepositoryMemory } from "../lib/cognee-repository-memory";
import {
  extractCogneeMemoryHighlights,
  extractCogneeMemoryReferences,
} from "../lib/cognee-workflow-memory";
import { AIProviderLogo } from "./AIProviderLogo";
import "./MemoryRecallModal.css";

interface Props {
  repoName: string;
  memory: RecalledCogneeRepositoryMemory;
  onClose: () => void;
}

const EXIT_MS = 140;
const MAX_MEMORY_SUMMARY_CHARS = 700;

export function RepoMemoryRecallModal({ repoName, memory, onClose }: Props) {
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

  const memories = useMemo(
    () =>
      memory.items.map((item) => {
        const highlights = extractCogneeMemoryHighlights(item.summary);
        return {
          id: item.id,
          title: cleanText(item.title) || "Recalled memory",
          summary: boundText(cleanText(highlights[0] ?? item.summary), MAX_MEMORY_SUMMARY_CHARS),
          references: extractCogneeMemoryReferences(item).slice(0, 6),
        };
      }),
    [memory.items],
  );
  const highlights = useMemo(() => extractCogneeMemoryHighlights(memory.context), [memory.context]);
  const strongestSignal = cleanText(highlights[0] ?? memories[0]?.summary ?? memory.summary);
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
        aria-label={`Cognee memory for ${repoName}`}
      >
        <header className="memory-modal-header">
          <AIProviderLogo providerId="cognee" size="md" decorative />
          <div className="memory-modal-titleblock">
            <span className="memory-modal-title">Cognee repo memory</span>
            <small>
              {memory.itemCount} memor{memory.itemCount === 1 ? "y" : "ies"} recalled for {repoName}
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
          <section className="memory-modal-hero" aria-label="Repository memory summary">
            <div>
              <span className="memory-modal-kicker">Repo signal</span>
              <p>{strongestSignal || "Cognee returned matching memory for this repository."}</p>
            </div>
            <div className="memory-modal-coverage">
              <span>{memory.itemCount}</span>
              <small>repo memories</small>
            </div>
          </section>

          <section className="memory-modal-panel" aria-label="Recalled memory">
            <div className="memory-modal-section-head">
              <span className="memory-modal-kicker">Recalled memory</span>
              <small>repo-scoped</small>
            </div>
            <ul className="memory-modal-memory-list">
              {memories.map((item) => (
                <li key={item.id}>
                  <div className="memory-modal-memory-head">
                    <span>{item.title}</span>
                    <small>{repoName}</small>
                  </div>
                  <p>{item.summary}</p>
                  {item.references.length > 0 && (
                    <div className="memory-modal-reference-row">
                      {item.references.map((reference) => (
                        <code key={reference}>{reference}</code>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {memory.references.length > 0 && (
            <section className="memory-modal-panel" aria-label="All references">
              <span className="memory-modal-kicker">References</span>
              <div className="memory-modal-reference-row">
                {memory.references.map((reference) => (
                  <code key={reference}>{reference}</code>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="memory-modal-footer">
          Recalled live from Cognee Cloud. Overcode filters memories by repository before
          showing this view, so stronger memories from other workspaces do not leak into
          this repo context.
        </footer>
      </div>
    </>
  );
}

function cleanText(value: string): string {
  return value
    .replace(/__node_content_(?:start|end)__/g, " ")
    .replace(/\bMemory\s+(?:cognee:)?[\w:-]+:\s*/gi, " ")
    .replace(/\bNodes?:\s*/gi, " ")
    .replace(/\bNode:\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boundText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}
