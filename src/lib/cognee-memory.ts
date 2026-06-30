import type {
  MemoryReference,
  OvercodeMemoryDocument,
  OvercodeMemoryEdge,
  OvercodeMemoryEntity,
} from "./cognee-memory-types";

const MAX_SUMMARY_LENGTH = 280;

interface WorktreeRecallQueryInput {
  repo: string;
  branch?: string;
  modules?: string[];
  issueIds?: string[];
  riskKinds?: string[];
}

interface WorktreeMemoryItemInput {
  id: string;
  summary: string;
  refs?: MemoryReference[];
}

interface WorktreeModuleMemoryInput {
  path: string;
  summary: string;
}

interface WorktreeMemoryDocumentInput {
  repo: string;
  worktreeId: string;
  branch?: string;
  createdAt: string;
  summary: string;
  modules?: WorktreeModuleMemoryInput[];
  issues?: WorktreeMemoryItemInput[];
  decisions?: WorktreeMemoryItemInput[];
  risks?: WorktreeMemoryItemInput[];
  aiOutputs?: WorktreeMemoryItemInput[];
  sourceSnippets?: string[];
  diff?: string;
}

export function normalizeModulePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");

  if (!trimmed) {
    return ".";
  }

  const parts: string[] = [];

  for (const part of trimmed.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.length > 0 ? parts.join("/") : ".";
}

export function moduleKeyFromPath(path: string): string {
  return `module:${normalizeModulePath(path)}`;
}

export function buildWorktreeRecallQuery(input: WorktreeRecallQueryInput): string {
  const modules = [...(input.modules ?? [])].map(normalizeModulePath).sort();
  const issueIds = [...(input.issueIds ?? [])].sort();
  const riskKinds = [...(input.riskKinds ?? [])].sort();
  const parts = [`Recall Overcode memory for repo ${input.repo}`];

  if (input.branch) {
    parts.push(`on branch ${input.branch}`);
  }

  if (modules.length > 0) {
    parts.push(`touching modules ${modules.join(", ")}`);
  }

  if (issueIds.length > 0) {
    parts.push(`addressing issues ${issueIds.join(", ")}`);
  }

  if (riskKinds.length > 0) {
    parts.push(`with risks ${riskKinds.join(", ")}`);
  }

  return `${parts.join(" ")}.`;
}

export function buildImpactMemoryContext(memories: OvercodeMemoryDocument[]): string {
  return memories
    .map((memory) => {
      const lines = [`Memory ${memory.id}: ${boundSummary(memory.metadata.summary)}`];

      for (const entity of memory.entities) {
        const refs = formatRefs(entity.refs);
        lines.push(
          `- ${entity.kind} ${entity.label}: ${boundSummary(entity.summary)}${
            refs ? ` ${refs}` : ""
          }`,
        );
      }

      for (const edge of memory.edges) {
        lines.push(
          `- ${edge.kind}: ${edge.from} -> ${edge.to}${
            edge.summary ? ` (${edge.summary})` : ""
          }`,
        );
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

export function buildWorktreeMemoryDocument(
  input: WorktreeMemoryDocumentInput,
): OvercodeMemoryDocument {
  const documentId = `memory:${input.repo}:${input.worktreeId}`;
  const repoId = `repo:${input.repo}`;
  const worktreeId = `worktree:${input.repo}:${input.worktreeId}`;
  const entities: OvercodeMemoryEntity[] = [
    {
      id: repoId,
      kind: "repo",
      label: input.repo,
      summary: boundSummary(`Repository ${input.repo}.`),
    },
    {
      id: worktreeId,
      kind: "worktree",
      label: input.branch ?? input.worktreeId,
      summary: boundSummary(input.summary),
    },
  ];
  const edges: OvercodeMemoryEdge[] = [
    {
      from: worktreeId,
      to: repoId,
      kind: "LOCATED_IN",
    },
  ];

  for (const module of input.modules ?? []) {
    const path = normalizeModulePath(module.path);
    const moduleId = moduleKeyFromPath(path);
    entities.push({
      id: moduleId,
      kind: "module",
      label: path,
      summary: boundSummary(module.summary),
      refs: [{ kind: "file", value: path }],
    });
    edges.push({
      from: worktreeId,
      to: moduleId,
      kind: "TOUCHES",
    });
  }

  addItemEntities({
    entities,
    edges,
    items: input.issues,
    kind: "issue",
    idPrefix: "issue",
    edgeKind: "ADDRESSES",
    edgeFromItem: false,
    targetId: worktreeId,
  });
  addItemEntities({
    entities,
    edges,
    items: input.decisions,
    kind: "decision",
    idPrefix: "decision",
    edgeKind: "MOTIVATED_BY",
    edgeFromItem: true,
    targetId: worktreeId,
  });
  addItemEntities({
    entities,
    edges,
    items: input.risks,
    kind: "risk",
    idPrefix: "risk",
    edgeKind: "FLAGS",
    edgeFromItem: true,
    targetId: worktreeId,
  });
  addItemEntities({
    entities,
    edges,
    items: input.aiOutputs,
    kind: "ai_output",
    idPrefix: "ai_output",
    edgeKind: "ANALYZES",
    edgeFromItem: true,
    targetId: worktreeId,
  });

  return {
    id: documentId,
    metadata: {
      repo: input.repo,
      branch: input.branch,
      createdAt: input.createdAt,
      summary: boundSummary(input.summary),
    },
    entities,
    edges,
  };
}

function addItemEntities(args: {
  entities: OvercodeMemoryEntity[];
  edges: OvercodeMemoryEdge[];
  items?: WorktreeMemoryItemInput[];
  kind: OvercodeMemoryEntity["kind"];
  idPrefix: string;
  edgeKind: OvercodeMemoryEdge["kind"];
  edgeFromItem: boolean;
  targetId: string;
}) {
  for (const item of args.items ?? []) {
    const itemId = `${args.idPrefix}:${item.id}`;
    args.entities.push({
      id: itemId,
      kind: args.kind,
      label: item.id,
      summary: boundSummary(item.summary),
      refs: item.refs,
    });
    args.edges.push({
      from: args.edgeFromItem ? itemId : args.targetId,
      to: args.edgeFromItem ? args.targetId : itemId,
      kind: args.edgeKind,
    });
  }
}

function boundSummary(summary: string): string {
  const normalized = summary.trim().replace(/\s+/g, " ");

  if (normalized.length <= MAX_SUMMARY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SUMMARY_LENGTH - 3)}...`;
}

function formatRefs(refs: MemoryReference[] | undefined): string {
  if (!refs?.length) {
    return "";
  }

  return refs.map((ref) => `[${ref.kind}:${ref.value}]`).join(" ");
}
