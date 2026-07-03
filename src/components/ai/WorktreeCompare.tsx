import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsLeftRight, Copy, ArrowClockwise } from "@phosphor-icons/react";
import { useAIPanel } from "../../store/useAIPanel";
import {
  ipc,
  type MemoryRememberResult,
  type WorktreeSummaryInput,
} from "../../lib/ipc";
import {
  summarizeWorktreeCompare,
  type WorktreeComparePayload,
} from "../../lib/ai-features";
import type {
  AIEnvelope,
  WorktreeCompareData,
} from "../../lib/ai-structured";
import { recallCogneeWorkflowMemory } from "../../lib/cognee-workflow-runtime";
import { WorktreeCompareSummary } from "./AIResultViews";
import { BrutalistSelect } from "../BrutalistSelect";
import { AIProviderLogo } from "../AIProviderLogo";
import { buildWorktreeCompareMemoryInput } from "./worktree-memory";
import "./WorktreeCompare.css";

interface Props {
  payload?: WorktreeComparePayload | null;
}

type View = "picker" | "loading" | "result" | "error";
type RememberState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; message: string; savedId: string; savedDataset: string }
  | { status: "forgetting"; message: string; savedId: string; savedDataset: string }
  | { status: "forgotten"; message: string }
  | { status: "skipped"; message: string }
  | { status: "error"; message: string };

const COMMON_TARGETS = ["origin/main", "origin/master", "main", "master", "develop", "trunk"];

export function WorktreeCompare({ payload: explicitPayload }: Props) {
  const { payload: storePayload } = useAIPanel();
  const incoming = (explicitPayload ?? storePayload) as
    | WorktreeComparePayload
    | null;

  const [view, setView] = useState<View>("picker");
  const [content, setContent] = useState<AIEnvelope<WorktreeCompareData> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [source, setSource] = useState<string>("");
  const [target, setTarget] = useState<string>("");
  const [lastPayload, setLastPayload] = useState<WorktreeComparePayload | null>(null);
  const [memoryUsed, setMemoryUsed] = useState<string | null>(null);
  const [rememberState, setRememberState] = useState<RememberState>({ status: "idle" });
  const initialRunRef = useRef(false);

  // Hydrate pickers from incoming payload. Source = worktree branch, target = base.
  useEffect(() => {
    if (!incoming) return;
    setSource(incoming.targetPath || incoming.target || incoming.branch || "");
    setTarget(incoming.base || "main");
  }, [incoming]);

  const targetOptions = useMemo(() => {
    const set = new Set<string>(COMMON_TARGETS);
    for (const candidate of incoming?.baseCandidates ?? []) set.add(candidate);
    if (incoming?.base) set.add(incoming.base);
    if (target) set.add(target);
    return Array.from(set);
  }, [incoming?.base, incoming?.baseCandidates, target]);

  const sourceOptions = useMemo(() => {
    const candidates = incoming?.worktreeCandidates ?? [];
    const options = candidates.map((candidate) => ({
      value: candidate.path,
      label: `${candidate.branch || "(detached)"}  ${shortPath(candidate.path)}`,
    }));
    if (incoming?.targetPath && !options.some((option) => option.value === incoming.targetPath)) {
      options.unshift({
        value: incoming.targetPath,
        label: `${incoming.target || incoming.branch || "current"}  ${shortPath(incoming.targetPath)}`,
      });
    }
    return options;
  }, [incoming?.branch, incoming?.target, incoming?.targetPath, incoming?.worktreeCandidates]);

  const runCompare = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!incoming?.repoId) return;
      setView("loading");
      setError(null);
      setCopyState("idle");
      setContent(null);
      setLastPayload(null);
      setRememberState({ status: "idle" });
      setMemoryUsed(null);
      try {
        let payload: WorktreeComparePayload = {
          ...incoming,
          base: target || incoming.base,
          target: incoming.target || incoming.branch || source,
          targetPath: source || incoming.targetPath,
        };
        if (incoming.repoPath && payload.targetPath) {
          const fresh = await ipc.getWorktreeSummaryInput(
            incoming.repoPath,
            payload.targetPath,
            target || incoming.base,
          );
          payload = payloadFromSummaryInput(incoming, fresh);
        }
        const memory = await recallCogneeWorkflowMemory({
          source: "worktree compare",
          repoId: payload.repoId,
          repoName: payload.repoName,
          branch: payload.branch ?? payload.target,
          paths: payload.changedFiles,
          tags: ["worktree", "compare"],
        });
        const result = await summarizeWorktreeCompare(
          memory?.context ? { ...payload, memoryContext: memory.context } : payload,
          options,
        );
        setLastPayload(payload);
        setContent(result);
        // Disclose that recalled memory shaped this result; silence otherwise.
        setMemoryUsed(memory ? memory.summary : null);
        setView("result");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to compare worktree");
        setView("error");
      }
    },
    [incoming, source, target],
  );

  // Auto-run once on first arrival so the existing entry point keeps "summarize" semantics.
  useEffect(() => {
    if (!incoming?.repoId) return;
    if (initialRunRef.current) return;
    initialRunRef.current = true;
    void runCompare();
  }, [incoming?.repoId, runCompare]);

  const copyAll = useCallback(async () => {
    if (!content) return;
    const text = formatStructuredForClipboard(content);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("error");
    }
  }, [content]);

  const rememberWithCognee = useCallback(async () => {
    if (!content || !lastPayload) return;
    setRememberState({ status: "saving" });
    try {
      const input = buildWorktreeCompareMemoryInput(lastPayload, content);
      const result = await ipc.rememberMemory(input) as MemoryRememberResult;
      if (result.ok) {
        setRememberState({
          status: "saved",
          message: `Saved ${result.stored} worktree memory record${result.stored === 1 ? "" : "s"} to Cognee.`,
          savedId: input.documents[0]?.id ?? "",
          savedDataset: input.datasetName ?? "overcode_memory",
        });
        return;
      }
      setRememberState({
        status: result.skipped ? "skipped" : "error",
        message: result.reason || result.error || "Cognee did not accept the memory record.",
      });
    } catch (err) {
      setRememberState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to save Cognee memory.",
      });
    }
  }, [content, lastPayload]);

  const forgetSavedMemory = useCallback(async () => {
    if (rememberState.status !== "saved" || !rememberState.savedId) return;
    const { savedId, savedDataset } = rememberState;
    setRememberState({ status: "forgetting", message: "", savedId, savedDataset });
    try {
      const result = await ipc.forgetMemory({ id: savedId, datasetName: savedDataset });
      if (result.forgotten) {
        setRememberState({
          status: "forgotten",
          message: "Memory removed from Cognee. Future recalls will not return it.",
        });
        return;
      }
      setRememberState({
        status: "saved",
        message: result.reason || result.error || "Cognee did not forget the memory.",
        savedId,
        savedDataset,
      });
    } catch (err) {
      setRememberState({
        status: "saved",
        message: err instanceof Error ? err.message : "Failed to forget Cognee memory.",
        savedId,
        savedDataset,
      });
    }
  }, [rememberState]);

  const canCompare = Boolean(incoming?.repoId && source && target);

  return (
    <div className="worktree-compare-ai">
      <section className="wt-picker" aria-label="Worktree compare inputs">
        <div className="wt-picker-row">
          <div className="wt-picker-field">
            <span className="wt-picker-label">Worktree</span>
            {sourceOptions.length > 0 ? (
              <BrutalistSelect
                className="wt-picker-input wt-picker-select"
                value={source}
                onChange={(next) => setSource(next)}
                ariaLabel="Source worktree"
                options={sourceOptions}
              />
            ) : (
              <input
                type="text"
                className="wt-picker-input"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                spellCheck={false}
                placeholder="/path/to/worktree"
              />
            )}
          </div>
          <div className="wt-picker-divider" aria-hidden="true">
            <ArrowsLeftRight size={14} />
          </div>
          <div className="wt-picker-field">
            <span className="wt-picker-label">Compare against</span>
            <BrutalistSelect
              className="wt-picker-input wt-picker-select"
              value={target}
              onChange={(next) => setTarget(next)}
              ariaLabel="Target branch"
              options={targetOptions.map((opt) => ({ value: opt, label: opt }))}
            />
          </div>
        </div>
        <button
          type="button"
          className="wt-compare-button"
          onClick={() => runCompare()}
          disabled={!canCompare || view === "loading"}
        >
          {view === "loading" ? "Comparing…" : "Compare"}
        </button>
      </section>

      {view === "picker" && !content && !error && (
        <div className="wt-empty">
          Pick a target branch and run Compare to see AI&apos;s structured analysis.
        </div>
      )}

      {view === "loading" && (
        <div className="wt-loading" role="status" aria-live="polite">
          <span className="wt-loading-dots" aria-hidden="true">
            <span className="wt-dot" style={{ animationDelay: "0ms" }} />
            <span className="wt-dot" style={{ animationDelay: "150ms" }} />
            <span className="wt-dot" style={{ animationDelay: "300ms" }} />
          </span>
          <span className="wt-loading-caption">AI is comparing…</span>
        </div>
      )}

      {view === "error" && error && (
        <div className="wt-error" role="alert">
          <div className="wt-error-label">Compare failed</div>
          <p>{error}</p>
          <button
            type="button"
            className="wt-error-retry"
            onClick={() => runCompare({ force: true })}
          >
            Retry
          </button>
        </div>
      )}

      {view === "result" && content && (
        <div className="wt-result motion-rise">
          {memoryUsed && (
            <div className="wt-memory-used" role="note" title="Recalled repository memory was included in the AI prompt for this comparison">
              From memory: {memoryUsed} informed this analysis.
            </div>
          )}
          <WorktreeCompareSummary result={content} />
          <section className={`wt-cognee-memory is-${rememberState.status}`}>
            <div className="wt-cognee-memory-head">
              <AIProviderLogo providerId="cognee" size="sm" decorative />
              <span>Cognee memory</span>
            </div>
            <button
              type="button"
              className="wt-action wt-cognee-action"
              onClick={() => void rememberWithCognee()}
              disabled={rememberState.status === "saving" || rememberState.status === "forgetting"}
              title="Save this comparison as repository memory for future recall"
            >
              <span>{rememberState.status === "saving" ? "Remembering..." : "Remember with Cognee"}</span>
            </button>
            {(rememberState.status === "saved" || rememberState.status === "forgetting") && (
              <button
                type="button"
                className="wt-action wt-cognee-action"
                onClick={() => void forgetSavedMemory()}
                disabled={rememberState.status === "forgetting"}
                title="Forget this saved memory in Cognee"
              >
                <span>
                  {rememberState.status === "forgetting" ? "Forgetting..." : "Forget this memory"}
                </span>
              </button>
            )}
            {rememberState.status !== "idle" &&
              rememberState.status !== "saving" &&
              rememberState.message && (
                <div className="wt-cognee-message">{rememberState.message}</div>
              )}
          </section>
          <footer className="wt-actions">
            <button type="button" className="wt-action" onClick={() => void copyAll()} title="Copy AI output to clipboard">
              <Copy size={13} />
              <span>{copyState === "copied" ? "Copied" : "Copy"}</span>
            </button>
            <button
              type="button"
              className="wt-action"
              onClick={() => runCompare({ force: true })}
              title="Re-run AI"
            >
              <ArrowClockwise size={13} />
              <span>Re-run</span>
            </button>
          </footer>
          {copyState === "error" && (
            <div className="wt-copy-error">Clipboard write failed.</div>
          )}
        </div>
      )}
    </div>
  );
}

function payloadFromSummaryInput(
  previous: WorktreeComparePayload,
  input: WorktreeSummaryInput,
): WorktreeComparePayload {
  return {
    ...previous,
    repoPath: input.repoPath,
    targetPath: input.targetPath,
    base: input.base,
    target: input.target,
    baseRef: input.baseRef,
    targetRef: input.targetRef,
    branch: input.branch,
    ahead: input.ahead,
    behind: input.behind,
    dirtyFiles: input.dirtyFiles,
    diffStat: input.diffStat,
    nameStatus: input.nameStatus,
    patch: input.patch,
    uncommittedDiff: input.uncommittedDiff,
    uniqueCommits: input.uniqueCommits,
    changedFiles: input.changedFiles,
    baseCandidates: input.baseCandidates,
    worktreeCandidates: input.worktreeCandidates,
  };
}

function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `.../${parts.slice(-2).join("/")}`;
}

function formatStructuredForClipboard(
  envelope: AIEnvelope<WorktreeCompareData>,
): string {
  const { data } = envelope;
  const lines: string[] = [];
  lines.push(`# Worktree compare: ${data.target} vs ${data.base}`);
  lines.push("");
  lines.push(envelope.summary);
  if (data.intent) {
    lines.push("");
    lines.push(`Intent: ${data.intent}`);
  }
  lines.push("");
  lines.push(`Readiness: ${data.readiness.replace(/_/g, " ")}`);
  lines.push(
    `Ahead ${data.ahead} / Behind ${data.behind} / Dirty ${data.dirtyFiles}`,
  );
  if (data.moduleMap.length > 0) {
    lines.push("");
    lines.push("## Modules");
    for (const module of data.moduleMap) {
      lines.push(`- [${module.risk.toUpperCase()}] ${module.module}`);
      for (const file of module.files.slice(0, 6)) {
        lines.push(`    - ${file}`);
      }
    }
  }
  if (data.nextActions.length > 0) {
    lines.push("");
    lines.push("## Next actions");
    for (const action of data.nextActions) {
      lines.push(`- ${action}`);
    }
  }
  if (data.prDraft) {
    lines.push("");
    lines.push("## PR draft");
    lines.push(data.prDraft.title);
    lines.push("");
    lines.push(data.prDraft.body);
  }
  return lines.join("\n");
}
