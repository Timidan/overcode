import type { WorkspaceRepository } from "./workspace-data";

export type PrMappingProvider = "github" | "gitlab";

export type PrLocalMappingState =
  | "matched"
  | "likely"
  | "ambiguous"
  | "remote-only";

export type PrLocalMappingConfidence = "high" | "medium" | "low" | "none";

export interface RemotePrBranchMetadata {
  provider: PrMappingProvider;
  repoFullName?: string | null;
  projectPath?: string | null;
  path_with_namespace?: string | null;
  sourceBranch?: string | null;
  source_branch?: string | null;
  head?: string | null;
  targetBranch?: string | null;
  target_branch?: string | null;
  base?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
}

export interface NormalizedRemotePrBranch {
  provider: PrMappingProvider;
  repoKey: string;
  repoName: string;
  sourceBranch: string;
  targetBranch: string;
  updatedAt: string | null;
}

export interface LocalPrBranchMappingStatus {
  state: PrLocalMappingState;
  confidence: PrLocalMappingConfidence;
  repoKey: string;
  sourceBranch: string;
  targetBranch: string;
  updatedAt: string | null;
  branchLikelyLocal: boolean;
  needsGitStatus: boolean;
  localRepoId: string | null;
  localPath: string | null;
  reason: string;
}

export interface LocalPrBranchMapping {
  remote: NormalizedRemotePrBranch;
  candidate: WorkspaceRepository | null;
  candidates: WorkspaceRepository[];
  branchLikelyLocal: boolean;
  status: LocalPrBranchMappingStatus;
}

type MatchKind = "remote-url" | "platform-name";

interface RankedCandidate {
  repository: WorkspaceRepository;
  kind: MatchKind;
}

export function normalizeRemotePrBranch(
  remote: RemotePrBranchMetadata,
): NormalizedRemotePrBranch {
  const repoKey = normalizeRepoKey(
    remote.repoFullName ?? remote.projectPath ?? remote.path_with_namespace ?? "",
  );
  const sourceBranch = normalizeBranchName(
    remote.sourceBranch ?? remote.source_branch ?? remote.head ?? "",
  );
  const targetBranch = normalizeBranchName(
    remote.targetBranch ?? remote.target_branch ?? remote.base ?? "",
  );

  return {
    provider: remote.provider,
    repoKey,
    repoName: repoNameFromKey(repoKey),
    sourceBranch,
    targetBranch,
    updatedAt: remote.updatedAt ?? remote.updated_at ?? null,
  };
}

export function mapRemotePrToLocalWorkspace(
  repositories: WorkspaceRepository[],
  remote: RemotePrBranchMetadata,
): LocalPrBranchMapping {
  return mapNormalizedRemotePrToLocalWorkspace(
    repositories,
    normalizeRemotePrBranch(remote),
  );
}

export function mapRemotePrsToLocalWorkspaces(
  repositories: WorkspaceRepository[],
  remotes: RemotePrBranchMetadata[],
): LocalPrBranchMapping[] {
  return remotes.map((remote) => mapRemotePrToLocalWorkspace(repositories, remote));
}

export function mapNormalizedRemotePrToLocalWorkspace(
  repositories: WorkspaceRepository[],
  remote: NormalizedRemotePrBranch,
): LocalPrBranchMapping {
  const ranked = rankCandidates(repositories, remote);
  const candidates = ranked.map((candidate) => candidate.repository);
  const directMatch = ranked.find((candidate) => candidate.kind === "remote-url");
  const directCount = ranked.filter((candidate) => candidate.kind === "remote-url").length;
  const candidate =
    (directCount === 1 ? directMatch?.repository : null) ??
    (ranked.length === 1 ? ranked[0].repository : null);
  const branchLikelyLocal = isBranchLikelyLocal(remote, candidate, directMatch?.kind);
  const status = buildStatus(remote, candidate, ranked, branchLikelyLocal);

  return {
    remote,
    candidate,
    candidates,
    branchLikelyLocal,
    status,
  };
}

export function remoteOwnerRepoKey(remoteUrl: string | undefined): string {
  return normalizeRepoKey(pathFromRemoteUrl(remoteUrl ?? ""));
}

function rankCandidates(
  repositories: WorkspaceRepository[],
  remote: NormalizedRemotePrBranch,
): RankedCandidate[] {
  if (!remote.repoKey) return [];

  const direct = repositories
    .filter((repository) => remoteOwnerRepoKey(repository.remote_url) === remote.repoKey)
    .map((repository): RankedCandidate => ({ repository, kind: "remote-url" }));

  if (direct.length > 0) return direct;

  const byPlatformAndName = repositories
    .filter(
      (repository) =>
        repository.platform === remote.provider &&
        normalizeRepoName(repository.name) === normalizeRepoName(remote.repoName),
    )
    .map((repository): RankedCandidate => ({ repository, kind: "platform-name" }));

  return byPlatformAndName;
}

function buildStatus(
  remote: NormalizedRemotePrBranch,
  candidate: WorkspaceRepository | null,
  ranked: RankedCandidate[],
  branchLikelyLocal: boolean,
): LocalPrBranchMappingStatus {
  const directCount = ranked.filter((item) => item.kind === "remote-url").length;

  if (!candidate && ranked.length > 1) {
    return status(
      remote,
      null,
      "ambiguous",
      "low",
      branchLikelyLocal,
      "Multiple local workspaces match this remote repository.",
    );
  }

  if (!candidate) {
    return status(
      remote,
      null,
      "remote-only",
      "none",
      false,
      "No local workspace matches the remote repository.",
    );
  }

  if (directCount === 1) {
    return status(
      remote,
      candidate,
      "matched",
      "high",
      branchLikelyLocal,
      "Remote URL maps to this local workspace.",
    );
  }

  return status(
    remote,
    candidate,
    "likely",
    "medium",
    branchLikelyLocal,
    "Provider and repository name uniquely map to this local workspace.",
  );
}

function status(
  remote: NormalizedRemotePrBranch,
  candidate: WorkspaceRepository | null,
  state: PrLocalMappingState,
  confidence: PrLocalMappingConfidence,
  branchLikelyLocal: boolean,
  reason: string,
): LocalPrBranchMappingStatus {
  return {
    state,
    confidence,
    repoKey: remote.repoKey,
    sourceBranch: remote.sourceBranch,
    targetBranch: remote.targetBranch,
    updatedAt: remote.updatedAt,
    branchLikelyLocal,
    needsGitStatus: candidate !== null,
    localRepoId: candidate?.id ?? null,
    localPath: candidate?.local_path ?? null,
    reason,
  };
}

function isBranchLikelyLocal(
  remote: NormalizedRemotePrBranch,
  candidate: WorkspaceRepository | null,
  directKind: MatchKind | undefined,
): boolean {
  if (!candidate || !remote.sourceBranch) return false;
  if (directKind === "remote-url") return true;

  return (
    candidate.platform === remote.provider &&
    normalizeRepoName(candidate.name) === normalizeRepoName(remote.repoName)
  );
}

function normalizeRepoKey(value: string): string {
  return trimGitSuffix(value)
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function normalizeRepoName(value: string): string {
  return trimGitSuffix(value.trim()).toLowerCase();
}

function normalizeBranchName(value: string): string {
  return value.trim().replace(/^refs\/heads\//, "");
}

function repoNameFromKey(repoKey: string): string {
  const parts = repoKey.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? repoKey;
}

function pathFromRemoteUrl(remoteUrl: string): string {
  const value = remoteUrl.trim();
  if (!value) return "";

  const sshMatch = value.match(/^[^@\s]+@[^:\s]+:(.+)$/);
  if (sshMatch) return sshMatch[1];

  try {
    const url = new URL(value);
    return url.pathname;
  } catch {
    return value;
  }
}

function trimGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}
