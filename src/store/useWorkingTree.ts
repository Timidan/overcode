import { create } from "zustand";

/** Dirty working-tree paths per repo path, published by UncommittedFiles so
 * sibling panes (e.g. StashList overlap notes) can react without refetching. */
interface WorkingTreeState {
  dirtyPathsByRepo: Record<string, string[]>;
  setDirtyPaths: (repoPath: string, paths: string[]) => void;
}

export const useWorkingTree = create<WorkingTreeState>((set) => ({
  dirtyPathsByRepo: {},
  setDirtyPaths: (repoPath, paths) =>
    set((state) => ({
      dirtyPathsByRepo: { ...state.dirtyPathsByRepo, [repoPath]: paths },
    })),
}));
