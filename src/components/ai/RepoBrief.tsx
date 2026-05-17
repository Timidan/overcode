import { useState, useEffect } from "react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  getRepoBriefStructured,
  type BriefPayload,
} from "../../lib/ai-features";
import type { GraniteEnvelope, RepoBriefData } from "../../lib/ai-structured";
import { RepoBriefResult } from "./AIResultViews";
import "./RepoBrief.css";

interface Props {
  payload?: BriefPayload | null;
}

export function RepoBrief({ payload: explicitPayload }: Props) {
  const { payload: storePayload } = useAIPanel();
  const payload = explicitPayload ?? storePayload;
  const [isLoading, setIsLoading] = useState(false);
  const [content, setContent] =
    useState<GraniteEnvelope<RepoBriefData> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function generate() {
      const data = payload as BriefPayload;
      if (!data?.repoId) return;

      setIsLoading(true);
      setError(null);
      setContent(null);

      try {
        setContent(await getRepoBriefStructured(data));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate brief");
      } finally {
        setIsLoading(false);
      }
    }

    generate();
  }, [payload]);

  return (
    <div className="repo-brief">
      {isLoading && (
        <div className="brief-loading">
          <span className="brief-dot" style={{ animationDelay: "0ms" }} />
          <span className="brief-dot" style={{ animationDelay: "150ms" }} />
          <span className="brief-dot" style={{ animationDelay: "300ms" }} />
        </div>
      )}
      {error && <div className="brief-error">{error}</div>}
      {content && (
        <RepoBriefResult result={content} />
      )}
    </div>
  );
}
