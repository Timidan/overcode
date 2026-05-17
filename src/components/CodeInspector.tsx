import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowsClockwise,
  Copy,
  X,
} from "@phosphor-icons/react";
import { ipc, type RepoFileContent } from "../lib/ipc";
import "./CodeInspector.css";

export interface CodeInspectorProps {
  repoPath: string;
  filePath: string;
  /** Git ref to read at — branch, tag, or SHA. Renamed from `ref` because
   *  React 18 strips a `ref` prop from non-forwardRef function components
   *  before it reaches the implementation. */
  gitRef?: string;
  maxBytes?: number;
  variant?: "inline" | "panel";
  patch?: string;
  highlightRange?: [number, number];
  onClose?: () => void;
  open?: boolean;
}

type LineKind = "add" | "del" | "hunk" | "ctx";

const DEFAULT_MAX_BYTES = 256_000;

/**
 * Build a map of 1-based line numbers (in the new/current file) to a
 * line classification derived from the unified diff `patch`.
 *
 * Unified diff conventions consumed:
 *  - `@@ -oldStart,oldLen +newStart,newLen @@`  → resets new-file cursor
 *  - lines starting with `+` (but not `+++`)   → "add", advances new cursor
 *  - lines starting with `-` (but not `---`)   → "del", does NOT advance new cursor
 *  - lines starting with ` ` (space)           → context, advances new cursor
 *  - lines starting with `\`                   → "\ No newline at end of file" — skipped
 *
 * Since `-` lines have no corresponding new-file line number, we attach them
 * to the new-file line that follows so the row immediately before an add still
 * gets a red tint. This matches how most code viewers render an "interleaved"
 * unified diff overlaid onto the post-image file.
 */
function buildPatchKindMap(patch: string): Map<number, LineKind> {
  const out = new Map<number, LineKind>();
  if (!patch) return out;

  const lines = patch.split("\n");
  let newCursor = 0;
  let inHunk = false;
  // pending `-` lines waiting for the next new-file line to attach to
  let pendingDel = false;

  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (m) {
        newCursor = parseInt(m[1], 10);
        inHunk = true;
        pendingDel = false;
      }
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (raw.startsWith("\\")) continue;

    const c = raw[0];
    if (c === "+") {
      out.set(newCursor, "add");
      pendingDel = false;
      newCursor += 1;
    } else if (c === "-") {
      pendingDel = true;
      // do not advance newCursor
    } else if (c === " " || raw === "") {
      // context line
      if (pendingDel && !out.has(newCursor)) {
        out.set(newCursor, "del");
      }
      pendingDel = false;
      newCursor += 1;
    }
  }
  return out;
}

function toHexPreview(content: string, max = 256): string {
  // content is base64-ish in binary mode? Spec says encoding=binary returns
  // a binary string. We render bytes from JS string charCodes & 0xff which
  // is safe for an Electron-side binary payload.
  const bytes: string[] = [];
  const len = Math.min(content.length, max);
  for (let i = 0; i < len; i++) {
    bytes.push((content.charCodeAt(i) & 0xff).toString(16).padStart(2, "0"));
  }
  // 16 columns
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    rows.push(bytes.slice(i, i + 16).join(" "));
  }
  return rows.join("\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function CodeInspector({
  repoPath,
  filePath,
  gitRef,
  maxBytes = DEFAULT_MAX_BYTES,
  variant = "inline",
  patch,
  highlightRange,
  onClose,
  open,
}: CodeInspectorProps) {
  const [file, setFile] = useState<RepoFileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<"path" | "content" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const highlightAnchorRef = useRef<HTMLDivElement | null>(null);

  const isPanel = variant === "panel";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.readRepoFile(repoPath, filePath, {
        ref: gitRef,
        maxBytes,
      });
      setFile(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, [repoPath, filePath, gitRef, maxBytes]);

  useEffect(() => {
    void load();
  }, [load]);

  // Esc to close (panel only)
  useEffect(() => {
    if (!isPanel) return;
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPanel, open, onClose]);

  // Scroll highlight into view
  useEffect(() => {
    if (!highlightRange || loading || !file) return;
    // tiny delay so the lines are rendered
    const t = window.setTimeout(() => {
      highlightAnchorRef.current?.scrollIntoView({
        block: "center",
        behavior: "auto",
      });
    }, 0);
    return () => window.clearTimeout(t);
  }, [highlightRange, loading, file]);

  const patchMap = useMemo(
    () => (patch ? buildPatchKindMap(patch) : new Map<number, LineKind>()),
    [patch],
  );

  const lines = useMemo<string[]>(() => {
    if (!file || file.binary) return [];
    // Keep trailing empty lines so line numbers align with editors.
    return file.content.split("\n");
  }, [file]);

  const lineCount = lines.length;
  const lineNumberWidth = Math.max(2, String(lineCount).length);

  async function copyText(text: string, key: "path" | "content") {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(null);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      setCopiedKey(null);
      setCopyError("Clipboard write failed.");
    }
  }

  const headerRefLabel = gitRef ?? "Working tree";

  // Ref chip is amber when pointing at anything other than a canonical default
  // branch — branches, tags, and SHAs all read as "verify before editing".
  // "Working tree" is the user's current checkout, so it stays neutral too.
  const refChipAccent = computeRefChipAccent(gitRef);

  // Size chip warns amber when the file is within 20% of the byte budget
  // (likely to be cut), red when the backend reports it was actually clipped.
  const sizeChipAccent: "neutral" | "amber" | "red" = !file
    ? "neutral"
    : file.truncated
      ? "red"
      : file.size > maxBytes * 0.8
        ? "amber"
        : "neutral";

  // ---- error / not-found mapping ----
  const isNotFound =
    !!error &&
    /(ENOENT|not found|unknown revision|does not exist|pathspec)/i.test(error);

  const rootClassName = [
    "code-inspector",
    isPanel ? "code-inspector--panel" : "code-inspector--inline",
    isPanel && open ? "is-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // For panel variant, render the panel shell even while closed so the
  // transition can play.
  if (isPanel) {
    return (
      <aside
        className={rootClassName}
        aria-hidden={!open}
        role="complementary"
      >
        <InspectorInner
          file={file}
          loading={loading}
          error={error}
          isNotFound={isNotFound}
          headerRefLabel={headerRefLabel}
          refChipAccent={refChipAccent}
          sizeChipAccent={sizeChipAccent}
          filePath={filePath}
          lines={lines}
          lineNumberWidth={lineNumberWidth}
          patchMap={patchMap}
          highlightRange={highlightRange}
          highlightAnchorRef={highlightAnchorRef}
          bodyRef={bodyRef}
          copiedKey={copiedKey}
          copyError={copyError}
          onCopyPath={() => copyText(filePath, "path")}
          onCopyContent={() =>
            file && !file.binary ? copyText(file.content, "content") : undefined
          }
          onRetry={load}
          onClose={onClose}
          showClose
        />
      </aside>
    );
  }

  return (
    <div className={rootClassName}>
      <InspectorInner
        file={file}
        loading={loading}
        error={error}
        isNotFound={isNotFound}
        headerRefLabel={headerRefLabel}
        refChipAccent={refChipAccent}
        sizeChipAccent={sizeChipAccent}
        filePath={filePath}
        lines={lines}
        lineNumberWidth={lineNumberWidth}
        patchMap={patchMap}
        highlightRange={highlightRange}
        highlightAnchorRef={highlightAnchorRef}
        bodyRef={bodyRef}
        copiedKey={copiedKey}
        copyError={copyError}
        onCopyPath={() => copyText(filePath, "path")}
        onCopyContent={() =>
          file && !file.binary ? copyText(file.content, "content") : undefined
        }
        onRetry={load}
      />
    </div>
  );
}

const DEFAULT_REFS = new Set(["main", "master", "trunk", "develop"]);

function computeRefChipAccent(
  gitRef: string | undefined,
): "neutral" | "amber" {
  if (!gitRef) return "neutral";
  return DEFAULT_REFS.has(gitRef) ? "neutral" : "amber";
}

// ---------- inner ----------

interface InspectorInnerProps {
  file: RepoFileContent | null;
  loading: boolean;
  error: string | null;
  isNotFound: boolean;
  headerRefLabel: string;
  refChipAccent: "neutral" | "amber";
  sizeChipAccent: "neutral" | "amber" | "red";
  filePath: string;
  lines: string[];
  lineNumberWidth: number;
  patchMap: Map<number, LineKind>;
  highlightRange?: [number, number];
  highlightAnchorRef: React.MutableRefObject<HTMLDivElement | null>;
  bodyRef: React.MutableRefObject<HTMLDivElement | null>;
  copiedKey: "path" | "content" | null;
  copyError: string | null;
  onCopyPath: () => void;
  onCopyContent: () => void;
  onRetry: () => void;
  onClose?: () => void;
  showClose?: boolean;
}

function InspectorInner({
  file,
  loading,
  error,
  isNotFound,
  headerRefLabel,
  refChipAccent,
  sizeChipAccent,
  filePath,
  lines,
  lineNumberWidth,
  patchMap,
  highlightRange,
  highlightAnchorRef,
  bodyRef,
  copiedKey,
  copyError,
  onCopyPath,
  onCopyContent,
  onRetry,
  onClose,
  showClose,
}: InspectorInnerProps) {
  return (
    <>
      <header className="code-inspector__header">
        <div className="code-inspector__path" title={filePath}>
          {filePath}
        </div>
        <div className="code-inspector__meta">
          <span
            className={`code-inspector__chip code-inspector__chip--ref code-inspector__chip--${refChipAccent}`}
            title={
              refChipAccent === "amber"
                ? "Non-default ref — verify before editing"
                : "Ref"
            }
          >
            {headerRefLabel}
          </span>
          {file && (
            <span
              className={`code-inspector__bytes code-inspector__bytes--${sizeChipAccent}`}
              title={
                sizeChipAccent === "red"
                  ? "File was truncated"
                  : sizeChipAccent === "amber"
                    ? "File is near the byte budget"
                    : undefined
              }
            >
              {formatBytes(file.size)}
            </span>
          )}
          <button
            type="button"
            className="code-inspector__icon-btn"
            title={copiedKey === "path" ? "Copied path" : "Copy path"}
            onClick={onCopyPath}
          >
            <Copy size={14} />
            <span className="code-inspector__btn-label">Path</span>
          </button>
          <button
            type="button"
            className="code-inspector__icon-btn"
            title={copiedKey === "content" ? "Copied content" : "Copy contents"}
            onClick={onCopyContent}
            disabled={!file || file.binary}
          >
            <Copy size={14} />
            <span className="code-inspector__btn-label">File</span>
          </button>
          {showClose && (
            <button
              type="button"
              className="code-inspector__icon-btn code-inspector__close"
              title="Close (Esc)"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      {copyError && (
        <div className="code-inspector__copy-error" role="status">
          {copyError}
        </div>
      )}

      <div className="code-inspector__body" ref={bodyRef}>
        {loading && <SkeletonRows />}

        {!loading && error && !isNotFound && (
          <div className="code-inspector__error" role="alert">
            <div className="code-inspector__error-title">
              Failed to read file
            </div>
            <pre className="code-inspector__error-msg">{error}</pre>
            <button
              type="button"
              className="code-inspector__retry"
              onClick={onRetry}
            >
              <ArrowsClockwise size={12} />
              <span>Retry</span>
            </button>
          </div>
        )}

        {!loading && isNotFound && (
          <div className="code-inspector__empty">
            File not found at this ref
          </div>
        )}

        {!loading && !error && file && file.binary && (
          <div className="code-inspector__binary">
            <div className="code-inspector__binary-stat">
              <span className="code-inspector__binary-tag">Binary</span>
              <span className="code-inspector__binary-sep">·</span>
              <span>{formatBytes(file.size)}</span>
              {file.truncated && (
                <>
                  <span className="code-inspector__binary-sep">·</span>
                  <span>Truncated</span>
                </>
              )}
            </div>
            <pre className="code-inspector__hex">
              {toHexPreview(file.content)}
            </pre>
          </div>
        )}

        {!loading && !error && file && !file.binary && (
          <>
            {file.truncated && (
              <div className="code-inspector__warning-chip">
                Truncated — showing {formatBytes(file.content.length)} /{" "}
                {formatBytes(file.size)}
              </div>
            )}
            <pre className="code-inspector__code" aria-label="File contents">
              {lines.map((text, idx) => {
                const lineNo = idx + 1;
                const kind = patchMap.get(lineNo);
                const highlighted =
                  !!highlightRange &&
                  lineNo >= highlightRange[0] &&
                  lineNo <= highlightRange[1];
                const isAnchor =
                  !!highlightRange && lineNo === highlightRange[0];
                const cls = [
                  "code-inspector__line",
                  kind ? `code-inspector__line--${kind}` : "",
                  highlighted ? "code-inspector__line--marked" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={lineNo}
                    className={cls}
                    ref={isAnchor ? highlightAnchorRef : undefined}
                  >
                    <span
                      className="code-inspector__lineno"
                      style={{ width: `${lineNumberWidth}ch` }}
                      aria-hidden="true"
                    >
                      {lineNo}
                    </span>
                    <span className="code-inspector__line-text">
                      {text === "" ? " " : text}
                    </span>
                  </div>
                );
              })}
            </pre>
          </>
        )}
      </div>
    </>
  );
}

function SkeletonRows() {
  // Varied widths so it doesn't look like a blocky placeholder grid.
  const widths = [62, 84, 48, 76, 92, 54];
  return (
    <div className="code-inspector__skeletons">
      {widths.map((w, i) => (
        <div
          key={i}
          className="code-inspector__skel-row motion-shimmer"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}
