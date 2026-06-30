import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Sparkle } from "@phosphor-icons/react";
import { ipc } from "../lib/ipc";
import { useAIPanel } from "../store/useAIPanel";
import { CodeInspector } from "./CodeInspector";
import "./UncommittedFiles.css";

interface GitFile {
  path: string;
  status: "M" | "A" | "D" | "R" | "?" | "U";
  staged: boolean;
  additions?: number;
  deletions?: number;
}

interface Props {
  repoPath: string;
  onCommit?: () => void;
}

interface InspectorState {
  filePath: string;
  patch?: string;
  gitRef?: string;
}

function fileListToDiff(files: GitFile[]): string {
  // Plain-language summary fed to AI when a real diff isn't available.
  return files
    .map((f) => {
      const label =
        f.status === "A"
          ? "added"
          : f.status === "D"
            ? "deleted"
            : f.status === "R"
              ? "renamed"
              : f.status === "?"
                ? "untracked"
                : "modified";
      return `${label}: ${f.path}`;
    })
    .join("\n");
}

const STATUS_LABEL: Record<GitFile["status"], string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  "?": "Untracked",
  U: "Conflict",
};

const FILE_EXPLAIN_MAX_BYTES = 18_000;

export function UncommittedFiles({ repoPath, onCommit }: Props) {
  const openAIPanel = useAIPanel((s) => s.open);
  const [files, setFiles] = useState<GitFile[]>([]);
  const [diff, setDiff] = useState("");
  const [inspector, setInspector] = useState<InspectorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patchesByPath = useMemo(() => buildPatchMap(diff), [diff]);

  const handleCommit = () => {
    if (onCommit) {
      onCommit();
      return;
    }
    openAIPanel("commit", {
      repoPath,
      stagedDiff: diff.trim() || fileListToDiff(files),
    });
  };

  const loadStatus = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoading(true);
      setError(null);
      try {
        const result = await ipc.getGitStatus(repoPath, { mode: "diff" });
        if (isCancelled()) return;
        setFiles(result.files as GitFile[]);
        setDiff([result.stagedDiff, result.diff].filter(Boolean).join("\n\n"));
      } catch (err) {
        if (isCancelled()) return;
        setFiles([]);
        setDiff("");
        setError(err instanceof Error ? err.message : "Failed to load working tree");
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [repoPath],
  );

  function patchForFile(file: GitFile): string {
    return patchesByPath.get(file.path) ?? "";
  }

  function inspectFile(file: GitFile) {
    setInspector({
      filePath: file.path,
      patch: patchForFile(file),
      gitRef: file.status === "D" ? "HEAD" : undefined,
    });
  }

  async function explainFile(file: GitFile) {
    const patch = patchForFile(file).trim();
    if (patch) {
      openAIPanel("code", {
        subject: `${STATUS_LABEL[file.status] ?? file.status} ${file.path}`,
        kind: "diff-hunk",
        content: patch,
        context: `Local uncommitted change in ${repoPath}`,
      });
      return;
    }

    try {
      const content = await ipc.readRepoFile(
        repoPath,
        file.path,
        file.status === "D"
          ? { ref: "HEAD", maxBytes: FILE_EXPLAIN_MAX_BYTES }
          : { maxBytes: FILE_EXPLAIN_MAX_BYTES },
      );
      openAIPanel("code", {
        subject: `${STATUS_LABEL[file.status] ?? file.status} ${file.path}`,
        kind: "file",
        language: content.language,
        content: content.binary
          ? `Binary file: ${file.path} (${content.size} bytes)`
          : content.content || "(empty file)",
        context: `Local ${STATUS_LABEL[file.status].toLowerCase()} file in ${repoPath}`,
      });
    } catch (err) {
      openAIPanel("code", {
        subject: `${STATUS_LABEL[file.status] ?? file.status} ${file.path}`,
        kind: "file",
        content: "",
        unavailableReason:
          err instanceof Error
            ? `Could not read ${file.path}: ${err.message}`
            : `Could not read ${file.path}.`,
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    void loadStatus(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  function renderBody() {
    if (loading) return <div className="empty">Loading…</div>;
    if (error) {
      return (
        <div className="uncommitted-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadStatus()}>
            Retry
          </button>
        </div>
      );
    }
    if (files.length === 0) return <div className="empty">No uncommitted changes</div>;
    return (
      <ul className="file-list">
        {files.map((f) => (
          <li key={f.path} className="file-row">
            <span className={`status-badge status-${f.status.toLowerCase()}`}>
              {STATUS_LABEL[f.status] ?? f.status}
            </span>
            <span className="file-path">{f.path}</span>
            {f.additions !== undefined || f.deletions !== undefined ? (
              <span className="file-loc">
                {f.additions !== undefined && (
                  <span className="file-loc-add">+{f.additions}</span>
                )}
                {f.additions !== undefined && f.deletions !== undefined && (
                  <span className="file-loc-sep"> / </span>
                )}
                {f.deletions !== undefined && (
                  <span className="file-loc-del">−{f.deletions}</span>
                )}
              </span>
            ) : (
              <span className="file-loc file-loc-missing" aria-hidden="true">—</span>
            )}
            {f.staged && <span className="file-staged-chip">staged</span>}
            <span className="file-actions" aria-label={`Actions for ${f.path}`}>
              <button
                type="button"
                className="file-action-button"
                onClick={() => inspectFile(f)}
                title={`Inspect ${f.path}`}
              >
                <Eye size={12} />
                <span>Inspect</span>
              </button>
              <button
                type="button"
                className="file-action-button file-action-button-ai"
                onClick={() => void explainFile(f)}
                title={`Ask OpenRouter to explain ${f.path}`}
              >
                <Sparkle size={12} />
                <span>AI</span>
              </button>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="uncommitted-files">
      <header className="uncommitted-header">
        <span className="section-label">Uncommitted files</span>
        <span className="uncommitted-count">{files.length}</span>
      </header>
      {renderBody()}
      {inspector && (
        <CodeInspector
          repoPath={repoPath}
          filePath={inspector.filePath}
          gitRef={inspector.gitRef}
          patch={inspector.patch}
          variant="panel"
          open
          onClose={() => setInspector(null)}
        />
      )}
      {!error && files.length > 0 && (
        <button
          className="commit-button"
          onClick={handleCommit}
          type="button"
          title="Generate a commit message for these changes with OpenRouter"
        >
          Commit changes
        </button>
      )}
    </section>
  );
}

function buildPatchMap(rawDiff: string): Map<string, string> {
  const patches = new Map<string, string>();
  for (const block of splitDiffBlocks(rawDiff)) {
    for (const path of pathsFromPatchBlock(block)) {
      const existing = patches.get(path);
      patches.set(path, existing ? `${existing}\n\n${block}` : block);
    }
  }
  return patches;
}

function splitDiffBlocks(rawDiff: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of rawDiff.split("\n")) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
    if (line || current.length > 0) current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks.filter((block) => block.trim().length > 0);
}

function pathsFromPatchBlock(block: string): string[] {
  const paths = new Set<string>();
  for (const line of block.split("\n")) {
    if (!line.startsWith("--- ") && !line.startsWith("+++ ")) continue;
    const path = normalizeDiffPath(line.slice(4));
    if (path) paths.add(path);
  }
  return Array.from(paths);
}

function normalizeDiffPath(rawPath: string): string | null {
  const clean = rawPath.trim();
  if (!clean || clean === "/dev/null") return null;
  const unquoted = clean.startsWith("\"") && clean.endsWith("\"")
    ? clean.slice(1, -1).replace(/\\"/g, "\"")
    : clean;
  if (unquoted.startsWith("a/") || unquoted.startsWith("b/")) {
    return unquoted.slice(2);
  }
  return unquoted;
}
