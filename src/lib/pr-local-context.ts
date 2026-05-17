import { ipc, type GitStatus, type PullRequestDetail, type Worktree, type WorktreeSummaryInput } from "./ipc";
import {
  mapRemotePrToLocalWorkspace,
  type LocalPrBranchMapping,
} from "./pr-local-mapping";
import { loadRepositories } from "./workspace-data";

export interface PullRequestLocalContext {
  mapping: LocalPrBranchMapping;
  status: GitStatus | null;
  worktrees: Worktree[];
  matchingWorktree: Worktree | null;
  compareInput: WorktreeSummaryInput | null;
}

export async function loadPullRequestLocalContext(
  detail: PullRequestDetail,
): Promise<PullRequestLocalContext> {
  const repositories = await loadRepositories();
  const mapping = mapRemotePrToLocalWorkspace(repositories, {
    provider: detail.provider,
    repoFullName: detail.provider === "github" ? detail.repoFullName : undefined,
    projectPath: detail.provider === "gitlab" ? detail.repoFullName : undefined,
    sourceBranch: detail.source_branch,
    targetBranch: detail.target_branch,
    updatedAt: detail.updated_at,
  });

  const repoPath = mapping.status.localPath;
  if (!repoPath) {
    return {
      mapping,
      status: null,
      worktrees: [],
      matchingWorktree: null,
      compareInput: null,
    };
  }

  const [status, worktrees] = await Promise.all([
    ipc.getGitStatus(repoPath, { mode: "lite" }).catch(() => null),
    ipc.getWorktrees(repoPath).catch(() => [] as Worktree[]),
  ]);
  const matchingWorktree =
    worktrees.find((worktree) => worktree.branch === detail.source_branch) ??
    worktrees.find((worktree) => worktree.path === repoPath) ??
    null;
  const compareInput = matchingWorktree
    ? await ipc
        .getWorktreeSummaryInput(repoPath, matchingWorktree.path, detail.target_branch)
        .catch(() => null)
    : null;

  return {
    mapping,
    status,
    worktrees,
    matchingWorktree,
    compareInput,
  };
}
