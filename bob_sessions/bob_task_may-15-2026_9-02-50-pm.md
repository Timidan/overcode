**User:**

<task>
I'm building Overcode for the IBM Bob Hackathon. The complete specification is in two files at the project root:

'OvercodePRD.md' (see below for file content)  — full product requirements, tech stack, screens, IPC channels, build order, and a ready-to-paste prompt for every task
'design\ system.md' (see below for file content) — every visual token, component spec, and styling rule

Before you do anything else:
1. Read @PRD.md fully
2. Read @DESIGN_SYSTEM.md fully
3. Update AGENTS.md to summarize the project's key constraints: Electron + React + TypeScript, vanilla CSS with CSS variables (no Tailwind), no native modules (electron-store not SQLite), Utility Process for all git/filesystem work, IPC channel names exactly as listed in PRD section 13, runtime AI is watsonx.ai Granite (not Bob).

Then confirm you've read both files by listing back to me:
- The 4 watsonx.ai Granite features (PRD section 9)
- The 5 functional sidebar icons (DESIGN_SYSTEM 5.1)
- The CSS variable for the primary background color
- The IPC channel for AI calls

Once I confirm your understanding, we'll start Task 2 (IPC Architecture) in Plan mode. We'll work through tasks one at a time, always Plan mode first, then Code mode. I'll paste the exact prompt for each task from PRD section 15.

Do not start writing code yet. Just read, update AGENTS.md, and confirm.
</task>

<file_content path="OvercodePRD.md">
  1 | # Overcode — Product Requirements Document
  2 | 
  3 | **Hackathon:** IBM Bob Hackathon (lablab.ai) — May 15–17, 2026
  4 | **Prize:** $5,000 first place
  5 | **Build Partner:** IBM Bob (coding) + watsonx.ai Granite (in-app inference)
  6 | **Type:** Desktop Application (Electron + React + TypeScript)
  7 | **Target OS:** Linux (Manjaro via Distrobox Debian)
  8 | **Tagline:** Stay in sync. Stay ahead.
  9 | 
 10 | ---
 11 | 
 12 | ## 1. Overview
 13 | 
 14 | Overcode is a desktop developer workspace hub that collapses the mental overhead of managing multiple Git repositories across GitHub, GitLab, and local environments into a single, aesthetically exceptional interface. It gives developers a real-time, visual understanding of where their code is — locally and remotely — and surfaces IBM watsonx.ai Granite models as an intelligent layer for contextual reasoning, commit automation, and codebase onboarding.
 15 | 
 16 | IBM Bob is the development partner that builds Overcode. watsonx.ai is the inference engine that powers Overcode's in-app AI features. This split uses both technologies as intended by the hackathon.
 17 | 
 18 | ---
 19 | 
 20 | ## 2. The Problem
 21 | 
 22 | A developer managing several active repositories across GitHub and GitLab has no single place to answer the following questions: what is dirty locally right now, which branches are ahead or behind remote, what stashes exist and what they contain, which worktrees are active, and what's the relationship between local state and remote. This fragmentation costs 30–60 minutes of context switching per day. Overcode solves it with visual clarity and Granite-powered intelligence.
 23 | 
 24 | ---
 25 | 
 26 | ## 3. Goals
 27 | 
 28 | Provide a unified, real-time view of all local, GitHub, and GitLab workspaces. Visualize the full Git branch graph per repository with local state overlaid. Surface stashes, uncommitted files, worktrees, and divergence in an intuitive UI. Embed four watsonx.ai-powered features for contextual reasoning, commit automation, stash annotation, and repo onboarding. Ship a demo-ready Linux desktop app within 48 hours.
 29 | 
 30 | ## 4. Non-Goals
 31 | 
 32 | Cross-platform testing, Issues management, Notifications screen, full PR review with approve/request-changes, diff viewer with side-by-side rendering, Git history editing, team features, mobile or web versions.
 33 | 
 34 | ---
 35 | 
 36 | ## 5. Target User
 37 | 
 38 | Full-stack developer managing 3–10 active GitHub and/or GitLab repositories simultaneously who loses time to context switching, forgets stashes, and has no visual overview of local divergence from remote.
 39 | 
 40 | ---
 41 | 
 42 | ## 6. Tech Stack
 43 | 
 44 | | Layer               | Technology                                                     | Why                                                                  |
 45 | | ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
 46 | | Desktop shell       | Electron 30+                                                   | Bob is fluent in JS, no Rust wall                                    |
 47 | | Build tool          | electron-vite                                                  | Fastest scaffold                                                     |
 48 | | Frontend            | React 18 + TypeScript                                          |                                                                      |
 49 | | Styling             | **Vanilla CSS with CSS variables** (no Tailwind, no CSS-in-JS) | DESIGN_SYSTEM.md tokens drive everything; one CSS file per component |
 50 | | Time formatting     | Native `Intl.RelativeTimeFormat`                               | Avoid heavy libs like moment.js                                      |
 51 | | Git operations      | `simple-git` (Utility Process)                                 | UI never freezes                                                     |
 52 | | Git graph           | `@gitgraph/react` with custom theme                            |                                                                      |
 53 | | Filesystem watching | `chokidar` (Utility Process)                                   |                                                                      |
 54 | | GitHub API          | `@octokit/rest`                                                |                                                                      |
 55 | | GitLab API          | `fetch` against GitLab REST v4                                 | Lightweight, no SDK                                                  |
 56 | | OAuth               | Local HTTP server on port 3000 (GitHub) / 3001 (GitLab)        | Reliable, no custom protocols                                        |
 57 | | In-app AI           | watsonx.ai Granite via REST                                    | Powered by $80 IBM Cloud credit                                      |
 58 | | Persistence         | `electron-store`                                               | Pure JS, no native modules                                           |
 59 | | Virtual list        | `react-window`                                                 | Performance                                                          |
 60 | | State               | Zustand                                                        |                                                                      |
 61 | | Icons               | Lucide React                                                   |                                                                      |
 62 | | Env loading         | `dotenv` (called at top of main entry)                         | Must call `dotenv.config()` BEFORE any env-dependent code            |
 63 | 
 64 | **Critical: no native modules.** `electron-store` replaces SQLite. Avoids electron-rebuild headaches. Sufficient for hackathon scale (hundreds of activity items, dozens of repos).
 65 | 
 66 | ---
 67 | 
 68 | ## 7. Design System
 69 | 
 70 | **See `DESIGN_SYSTEM.md` — Bob must read this file before writing any component.**
 71 | 
 72 | Summary of non-negotiable rules: dark surfaces only, JetBrains Mono as primary UI font, status dots with glow on green/live, PR cards with colored left borders (3px), no modals (slide-in panels only), no drop shadows (use border contrast), section labels in ALL CAPS with 0.08em tracking. The accent palette is blue, cyan, green, amber, purple, red.
 73 | 
 74 | ---
 75 | 
 76 | ## 8. Application Screens
 77 | 
 78 | ### 8.1 Onboarding (First Launch)
 79 | 
 80 | Three-step setup. Step one connects GitHub via OAuth flow (local HTTP server on port 3000 catches the callback). Step two connects GitLab via the same pattern (port 3001 to avoid conflict). Both steps are skippable — the user can connect either, both, or neither. Step three prompts the user to add local workspace directories via file picker (defaults to `~/projects`, `~/Desktop`, `~/Documents`). Overcode scans selected directories for `.git` folders recursively and matches local repos to remote repos by parsing the `origin` URL (github.com vs gitlab.com).
 81 | 
 82 | ### 8.2 Dashboard (Main Screen)
 83 | 
 84 | Left sidebar (48px wide, icon-only) plus main content area. The dashboard has four visual layers stacked vertically:
 85 | 
 86 | **Header row.** "OVERCODE" wordmark on the left. On the far right: the **sync status indicator** — a green pulsing dot plus the text "EVERYTHING IS IN SYNC" in JetBrains Mono uppercase, `--text-xs`, `--tracking-wide`. When fetching, the dot turns amber and text reads "SYNCING…". When an error occurs, the dot turns red and text reads "SYNC ERROR".
 87 | 
 88 | **Stat cards row.** Four cards (Commits Synced, Pull Requests Updated, Repositories Updated, Local Changes Detected) with the icon colors specified in DESIGN_SYSTEM.md.
 89 | 
 90 | **Activity feed.** Filter tabs above (ALL / LOCAL / REMOTE). Items mix GitHub, GitLab, and local events. Each item shows platform icon (GitHub Octocat for GitHub, GitLab fox for GitLab, monitor icon for local), repo name, branch badge, event description, time ago, and a status dot. The feed uses `react-window` for virtualization.
 91 | 
 92 | **Signature footer.** A dark card at the bottom of the dashboard with the brand tagline. Left side: a circular pulse icon in `--color-accent-purple` (the same waveform icon from the poster). Center: "NO NOISE. JUST WHAT MATTERS." in `--font-mono`, `--text-md`, `--color-text-primary` on the first line; "FILTERED. PRIORITIZED. ACTIONABLE." in `--text-xs`, `--tracking-wide`, `--color-text-secondary` on the second line. Right side: an animated dot-matrix waveform SVG that subtly pulses (slow horizontal motion, ~6s cycle). This footer is decorative and non-interactive — it's brand reinforcement, matching the poster.
 93 | 
 94 | ### 8.3 Repository Detail
 95 | 
 96 | Triggered by clicking any repo in the feed. Layout splits 60/40 between the commit graph (left) and a local state panel (right).
 97 | 
 98 | **Graph panel** renders the last 100 commits via `@gitgraph/react` with the Overcode custom theme. Each commit node has overlay badges from remote data: PR badge (number + status), CI status dot (green/red/amber), review status chip. Hover shows full message, author, date. Click opens a commit detail view in the right panel. A "Load 100 more" button at the bottom paginates older commits.
 99 | 
100 | **Local state panel** shows three sections stacked vertically: Uncommitted Files (status badges Modified/Added/Deleted, file paths, line counts, Commit button), Stashes (Granite-generated labels per stash, Pop/Drop actions), and Worktrees (path, branch, HEAD hash). At the top, a divergence indicator: "Your branch is X commits ahead, Y commits behind origin/main" with Pull and Push buttons.
101 | 
102 | ### 8.4 Pull Requests Screen
103 | 
104 | Unified list of all open PRs (GitHub) and Merge Requests (GitLab) across connected repos. Each card has a colored left border by status (open=blue, approved=green, changes-requested=amber, merged=purple, draft=grey). Card content: platform icon (GitHub or GitLab), repo name, PR/MR title + number (e.g., `#42` for GitHub, `!42` for GitLab), author, target plus source branch, CI status dot, comment count, time ago. Single inline action: "Comment" (opens an inline text field). No diff viewer in MVP — clicking the card opens the PR/MR in the browser via `shell.openExternal`.
105 | 
106 | ---
107 | 
108 | ## 9. watsonx.ai Granite Integration (Core Judging Criterion)
109 | 
110 | These four features live INSIDE Overcode and run on watsonx.ai Granite models. They map directly to the three hackathon judging themes: contextual reasoning, repetitive automation, knowledge transfer.
111 | 
112 | A persistent "AI" button in the sidebar opens a slide-in panel from the right (380px wide). Each feature renders in that panel.
113 | 
114 | ### 9.1 Impact Analysis (Contextual Reasoning)
115 | 
116 | Trigger: user clicks "Analyze Impact" on uncommitted files or a commit. Granite receives the diff plus the repo file tree (top 2 levels), returns a plain-English summary of likely affected modules with a recommendation. Example output:
117 | 
118 | > This change modifies the token refresh logic in `src/auth/refresh.ts`. Likely affected: all routes using `requireAuth()` middleware (14 routes), the session module in `src/session/`, 3 tests in `__tests__/auth/`. Recommendation: run the auth test suite before pushing.
119 | 
120 | ### 9.2 Commit Assistant (Repetitive Automation)
121 | 
122 | Trigger: user clicks "Generate Commit Message" in the local state panel. Granite reads the staged diff, returns a conventional commit message (type, scope, description, body) plus a PR description. The user can edit before committing.
123 | 
124 | ### 9.3 Stash Annotator (Repetitive Automation)
125 | 
126 | Trigger: automatic on repo load. For each stash, Overcode fetches its diff and sends it to Granite, which returns a single-line plain-English label. Cached in electron-store keyed by repo plus stash ref. Example: `stash@{0}` becomes "Half-finished OAuth token refresh, 3 files".
127 | 
128 | ### 9.4 Repo Onboarding Brief (Knowledge Transfer)
129 | 
130 | Trigger: user clicks "Get Briefed" on any repo. Granite receives the file tree, the README, the last 20 commit messages, and open PR titles. Returns a structured brief: what the repo does, key modules, recent activity, things worth knowing.
131 | 
132 | ### 9.5 watsonx.ai API Call Pattern
133 | 
134 | ```javascript
135 | // src/main/lib/granite.ts
136 | const callGranite = async (systemPrompt, userPrompt) => {
137 |   const response = await fetch(
138 |     `${WATSONX_URL}/ml/v1/text/generation?version=2023-05-29`,
139 |     {
140 |       method: "POST",
141 |       headers: {
142 |         Authorization: `Bearer ${IAM_TOKEN}`,
143 |         "Content-Type": "application/json",
144 |       },
145 |       body: JSON.stringify({
146 |         model_id: "ibm/granite-3-8b-instruct",
147 |         project_id: WATSONX_PROJECT_ID,
148 |         input: `${systemPrompt}\n\n${userPrompt}`,
149 |         parameters: {
150 |           decoding_method: "greedy",
151 |           max_new_tokens: 800,
152 |           repetition_penalty: 1.05,
153 |         },
154 |       }),
155 |     },
156 |   );
157 |   const data = await response.json();
158 |   return data.results[0].generated_text;
159 | };
160 | ```
161 | 
162 | The IAM token is generated from an IBM Cloud API key on app startup and cached in memory with its `expiration` timestamp. Before every Granite call, check if `Date.now() >= expiration - 600_000` (10 minutes before expiry) and refresh if so. Do not use `setInterval` — refresh lazily on use to avoid background work when the app is idle.
163 | 
164 | ```javascript
165 | // Pattern
166 | let tokenCache = { token: null, expiresAt: 0 };
167 | 
168 | async function getIAMToken() {
169 |   if (tokenCache.token && Date.now() < tokenCache.expiresAt - 600_000) {
170 |     return tokenCache.token;
171 |   }
172 |   const resp = await fetch("https://iam.cloud.ibm.com/identity/token", {
173 |     method: "POST",
174 |     headers: { "Content-Type": "application/x-www-form-urlencoded" },
175 |     body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${process.env.WATSONX_API_KEY}`,
176 |   });
177 |   const { access_token, expiration } = await resp.json();
178 |   tokenCache = { token: access_token, expiresAt: expiration * 1000 };
179 |   return access_token;
180 | }
181 | ```
182 | 
183 | ---
184 | 
185 | ## 10. Data Persistence (electron-store)
186 | 
187 | All persistent state lives in a JSON file managed by `electron-store`. Schema:
188 | 
189 | ```javascript
190 | {
191 |   accounts: {
192 |     github: { username, token, avatar_url },
193 |     gitlab: { username, token, avatar_url }
194 |   },
195 |   repositories: [
196 |     { id, name, platform, remote_url, local_path, last_synced }
197 |   ],
198 |   granite_cache: {
199 |     "stash:{repo_id}:{stash_ref}": "AI-generated label",
200 |     "brief:{repo_id}": { content, timestamp }
201 |   },
202 |   activity: [
203 |     { id, repo_id, type, title, metadata, timestamp }
204 |   ],
205 |   settings: {
206 |     watch_directories: ["~/projects"],
207 |     watsonx_api_key: "...",
208 |     watsonx_project_id: "..."
209 |   }
210 | }
211 | ```
212 | 
213 | Activity is capped at 500 most recent entries. Older entries are pruned on each write.
214 | 
215 | ---
216 | 
217 | ## 11. OAuth Flow (Local HTTP Server Pattern)
218 | 
219 | Same pattern for both providers, different ports.
220 | 
221 | ```javascript
222 | // src/main/oauth-server.ts
223 | 
224 | const CONFIG = {
225 |   github: {
226 |     port: 3000,
227 |     authorizeUrl: 'https://github.com/login/oauth/authorize',
228 |     tokenUrl: 'https://github.com/login/oauth/access_token',
229 |     scopes: 'repo read:user',
230 |     clientId: process.env.GITHUB_CLIENT_ID,
231 |     clientSecret: process.env.GITHUB_CLIENT_SECRET,
232 |   },
233 |   gitlab: {
234 |     port: 3001,
235 |     authorizeUrl: 'https://gitlab.com/oauth/authorize',
236 |     tokenUrl: 'https://gitlab.com/oauth/token',
237 |     scopes: 'api read_user',
238 |     clientId: process.env.GITLAB_CLIENT_ID,
239 |     clientSecret: process.env.GITLAB_CLIENT_SECRET,
240 |   },
241 | }
242 | 
243 | async function startOAuthFlow(provider: 'github' | 'gitlab'): Promise<string> {
244 |   const cfg = CONFIG[provider]
245 |   const redirectUri = `http://localhost:${cfg.port}/callback`
246 | 
247 |   // 1. Capture the code with a temporary local server
248 |   const code = await new Promise<string>((resolve, reject) => {
249 |     const server = http.createServer((req, res) => {
250 |       const url = new URL(req.url!, redirectUri)
251 |       const c = url.searchParams.get('code')
252 |       if (c) {
253 |         res.end('<h1>Connected. You can close this tab.</h1>')
254 |         server.close()
255 |         resolve(c)
256 |       }
257 |     })
258 |     server.listen(cfg.port)
259 |     setTimeout(() => { server.close(); reject(new Error('OAuth timeout')) }, 120_000)
260 |   })
261 | 
262 |   // 2. Open the browser to the authorize URL
263 |   shell.openExternal(
264 |     `${cfg.authorizeUrl}?client_id=${cfg.clientId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent(cfg.scopes)}`
265 |   )
266 | 
267 |   // 3. Exchange code for token
268 |   const tokenResp = await fetch(cfg.tokenUrl, {
269 |     method: 'POST',
270 |     headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
271 |     body: JSON.stringify({
272 |       client_id: cfg.clientId,
273 |       client_secret: cfg.clientSecret,
274 |       code,
275 |       redirect_uri: redirectUri,
276 |       grant_type: 'authorization_code', // GitLab requires this; GitHub ignores
277 |     }),
278 |   })
279 |   const { access_token } = await tokenResp.json()
280 | 
281 |   // 4. Store in electron-store
282 |   return access_token
283 | }
284 | ```
285 | 
286 | GitHub OAuth App callback URL: `http://localhost:3000/callback`. GitLab OAuth App callback URL: `http://localhost:3001/callback`. Note: the steps above are conceptually correct but Bob should call `shell.openExternal` BEFORE awaiting the server (the order in the code is just for readability).
287 | 
288 | ---
289 | 
290 | ## 12. Performance Architecture
291 | 
292 | Bob must implement these patterns from day one.
293 | 
294 | **Utility Process for git.** `simple-git`, `chokidar`, and all heavy file operations run in an Electron Utility Process spawned via `utilityProcess.fork()`. The UI never freezes. Communication via `process.parentPort.postMessage`.
295 | 
296 | **Virtual feed.** `react-window` with `FixedSizeList`, 64px item height, only the visible rows render.
297 | 
298 | **Graph pagination.** `simple-git`'s `log({ maxCount: 100 })` for initial load. "Load more" button at graph bottom fetches the next 100.
299 | 
300 | **Cache-first.** Every API call: serve from electron-store immediately, then fetch fresh, then update store and re-render only changed items. No loading spinners on the dashboard — it always has data.
301 | 
302 | **Chokidar debounce.**
303 | 
304 | ```javascript
305 | chokidar.watch(paths, {
306 |   ignored: /(^|[\/\\])\../,
307 |   ignoreInitial: true,
308 |   awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
309 | });
310 | ```
311 | 
312 | ---
313 | 
314 | ## 13. Component Architecture
315 | 
316 | ```
317 | src/
318 | ├── main/
319 | │   ├── index.ts                  Electron main entry; CALLS dotenv.config() AT TOP
320 | │   ├── oauth-server.ts           Local HTTP server for OAuth (GitHub + GitLab)
321 | │   ├── ipc-handlers.ts           IPC handlers exposed to renderer
322 | │   ├── mock-data.ts              Sample fixtures for demo
323 | │   ├── lib/
324 | │   │   ├── granite.ts            watsonx.ai client + IAM token mgr
325 | │   │   ├── github.ts             Octokit-based GitHub client
326 | │   │   └── gitlab.ts             fetch-based GitLab client
327 | │   └── workers/
328 | │       └── git-worker.ts         Utility Process: simple-git + chokidar
329 | ├── preload/
330 | │   └── index.ts                  contextBridge API exposure
331 | ├── renderer/
332 | │   ├── App.tsx
333 | │   ├── screens/
334 | │   │   ├── Onboarding.tsx
335 | │   │   ├── Dashboard.tsx
336 | │   │   ├── RepoDetail.tsx
337 | │   │   └── PullRequests.tsx
338 | │   ├── components/
339 | │   │   ├── Sidebar.tsx
340 | │   │   ├── StatCard.tsx
341 | │   │   ├── ActivityFeed.tsx
342 | │   │   ├── ActivityItem.tsx
343 | │   │   ├── FilterTabs.tsx
344 | │   │   ├── StatusDot.tsx
345 | │   │   ├── BranchBadge.tsx
346 | │   │   ├── SyncStatusIndicator.tsx
347 | │   │   ├── SignatureFooter.tsx
348 | │   │   ├── CommitGraph.tsx
349 | │   │   ├── UncommittedFiles.tsx
350 | │   │   ├── StashList.tsx
351 | │   │   ├── WorktreeList.tsx
352 | │   │   ├── DivergenceIndicator.tsx
353 | │   │   ├── PRCard.tsx
354 | │   │   └── ai/
355 | │   │       ├── AIPanel.tsx
356 | │   │       ├── ImpactAnalysis.tsx
357 | │   │       ├── CommitAssistant.tsx
358 | │   │       └── RepoBrief.tsx
359 | │   ├── hooks/
360 | │   │   ├── useStashLabels.ts
361 | │   │   ├── useRepoData.ts
362 | │   │   └── useTimeAgo.ts
363 | │   ├── store/
364 | │   │   ├── useAppStore.ts
365 | │   │   └── useRepoStore.ts
366 | │   ├── lib/
367 | │   │   └── ipc.ts                Typed wrappers around window.api.*
368 | │   └── styles/
369 | │       ├── variables.css         All CSS custom properties from DESIGN_SYSTEM.md
370 | │       └── reset.css
371 | ```
372 | 
373 | **IPC channel naming convention** (use exactly these strings, not variations):
374 | 
375 | ```
376 | auth:connect           auth:disconnect       auth:status
377 | git:scan               git:status            git:log
378 | git:stashes            git:stash-show        git:worktrees
379 | git:divergence         git:push              git:pull
380 | git:commit             git:stash-pop         git:stash-drop
381 | github:repos           github:prs            github:pipelines
382 | github:comment
383 | gitlab:projects        gitlab:mrs            gitlab:pipelines
384 | gitlab:comment
385 | ai:complete            ai:status
386 | store:get              store:set             store:list
387 | ```
388 | 
389 | ---
390 | 
391 | ## 14. Bobcoin Budget Plan (40 coins total)
392 | 
393 | Pre-build setup happens before opening Bob (zero coins). The user creates the GitHub OAuth App at github.com/settings/developers (homepage `http://localhost`, callback `http://localhost:3000/callback`), gets watsonx.ai credentials (API key, project ID, Dallas URL — see hackathon guide), activates the IBM Cloud account, scaffolds the project with `npm create electron-vite@latest overcode -- --template react-ts`, installs all dependencies, and creates a `.env` file with all credentials. Then runs Bob's `/init` to generate `AGENTS.md`.
394 | 
395 | ### Build order (priority-reversed to protect AI features)
396 | 
397 | The killer judging features are the watsonx.ai-powered features. They must be built _early_ with mock local data, so even if coins run out, the demo still shows the AI angle.
398 | 
399 | | #   | Task                                                                                  | Mode        | Est. Cost | Cumulative |
400 | | --- | ------------------------------------------------------------------------------------- | ----------- | --------- | ---------- |
401 | | 1   | `/init` AGENTS.md generation                                                          | Ask         | 0.3       | 0.3        |
402 | | 2   | IPC architecture (main, preload, contextBridge, Utility Process scaffold)             | Plan + Code | 3.0       | 3.3        |
403 | | 3   | electron-store schema, helpers, IPC handlers                                          | Code        | 1.2       | 4.5        |
404 | | 4   | Mock data fixtures (sample repos, commits, stashes for demo)                          | Code        | 1.0       | 5.5        |
405 | | 5   | Dashboard layout, sidebar, stat cards with mock data                                  | Code        | 2.5       | 8.0        |
406 | | 6   | Activity feed with react-window and mock data                                         | Code        | 2.0       | 10.0       |
407 | | 7   | watsonx.ai Granite client, IAM token refresh                                          | Code        | 1.8       | 11.8       |
408 | | 8   | AI panel slide-in, Impact Analysis feature (with mock diff)                           | Code        | 2.0       | 13.8       |
409 | | 9   | Commit Assistant feature                                                              | Code        | 1.5       | 15.3       |
410 | | 10  | Repo Brief feature                                                                    | Code        | 1.5       | 16.8       |
411 | | 11  | Stash Annotator feature                                                               | Code        | 1.2       | 18.0       |
412 | | 12  | **DEMO-READY CHECKPOINT** — mock-data demo with all 4 AI features works               | —           | —         | —          |
413 | | 13  | Local git scanner, chokidar watcher (Utility Process)                                 | Code        | 2.5       | 20.5       |
414 | | 14  | Local state panel (uncommitted, stashes, worktrees, divergence)                       | Code        | 2.5       | 23.0       |
415 | | 15  | GitHub OAuth via local HTTP server                                                    | Code        | 2.0       | 25.0       |
416 | | 16  | GitHub API client (Octokit), cache-first data flow                                    | Code        | 2.0       | 27.0       |
417 | | 17  | GitLab OAuth (reuse pattern from task 15) + GitLab API client                         | Code        | 1.8       | 28.8       |
418 | | 18  | Repo detail screen layout                                                             | Code        | 1.0       | 29.8       |
419 | | 19  | CommitGraph with custom theme                                                         | Code        | 2.5       | 32.3       |
420 | | 20  | PR and CI badge overlays on graph nodes                                               | Code        | 1.8       | 34.1       |
421 | | 21  | PR screen with unified GitHub PRs + GitLab MRs                                        | Code        | 1.8       | 35.9       |
422 | | 22  | Push action and Pull action                                                           | Code        | 1.3       | 37.2       |
423 | | 23  | Polish: animations, sync status indicator, signature footer waveform, status dot glow | Code        | 1.8       | 39.0       |
424 | | 24  | Buffer for debugging and corrections                                                  | —           | 1.0       | 40.0       |
425 | 
426 | **Step 12 is the critical line.** After task 11, you have a demo with all four AI features working on mock data. If anything goes wrong after that, you still have a winnable submission.
427 | 
428 | ### Coin-saving rules
429 | 
430 | Always start a task in Plan mode, review the plan, then switch to Code mode. Use `@file` mentions to point Bob at specific files. Reference `@PRD.md` and `@DESIGN_SYSTEM.md` by name to avoid re-explaining. Enable auto-approve for Read and Write only (not Execute). Create a new context window after each major task. If Bob goes wrong, use Checkpoints to roll back rather than spending coins on corrections. Never ask Bob to "build the entire dashboard" — one component per task.
431 | 
432 | ### Out-of-coins fallback
433 | 
434 | If coins run out before task 23, the watsonx.ai features still work because they use the $80 IBM Cloud credit, not Bobcoins. You can continue building the remaining tasks manually or with another AI tool. The submission still demonstrates Bob's contribution via the exported task history.
435 | 
436 | ---
437 | 
438 | ## 15. Ready-to-Paste Bob Prompts
439 | 
440 | These are tuned for minimum coin cost. Each one references `@PRD.md` and `@DESIGN_SYSTEM.md` so Bob doesn't waste tokens re-reading.
441 | 
442 | ### Task 1 — Init
443 | 
444 | ```
445 | /init
446 | ```
447 | 
448 | ### Task 1b — CSS Variables File (free, copy-paste)
449 | 
450 | This isn't a Bob task. YOU manually create `src/renderer/styles/variables.css` by copy-pasting all the CSS custom properties from @DESIGN_SYSTEM.md sections 2 and 3 (Color Tokens and Typography). Also copy section 4 (Spacing & Layout) tokens. Then import this file at the top of `src/renderer/main.tsx`. This saves ~0.5 coins of Bob work and guarantees zero deviation from the design tokens.
451 | 
452 | Also create `src/renderer/styles/reset.css` with a minimal reset (margin/padding 0 on body, box-sizing border-box on \*, font-family inherit, line-height 1.5). Import it before variables.css.
453 | 
454 | ### Task 2 — IPC Architecture
455 | 
456 | ```
457 | [Plan mode first]
458 | @PRD.md section 13 shows the project structure and IPC channel names. Plan the Electron IPC architecture:
459 | - main process entry at src/main/index.ts — IMPORTANT: import dotenv and call dotenv.config() at the VERY TOP, before any other import that touches process.env
460 | - preload script at src/preload/index.ts using contextBridge to expose a typed window.api with all channels listed in @PRD.md section 13
461 | - a Utility Process worker at src/main/workers/git-worker.ts (use Electron's utilityProcess.fork — NOT Node's worker_threads)
462 | - typed IPC handlers in src/main/ipc-handlers.ts that register all channels listed in @PRD.md section 13
463 | 
464 | The renderer must never directly import Node modules. All git, filesystem, electron-store, and granite operations go through IPC.
465 | 
466 | After I approve the plan, switch to Code mode and implement the skeleton (empty handler bodies are fine, but all channel names from @PRD.md section 13 must be registered).
467 | ```
468 | 
469 | ### Task 3 — electron-store
470 | 
471 | ```
472 | @PRD.md section 10 has the persistence schema. Set up electron-store in the main process with this schema. Expose IPC handlers for getRepo, setRepo, listRepos, getActivity, addActivity (with 500-entry cap), getCache, setCache. No business logic, just CRUD.
473 | ```
474 | 
475 | ### Task 4 — Mock Data
476 | 
477 | ```
478 | Create src/main/mock-data.ts with sample data matching the electron-store schema in @PRD.md section 10. Include: 4 repos (mix of GitHub + local), 25 activity items spanning the last 24h, 3 stashes per repo, 2 uncommitted files in one repo, 1 worktree. Use realistic repo names like "design-system", "backend-api", "marketing-website". Match the feel described in @DESIGN_SYSTEM.md.
479 | ```
480 | 
481 | ### Task 5 — Dashboard Shell
482 | 
483 | ```
484 | @PRD.md section 8.2 describes the Dashboard. @DESIGN_SYSTEM.md sections 5.1, 5.2 cover Sidebar and Stat Cards.
485 | 
486 | Build:
487 | - src/renderer/screens/Dashboard.tsx with the four-layer layout from PRD 8.2 (header row with sync status, stat cards row, activity feed, signature footer — but only stub the sync status and footer with placeholder text for now; they get the full treatment in Task 23)
488 | - src/renderer/components/Sidebar.tsx — 48px wide, icon-only. IMPORTANT: 9 icons total in the order listed in DESIGN_SYSTEM.md 5.1, but ONLY 5 are functional (Dashboard, Repositories, PRs, AI Panel toggle, Settings). The other 4 (monitor, database, bell, filter) are decorative — render them with --color-text-muted and pointer-events: none. Do NOT build screens for them.
489 | - src/renderer/components/StatCard.tsx — see 5.2, four cards with distinct icon colors
490 | 
491 | Use mock data via the store:get IPC. No real git yet. Apply DESIGN_SYSTEM.md tokens strictly — JetBrains Mono, the exact CSS variables (which should already be defined in src/renderer/styles/variables.css), no hardcoded colors.
492 | ```
493 | 
494 | ### Task 6 — Activity Feed
495 | 
496 | ```
497 | @PRD.md section 8.2 (feed behavior). @DESIGN_SYSTEM.md section 5.3 (ActivityItem visual spec) and 5.4 (FilterTabs).
498 | 
499 | Build src/renderer/components/ActivityFeed.tsx using react-window FixedSizeList (height fills container, itemSize 64). ActivityItem renders platform icon, repo name, branch badge (component already in DESIGN_SYSTEM.md 5.5), description, time-ago, status dot. FilterTabs above (ALL/LOCAL/REMOTE). Pull mock data from IPC.
500 | ```
501 | 
502 | ### Task 7 — Granite Client
503 | 
504 | ```
505 | @PRD.md section 9.5 has the watsonx.ai API call pattern. Build src/main/lib/granite.ts with:
506 | - generateIAMToken(apiKey) that returns {token, expiresAt}
507 | - a token cache that auto-refreshes 10min before expiry
508 | - callGranite(systemPrompt, userPrompt) returning the generated text
509 | - expose via IPC as ai:complete
510 | 
511 | Read WATSONX_API_KEY, WATSONX_PROJECT_ID, WATSONX_URL from process.env (.env loaded via dotenv).
512 | ```
513 | 
514 | ### Task 8 — Impact Analysis
515 | 
516 | ```
517 | @PRD.md section 9.1 describes Impact Analysis. @DESIGN_SYSTEM.md section 5.7 covers the AI Panel visual spec (NOT named "Bob Panel" — runtime branding is watsonx.ai / "AI", not "Bob").
518 | 
519 | Build:
520 | - src/renderer/components/ai/AIPanel.tsx — slide-in panel container, 380px wide, transform transition 300ms, cyan accent. Header shows "AI" label + feature name + close X
521 | - src/renderer/components/ai/ImpactAnalysis.tsx — calls ai:complete via IPC with diff + tree, renders the response in the AI-output container style from 5.7 (cyan left border)
522 | 
523 | Wire an "Analyze Impact" button on the activity feed item that opens the panel with that item's mock diff. The diff and tree are pulled from mock data for now.
524 | ```
525 | 
526 | ### Task 9 — Commit Assistant
527 | 
528 | ```
529 | @PRD.md section 9.2. Build src/renderer/components/ai/CommitAssistant.tsx. Takes a diff input (from mock data for now), calls ai:complete with a system prompt for conventional commits, renders editable result. Add a "Generate" trigger button. Reuse AIPanel container.
530 | ```
531 | 
532 | ### Task 10 — Repo Brief
533 | 
534 | ```
535 | @PRD.md section 9.4. Build src/renderer/components/ai/RepoBrief.tsx. Takes a repo (mock for now: tree, README, last 20 commit messages, open PR titles), calls ai:complete, renders the structured brief. Cache result in electron-store via cache:set IPC.
536 | ```
537 | 
538 | ### Task 11 — Stash Annotator
539 | 
540 | ```
541 | @PRD.md section 9.3. Build a hook useStashLabels(repoId) that for each stash in the repo: checks granite_cache first, if missing calls ai:complete with the stash diff, caches the label. Returns {[stashRef]: label}. Use it in the StashList component (build that too, see @DESIGN_SYSTEM.md for stash row styling).
542 | ```
543 | 
544 | ### Task 13 — Local Git Scanner
545 | 
546 | ```
547 | @PRD.md section 12 (Utility Process pattern). Build src/main/workers/git-worker.ts using simple-git + chokidar:
548 | - recursive scan for .git folders in user-selected directories
549 | - chokidar watcher with awaitWriteFinish (stabilityThreshold 500)
550 | - exposed operations: status, log({maxCount:100}), stashList, stashShow, worktreeList, revparse for ahead/behind
551 | - communicates with main via process.parentPort
552 | 
553 | Main exposes via IPC as git:scan, git:status, git:log, git:stashes, git:worktrees, git:divergence.
554 | ```
555 | 
556 | ### Task 15 — OAuth
557 | 
558 | ```
559 | @PRD.md section 11 describes the local HTTP server OAuth pattern. Build src/main/oauth-server.ts:
560 | - startOAuthFlow(provider: 'github') returns a Promise<token>
561 | - launches http.createServer on port 3000
562 | - shell.openExternal to GitHub authorize URL
563 | - captures code from callback, exchanges for token
564 | - closes the server after success
565 | - stores token in electron-store
566 | 
567 | Use process.env.GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET. Expose via IPC as auth:connect.
568 | ```
569 | 
570 | ### Task 17 — GitLab Integration
571 | 
572 | ```
573 | @PRD.md section 11. Extend src/main/oauth-server.ts to also support 'gitlab' as a provider:
574 | - uses port 3001 to avoid conflict
575 | - GitLab authorize URL: https://gitlab.com/oauth/authorize
576 | - token exchange: https://gitlab.com/oauth/token
577 | - scopes: api read_user
578 | 
579 | Also build src/main/lib/gitlab.ts (no SDK, just fetch) with: listProjects, getMergeRequests(projectId), getPipelines(projectId), commentOnMR(projectId, mrIid, body). Expose via IPC as gitlab:projects, gitlab:mrs, gitlab:pipelines, gitlab:comment.
580 | 
581 | Update the activity feed to handle 'gitlab' platform — render the GitLab fox icon (use lucide or inline SVG) and the MR notation "!42" instead of "#42".
582 | ```
583 | 
584 | (Remaining task prompts follow the same shape — short, file-named, spec-referenced.)
585 | 
586 | ---
587 | 
588 | ## 16. Pre-Build Checklist
589 | 
590 | GitHub OAuth App created with callback `http://localhost:3000/callback`. GitLab OAuth App created at gitlab.com/-/user_settings/applications with callback `http://localhost:3001/callback` and scopes `api read_user`. watsonx.ai API key, project ID, and Dallas URL saved (URL is `https://us-south.ml.cloud.ibm.com`). IBM Cloud account active and switched to the hackathon account (not personal). Project scaffolded with `npm create electron-vite@latest overcode -- --template react-ts`. All npm packages installed:
591 | 
592 | ```
593 | npm install electron-store react-window @gitgraph/react simple-git chokidar @octokit/rest zustand lucide-react dotenv
594 | npm install -D @types/react-window
595 | ```
596 | 
597 | `.env` file created in project root with: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`, `WATSONX_API_KEY`, `WATSONX_PROJECT_ID`, `WATSONX_URL`. `.env` added to `.gitignore` (CRITICAL — guide says leaked credentials = account suspension). `PRD.md` and `DESIGN_SYSTEM.md` placed in project root. `bob_sessions/` folder created in project root for session export deliverable. Bob IDE open, on hackathon team `ibm-coding-challenge-xxx` (confirmed in Settings → General), Plan mode selected. `/init` run to generate `AGENTS.md`. CSS variables file created manually (see Task 1b) — saves Bobcoins.
598 | 
599 | ---
600 | 
601 | ## 17. Demo Script (3-minute video)
602 | 
603 | Open on the dashboard with mock data populated — four stat cards, busy activity feed mixing GitHub, GitLab, and local events. The "EVERYTHING IS IN SYNC" status pulses green at the top right. The waveform footer animates at the bottom. Voiceover: "Most developers stitch together five tools to know what's happening in their workspace. Overcode collapses that into one calm signal — GitHub, GitLab, and your local machine, unified."
604 | 
605 | Click into a repo with a local change. The repo detail opens — graph on the left, local state on the right. Voiceover: "Real-time picture of how your local branch relates to remote. Stashes, worktrees, ahead and behind, all visible."
606 | 
607 | Click "Analyze Impact" on the uncommitted files. The AI panel slides in. watsonx.ai Granite returns the impact summary. Voiceover: "Powered by watsonx.ai Granite, Overcode reads your changes and tells you what's at risk. That's contextual reasoning."
608 | 
609 | Click "Generate Commit Message." Granite returns a conventional commit message. Voiceover: "Repetitive automation. One click, ready to commit."
610 | 
611 | Open a different repo. Click "Get Briefed." Granite generates the codebase brief. Voiceover: "Knowledge transfer. New repo, instant orientation."
612 | 
613 | End on the dashboard. Voiceover: "Built with IBM Bob. Powered by watsonx.ai Granite. Overcode. One calm signal for your entire workspace."
614 | 
615 | Talking points for submission text: addresses all three hackathon themes (contextual reasoning, automation, knowledge transfer). Uses both Bob (build) and watsonx.ai (runtime). Spans GitHub and GitLab. Solves a real developer pain that ships every day.
616 | 
617 | ---
618 | 
619 | ## 18. Acceptance Criteria
620 | 
621 | **Must have (demo blockers):** GitHub OAuth connects. GitLab OAuth connects. Local repos detected and listed. Dashboard shows unified feed (GitHub + GitLab + local). "EVERYTHING IS IN SYNC" status indicator works. Repo detail shows commit graph. Local state panel shows uncommitted, stashes, worktrees. All four Granite-powered features (Impact, Commit Assistant, Stash Annotator, Repo Brief) return results. Push action works. PR list shows GitHub PRs and GitLab MRs unified.
622 | 
623 | **Should have:** CI status overlays on graph. PR badge overlays. Conflict warning before push. Divergence indicator. Signature waveform footer.
624 | 
625 | **Stretch:** watsonx Orchestrate "Workspace Assistant" agent embed.
626 | 
627 | ---
628 | 
629 | ## 19. Out of Scope
630 | 
631 | Cross-platform builds and testing. Issues management. Notifications screen. Diff viewer (link out to browser instead). PR approve and request-changes actions. Git history editing. Multi-user features. Repo creation. Branch protection management. watsonx Orchestrate integration (stretch goal — can be added via embed snippet if time permits, no Bobcoins needed).
632 | 
633 | ---
634 | 
635 | _PRD v2.0 — corrected build edition. May 2026._

</file_content>

<file_content path="design\ system.md">
  1 | # Overcode Design System
  2 | 
  3 | **Version:** 1.0  
  4 | **Reference:** Official Overcode poster / brand identity  
  5 | **Usage:** This file is the single source of truth for all visual decisions. Every component, screen, and element in Overcode must conform to these tokens and rules.
  6 | 
  7 | ---
  8 | 
  9 | ## 1. Design Philosophy
 10 | 
 11 | **Aesthetic direction:** Terminal meets mission control. Not a generic developer tool.  
 12 | **Feeling:** You are looking at a signal board for your codebase — calm, precise, information-dense without being noisy.  
 13 | **Rules:**
 14 | 
 15 | - Dark surfaces only. No light mode.
 16 | - Color is reserved for status and accent — never decoration.
 17 | - All-caps for section labels and metadata. Sentence case for descriptions.
 18 | - Monospace typography everywhere in the UI.
 19 | - No modals. Panels slide in from the right.
 20 | - Motion is subtle. Nothing bounces or spins unnecessarily.
 21 | 
 22 | ---
 23 | 
 24 | ## 2. Color Tokens
 25 | 
 26 | Apply these as CSS custom properties on `:root`.
 27 | 
 28 | ### Backgrounds
 29 | 
 30 | ```css
 31 | --color-bg-void: #08080f; /* Deepest background — outer shell, titlebar area */
 32 | --color-bg-app: #0e0e18; /* App window background */
 33 | --color-bg-surface: #131320; /* Cards, panels, sidebar */
 34 | --color-bg-elevated: #1a1a28; /* Hovered cards, active row highlight */
 35 | --color-bg-input: #111120; /* Input fields, search bars */
 36 | ```
 37 | 
 38 | ### Borders
 39 | 
 40 | ```css
 41 | --color-border-subtle: rgba(255, 255, 255, 0.04); /* Barely visible dividers */
 42 | --color-border-default: rgba(
 43 |   255,
 44 |   255,
 45 |   255,
 46 |   0.08
 47 | ); /* Card borders, panel edges */
 48 | --color-border-strong: rgba(255, 255, 255, 0.14); /* Active element outlines */
 49 | ```
 50 | 
 51 | ### Text
 52 | 
 53 | ```css
 54 | --color-text-primary: #e2e8f0; /* Main readable text, numbers, headings */
 55 | --color-text-secondary: #8892a4; /* Labels, metadata, subtitles */
 56 | --color-text-muted: #3d4258; /* Timestamps in inactive state, placeholders */
 57 | --color-text-inverted: #08080f; /* Text on accent backgrounds */
 58 | ```
 59 | 
 60 | ### Accent / Status Colors
 61 | 
 62 | These are the ONLY colors used for icons, status indicators, and interactive elements.
 63 | 
 64 | ```css
 65 | /* Blue — code, active elements, GitHub */
 66 | --color-accent-blue: #6c8fff;
 67 | --color-accent-blue-dim: rgba(108, 143, 255, 0.12);
 68 | --color-accent-blue-border: rgba(108, 143, 255, 0.25);
 69 | 
 70 | /* Cyan — brand highlight, CLI, "CALM SIGNAL" moments */
 71 | --color-accent-cyan: #5eead4;
 72 | --color-accent-cyan-dim: rgba(94, 234, 212, 0.1);
 73 | 
 74 | /* Green — synced, passing CI, live status */
 75 | --color-accent-green: #4ade80;
 76 | --color-accent-green-dim: rgba(74, 222, 128, 0.1);
 77 | 
 78 | /* Amber — local changes, pending, warnings */
 79 | --color-accent-amber: #fb923c;
 80 | --color-accent-amber-dim: rgba(251, 146, 60, 0.1);
 81 | 
 82 | /* Purple — GitLab, stale/behind, worktrees */
 83 | --color-accent-purple: #a78bfa;
 84 | --color-accent-purple-dim: rgba(167, 139, 250, 0.1);
 85 | 
 86 | /* Red — conflict, CI failing, error */
 87 | --color-accent-red: #f87171;
 88 | --color-accent-red-dim: rgba(248, 113, 113, 0.1);
 89 | ```
 90 | 
 91 | ### Sidebar Active Icon Gradient
 92 | 
 93 | The active icon in the sidebar uses a gradient fill for its background:
 94 | 
 95 | ```css
 96 | --gradient-sidebar-active: linear-gradient(135deg, #3730a3 0%, #1d4ed8 100%);
 97 | ```
 98 | 
 99 | ### Background Atmosphere
100 | 
101 | The app has a very subtle purple gradient bloom in the top-right corner — this is part of the brand identity:
102 | 
103 | ```css
104 | /* Apply to the root app container as a pseudo-element or background */
105 | background:
106 |   radial-gradient(
107 |     ellipse at 85% 0%,
108 |     rgba(88, 28, 235, 0.12) 0%,
109 |     transparent 55%
110 |   ),
111 |   var(--color-bg-void);
112 | ```
113 | 
114 | ---
115 | 
116 | ## 3. Typography
117 | 
118 | ### Font Families
119 | 
120 | ```css
121 | --font-mono: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
122 | --font-sans: "Inter", "DM Sans", system-ui, sans-serif;
123 | ```
124 | 
125 | **Rule:** `--font-mono` is the primary font for all UI elements — labels, values, branch names, paths, timestamps.  
126 | `--font-sans` is used only for longer descriptive text (Bob panel explanations, repo briefs, PR descriptions).
127 | 
128 | ### Font Scale
129 | 
130 | ```css
131 | --text-xs: 10px; /* Metadata, timestamps, muted labels */
132 | --text-sm: 12px; /* Secondary labels, badge text, section headers */
133 | --text-base: 13px; /* Body text, feed item descriptions */
134 | --text-md: 14px; /* Primary UI text, sidebar labels */
135 | --text-lg: 16px; /* Card titles, panel headings */
136 | --text-xl: 24px; /* Stat card numbers */
137 | --text-2xl: 36px; /* Large feature numbers */
138 | ```
139 | 
140 | ### Font Weights
141 | 
142 | ```css
143 | --weight-regular: 400;
144 | --weight-medium: 500;
145 | --weight-bold: 700;
146 | ```
147 | 
148 | ### Letter Spacing
149 | 
150 | Section labels, stat card labels, filter tabs, and metadata use wide letter spacing:
151 | 
152 | ```css
153 | --tracking-wide: 0.08em; /* ALL CAPS labels: OVERVIEW, RECENT UPDATES */
154 | --tracking-wider: 0.12em; /* Extra small labels: COMMITS SYNCED */
155 | ```
156 | 
157 | ### Text Rendering Rules
158 | 
159 | - Section labels: UPPERCASE + `--tracking-wide` + `--color-text-secondary` + `--text-sm`
160 | - Stat card numbers: `--text-xl` + `--weight-bold` + `--color-text-primary`
161 | - Branch name badges: `--text-xs` + `--font-mono` + `--weight-regular`
162 | - Time ago values: `--text-xs` + `--color-text-muted` + `--font-mono`
163 | - File paths: `--font-mono` + `--text-sm` + `--color-text-secondary`
164 | - Repo names: `--font-mono` + `--text-md` + `--weight-medium` + `--color-text-primary`
165 | 
166 | ---
167 | 
168 | ## 4. Spacing & Layout
169 | 
170 | ### Base Unit
171 | 
172 | All spacing uses a 4px base unit.
173 | 
174 | ```css
175 | --space-1: 4px;
176 | --space-2: 8px;
177 | --space-3: 12px;
178 | --space-4: 16px;
179 | --space-5: 20px;
180 | --space-6: 24px;
181 | --space-8: 32px;
182 | --space-10: 40px;
183 | --space-12: 48px;
184 | ```
185 | 
186 | ### Border Radius
187 | 
188 | ```css
189 | --radius-sm: 4px; /* Badges, chips, small elements */
190 | --radius-md: 8px; /* Cards, input fields, stat cards */
191 | --radius-lg: 12px; /* Main app window, panels, sidebar */
192 | --radius-xl: 16px; /* Modal-like elements */
193 | --radius-full: 9999px; /* Dots, avatars, pill badges */
194 | ```
195 | 
196 | ### App Layout
197 | 
198 | ```
199 | ┌─────────────────────────────────────────────────────┐
200 | │  TITLEBAR  (48px height, bg-void, drag region)      │
201 | ├──────┬──────────────────────────────────────────────┤
202 | │      │                                              │
203 | │ SIDE │           MAIN CONTENT AREA                 │
204 | │ BAR  │                                              │
205 | │ 48px │                                              │
206 | │      │                                              │
207 | └──────┴──────────────────────────────────────────────┘
208 | ```
209 | 
210 | - **Titlebar:** 48px, `--color-bg-void`, contains logo + wordmark left, window controls right
211 | - **Sidebar:** 48px wide, `--color-bg-surface`, icon-only, no labels
212 | - **Main content:** fills remaining width, `--color-bg-app`, scrollable
213 | 
214 | ---
215 | 
216 | ## 5. Component Specifications
217 | 
218 | ### 5.1 Sidebar
219 | 
220 | ```
221 | Width: 48px
222 | Background: --color-bg-surface
223 | Border-right: 1px solid --color-border-subtle
224 | Padding: 8px 0
225 | 
226 | Icon container size: 36px × 36px
227 | Icon size: 18px
228 | Border-radius on container: --radius-md
229 | ```
230 | 
231 | **States:**
232 | 
233 | - **Default:** icon in `--color-text-muted`, no background
234 | - **Hover:** icon in `--color-text-secondary`, bg `--color-bg-elevated`
235 | - **Active:** icon in white (#ffffff), bg `--gradient-sidebar-active`, icon rendered in the accent color of the section
236 | 
237 | **Active icon (Dashboard) from poster:**
238 | 
239 | ```css
240 | background: linear-gradient(135deg, #3730a3, #1d4ed8);
241 | border-radius: 8px;
242 | color: #6c8fff; /* the </> icon is in blue */
243 | ```
244 | 
245 | **Icon-to-screen mapping (FUNCTIONAL — must be wired):**
246 | 
247 | - `</>` (Code icon) → Dashboard (default active screen)
248 | - Home → Repositories list
249 | - Git branch → Pull Requests / Merge Requests
250 | - Sparkles → AI Panel toggle
251 | - Settings gear → Settings
252 | 
253 | **Decorative icons from poster (render visually for completeness, but NOT clickable):**
254 | The poster shows additional icons (monitor, database/cylinder, bell, filter) that suggest features outside MVP scope (Local Workspaces overview, Issues, Notifications, Smart Filter). Render them with `--color-text-muted` and `pointer-events: none`. Do NOT build any screens for these. They preserve the visual identity of the poster without spending coins on dead features.
255 | 
256 | **Sidebar layout order (top to bottom):**
257 | 
258 | 1. `</>` Dashboard (functional)
259 | 2. Home (functional — Repositories)
260 | 3. Git branch (functional — PRs)
261 | 4. Monitor (decorative)
262 | 5. Database (decorative)
263 | 6. Bell (decorative)
264 | 7. Filter (decorative)
265 | 8. Sparkles (functional — AI Panel)
266 | 9. Settings gear (functional — pushed to bottom of sidebar with `margin-top: auto`)
267 | 
268 | ---
269 | 
270 | ### 5.2 Stat Cards (Overview)
271 | 
272 | From the poster: four cards in a horizontal row showing Commits Synced, Pull Requests Updated, Repositories Updated, Local Change Detected.
273 | 
274 | ```
275 | Background: --color-bg-surface
276 | Border: 1px solid --color-border-default
277 | Border-radius: --radius-md
278 | Padding: --space-4
279 | Min-width: 120px
280 | Flex: 1
281 | ```
282 | 
283 | **Internal layout (top to bottom):**
284 | 
285 | 1. Icon (20px, colored by type — see below)
286 | 2. Number (--text-xl, --weight-bold, --color-text-primary)
287 | 3. Label (--text-xs, UPPERCASE, --tracking-wider, --color-text-secondary)
288 | 
289 | **Icon colors per card:**
290 | 
291 | - Commits Synced → `</>` icon in `--color-accent-blue`
292 | - Pull Requests Updated → git-branch icon in `--color-accent-green`
293 | - Repositories Updated → folder icon in `--color-accent-purple`
294 | - Local Change Detected → monitor icon in `--color-accent-amber`
295 | 
296 | ---
297 | 
298 | ### 5.3 Activity Feed Item
299 | 
300 | Each item in the Recent Updates feed.
301 | 
302 | ```
303 | Background: transparent (default) / --color-bg-elevated (hover)
304 | Border-bottom: 1px solid --color-border-subtle
305 | Padding: --space-3 --space-4
306 | Transition: background 150ms ease
307 | ```
308 | 
309 | **Internal layout (horizontal, left to right):**
310 | 
311 | ```
312 | [Platform Avatar 28px] [Repo Name + Branch Badge] [Description] [Time ago] [Status Dot]
313 | ```
314 | 
315 | - **Platform avatar:** 28px circle. GitHub cat icon or GitLab fox icon. Local = terminal icon. All in `--color-text-secondary`.
316 | - **Repo name:** `--font-mono`, `--text-md`, `--weight-medium`, `--color-text-primary`
317 | - **Branch badge:** pill shape, `--radius-sm`, `--color-bg-elevated`, border `--color-border-default`, text `--text-xs`, `--color-text-secondary`, `--font-mono`. E.g. `main`, `develop`
318 | - **Description:** `--text-sm`, `--color-text-secondary`
319 | - **Time ago:** `--text-xs`, `--color-text-muted`, `--font-mono`, right-aligned
320 | - **Status dot:** 7px circle, right edge. Color by status (see Section 6)
321 | 
322 | ---
323 | 
324 | ### 5.4 Filter Tabs (ALL / LOCAL / REMOTE)
325 | 
326 | ```
327 | Container: flex row, gap --space-1
328 | ```
329 | 
330 | **Active tab:**
331 | 
332 | ```css
333 | background: --color-bg-elevated;
334 | border: 1px solid --color-border-strong;
335 | border-radius: --radius-full;
336 | color: --color-text-primary;
337 | font-size: --text-xs;
338 | letter-spacing: --tracking-wide;
339 | padding: 4px 12px;
340 | ```
341 | 
342 | Active tab also has a small green dot (6px, `--color-accent-green`) before the label text — exact pattern from poster.
343 | 
344 | **Inactive tab:**
345 | 
346 | ```css
347 | background: transparent;
348 | border: none;
349 | color: --color-text-secondary;
350 | ```
351 | 
352 | ---
353 | 
354 | ### 5.5 Branch Name Badge
355 | 
356 | Used inline in feed items and the graph.
357 | 
358 | ```css
359 | display: inline-flex;
360 | align-items: center;
361 | padding: 2px 8px;
362 | background: var(--color-bg-elevated);
363 | border: 1px solid var(--color-border-default);
364 | border-radius: var(--radius-sm);
365 | font-family: var(--font-mono);
366 | font-size: var(--text-xs);
367 | color: var(--color-text-secondary);
368 | letter-spacing: 0;
369 | ```
370 | 
371 | ---
372 | 
373 | ### 5.6 Status Dot
374 | 
375 | Used on every feed item, PR card, and notification.
376 | 
377 | ```css
378 | width: 7px;
379 | height: 7px;
380 | border-radius: var(--radius-full);
381 | flex-shrink: 0;
382 | ```
383 | 
384 | **Colors:**
385 | 
386 | - Synced / passing CI / live: `--color-accent-green` with `box-shadow: 0 0 6px var(--color-accent-green)`
387 | - Remote update / GitHub: `--color-accent-blue`
388 | - Local change: `--color-accent-amber`
389 | - Behind / GitLab: `--color-accent-purple`
390 | - Conflict / error: `--color-accent-red`
391 | - Unknown / no CI: `--color-text-muted`
392 | 
393 | **Pulse animation for live/active dots:**
394 | 
395 | ```css
396 | @keyframes pulse-dot {
397 |   0%,
398 |   100% {
399 |     opacity: 1;
400 |     box-shadow: 0 0 6px currentColor;
401 |   }
402 |   50% {
403 |     opacity: 0.6;
404 |     box-shadow: 0 0 2px currentColor;
405 |   }
406 | }
407 | animation: pulse-dot 2s ease-in-out infinite;
408 | ```
409 | 
410 | ---
411 | 
412 | ### 5.7 AI Panel (Slide-in)
413 | 
414 | This panel hosts all watsonx.ai Granite features (Impact Analysis, Commit Assistant, Repo Brief). It is NOT labeled "Bob" — Bob is the dev partner that built Overcode, not its runtime AI. The runtime brand is watsonx.ai Granite.
415 | 
416 | ```
417 | Width: 380px
418 | Background: --color-bg-surface
419 | Border-left: 1px solid --color-border-default
420 | Height: 100vh
421 | Position: fixed right
422 | Transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1)
423 | ```
424 | 
425 | **Panel header:**
426 | 
427 | ```
428 | Height: 48px
429 | Background: --color-bg-elevated
430 | Border-bottom: 1px solid --color-border-subtle
431 | Padding: 0 --space-4
432 | Contains: "AI" label (--font-mono, --text-sm, --color-accent-cyan) + feature name (e.g. "Impact Analysis") + close button (Lucide X icon)
433 | ```
434 | 
435 | **Content area:**
436 | 
437 | ```
438 | Padding: --space-4
439 | Font: --font-sans for AI-generated prose explanations, --font-mono for code/paths/diffs
440 | ```
441 | 
442 | **AI output container:**
443 | Each section of AI output renders in a code-block-like container with a cyan left border (signals this is AI content, distinct from local data):
444 | 
445 | ```css
446 | background: var(--color-bg-app);
447 | border: 1px solid var(--color-border-default);
448 | border-left: 3px solid var(--color-accent-cyan);
449 | border-radius: var(--radius-md);
450 | padding: var(--space-4);
451 | font-family: var(--font-mono);
452 | font-size: var(--text-sm);
453 | line-height: 1.7;
454 | color: var(--color-text-primary);
455 | ```
456 | 
457 | **Loading state:** While Granite is generating, show three pulsing dots in `--color-accent-cyan` at the top of the output container. No spinner.
458 | 
459 | ---
460 | 
461 | ### 5.8 Commit Graph
462 | 
463 | The graph uses `@gitgraph/react` with a custom dark theme.
464 | 
465 | **Custom theme object:**
466 | 
467 | ```javascript
468 | const overcodeTheme = {
469 |   colors: [
470 |     "#6c8fff", // blue
471 |     "#4ade80", // green
472 |     "#a78bfa", // purple
473 |     "#fb923c", // amber
474 |     "#5eead4" /* cyan */,
475 |     "#f87171" /* red */,
476 |   ],
477 |   branch: {
478 |     lineWidth: 2,
479 |     spacing: 28,
480 |     label: {
481 |       display: true,
482 |       bgColor: "#1a1a28",
483 |       borderRadius: 4,
484 |       font: "11px JetBrains Mono",
485 |       color: "#e2e8f0",
486 |     },
487 |   },
488 |   commit: {
489 |     spacing: 36,
490 |     hasTooltipInCompactMode: true,
491 |     dot: {
492 |       size: 8,
493 |       strokeWidth: 2,
494 |       strokeColor: "#08080f",
495 |       font: "12px JetBrains Mono",
496 |     },
497 |     message: {
498 |       display: true,
499 |       displayAuthor: false,
500 |       displayHash: true,
501 |       font: "12px JetBrains Mono",
502 |       color: "#8892a4",
503 |     },
504 |   },
505 |   tag: {},
506 |   arrow: { size: 8, offset: 2, color: "#3d4258" },
507 | };
508 | ```
509 | 
510 | **Overlay badges on commit nodes:**
511 | Position: top-right of each commit dot.
512 | 
513 | - PR badge: 14px × 14px circle, `--color-accent-blue-dim` bg, PR number in `--text-xs`
514 | - CI passing dot: 6px circle `--color-accent-green`
515 | - CI failing dot: 6px circle `--color-accent-red`
516 | - CI running dot: 6px circle `--color-accent-amber` with spin animation
517 | 
518 | ---
519 | 
520 | ### 5.9 Uncommitted File Row
521 | 
522 | ```
523 | Layout: horizontal, flex
524 | Padding: --space-2 --space-3
525 | Background: transparent (default) / --color-bg-elevated (hover)
526 | Border-radius: --radius-sm
527 | ```
528 | 
529 | **Status badge (Modified / Added / Deleted / Renamed):**
530 | 
531 | ```css
532 | /* Modified */
533 | background: var(--color-accent-amber-dim);
534 | color: var(--color-accent-amber);
535 | border: 1px solid rgba(251, 146, 60, 0.2);
536 | 
537 | /* Added */
538 | background: var(--color-accent-green-dim);
539 | color: var(--color-accent-green);
540 | border: 1px solid rgba(74, 222, 128, 0.2);
541 | 
542 | /* Deleted */
543 | background: var(--color-accent-red-dim);
544 | color: var(--color-accent-red);
545 | border: 1px solid rgba(248, 113, 113, 0.2);
546 | 
547 | /* Common */
548 | padding: 2px 6px;
549 | border-radius: var(--radius-sm);
550 | font-size: var(--text-xs);
551 | font-family: var(--font-mono);
552 | letter-spacing: var(--tracking-wide);
553 | ```
554 | 
555 | ---
556 | 
557 | ### 5.10 PR / MR Card
558 | 
559 | ```
560 | Background: --color-bg-surface
561 | Border: 1px solid --color-border-default
562 | Border-left: 3px solid [status color]   ← this is the key visual element
563 | Border-radius: --radius-md
564 | Padding: --space-4
565 | Margin-bottom: --space-2
566 | ```
567 | 
568 | **Left border colors by PR status:**
569 | 
570 | - Open: `--color-accent-blue`
571 | - Approved: `--color-accent-green`
572 | - Changes requested: `--color-accent-amber`
573 | - Merged: `--color-accent-purple`
574 | - Draft: `--color-border-default` (no color)
575 | - Closed: `--color-text-muted`
576 | 
577 | ---
578 | 
579 | ### 5.11 Sync Status Indicator
580 | 
581 | Positioned at the top-right of the dashboard. Three states.
582 | 
583 | ```css
584 | .sync-status {
585 |   display: inline-flex;
586 |   align-items: center;
587 |   gap: var(--space-2);
588 |   font-family: var(--font-mono);
589 |   font-size: var(--text-xs);
590 |   letter-spacing: var(--tracking-wide);
591 |   text-transform: uppercase;
592 |   color: var(--color-text-secondary);
593 | }
594 | 
595 | .sync-status .dot {
596 |   width: 7px;
597 |   height: 7px;
598 |   border-radius: 50%;
599 |   flex-shrink: 0;
600 | }
601 | ```
602 | 
603 | **State: Synced (default)**
604 | 
605 | - Text: "EVERYTHING IS IN SYNC"
606 | - Dot: `--color-accent-green` with `box-shadow: 0 0 6px var(--color-accent-green)`
607 | - Dot uses `pulse-dot` animation (2s infinite)
608 | 
609 | **State: Syncing**
610 | 
611 | - Text: "SYNCING…"
612 | - Dot: `--color-accent-amber`
613 | - No glow, faster pulse (1s)
614 | 
615 | **State: Error**
616 | 
617 | - Text: "SYNC ERROR"
618 | - Dot: `--color-accent-red` with glow
619 | - No pulse (steady)
620 | 
621 | ---
622 | 
623 | ### 5.12 Signature Footer
624 | 
625 | A dark brand card at the bottom of the dashboard. From the poster.
626 | 
627 | ```
628 | Background: --color-bg-surface
629 | Border: 1px solid --color-border-default
630 | Border-radius: --radius-md
631 | Padding: --space-5 --space-6
632 | Height: ~90px
633 | Display: grid
634 | Grid-template-columns: auto 1fr auto
635 | Gap: --space-5
636 | Align-items: center
637 | ```
638 | 
639 | **Left cell — pulse icon:**
640 | A 40px circle with `--color-accent-purple-dim` background and a waveform/pulse line icon (Lucide `Activity` or `AudioWaveform`) in `--color-accent-purple` at 20px.
641 | 
642 | **Center cell — text stack:**
643 | 
644 | ```html
645 | <div>
646 |   <div class="footer-headline">NO NOISE. JUST WHAT MATTERS.</div>
647 |   <div class="footer-sub">FILTERED. PRIORITIZED. ACTIONABLE.</div>
648 | </div>
649 | ```
650 | 
651 | ```css
652 | .footer-headline {
653 |   font-family: var(--font-mono);
654 |   font-size: var(--text-md);
655 |   color: var(--color-text-primary);
656 |   letter-spacing: var(--tracking-wide);
657 |   text-transform: uppercase;
658 | }
659 | 
660 | .footer-sub {
661 |   font-family: var(--font-mono);
662 |   font-size: var(--text-xs);
663 |   color: var(--color-text-secondary);
664 |   letter-spacing: var(--tracking-wide);
665 |   text-transform: uppercase;
666 |   margin-top: var(--space-1);
667 | }
668 | ```
669 | 
670 | **Right cell — animated dot-matrix waveform:**
671 | An inline SVG, approximately 200px × 50px, drawing 60 dots in a sine-wave pattern. Dots are 3px circles in `--color-accent-purple` with varying opacity (0.2 to 1.0 based on Y position). Animate the wave by shifting the sine phase over time:
672 | 
673 | ```javascript
674 | // Pseudo-React component
675 | function Waveform() {
676 |   const [phase, setPhase] = useState(0);
677 |   useEffect(() => {
678 |     const id = setInterval(() => setPhase((p) => p + 0.05), 50);
679 |     return () => clearInterval(id);
680 |   }, []);
681 | 
682 |   const dots = Array.from({ length: 60 }, (_, i) => {
683 |     const x = (i / 60) * 200;
684 |     const y = 25 + Math.sin((i / 60) * Math.PI * 4 + phase) * 15;
685 |     const opacity =
686 |       0.3 + Math.abs(Math.sin((i / 60) * Math.PI * 4 + phase)) * 0.7;
687 |     return (
688 |       <circle
689 |         key={i}
690 |         cx={x}
691 |         cy={y}
692 |         r={1.5}
693 |         fill="var(--color-accent-purple)"
694 |         opacity={opacity}
695 |       />
696 |     );
697 |   });
698 | 
699 |   return (
700 |     <svg width="200" height="50" viewBox="0 0 200 50">
701 |       {dots}
702 |     </svg>
703 |   );
704 | }
705 | ```
706 | 
707 | Cycle period: roughly 6 seconds. Subtle, not distracting.
708 | 
709 | ---
710 | 
711 | ## 6. Status Color Reference
712 | 
713 | Quick reference for consistently applying status colors:
714 | 
715 | | State                   | Color Token             | Use case                               |
716 | | ----------------------- | ----------------------- | -------------------------------------- |
717 | | Synced / Live / Passing | `--color-accent-green`  | Feed dot, CI passing, push success     |
718 | | Active / GitHub         | `--color-accent-blue`   | Active branch, GitHub items            |
719 | | Local / Pending         | `--color-accent-amber`  | Uncommitted, local-only changes        |
720 | | Behind / GitLab         | `--color-accent-purple` | Behind remote, GitLab MRs              |
721 | | Conflict / Error        | `--color-accent-red`    | Merge conflict, CI fail                |
722 | | Brand / CLI             | `--color-accent-cyan`   | "CALM SIGNAL", CLI prompts, Bob accent |
723 | 
724 | ---
725 | 
726 | ## 7. Motion & Animation
727 | 
728 | ```css
729 | /* Standard transition for all interactive elements */
730 | --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
731 | --transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
732 | --transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
733 | --transition-panel: 300ms cubic-bezier(0.4, 0, 0.2, 1); /* Slide-in panels */
734 | ```
735 | 
736 | ### Card stagger entrance
737 | 
738 | Feed items and stat cards animate in on mount with a stagger:
739 | 
740 | ```css
741 | @keyframes fade-up {
742 |   from {
743 |     opacity: 0;
744 |     transform: translateY(8px);
745 |   }
746 |   to {
747 |     opacity: 1;
748 |     transform: translateY(0);
749 |   }
750 | }
751 | 
752 | .feed-item {
753 |   animation: fade-up 200ms ease-out both;
754 | }
755 | 
756 | /* Stagger each item */
757 | .feed-item:nth-child(1) {
758 |   animation-delay: 0ms;
759 | }
760 | .feed-item:nth-child(2) {
761 |   animation-delay: 40ms;
762 | }
763 | .feed-item:nth-child(3) {
764 |   animation-delay: 80ms;
765 | }
766 | .feed-item:nth-child(4) {
767 |   animation-delay: 120ms;
768 | }
769 | ```
770 | 
771 | ### Panel slide-in
772 | 
773 | ```css
774 | .bob-panel {
775 |   transform: translateX(100%);
776 |   transition: transform var(--transition-panel);
777 | }
778 | .bob-panel.open {
779 |   transform: translateX(0);
780 | }
781 | ```
782 | 
783 | ### Status dot pulse
784 | 
785 | ```css
786 | @keyframes pulse-dot {
787 |   0%,
788 |   100% {
789 |     opacity: 1;
790 |   }
791 |   50% {
792 |     opacity: 0.4;
793 |   }
794 | }
795 | /* Apply only to live/active dots */
796 | ```
797 | 
798 | ---
799 | 
800 | ## 8. The "OVERCODE" Logo Wordmark
801 | 
802 | The logo in the titlebar area consists of:
803 | 
804 | 1. Two stacked circles left of the wordmark (one filled, one outline — 8px and 10px diameter, `--color-text-primary`)
805 | 2. "OVERCODE" text in `--font-mono`, `--weight-bold`, `--tracking-wide`, `--color-text-primary`, `--text-sm`
806 | 3. "STAY IN SYNC. STAY AHEAD." below in `--font-mono`, `--text-xs`, `--color-text-secondary`, `--tracking-wide`
807 | 
808 | The giant dot-matrix "OVERCODE" in the poster is a marketing illustration only and does NOT appear in the app UI.
809 | 
810 | ---
811 | 
812 | ## 9. CLI / Terminal Style Elements
813 | 
814 | The app uses terminal-style elements for certain UI moments (Bob output, commit messages, command hints).
815 | 
816 | **CLI prompt styling:**
817 | 
818 | ```css
819 | .cli-prompt::before {
820 |   content: "> ";
821 |   color: var(--color-text-muted);
822 |   font-family: var(--font-mono);
823 | }
824 | 
825 | .cli-command {
826 |   color: var(--color-accent-cyan);
827 |   font-family: var(--font-mono);
828 | }
829 | 
830 | .cli-output {
831 |   color: var(--color-text-secondary);
832 |   font-family: var(--font-mono);
833 | }
834 | ```
835 | 
836 | ---
837 | 
838 | ## 10. Do Not
839 | 
840 | - **DO NOT** use white or light backgrounds anywhere
841 | - **DO NOT** use purple gradients on white (classic AI tool aesthetic — avoid completely)
842 | - **DO NOT** use Inter or Roboto as the primary UI font — JetBrains Mono is the primary font
843 | - **DO NOT** use rounded pill shapes for PR status badges — use the left-border pattern on cards instead
844 | - **DO NOT** add drop shadows — use border and bg contrast for elevation
845 | - **DO NOT** use emojis in the UI — use Lucide React icons only
846 | - **DO NOT** use blue text links — use icon buttons for actions
847 | - **DO NOT** animate anything on hover that takes longer than 200ms — it will feel sluggish
848 | 
849 | ---
850 | 
851 | _Overcode Design System v1.0 — extracted from official brand poster, May 2026_

</file_content>
<environment_details>
# VSCode Visible Files


# VSCode Open Tabs
package.json,.env,OvercodePRD.md

# Current Time
Current time in ISO 8601 UTC format: 2026-05-15T18:57:14.950Z
User time zone: Africa/Lagos, UTC+1:00

# Current Cost
$0.00

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>


# Current Workspace Directory (/home/timidan/Desktop/persona/overcode) Files
.env
.eslintrc.cjs
.gitignore
design system.md
electron-builder.json5
index.html
Lablab-IBM-Bob-hackathon-guide-May-2026.pdf
OvercodePRD.md
package-lock.json
package.json
README.md
tsconfig.json
tsconfig.node.json
vite.config.ts
.vscode/
electron/
electron/electron-env.d.ts
electron/main.ts
electron/preload.ts
public/
public/electron-vite.animate.svg
public/electron-vite.svg
public/vite.svg
src/
src/App.css
src/App.tsx
src/index.css
src/main.tsx
src/vite-env.d.ts
src/assets/
src/assets/react.svg
You have not created a todo list yet. Create one with `update_todo_list` if your task is complicated or involves multiple steps.
</environment_details>

---

**Assistant:**

# Conversation Summary

## 1. Previous Conversation

The user is building **Overcode**, a desktop developer workspace hub for the IBM Bob Hackathon (May 15-17, 2026). The project uses Electron + React + TypeScript with vanilla CSS (no Tailwind), electron-store for persistence (no native modules), and watsonx.ai Granite for runtime AI features. The goal is to create a unified interface for managing Git repositories across GitHub, GitLab, and local environments with four AI-powered features: Impact Analysis, Commit Assistant, Stash Annotator, and Repo Onboarding Brief.

## 2. Current Work

Successfully completed Tasks 1-3 and currently implementing Tasks 4-11 from `bob_prompts.md`:

**Task 1-3 (Completed):**
- Created complete IPC architecture with all 27 channels
- Set up electron-store with full schema and CRUD operations
- Established Utility Process worker pattern for git operations

**Task 4 (Completed):**
- Created `electron/mock-data.ts` with `getMockData()` function
- 4 repositories (design-system, backend-api, marketing-website, infra-tools)
- 25 activity items spanning 24 hours with realistic event types

**Task 5 (In Progress):**
- Created `src/lib/seed.ts` for seeding electron-store if empty
- Created `src/components/Sidebar.tsx` with 9 icons (5 functional, 4 decorative)
- Created `src/components/StatCard.tsx` for dashboard statistics
- Created `src/components/SyncStatusIndicator.tsx` (stub without pulse animation)
- Created `src/components/SignatureFooter.tsx` (stub without waveform)
- All components have co-located CSS files
- Still need to create `src/screens/Dashboard.tsx` to wire everything together

## 3. Key Technical Concepts

- **Electron Architecture**: Main process (`electron/`), preload script, renderer (`src/`)
- **IPC Channels**: Exactly 27 channels defined in AGENTS.md (auth, git, github, gitlab, ai, store)
- **Utility Process**: Git operations run in separate process via `utilityProcess.fork()` to prevent UI freezing
- **electron-store**: JSON-based persistence with schema for accounts, repositories, granite_cache, activity, settings
- **CSS Variables**: All styling uses design tokens from `DESIGN_SYSTEM.md` (no hardcoded colors)
- **Mock Data Pattern**: Seed store on first run, use IPC to fetch data
- **Zustand**: State management (not yet implemented)
- **react-window**: Virtual list for performance (not yet implemented)

## 4. Relevant Files and Code

**electron/main.ts**
- Main process entry with `dotenv.config()` at top
- Spawns git worker via `utilityProcess.fork()`
- Registers all IPC handlers

**electron/ipc-handlers.ts**
- All 27 IPC channel handlers registered
- Routes git operations to Utility Process worker
- Store operations connected to `electron/lib/store.ts`
- Additional helper channels for repo/activity/cache CRUD

**electron/lib/store.ts**
- Complete electron-store implementation
- TypeScript interfaces: `StoreSchema`, `Repository`, `ActivityItem`, `Account`, `Settings`
- CRUD functions: `getRepo()`, `setRepo()`, `listRepos()`, `getActivity()`, `addActivity()` (500-entry cap), `getCache()`, `setCache()`

**electron/mock-data.ts**
- `getMockData()` returns complete `StoreSchema`
- 4 repos, 25 activity items with realistic timestamps

**electron/workers/git-worker.ts**
- Utility Process worker (stub handlers)
- Uses `process.parentPort` for IPC (not imported from 'electron')

**electron/preload.ts**
- Exposes `window.api` via contextBridge
- All 27 channels grouped by domain

**src/lib/ipc.ts**
- Typed wrapper class with methods for all IPC channels
- Singleton `ipc` instance exported

**src/lib/seed.ts**
- `seedIfEmpty()` function to populate store with mock data on first run

**src/components/Sidebar.tsx + .css**
- 48px wide, icon-only sidebar
- 9 icons: Code (Dashboard), Home, GitBranch, Monitor*, Database*, Bell*, Filter*, Sparkles (AI), Settings
- *Decorative icons with `pointer-events: none`
- Active state uses gradient background

**src/components/StatCard.tsx + .css**
- Displays icon, number, label
- Uses CSS variables for all styling

**src/components/SyncStatusIndicator.tsx + .css**
- Green dot + "EVERYTHING IS IN SYNC" text
- No pulse animation yet (Task 23)

**src/components/SignatureFooter.tsx + .css**
- Two-line text display
- No waveform animation yet (Task 23)

## 5. Problem Solving

**Issue**: electron-store not installed
**Solution**: Ran `npm install electron-store`

**Issue**: Git worker not building
**Solution**: Added worker entry to `vite.config.ts` to build to `dist-electron/workers/git-worker.js`

**Issue**: TypeScript errors with unused parameters
**Solution**: Prefixed unused params with underscore (`_body`, `_value`, etc.)

**Issue**: Worker `parentPort` import error
**Solution**: Used `process.parentPort` directly (no import needed in Utility Process)

## 6. Pending Tasks and Next Steps

**Immediate Next Steps (Task 5 completion):**
1. Create `src/screens/Dashboard.tsx` with:
   - Four-layer layout: header (with SyncStatusIndicator), stat cards row, activity feed placeholder, SignatureFooter
   - Wire Sidebar with `selectedScreen` state
   - Call `seedIfEmpty()` on mount
   - Fetch activity from store and derive stat counts
   - Use StatCard components with correct icons/colors per DESIGN_SYSTEM.md

**Remaining Tasks 6-11:**
- Task 6: Activity Feed with react-window, FilterTabs, ActivityItem, BranchBadge, StatusDot
- Task 7: Granite client (`electron/lib/granite.ts`) with IAM token management
- Task 8: AI Panel + Impact Analysis feature
- Task 9: Commit Assistant feature
- Task 10: Repo Brief feature  
- Task 11: Stash Annotator with `useStashLabels` hook

**Direct Quote from Task 5 Prompt:**
```
"Use the IPC singleton from src/lib/ipc.ts to fetch via `ipc.getFromStore("activity")` and derive stat counts client-side. For now, also call `ipc.setInStore("__seed__", getMockDataResult)` once on mount if `ipc.listStoreKeys()` returns empty — but the seeding logic must live in src/lib/seed.ts (one function, `seedIfEmpty()`), not in Dashboard."
```

**Constraints from bob_prompts.md:**
- Create/modify ONLY the files listed in each task
- Export ONLY the symbols listed
- Do not invent new IPC channels (use only the 28 from AGENTS.md)
- Output code only, no summary or markdown report
- Use lucide-react for all icons, no custom SVGs

---

**User:**

[write_to_file for 'src/components/SignatureFooter.css'] Result:
<file_write_result>
<path>src/components/SignatureFooter.css</path>
<operation>created</operation>
<notice>
<i>You do not need to re-read the file, as you have seen all changes</i>
<i>Proceed with the task using these changes as the new baseline.</i>
</notice>
</file_write_result>

<environment_details>
# VSCode Visible Files
src/components/SignatureFooter.css

# VSCode Open Tabs
package.json,.env,OvercodePRD.md,src/vite-env.d.ts,electron/main.ts,electron/workers/git-worker.ts,vite.config.ts,electron/lib/store.ts,electron/ipc-handlers.ts,electron/mock-data.ts,src/lib/seed.ts,src/components/Sidebar.tsx,src/components/Sidebar.css,src/components/StatCard.tsx,src/components/StatCard.css,src/components/SyncStatusIndicator.tsx,src/components/SyncStatusIndicator.css,src/components/SignatureFooter.tsx,src/components/SignatureFooter.css,AGENTS.md

# Current Time
Current time in ISO 8601 UTC format: 2026-05-15T19:59:38.693Z
User time zone: Africa/Lagos, UTC+1:00

# Current Cost
$15.62

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**

# Current Mode
<slug>code</slug>
<name>💻 Code</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Plan IPC architecture structure | Pending |
| 2 | Review and approve plan | Pending |
| 3 | Switch to Code mode and implement skeleton | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

Now the Dashboard screen:

<write_to_file>
<path>src/screens/Dashboard.tsx</path>
<content>
import { useState, useEffect } from 'react';
import { Code, GitBranch, Folder, Monitor } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { StatCard } from '../components/StatCard';
import { SyncStatusIndicator } from '../components/SyncStatusIndicator';
import { SignatureFooter } from '../components/SignatureFooter';
import { ipc } from '../lib/ipc';
import { seedIfEmpty } from '../lib/seed';
import './Dashboard.css';

export function Dashboard() {
  const [selectedScreen, setSelectedScreen] = useState('dashboard');
  const [stats, setStats] = useState({
    commits: 0,
    prs: 0,
    repos: 0,
    localChanges: 0,
  });

  useEffect(() => {
    async function loadData() {
      await seedIfEmpty();
      
      const activity = await ipc.getFromStore('activity');
      if (activity && Array.isArray(activity)) {
        const commits = activity.filter(a => a.type === 'commit' || a.type === 'push').length;
        const prs = activity.filter(a => a.type === 'pr_opened' || a.type === 'pr_merged').length;
        const repos = new Set(activity.map(a => a.repo_id)).size;
        const localChanges = activity.filter(a => a.type === 'stash').length;
        
        setStats({ commits, prs, repos, localChanges });
      }
    }
    
    loadData();
  }, []);

  return (
    <div className="dashboard-container">
      <Sidebar selectedScreen={selectedScreen} onScreenChange={setSelectedScreen} />
      
      <main className="dashboard-main">
        <header className="dashboard-header">
          <h1 className="dashboard-title">OVERCODE</h1>
          <SyncStatusIndicator />
        </header>

        <div className="stat-cards">
          <StatCard
            icon={Code}
            iconColor="var(--color-accent-blue)"
            number={stats.commits}
            label="COMMITS SYNCED"
          />
          <StatCard
            icon={GitBranch}
            iconColor="var(--color-accent-green)"
            number={stats.prs}
            label="PULL REQUESTS UPDATED"
          />
          <StatCard
            icon={Folder}
            iconColor="var(--color-accent-purple)"
            number={stats.repos}
            label="REPOSITORIES UPDATED"
          />
          <StatCard
            icon={Monitor}
            iconColor="var(--color-accent-amber)"
            number={stats.localChanges}
            label="LOCAL CHANGES DETECTED"
          />
        </div>

        <div className="activity-section">
          <div className="activity-placeholder">Activity Feed</div>
        </div>

        <SignatureFooter />
      </main>
    </div>
  );
}
</content>
<line_count>84</line_count>
</write_to_file>

---

**User:**

[write_to_file for 'src/screens/Dashboard.tsx'] Result:
<file_write_result>
<path>src/screens/Dashboard.tsx</path>
<operation>created</operation>
<notice>
<i>You do not need to re-read the file, as you have seen all changes</i>
<i>Proceed with the task using these changes as the new baseline.</i>
</notice>
</file_write_result>

<environment_details>
# VSCode Visible Files
src/screens/Dashboard.tsx

# VSCode Open Tabs
package.json,.env,OvercodePRD.md,src/vite-env.d.ts,electron/main.ts,electron/workers/git-worker.ts,vite.config.ts,electron/lib/store.ts,electron/ipc-handlers.ts,electron/mock-data.ts,src/lib/seed.ts,src/components/Sidebar.tsx,src/components/Sidebar.css,src/components/StatCard.tsx,src/components/StatCard.css,src/components/SyncStatusIndicator.tsx,src/components/SyncStatusIndicator.css,src/components/SignatureFooter.tsx,src/components/SignatureFooter.css,src/screens/Dashboard.tsx

# Current Time
Current time in ISO 8601 UTC format: 2026-05-15T19:59:51.982Z
User time zone: Africa/Lagos, UTC+1:00

# Current Cost
$15.97

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**

# Current Mode
<slug>code</slug>
<name>💻 Code</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Plan IPC architecture structure | Pending |
| 2 | Review and approve plan | Pending |
| 3 | Switch to Code mode and implement skeleton | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

<write_to_file>
<path>src/screens/Dashboard.css</path>
<content>
.dashboard-container {
  display: flex;
  height: 100vh;
  background: var(--color-bg-app);
}

.dashboard-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: var(--space-6);
  gap: var(--space-6);
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border-subtle);
}

.dashboard-title {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-wide);
  color: var(--color-text-primary);
  text-transform: uppercase;
  margin: 0;
}

.stat-cards {
  display: flex;
  gap: var(--space-4);
}

.activity-section {
  flex: 1;
  min-height: 300px;
}

.activity-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
}
</content>
<line_count>56</line_count>
</write_to_file>

---

**User:**

[write_to_file for 'src/screens/Dashboard.css'] Result:
<file_write_result>
<path>src/screens/Dashboard.css</path>
<operation>created</operation>
<notice>
<i>You do not need to re-read the file, as you have seen all changes</i>
<i>Proceed with the task using these changes as the new baseline.</i>
</notice>
</file_write_result>

<environment_details>
# VSCode Visible Files
src/screens/Dashboard.css

# VSCode Open Tabs
package.json,.env,OvercodePRD.md,src/vite-env.d.ts,electron/main.ts,electron/workers/git-worker.ts,vite.config.ts,electron/lib/store.ts,electron/ipc-handlers.ts,electron/mock-data.ts,src/lib/seed.ts,src/components/Sidebar.tsx,src/components/Sidebar.css,src/components/StatCard.tsx,src/components/StatCard.css,src/components/SyncStatusIndicator.tsx,src/components/SyncStatusIndicator.css,src/components/SignatureFooter.tsx,src/components/SignatureFooter.css,src/screens/Dashboard.tsx

# Current Time
Current time in ISO 8601 UTC format: 2026-05-15T20:00:45.619Z
User time zone: Africa/Lagos, UTC+1:00

# Current Cost
$16.39

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**

# Current Mode
<slug>code</slug>
<name>💻 Code</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Plan IPC architecture structure | Pending |
| 2 | Review and approve plan | Pending |
| 3 | Switch to Code mode and implement skeleton | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

Now update App.tsx to render the Dashboard:

<write_to_file>
<path>src/App.tsx</path>
<content>
import { Dashboard } from './screens/Dashboard';
import './App.css';

function App() {
  return <Dashboard />;
}

export default App;
</content>
<line_count>8</line_count>
</write_to_file>

---

**User:**

[write_to_file for 'src/App.tsx'] Result:
<file_write_result>
<path>src/App.tsx</path>
<operation>modified</operation>
<notice>
<i>You do not need to re-read the file, as you have seen all changes</i>
<i>Proceed with the task using these changes as the new baseline.</i>
</notice>
</file_write_result>

<environment_details>
# VSCode Visible Files
src/App.tsx

# VSCode Open Tabs
package.json,.env,OvercodePRD.md,src/vite-env.d.ts,electron/main.ts,electron/workers/git-worker.ts,vite.config.ts,electron/lib/store.ts,electron/ipc-handlers.ts,electron/mock-data.ts,src/lib/seed.ts,src/components/Sidebar.tsx,src/components/Sidebar.css,src/components/StatCard.tsx,src/components/StatCard.css,src/components/SyncStatusIndicator.tsx,src/components/SyncStatusIndicator.css,src/components/SignatureFooter.tsx,src/components/SignatureFooter.css,src/screens/Dashboard.tsx

# Current Time
Current time in ISO 8601 UTC format: 2026-05-15T20:00:51.187Z
User time zone: Africa/Lagos, UTC+1:00

# Current Cost
$16.47

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**

# Current Mode
<slug>code</slug>
<name>💻 Code</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Plan IPC architecture structure | Pending |
| 2 | Review and approve plan | Pending |
| 3 | Switch to Code mode and implement skeleton | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

<write_to_file>
<path>src/App.css</path>
<content>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-mono);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#root {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
</content>
<line_count>19</line_count>
</write_to_file>

---

**User:**

[write_to_file for 'src/App.css'] Result:
<file_write_result>
<path>src/App.css</path>
<operation>modified</operation>
<notice>
<i>You do not need to re-read the file, as you have seen all changes</i>
<i>Proceed with the task using these changes as the new baseline.</i>
</notice>
</file_write_result>

<environment_details>
# VSCode Visible Files
src/App.css

# VSCode Open Tabs
package.json,.env,OvercodePRD.md,src/vite-env.d.ts,electron/main.ts,electron/workers/git-worker.ts,vite.config.ts,electron/lib/store.ts,electron/ipc-handlers.ts,electron/mock-data.ts,src/lib/seed.ts,src/components/Sidebar.tsx,src/components/Sidebar.css,src/components/StatCard.tsx,src/components/StatCard.css,src/components/SyncStatusIndicator.tsx,src/components/SyncStatusIndicator.css,src/components/SignatureFooter.tsx,src/components/SignatureFooter.css,src/screens/Dashboard.tsx

# Current Time
Current time in ISO 8601 UTC format: 2026-05-15T20:00:56.899Z
User time zone: Africa/Lagos, UTC+1:00

# Current Cost
$16.56

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**

# Current Mode
<slug>code</slug>
<name>💻 Code</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Plan IPC architecture structure | Pending |
| 2 | Review and approve plan | Pending |
| 3 | Switch to Code mode and implement skeleton | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

<update_todo_list>
<todos>
[x] Plan IPC architecture structure
[x] Review and approve plan
[x] Switch to Code mode and implement skeleton
[x] Create Dashboard screen with all components
</todos>
</update_todo_list>

---

**User:**

[update_todo_list] Result:
Todo list updated successfully.
<environment_details>
# VSCode Visible Files
src/App.css

# VSCode Open Tabs
package.json,.env,OvercodePRD.md,src/vite-env.d.ts,electron/main.ts,electron/workers/git-worker.ts,vite.config.ts,electron/lib/store.ts,electron/ipc-handlers.ts,electron/mock-data.ts,src/lib/seed.ts,src/components/Sidebar.tsx,src/components/Sidebar.css,src/components/StatCard.tsx,src/components/StatCard.css,src/components/SyncStatusIndicator.tsx,src/components/SyncStatusIndicator.css,src/components/SignatureFooter.tsx,src/components/SignatureFooter.css,src/screens/Dashboard.tsx

# Current Time
Current time in ISO 8601 UTC format: 2026-05-15T20:02:38.681Z
User time zone: Africa/Lagos, UTC+1:00

# Current Cost
$16.65

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**

# Current Mode
<slug>code</slug>
<name>💻 Code</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Plan IPC architecture structure | Completed |
| 2 | Review and approve plan | Completed |
| 3 | Switch to Code mode and implement skeleton | Completed |
| 4 | Create Dashboard screen with all components | Completed |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

<attempt_completion>
<result>
Task 5 (Dashboard Shell) complete:

**Created Components:**
- `src/components/Sidebar.tsx` + `.css` - 48px icon-only sidebar with 9 icons (5 functional, 4 decorative)
- `src/components/StatCard.tsx` + `.css` - Stat display with icon, number, label
- `src/components/SyncStatusIndicator.tsx` + `.css` - Green dot + "EVERYTHING IS IN SYNC" text (stub, no pulse yet)
- `src/components/SignatureFooter.tsx` + `.css` - Two-line brand tagline (stub, no waveform yet)

**Created Screens:**
- `src/screens/Dashboard.tsx` + `.css` - Four-layer layout: header with sync status, stat cards row, activity feed placeholder, signature footer

**Integration:**
- Updated `src/App.tsx` to render Dashboard
- Updated `src/App.css` with base reset styles
- Dashboard calls `seedIfEmpty()` on mount to populate electron-store with mock data
- Fetches activity via IPC and derives stat counts client-side
- All components use CSS variables from design system (no hardcoded colors)
- JetBrains Mono as primary font throughout

**Sidebar Icons (in order):**
1. Code (Dashboard) - functional, default active
2. Home (Repositories) - functional
3. GitBranch (PRs) - functional
4. Monitor - decorative
5. Database - decorative
6. Bell - decorative
7. Filter - decorative
8. Sparkles (AI Panel) - functional
9. Settings - functional, pushed to bottom

Ready for Task 6 (Activity Feed with react-window).
</result>
</attempt_completion>

