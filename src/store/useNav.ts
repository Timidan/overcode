import { create } from "zustand";

export type Screen =
  | "dashboard"
  | "cognee"
  | "repo-detail"
  | "prs"
  | "pr-detail"
  | "issues"
  | "issue-detail"
  | "repositories"
  | "settings";

export interface PRDetailRef {
  provider: "github" | "gitlab";
  repoFullName: string;
  projectId?: string;
  number: number;
}

export type IssueProvider = "github" | "gitlab";

export interface IssueDetailRef {
  repoFullName: string;
  number: number;
  // `provider` defaults to "github" when omitted so existing GitHub call
  // sites stay backwards-compatible. `projectId` is required for GitLab
  // detail fetches because GitLab routes by numeric project id, not by
  // path.
  provider?: IssueProvider;
  projectId?: string;
}

interface NavState {
  screen: Screen;
  repoId: string | null;
  prRef: PRDetailRef | null;
  issueRepo: string | null;
  issueNumber: number | null;
  issueProvider: IssueProvider;
  issueProjectId: string | null;
  navigate: (screen: Screen, repoId?: string | null) => void;
  openPRDetail: (ref: PRDetailRef) => void;
  openIssueDetail: (ref: IssueDetailRef) => void;
  setIssueRepo: (repoFullName: string | null) => void;
  setIssueProvider: (provider: IssueProvider) => void;
}

export const useNav = create<NavState>((set) => ({
  screen: "dashboard",
  repoId: null,
  prRef: null,
  issueRepo: null,
  issueNumber: null,
  issueProvider: "github",
  issueProjectId: null,
  navigate: (screen, repoId = null) => set({ screen, repoId }),
  openPRDetail: (ref) => set({ screen: "pr-detail", prRef: ref }),
  openIssueDetail: (ref) =>
    set({
      screen: "issue-detail",
      issueRepo: ref.repoFullName,
      issueNumber: ref.number,
      issueProvider: ref.provider ?? "github",
      issueProjectId: ref.projectId ?? null,
    }),
  setIssueRepo: (repoFullName) => set({ issueRepo: repoFullName }),
  setIssueProvider: (provider) =>
    // Reset the repo selection because GitHub/GitLab repo identifiers live
    // in different namespaces — keeping the old value across a swap leads
    // to "no issues found" with a stale picker.
    set({ issueProvider: provider, issueRepo: null, issueProjectId: null }),
}));
