import { useMemo, type AnchorHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import "./PRMessage.css";

interface Props {
  body: string;
  /** Optional callback when the user clicks a `path/to/file.ts:42` reference. */
  onJumpToFile?: (filePath: string, line?: number) => void;
}

/**
 * Render a GitHub-flavoured PR/MR comment body with proper markdown,
 * tables, code fences, inline code, links, images, blockquotes,
 * collapsible <details>, plus our own highlight passes for:
 *   • @mentions     → styled chip linking to provider profile
 *   • file:line refs → clickable inline tokens that call onJumpToFile
 *
 * Pre-processing wraps raw matches in custom HTML markers so the GFM
 * pipeline + rehype-raw can carry them through; we then map those
 * markers to React nodes in `components.mark`.
 */
export function PRMessage({ body, onJumpToFile }: Props) {
  const preprocessed = useMemo(() => preprocess(body), [body]);

  const components = useMemo<Components>(
    () => ({
      a: AnchorRenderer,
      mark: (props) => <MentionOrFileRef {...props} onJumpToFile={onJumpToFile} />,
      pre: ({ children }) => <pre className="pr-md-pre">{children}</pre>,
      code: ({ className, children, ...rest }) => {
        const isInline = !/language-/.test(className ?? "");
        return isInline ? (
          <code className="pr-md-code-inline" {...rest}>
            {children}
          </code>
        ) : (
          <code className={`pr-md-code-block ${className ?? ""}`} {...rest}>
            {children}
          </code>
        );
      },
      table: ({ children }) => (
        <div className="pr-md-table-scroll">
          <table className="pr-md-table">{children}</table>
        </div>
      ),
      img: ({ src, alt }) =>
        src ? (
          <img className="pr-md-img" src={src} alt={alt ?? ""} loading="lazy" />
        ) : null,
      blockquote: ({ children }) => <blockquote className="pr-md-quote">{children}</blockquote>,
    }),
    [onJumpToFile],
  );

  if (!body || !body.trim()) {
    return <div className="pr-md-empty">(empty)</div>;
  }

  return (
    <div className="pr-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {preprocessed}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Anchor renderer — BrowserWindow.setWindowOpenHandler validates allowed
 * external hosts before launching the user's browser.
 */
function AnchorRenderer({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...rest}
      href={href}
      className="pr-md-link"
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (!href) return;
        // Let modifier-clicks pass through so users can open in new tab via system.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      {children}
    </a>
  );
}

interface MentionOrFileRefProps {
  className?: string;
  "data-kind"?: string;
  "data-path"?: string;
  "data-line"?: string;
  "data-user"?: string;
  children?: ReactNode;
  onJumpToFile?: (filePath: string, line?: number) => void;
}

/**
 * Render the placeholder <mark> tags emitted by preprocess() as either an
 * @mention chip or a clickable file:line reference. Anything we don't
 * recognise falls back to a plain rendering.
 */
function MentionOrFileRef({
  className,
  children,
  onJumpToFile,
  ...data
}: MentionOrFileRefProps) {
  const kind = data["data-kind"];
  if (kind === "mention") {
    const user = data["data-user"] ?? "";
    return <span className={`pr-md-mention ${className ?? ""}`.trim()}>@{user}</span>;
  }
  if (kind === "fileref") {
    const path = data["data-path"] ?? "";
    const lineStr = data["data-line"];
    const line = lineStr ? Number.parseInt(lineStr, 10) || undefined : undefined;
    return (
      <button
        type="button"
        className={`pr-md-fileref ${className ?? ""}`.trim()}
        onClick={() => onJumpToFile?.(path, line)}
        disabled={!onJumpToFile}
        title={onJumpToFile ? `Open ${path}${line ? `:${line}` : ""}` : path}
      >
        {path}
        {line ? `:${line}` : ""}
      </button>
    );
  }
  return <mark className={className}>{children}</mark>;
}

/**
 * The pre-processing pass adds machine-readable hooks to the raw markdown
 * before it hits remark/rehype, so we can render mentions and file references
 * with React components without losing any of the surrounding markdown
 * semantics (tables, code fences, etc).
 *
 * Rules avoid matching inside code spans/blocks to prevent rewriting code.
 */
function preprocess(body: string): string {
  // Track inside-code-fence state so we don't touch fenced code.
  const lines = body.split("\n");
  let inFence = false;
  const out: string[] = [];
  for (const rawLine of lines) {
    if (/^```/.test(rawLine.trim())) {
      inFence = !inFence;
      out.push(rawLine);
      continue;
    }
    if (inFence) {
      out.push(rawLine);
      continue;
    }
    out.push(decorateOutsideCode(rawLine));
  }
  return out.join("\n");
}

const MENTION_PATTERN = /(^|[^\w/])@([a-zA-Z0-9][-a-zA-Z0-9_]*(?:\[bot\])?)\b/g;
// path/segments with at least one slash and a file-ish extension, optionally :line[:col].
const FILEREF_PATTERN = /(^|[\s(`[])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)(?::(\d+))?(?=$|[\s),`\]])/g;

/**
 * Walk a single line and decorate matches outside of backtick-delimited code
 * spans. We intentionally process backticks first so inline code is preserved
 * verbatim — GitHub doesn't expand mentions inside `code` either.
 */
function decorateOutsideCode(line: string): string {
  const parts = line.split("`");
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(
        MENTION_PATTERN,
        (_match, lead: string, user: string) =>
          `${lead}<mark data-kind="mention" data-user="${escapeAttr(user)}"></mark>`,
      )
      .replace(
        FILEREF_PATTERN,
        (_match, lead: string, path: string, lineNo?: string) =>
          `${lead}<mark data-kind="fileref" data-path="${escapeAttr(path)}"${
            lineNo ? ` data-line="${escapeAttr(lineNo)}"` : ""
          }></mark>`,
      );
  }
  return parts.join("`");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
