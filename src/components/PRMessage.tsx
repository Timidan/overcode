import { useMemo, type AnchorHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { preprocessForMarkdown } from "./pr-message-preprocess";
import "./PRMessage.css";

interface Props {
  body: string;
  /** Optional callback when the user clicks a `path/to/file.ts:42` reference. */
  onJumpToFile?: (filePath: string, line?: number) => void;
}

/**
 * Render a GitHub-flavoured PR/MR comment body with proper markdown,
 * tables, code fences, inline code, links, images, blockquotes, plus
 * our own highlight passes for:
 *   • @mentions     → styled chip linking to provider profile
 *   • file:line refs → clickable inline tokens that call onJumpToFile
 *
 * Raw remote HTML is escaped before our pre-processing inserts custom
 * <mark> placeholders. `rehype-raw` is kept only so those placeholders
 * survive the markdown pipeline and can be mapped to React nodes.
 */
export function PRMessage({ body, onJumpToFile }: Props) {
  const preprocessed = useMemo(() => preprocessForMarkdown(body), [body]);

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
