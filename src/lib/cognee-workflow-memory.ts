import type {
  MemoryRecallItem,
  MemoryRecallQuery,
  MemoryRememberInput,
} from "./ipc";

export const COGNEE_WORKSPACE_DATASET = "overcode_memory";

const DEFAULT_RECALL_LIMIT = 5;
const MAX_RECALL_REFERENCES = 12;
const MAX_RECALL_CONTEXT_CHARS = 4_000;
const MAX_MEMORY_SUMMARY_CHARS = 1_600;
const MAX_MEMORY_TAGS = 16;
const MAX_MEMORY_PATHS = 10;
const REDACTED_SECRET = "[redacted secret]";
const SECRET_ASSIGNMENT_PATTERN =
  /\b[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_SECRET_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g;
const COMMON_AI_KEY_PATTERN =
  /\b(?:sk-(?:or-)?|sk-ant-|AIza)[A-Za-z0-9._~+/=-]{12,}/g;
const SAFE_METADATA_KEYS = new Set([
  "acceptance_check_count",
  "ahead",
  "base",
  "behind",
  "blocker_count",
  "check_count",
  "confidence",
  "dirty_files",
  "dirty_workspace_count",
  "failing_checks",
  "file_count",
  "hunk_count",
  "key_module_count",
  "label",
  "likely_module_count",
  "module_count",
  "overall",
  "pr_count",
  "priority",
  "question_count",
  "readiness",
  "risk",
  "risk_count",
  "suggested_check_count",
  "target",
  "test_count",
]);

export interface CogneeWorkflowSubject {
  source: string;
  repoId?: string;
  repoName?: string;
  branch?: string;
  paths?: string[];
  issueNumber?: number;
  prNumber?: number;
  commitHash?: string;
  stashRef?: string;
  subject?: string;
  tags?: string[];
  limit?: number;
}

export interface CogneeSummaryMemoryInput extends CogneeWorkflowSubject {
  title: string;
  summary: string;
  data?: Record<string, unknown>;
}

export function buildCogneeRecallRequest(
  subject: CogneeWorkflowSubject,
): MemoryRecallQuery | null {
  const source = normalizeText(subject.source);
  const repo = normalizeText(subject.repoName) || normalizeText(subject.repoId);
  if (!source || !repo) return null;

  const branch = normalizeText(subject.branch);
  const paths = normalizeList(subject.paths, MAX_MEMORY_PATHS);
  const tags = normalizeList(subject.tags, 6);
  const parts = [`Recall Overcode memory for ${source} in repo ${repo}`];

  if (branch) parts.push(`on branch ${branch}`);
  if (paths.length > 0) parts.push(`touching ${paths.join(", ")}`);
  if (subject.issueNumber) parts.push(`for issue #${subject.issueNumber}`);
  if (subject.prNumber) parts.push(`for PR #${subject.prNumber}`);
  if (subject.commitHash) parts.push(`around commit ${subject.commitHash.slice(0, 12)}`);
  if (subject.stashRef) parts.push(`around stash ${subject.stashRef}`);
  if (subject.subject) parts.push(`about ${normalizeText(subject.subject)}`);
  if (tags.length > 0) parts.push(`tagged ${tags.join(", ")}`);

  const filters: NonNullable<MemoryRecallQuery["filters"]> = {};
  if (subject.repoId) filters.repo = subject.repoId;
  if (branch) filters.branch = branch;

  return {
    query: `${parts.join(" ")}.`,
    datasets: [COGNEE_WORKSPACE_DATASET],
    limit: subject.limit ?? DEFAULT_RECALL_LIMIT,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  };
}

/** The first readable highlight, or null — for quiet one-line UI surfaces. */
export function extractCogneeMemoryHighlight(context: string): string | null {
  return extractCogneeMemoryHighlights(context)[0] ?? null;
}

/** Every readable content block from a recalled context, in order — the full
 * memory for expanded views. Prefers the content between
 * __node_content_start/end__ markers; otherwise strips the graph scaffolding
 * prefixes. */
export function extractCogneeMemoryHighlights(context: string): string[] {
  if (!context.trim()) return [];

  const blocks = Array.from(
    context.matchAll(/__node_content_start__([\s\S]*?)(?:__node_content_end__|$)/g),
    (match) => match[1].replace(/\s+/g, " ").trim(),
  ).filter(Boolean);
  if (blocks.length > 0) {
    // Raw record JSON is a storage artifact, not a status report; hide it
    // whenever prose blocks exist.
    const prose = blocks.filter((block) => !block.startsWith("{"));
    return prose.length > 0 ? prose : blocks;
  }

  const SCAFFOLD_PREFIXES = [
    /^Memory cognee:\d+:\s*/i,
    /^Memory [\w-]+:\s*/i,
    /^Memory result \d+\s*/i,
    /^Nodes?:\s*/i,
    /^Node:\s*/i,
  ];
  const cleaned = context
    .split("\n")
    .map((line) => {
      let value = line.trim();
      let changed = true;
      while (changed) {
        changed = false;
        for (const prefix of SCAFFOLD_PREFIXES) {
          const next = value.replace(prefix, "");
          if (next !== value) {
            value = next.trim();
            changed = true;
          }
        }
      }
      return value;
    })
    .filter((line) => line && !line.startsWith("__node_content"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned ? [cleaned] : [];
}

export function formatCogneeRecallContext(
  items: MemoryRecallItem[],
  options: { maxChars?: number } = {},
): string {
  const maxChars = Math.max(80, options.maxChars ?? MAX_RECALL_CONTEXT_CHARS);
  const lines = items
    .filter((item) => item.summary.trim() || item.title.trim())
    .map((item) => {
      const refs = extractCogneeMemoryReferences(item);
      return [
        `Memory ${item.id}: ${redactSensitiveText(item.title)}`,
        redactSensitiveText(item.summary),
        refs.length > 0 ? `References: ${refs.join(", ")}` : "",
      ].filter(Boolean).join("\n");
    });

  return boundText(lines.join("\n\n"), maxChars);
}

export function buildCogneeMemoryPromptSection(context: string | undefined): string {
  const trimmed = context?.trim();
  if (!trimmed) return "";
  return `COGNEE MEMORY CONTEXT:\n${boundText(
    redactSensitiveText(trimmed),
    MAX_RECALL_CONTEXT_CHARS,
  )}`;
}

export function buildCogneeSummaryMemoryInput(
  input: CogneeSummaryMemoryInput,
): MemoryRememberInput {
  const source = normalizeText(input.source);
  const repo = normalizeText(input.repoName) || normalizeText(input.repoId) || "workspace";
  const paths = normalizeList(input.paths, MAX_MEMORY_PATHS);
  const metadata = sanitizeMetadata(input);
  const idParts = [
    source,
    input.repoId,
    input.repoName,
    input.branch,
    input.issueNumber,
    input.prNumber,
    input.commitHash,
    input.stashRef,
    input.subject,
    input.title,
    input.summary,
  ].filter((value) => value !== undefined && value !== null).join(":");

  return {
    datasetName: COGNEE_WORKSPACE_DATASET,
    documents: [
      {
        id: `${slugify(source || "workflow")}:${hashMemoryId(idParts)}`,
        kind: documentKindForSource(source),
        title: boundText(
          redactSensitiveText(normalizeText(input.title) || `Cognee memory for ${repo}`),
          180,
        ),
        summary: boundText(redactSensitiveText(input.summary), MAX_MEMORY_SUMMARY_CHARS),
        tags: buildTags(source, input.tags, paths),
        metadata,
      },
    ],
  };
}

export function extractCogneeMemoryReferences(item: MemoryRecallItem): string[] {
  const metadata = item.metadata ?? {};
  const refs = [
    metadata.changed_paths,
    metadata.paths,
    metadata.file,
    metadata.path,
    metadata.ref,
    metadata.url,
  ];
  return normalizeList(
    refs.flatMap(referenceValues),
    MAX_RECALL_REFERENCES,
  );
}

function sanitizeMetadata(
  input: CogneeSummaryMemoryInput,
): Record<string, string | number | boolean | null> {
  const metadata: Record<string, string | number | boolean | null> = {
    source: input.source,
    repo: input.repoId ?? input.repoName ?? null,
    repository: input.repoName ?? input.repoId ?? null,
  };

  if (input.branch) metadata.branch = input.branch;
  if (input.issueNumber) metadata.issue = input.issueNumber;
  if (input.prNumber) metadata.pull_request = input.prNumber;
  if (input.commitHash) metadata.commit = input.commitHash.slice(0, 40);
  if (input.stashRef) metadata.stash = input.stashRef;
  if (input.subject) metadata.subject = boundText(redactSensitiveText(input.subject), 240);

  const paths = normalizeList(input.paths, MAX_MEMORY_PATHS);
  if (paths.length > 0) metadata.changed_paths = paths.join(",");

  for (const [key, value] of Object.entries(input.data ?? {})) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if (typeof value === "string") metadata[key] = boundText(redactSensitiveText(value), 240);
    else if (typeof value === "number" && Number.isFinite(value)) metadata[key] = value;
    else if (typeof value === "boolean" || value === null) metadata[key] = value;
  }

  return metadata;
}

function buildTags(source: string, tags: string[] | undefined, paths: string[]): string[] {
  return normalizeList(
    [
      "cognee",
      slugify(source),
      "ai-output",
      ...paths,
      ...(tags ?? []),
    ],
    MAX_MEMORY_TAGS,
  );
}

function documentKindForSource(source: string): MemoryRememberInput["documents"][number]["kind"] {
  const normalized = source.toLowerCase();
  if (normalized.includes("pr") || normalized.includes("pull request")) return "pull_request";
  if (normalized.includes("issue")) return "issue";
  if (normalized.includes("repo")) return "repository";
  return "summary";
}

function referenceValues(value: unknown): string[] {
  if (typeof value === "string") return value.split(",");
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? item.split(",") : []));
  }
  return [];
}

function normalizeList(values: Array<string | undefined> | undefined, limit: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    output.push(normalized);
    seen.add(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function boundText(value: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(SECRET_ASSIGNMENT_PATTERN, REDACTED_SECRET)
    .replace(BEARER_SECRET_PATTERN, REDACTED_SECRET)
    .replace(COMMON_AI_KEY_PATTERN, REDACTED_SECRET);
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "memory"
  );
}

function hashMemoryId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
