import {
  ipc,
  type GitHubIssueDetail,
  type GitStatus,
} from "./ipc";
import {
  mapRemotePrToLocalWorkspace,
  type LocalPrBranchMapping,
  type PrMappingProvider,
} from "./pr-local-mapping";
import { summarizeGitHubIssueStructured, type IssueTriagePayload } from "./ai-features";
import { loadRepositories } from "./workspace-data";

export type IssueLocalContextProvider = PrMappingProvider;

// Renamed from `GitHubIssueLocalContext` to reflect provider-agnostic use.
// The old name is preserved as an alias for back-compat with existing
// import sites.
export interface IssueLocalContext {
  mapping: LocalPrBranchMapping;
  status: GitStatus | null;
  triagePayload: IssueTriagePayload;
}

export type GitHubIssueLocalContext = IssueLocalContext;

export async function loadIssueLocalContext(
  provider: IssueLocalContextProvider,
  repoFullName: string,
  issue: GitHubIssueDetail,
): Promise<IssueLocalContext> {
  const repositories = await loadRepositories();
  // pr-local-mapping already handles platform-name fallback when the
  // remote URL doesn't match, which is exactly the heuristic we want for
  // GitLab projects whose `path_with_namespace` may differ from the local
  // git remote URL the user pinned. Provider is passed through so
  // platform-name matching is filtered to the right backend.
  const mapping = mapRemotePrToLocalWorkspace(repositories, {
    provider,
    repoFullName,
    updatedAt: issue.updated_at,
  });

  const localPath = mapping.status.localPath;
  const status = localPath
    ? await ipc.getGitStatus(localPath).catch(() => null)
    : null;

  return {
    mapping,
    status,
    triagePayload: {
      issue,
      repoName: repoFullName,
      repoTree: status?.fileTree,
      packageSummary: status?.packageSummary,
      readme: status?.readme,
      localChangedFiles: status?.files.map((file) => file.path),
    },
  };
}

// Back-compat wrapper — existing GitHub call sites import this name.
export function loadGitHubIssueLocalContext(
  repoFullName: string,
  issue: GitHubIssueDetail,
): Promise<IssueLocalContext> {
  return loadIssueLocalContext("github", repoFullName, issue);
}

export async function summarizeIssueWithLocalContext(
  provider: IssueLocalContextProvider,
  repoFullName: string,
  issue: GitHubIssueDetail,
  options: { force?: boolean } = {},
) {
  const context = await loadIssueLocalContext(provider, repoFullName, issue);
  return summarizeGitHubIssueStructured(context.triagePayload, options);
}

export function summarizeGitHubIssueWithLocalContext(
  repoFullName: string,
  issue: GitHubIssueDetail,
  options: { force?: boolean } = {},
) {
  return summarizeIssueWithLocalContext("github", repoFullName, issue, options);
}
