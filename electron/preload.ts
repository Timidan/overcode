import { contextBridge, ipcRenderer } from "electron";

const api = {
  auth: {
    connect: (provider: "github" | "gitlab") =>
      ipcRenderer.invoke("auth:connect", provider),
    disconnect: (provider: "github" | "gitlab") =>
      ipcRenderer.invoke("auth:disconnect", provider),
    status: () => ipcRenderer.invoke("auth:status"),
  },

  git: {
    scan: (directories: string[]) =>
      ipcRenderer.invoke("git:scan", directories),
    scanCandidates: (directories: string[]) =>
      ipcRenderer.invoke("git:scan", directories, { mode: "candidates" }),
    status: (repoPath: string, options?: unknown) =>
      ipcRenderer.invoke("git:status", repoPath, options),
    log: (repoPath: string, maxCount: number) =>
      ipcRenderer.invoke("git:log", repoPath, maxCount),
    show: (repoPath: string, hash: string) =>
      ipcRenderer.invoke("git:log", repoPath, 1, hash),
    commitStat: (repoPath: string, hash: string) =>
      ipcRenderer.invoke("git:log", repoPath, 1, hash, { mode: "stat" }),
    diff: async (repoPath: string) => {
      const status = await ipcRenderer.invoke("git:status", repoPath, { mode: "diff" });
      return status?.diff ?? "";
    },
    stashes: (repoPath: string) => ipcRenderer.invoke("git:stashes", repoPath),
    stashShow: (repoPath: string, stashRef: string) =>
      ipcRenderer.invoke("git:stash-show", repoPath, stashRef),
    worktrees: (repoPath: string, options?: unknown) =>
      ipcRenderer.invoke("git:worktrees", repoPath, options),
    file: (repoPath: string, filePath: string, options?: unknown) =>
      ipcRenderer.invoke("git:file", repoPath, filePath, options),
    divergence: (repoPath: string, branch: string) =>
      ipcRenderer.invoke("git:divergence", repoPath, branch),
    push: (repoPath: string, remote: string, branch: string) =>
      ipcRenderer.invoke("git:push", repoPath, remote, branch),
    pull: (repoPath: string, remote: string, branch: string) =>
      ipcRenderer.invoke("git:pull", repoPath, remote, branch),
    commit: (repoPath: string, message: string) =>
      ipcRenderer.invoke("git:commit", repoPath, message),
    stashPop: (repoPath: string, stashRef: string) =>
      ipcRenderer.invoke("git:stash-pop", repoPath, stashRef),
    stashDrop: (repoPath: string, stashRef: string) =>
      ipcRenderer.invoke("git:stash-drop", repoPath, stashRef),
  },

  github: {
    repos: () => ipcRenderer.invoke("github:repos"),
    issues: (repoFullName?: string) =>
      ipcRenderer.invoke("github:issues", repoFullName ?? ""),
    issueDetail: (repoFullName: string, issueNumber: number) =>
      ipcRenderer.invoke("github:issues", repoFullName, { mode: "detail", number: issueNumber }),
    prs: (repoFullName: string) =>
      ipcRenderer.invoke("github:prs", repoFullName),
    prDetail: (repoFullName: string, prNumber: number) =>
      ipcRenderer.invoke("github:prs", repoFullName, { mode: "detail", number: prNumber }),
    pipelines: (repoFullName: string) =>
      ipcRenderer.invoke("github:pipelines", repoFullName),
    comment: (repoFullName: string, prNumber: number, body: string) =>
      ipcRenderer.invoke("github:comment", repoFullName, prNumber, body),
  },

  gitlab: {
    projects: () => ipcRenderer.invoke("gitlab:projects"),
    mrs: (projectId: string) => ipcRenderer.invoke("gitlab:mrs", projectId),
    mrDetail: (projectId: string, mrIid: number) =>
      ipcRenderer.invoke("gitlab:mrs", projectId, { mode: "detail", iid: mrIid }),
    issues: (projectId: string) =>
      ipcRenderer.invoke("gitlab:issues", projectId),
    issueDetail: (projectId: string, issueIid: number) =>
      ipcRenderer.invoke("gitlab:issues", projectId, { mode: "detail", number: issueIid }),
    pipelines: (projectId: string) =>
      ipcRenderer.invoke("gitlab:pipelines", projectId),
    comment: (projectId: string, mrIid: number, body: string) =>
      ipcRenderer.invoke("gitlab:comment", projectId, mrIid, body),
  },

  ai: {
    complete: (systemPrompt: string, userPrompt: string) =>
      ipcRenderer.invoke("ai:complete", systemPrompt, userPrompt),
    status: () => ipcRenderer.invoke("ai:status"),
    providers: () => ipcRenderer.invoke("ai:providers"),
    models: (providerId: string, options?: { force?: boolean }) =>
      ipcRenderer.invoke("ai:models", { providerId, options }),
    setActiveProvider: (providerId: string, modelId?: string) =>
      ipcRenderer.invoke("ai:set-active-provider", { providerId, modelId }),
  },

  memory: {
    remember: (payload: unknown) =>
      ipcRenderer.invoke("memory:remember", payload),
    recall: (payload: unknown) => ipcRenderer.invoke("memory:recall", payload),
    improve: (payload: unknown) =>
      ipcRenderer.invoke("memory:improve", payload),
    forget: (payload: unknown) => ipcRenderer.invoke("memory:forget", payload),
    status: () => ipcRenderer.invoke("memory:status"),
  },

  store: {
    get: (key: string) => ipcRenderer.invoke("store:get", key),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke("store:set", key, value),
    list: () => ipcRenderer.invoke("store:list"),
  },

  settings: {
    saveAIProvider: (update: unknown) =>
      ipcRenderer.invoke("settings:save-ai-provider", update),
    aiProviderStatus: (providerId?: string) =>
      ipcRenderer.invoke("settings:ai-provider-status", { providerId }),
  },
};

contextBridge.exposeInMainWorld("api", api);

export type API = typeof api;
