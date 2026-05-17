# Bob helped here

This file is the index for the Bob IDE task-history exports in `bob_sessions/`. Bob was the build-time tool used to scaffold, implement, debug, and document Overcode, while `watsonx.ai Granite` is the runtime AI service inside the app. The four markdown transcripts are the detailed record; this file maps those sessions to the concrete code and documentation they produced.

| Session file | Date | What Bob did in one line |
| --- | --- | --- |
| [bob_task_may-15-2026_9-02-50-pm.md](bob_task_may-15-2026_9-02-50-pm.md) | May 15, 2026, 9:02 p.m. UTC+1 | Bootstrapped the Electron architecture, IPC skeleton, store schema, mock data, and dashboard shell. |
| [bob_task_may-15-2026_9-34-11-pm.md](bob_task_may-15-2026_9-34-11-pm.md) | May 15, 2026, 9:34 p.m. UTC+1 | Landed the virtual activity feed, Granite client, AI panel, and four demo-ready AI features. |
| [bob_task_may-17-2026_9-48-09-am.md](bob_task_may-17-2026_9-48-09-am.md) | May 17, 2026, 9:48 a.m. UTC+1 | Swept the app for subtle bugs and fixed eight issues across state, watchers, errors, and validation. |
| [bob_task_may-17-2026_10-19-45-am.md](bob_task_may-17-2026_10-19-45-am.md) | May 17, 2026, 10:19 a.m. UTC+1 | Produced five Excalidraw architecture diagrams and the supporting diagram guide. |

The Bobcoin consumption screenshots are [IBM BOB USAGE 1.png](IBM%20BOB%20USAGE%201.png) and [IBM BOB USAGE 2.png](IBM%20BOB%20USAGE%202.png).

## May 15, 9:02 p.m. — project bootstrap

This session established the project shape before feature work started. Bob read `OvercodePRD.md` and `DESIGN_SYSTEM.md`, then wrote the constraints it needed to keep following into `AGENTS.md`. The main outcome was a working architecture scaffold for a multi-process Electron app, with the dashboard UI seeded by mock data. The cumulative Bobcoin cost by the end of this session was about `$16.65`.

- Updated `AGENTS.md` with the stack constraints: Electron, React, TypeScript, vanilla CSS variables, no native modules, Utility Process git work, and exact IPC channel names from PRD section 13.
- Created `electron/main.ts` with `dotenv.config()` at the top before env-dependent imports.
- Used `utilityProcess.fork()` to spawn the git worker instead of Node `worker_threads`.
- Created `electron/preload/index.ts` and exposed 27 IPC channels grouped by auth, git, github, gitlab, ai, and store.
- Created `electron/ipc-handlers.ts` with registrations for all 27 IPC channels.
- Created `electron/workers/git-worker.ts` using `process.parentPort` for Utility Process communication.
- Resolved a `vite.config.ts` worker-entry issue.
- Created `electron/lib/store.ts` with a TypeScript `StoreSchema` matching PRD section 10.
- Implemented `getRepo`, `setRepo`, `listRepos`, `getActivity`, `addActivity`, `getCache`, and `setCache`.
- Added a 500-entry activity cap with automatic pruning.
- Registered `store:get`, `store:set`, and `store:list` in `electron/ipc-handlers.ts`.
- Created `electron/mock-data.ts` with `getMockData()`.
- Seeded 4 repositories: `design-system`, `backend-api`, `marketing-website`, and `infra-tools`.
- Seeded 25 activity items covering commits, PRs, stashes, and pushes across 24 hours.
- Created `src/lib/seed.ts` with `seedIfEmpty()`.
- Created `src/components/Sidebar.tsx` and `src/components/Sidebar.css`.
- Built the 48px sidebar with 9 icons: five functional icons and four decorative icons with `pointer-events: none`.
- Created `src/components/StatCard.tsx` and `src/components/StatCard.css`.
- Created `src/components/SyncStatusIndicator.tsx` and `src/components/SyncStatusIndicator.css`.
- Created `src/components/SignatureFooter.tsx` and `src/components/SignatureFooter.css`.
- Created `src/screens/Dashboard.tsx` and `src/screens/Dashboard.css`.
- Updated `src/App.tsx` and `src/App.css`.
- Kept activity stat derivation client-side in `Dashboard`.
- Used the Plan mode to Code mode cadence with `@PRD.md` and `@DESIGN_SYSTEM.md` references.

Bob made several architecture decisions in this session without needing follow-up correction: keep `dotenv.config()` at the top of `electron/main.ts`, use `electron-store` instead of SQLite, preserve exact IPC strings such as `git:log` and `ai:complete`, split sidebar icons between functional and decorative roles, and derive dashboard stats from activity data in the renderer.

## May 15, 9:34 p.m. — batched AI checkpoint

This was a single Code-mode run that executed six planned phases. It brought the app to the demo-ready checkpoint by adding the activity feed, Granite client, AI panel, Impact Analysis, Commit Assistant, Repo Brief, and Stash Annotator. The reported incremental Bobcoin cost was about `$13.09`.

- Created `src/components/ActivityFeed.tsx` and `src/components/ActivityFeed.css`.
- Used `react-window` with `FixedSizeList`, 64px item height, and a 400px container.
- Created `src/components/ActivityItem.tsx` and `src/components/ActivityItem.css`.
- Created `src/components/FilterTabs.tsx` and `src/components/FilterTabs.css`.
- Created `src/components/BranchBadge.tsx` and `src/components/BranchBadge.css`.
- Created `src/components/StatusDot.tsx` and `src/components/StatusDot.css`.
- Created `src/lib/mock-diffs.ts` exporting `SAMPLE_DIFF` and `SAMPLE_TREE`.
- Updated `src/screens/Dashboard.tsx` to render `<ActivityFeed />`.
- Created `electron/lib/granite.ts` as the REST client for `ibm/granite-3-8b-instruct`.
- Added the module-scoped IAM token cache: `let tokenCache: { token: string | null; expiresAt: number }`.
- Added a 10-minute pre-expiry refresh buffer with `Date.now() < tokenCache.expiresAt - 600_000`.
- Wired IAM token requests to `https://iam.cloud.ibm.com/identity/token`.
- Wired text generation requests to `${WATSONX_URL}/ml/v1/text/generation?version=2023-05-29`.
- Used greedy decoding, `max_new_tokens: 800`, and `repetition_penalty: 1.05`.
- Wired `ai:complete` and `ai:status` in `electron/ipc-handlers.ts`.
- Created `src/store/useAIPanel.ts` with Zustand state for the AI panel.
- Created `src/components/ai/AIPanel.tsx` and `src/components/ai/AIPanel.css`.
- Created `src/components/ai/ImpactAnalysis.tsx` and `src/components/ai/ImpactAnalysis.css`.
- Mounted `<AIPanel />` from `Dashboard`.
- Added an "Analyze impact" affordance from `ActivityItem` for commit and push activity rows.
- Passed `SAMPLE_DIFF` and `SAMPLE_TREE` into Impact Analysis.
- Created `src/components/ai/CommitAssistant.tsx` and `src/components/ai/CommitAssistant.css`.
- Split the Granite response on `---PR---` so one call could produce a conventional commit message and PR description.
- Added copy-to-clipboard behavior for the commit message and PR description.
- Created `src/components/ai/RepoBrief.tsx` and `src/components/ai/RepoBrief.css`.
- Added a 24-hour repo brief cache keyed by repo through `granite_cache` in electron-store.
- Rendered simple markdown headings for `##` without adding an external markdown library.
- Extended `electron/mock-data.ts` with `getMockStashes(repoId)`.
- Created `src/hooks/useStashLabels.ts`.
- Generated stash labels sequentially to avoid burst traffic against Granite.
- Created `src/components/StashList.tsx` and `src/components/StashList.css`.
- Added Pop and Drop placeholders in `StashList`.
- Used per-stash cache keys shaped as `stash:${repoId}:${stash.ref}`.
- Fixed a `react-window` default-import and `require` boundary issue so the build could succeed.

The important workflow pattern was batching tasks 6 through 11 into one prompt. That let Bob land connected vertical slices while keeping the cache-first AI behavior consistent across repo briefs, stash labels, and IAM tokens.

## May 17, 9:48 a.m. — bug sweep

This session started as a read-only request: find subtle bugs without running commands. Bob first triaged the app and then made targeted fixes after the user moved it into implementation. The final result was eight fixes across high, medium, and low severity.

| Severity | Where | What Bob caught |
| --- | --- | --- |
| High | `src/components/ai/AIPanel.tsx:45-47` | `useEffect` only updated `activePayload` when the payload was truthy, so previous feature state could leak when opening a feature with no payload. Bob removed the conditional guard. |
| High | `electron/workers/git-worker.ts:36, 177-198` | `watchersByRepoPath` grew indefinitely because removed repos had no unwatch path. Bob reconciled current workspace paths, closed orphaned watchers, and cleared timers. |
| High | `src/components/ai/AIPanel.tsx:106-158` | Feature components had no error boundary, so one render-time crash could take out the whole panel. Bob added `FeatureErrorBoundary` with retry UI. |
| Medium | `electron/lib/github.ts:463-468` | `.catch(() => [])` on check-run fetches hid auth and permission failures. Bob kept the empty-array fallback but added warning logging. |
| Medium | `electron/ipc-handlers.ts:188` | Timestamp validation accepted negative, `NaN`, and far-future values. Bob added positive, finite, and future-tolerance validation with `Date.now()` fallback. |
| Medium | `src/components/CommandPalette.tsx:57-61` | Repository-load failures were silent. Bob surfaced the failure in the palette UI. |
| Low | `src/components/LocalChangesPanel.tsx:191` | `f.path.toLowerCase()` had no defensive guard. Bob added one even though the type expected `path`. |
| Low | `src/components/LocalChangesPanel.tsx:262` | Search filtering ran on every keystroke. Bob added a 200ms debounce with `useRef` cleanup. |

Bob also surfaced systemic patterns that mattered beyond the individual fixes.

- `.catch(() => [])` was used as graceful degradation, but several cases needed logging so failures were visible during diagnosis.
- IPC boundaries needed stricter input validation.
- File watchers needed reconciliation, not just creation.
- Feature-level rendering needed component boundaries, not only inline try/catch handling.
- Seven initial findings were re-categorized by the user as already handled or intentional, which left a useful record of triage friction rather than a polished-only audit trail.

## May 17, 10:19 a.m. — architecture diagrams

This session turned the codebase architecture into diagrams. Bob first produced `overcode-architecture.excalidraw`, then fixed its JSON structure after the user reported that it was not rendering. When asked to create diagrams for other parts of the app, Bob decomposed the system into five complementary Excalidraw files at the repo root and added prose documentation.

- `overcode-architecture.excalidraw` — master system view covering the main process, IPC handlers, OAuth servers on 3000 and 3001, GitHub and GitLab clients, watsonx.ai Granite, electron-store, Utility Process, git worker, `simple-git`, `chokidar`, preload, contextBridge, renderer, React 18, Zustand, screens, AI features, and external services.
- `overcode-ipc-flow.excalidraw` — IPC choreography from Renderer to Preload to Main to response, with 26 channels grouped into auth, git, github, gitlab, ai, and store.
- `overcode-ai-workflow.excalidraw` — Granite feature pipelines for Impact Analysis, Commit Assistant, Stash Annotator, and Repo Brief, all routed through the same `callGranite` entry point with IAM token caching.
- `overcode-data-flow.excalidraw` — information flow from filesystem to git worker to main process to electron-store and external APIs, then into the renderer, with cache-first remote responses and `postMessage` between main and Utility Process.
- `overcode-component-hierarchy.excalidraw` — React tree covering `App.tsx`, `RouteFrame`, `AIPanel`, `CommandPalette`, `LocalChangesPanel`, Sidebar, 8 screens, and screen-level component breakdowns.

Bob made the diagrams readable by using process-based color coding: main in light blue, utility in light red, preload in light yellow, renderer in light green, and external APIs in light purple with dashed outlines. It also added bottom-of-diagram explanation boxes for IPC call-outs and used vertical layering from Renderer to Preload to Main to Utility.

Bob produced `ARCHITECTURE_DIAGRAMS.md` at about 1009 lines as supporting prose. That file includes per-diagram explanations, an IPC channel reference, AI feature specs, the Zustand store catalog, and a component usage matrix.

## Workflow patterns we used with Bob

- Plan mode to Code mode was the normal cadence for architecture-sensitive tasks. Bob first summarized the intended implementation, then switched into code changes after the shape was agreed.
- Batched multi-phase prompts reduced Bobcoin cost when the phases shared context, especially in the May 15 run that handled tasks 6 through 11.
- Cache-first AI features were used repeatedly: 24-hour repo brief cache, per-stash label cache, and IAM token cache with a 10-minute pre-expiry buffer.
- IPC channel names stayed anchored to the PRD-defined strings so handlers, preload exposure, and renderer calls could remain stable across sessions.
- Mock-data-first scaffolding kept screens demoable before live git, GitHub, and GitLab wiring was complete.

The four `.md` transcripts in this folder are the verbatim Bob IDE task-history exports required by the hackathon, with credentials scrubbed.

The two PNG files are the per-session Bobcoin consumption summaries.
