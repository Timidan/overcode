import { useState, useEffect } from "react";
import { Copy } from "@phosphor-icons/react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  generateCommitAssistant,
  type CommitPayload,
} from "../../lib/ai-features";
import "./CommitAssistant.css";

interface Props {
  payload?: CommitPayload | null;
}

export function CommitAssistant({ payload: explicitPayload }: Props) {
  const { payload: storePayload } = useAIPanel();
  const payload = explicitPayload ?? storePayload;
  const [isLoading, setIsLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [prDescription, setPrDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"commit" | "pr" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    async function generate() {
      const data = payload as CommitPayload;
      if (!data?.stagedDiff && !data?.repoPath) return;

      setIsLoading(true);
      setError(null);
      setCommitMessage("");
      setPrDescription("");
      setCopied(null);
      setCopyError(null);

      try {
        const result = await generateCommitAssistant(data);
        setCommitMessage(result.commitMessage);
        setPrDescription(result.prDescription);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate commit message");
      } finally {
        setIsLoading(false);
      }
    }

    generate();
  }, [payload]);

  async function copyToClipboard(kind: "commit" | "pr", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setCopyError(null);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopyError("Clipboard write failed.");
    }
  }

  return (
    <div className="commit-assistant">
      {isLoading && (
        <div className="commit-loading">
          <span className="commit-dot" style={{ animationDelay: "0ms" }} />
          <span className="commit-dot" style={{ animationDelay: "150ms" }} />
          <span className="commit-dot" style={{ animationDelay: "300ms" }} />
        </div>
      )}
      {error && <div className="commit-error">{error}</div>}
      {!isLoading && !error && commitMessage && (
        <>
          <div className="commit-section">
            <div className="commit-section-header">
              <span className="commit-section-label">Commit message</span>
              <button
                type="button"
                className="commit-copy-button"
                title="Copy commit message to clipboard"
                onClick={() => void copyToClipboard("commit", commitMessage)}
              >
                <Copy size={14} />
                <span>{copied === "commit" ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <textarea
              className="commit-textarea"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={5}
            />
          </div>
          <div className="commit-section">
            <div className="commit-section-header">
              <span className="commit-section-label">PR description</span>
              <button
                type="button"
                className="commit-copy-button"
                title="Copy PR description to clipboard"
                onClick={() => void copyToClipboard("pr", prDescription)}
              >
                <Copy size={14} />
                <span>{copied === "pr" ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <textarea
              className="commit-textarea"
              value={prDescription}
              onChange={(e) => setPrDescription(e.target.value)}
              rows={5}
            />
          </div>
          {copyError && <div className="commit-copy-error">{copyError}</div>}
        </>
      )}
    </div>
  );
}
