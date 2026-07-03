/**
 * The pre-processing pass adds machine-readable hooks to the raw markdown
 * before it hits remark/rehype, so we can render mentions and file references
 * with React components without losing the surrounding markdown semantics.
 *
 * Remote HTML is escaped first; only the <mark> placeholders created here are
 * intended to survive rehype-raw.
 */
export function preprocessForMarkdown(body: string): string {
  const lines = body.split("\n");
  let inFence = false;
  const out: string[] = [];
  for (const rawLine of lines) {
    const escapedLine = escapeMarkdownHtml(rawLine);
    if (/^```/.test(rawLine.trim())) {
      inFence = !inFence;
      out.push(escapedLine);
      continue;
    }
    if (inFence) {
      out.push(escapedLine);
      continue;
    }
    out.push(decorateOutsideCode(escapedLine));
  }
  return out.join("\n");
}

const MENTION_PATTERN = /(^|[^\w/])@([a-zA-Z0-9][-a-zA-Z0-9_]*(?:\[bot\])?)\b/g;
const FILEREF_PATTERN =
  /(^|[\s(`[])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)(?::(\d+))?(?=$|[\s),`\]])/g;

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
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMarkdownHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
