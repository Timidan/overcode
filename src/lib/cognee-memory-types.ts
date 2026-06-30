export type MemoryEntityKind =
  | "repo"
  | "worktree"
  | "commit"
  | "pull_request"
  | "issue"
  | "stash"
  | "module"
  | "ai_output"
  | "risk"
  | "decision"
  | "convention";

export type MemoryEdgeKind =
  | "ADDRESSES"
  | "MOTIVATED_BY"
  | "TOUCHES"
  | "MODIFIES"
  | "FLAGS"
  | "LOCATED_IN"
  | "ANALYZES"
  | "SUPERSEDES"
  | "APPLIES_TO"
  | "RELATED_TO";

export interface MemoryReference {
  kind: "file" | "url" | "artifact" | "commit" | "pull_request" | "issue";
  value: string;
}

export interface OvercodeMemoryEntity {
  id: string;
  kind: MemoryEntityKind;
  label: string;
  summary: string;
  refs?: MemoryReference[];
}

export interface OvercodeMemoryEdge {
  from: string;
  to: string;
  kind: MemoryEdgeKind;
  summary?: string;
}

export interface OvercodeMemoryMetadata {
  repo: string;
  branch?: string;
  createdAt: string;
  summary: string;
}

export interface OvercodeMemoryDocument {
  id: string;
  metadata: OvercodeMemoryMetadata;
  entities: OvercodeMemoryEntity[];
  edges: OvercodeMemoryEdge[];
}
