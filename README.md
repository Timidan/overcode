<p align="center">
  <img src="public/brand/current/overcode-banner-dark-nobg.svg" alt="Overcode — all your workspace updates, one calm signal" width="820">
</p>

<h1 align="center">Overcode</h1>

<p align="center">
  <strong>A native desktop hub for Git workspaces, repository state, and AI-assisted operations</strong>
  <br>
  Powered by IBM watsonx.ai Granite. Built with IBM Bob.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-1e40af?style=flat-square" alt="Version 0.1.0">
  <img src="https://img.shields.io/badge/Built%20with-IBM%20Bob-0f62fe?style=flat-square" alt="Built with IBM Bob">
  <img src="https://img.shields.io/badge/Powered%20by-watsonx.ai%20Granite-1f70c1?style=flat-square" alt="Powered by watsonx.ai Granite">
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-374151?style=flat-square" alt="macOS, Windows, Linux">
  <img src="https://img.shields.io/badge/Runtime-Electron%2030-47848f?style=flat-square" alt="Electron 30">
</p>

---

## What Overcode is

Overcode is a native desktop application that consolidates local Git state, GitHub, and GitLab into a single operator workspace, and applies IBM watsonx.ai Granite to translate that state into actionable answers. It is built for an engineer who maintains more than one repository, monitors more than one pull request, and switches between branches, worktrees, and stashes during a normal working day.

The data plane is local. Repositories are read directly from disk through `simple-git` in an isolated worker process. Remote provider data is pulled per-account through user-scoped OAuth and cached locally. AI calls are explicit and recorded in a local audit log. There is no Overcode backend.

This is the IBM Bob Hackathon, May 2026 submission.

---

## Capabilities

### Workspace and repository operations

| Capability           | What it does                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Local workspace scan | Recursively discovers Git repositories beneath operator-configured roots (defaults: `~/projects`, `~/Desktop/persona`, `~/Desktop`).   |
| Repository dashboard | Per-repository view of branches, uncommitted files, stashes, worktrees, recent commits, with `chokidar` refresh on file-system change. |
| Activity feed        | Unified chronological feed of commits, pull-request transitions, issue updates, and pipeline outcomes across all linked accounts.      |
| Pull-request console | Combined GitHub PRs + GitLab MRs with hunk-level navigation.                                                                           |
| Issue console        | Cross-provider issue list with assignee and linked-PR context.                                                                         |

### AI-assisted operations

The application ships eleven AI features routed through a single `callGranite` entry point at [`electron/lib/granite.ts`](electron/lib/granite.ts). The default model is `ibm/granite-4-h-small`; `ibm/granite-3-3-8b-instruct` and `ibm/granite-3-2-8b-instruct` are also available under Settings → AI. Each model is health-probed at startup.

Eight features are exposed through the AI panel:

| Feature          | Function                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Impact analysis  | Reads the current uncommitted diff and file tree; returns affected modules and a single recommended next action. |
| Commit assistant | Drafts a conventional-commits message and PR description from staged changes.                                    |
| Repository brief | New-team-member briefing: purpose, key modules, recent activity, notable conventions.                            |
| Stash annotator  | Generates a plain-language label for every stash entry, cached per stash reference.                              |
| Worktree compare | Compares a worktree against a base branch; classifies review-readiness.                                          |
| Code explain     | Inspector-panel explanation of any file or selection at any reference.                                           |
| Issue triage     | Severity classification, suggested owner, related-PR linkage.                                                    |
| Daily standup    | Cross-repository activity rollup, formatted for Slack or stand-up delivery.                                      |

Three additional features are invoked inline on the pull-request views:

| Feature           | Function                                                      |
| ----------------- | ------------------------------------------------------------- |
| PR review summary | Section-by-section structured review of any PR or MR.         |
| PR hunk review    | Inline-comment-style feedback on a selected diff hunk.        |
| PR file change    | Per-file analysis: risks, missing tests, suggested revisions. |

Each call validates the Granite response against a feature-specific JSON schema. On parse failure the response is repaired and reissued once; if repair fails, the panel falls back to a local-data-only envelope rather than surfacing a parse exception.

---

## Why a native desktop app, not a web app

Overcode reads local files and watches them continuously. That is the load-bearing constraint. Every other design choice follows.

**The data plane is local.** The product's primary inputs are `.git` metadata, uncommitted changes, stashes, worktrees, and source files at arbitrary refs. A web application can reach this data only through the File System Access API, which requires per-folder operator consent each session, returns no usable change notifications, and is unavailable in Firefox and Safari. A native client reads the working tree directly, with OS file permissions as the access boundary — no companion agent, no helper daemon, no per-folder dialog.

**Continuous watching survives only outside the browser.** Sub-second dashboard accuracy requires file watchers that keep running while the operator is in another window. Overcode runs `chokidar` inside an Electron `utilityProcess` worker. Browser tabs are throttled when backgrounded, discarded under memory pressure, and suspended by the operating system. None of that is acceptable for a workspace dashboard.

**No backend means no shared attack surface.** A hosted version would require a callback host with a public TLS certificate, a token-storage backend, a refresh-token rotation job, and a multi-tenant data plane. Overcode has none of those because the OAuth callback is served on `127.0.0.1`, tokens are stored on the operator's endpoint, and Granite calls go directly from the operator's machine to the operator's configured watsonx.ai region. There is nothing in the middle to compromise.

**Local-first behavior.** The dashboard, repository views, activity feed, stash and worktree views remain fully operational without network connectivity. AI features and provider sync require connectivity; the local views do not.

**One artifact to deploy.** A signed `.dmg`, `.exe`, or `.AppImage` is one file to inventory, allow-list, and distribute. There is no SaaS subscription to procure and no data-processing agreement to negotiate before an engineer can try the product on a real repository.

A short comparison:

| Concern                   | Native desktop (Overcode)                                                                                                                                           | Hosted web equivalent                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Local repository access   | Direct, gated by OS permissions                                                                                                                                     | File System Access API; per-session consent; Firefox/Safari gaps |
| File-system change events | Continuous via `chokidar` in utility process                                                                                                                        | Throttled and discarded when backgrounded                        |
| OAuth callback            | `127.0.0.1`, started on-demand, torn down after use                                                                                                                 | Publicly-routable host; certificate management                   |
| Credential storage        | `electron-store` on the operator's endpoint, encrypted via OS keystore when `safeStorage` is available; otherwise plaintext on disk with renderer-side IPC blocking | Browser `localStorage` or session backend                        |
| Connectivity              | Local views work offline; AI and provider sync require network                                                                                                      | Entirely unavailable offline                                     |
| Procurement surface       | Single binary artifact                                                                                                                                              | SaaS subscription and data-processing agreement                  |
| Data transit to vendor    | None except explicit Granite calls                                                                                                                                  | All operator data                                                |

---

## Architecture overview

Three isolated process tiers:

1. **Main process** ([`electron/`](electron/)) — IPC handlers, OAuth callback server (ports 3000 and 3001), watsonx.ai Granite client, `electron-store` persistence at `~/.overcode/config.json`.
2. **Preload bridge** ([`electron/preload.ts`](electron/preload.ts)) — typed `window.api` exposed via `contextBridge`. Twenty-eight IPC channels grouped under `auth:`, `git:`, `github:`, `gitlab:`, `ai:`, `store:`, with a single `shell:open` channel that validates URLs against a host allowlist.
3. **Renderer** ([`src/`](src/)) — React 18 + TypeScript. Zustand for navigation, AI panel, theme, and command-palette state. A single design-token source at `src/styles/variables.css` drives both light and dark themes via `<html data-theme="…">`.

`simple-git` and `chokidar` run in a dedicated Electron `utilityProcess` worker so the main process and renderer remain responsive against large repositories.

Architecture diagrams are in [`ARCHITECTURE_DIAGRAMS.md`](ARCHITECTURE_DIAGRAMS.md) and the accompanying Excalidraw source files at the repository root.

---

## System requirements

| Component        | Minimum                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Operating system | macOS 11, Windows 10 22H2, or glibc 2.31+ Linux                                                          |
| Memory           | 4 GB available                                                                                           |
| Disk             | 500 MB for the application, plus repository-metadata cache                                               |
| Network          | Outbound HTTPS to `*.cloud.ibm.com`, `github.com`, `gitlab.com`, and any enterprise instances configured |
| Accounts         | IBM Cloud account with watsonx.ai enabled. Optional: GitHub and GitLab OAuth applications.               |

---

## Installation

Pre-built installers for v0.1.0 are attached to the [GitHub release](https://github.com/Timidan/overcode/releases/tag/v0.1.0). Pick the section below that matches your operating system.

### Linux (AppImage)

```bash
# Download
curl -L -o Overcode-Linux-0.1.0.AppImage \
  https://github.com/Timidan/overcode/releases/download/v0.1.0/Overcode-Linux-0.1.0.AppImage

# Mark executable and run
chmod +x Overcode-Linux-0.1.0.AppImage
./Overcode-Linux-0.1.0.AppImage
```

If the AppImage refuses to start with a "namespace sandbox" or "chrome-sandbox" error (some Arch/Manjaro, Fedora-with-SELinux, and hardened kernels):

```bash
OVERCODE_NO_SANDBOX=1 ./Overcode-Linux-0.1.0.AppImage
```

Optionally integrate with your desktop environment via [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher).

### Windows (NSIS installer)

1. Download `Overcode-Windows-0.1.0-Setup.exe` from the [release page](https://github.com/Timidan/overcode/releases/tag/v0.1.0).
2. The v0.1.0 installer is **unsigned**. On first launch, Windows SmartScreen will display "Windows protected your PC". Click **More info → Run anyway** to proceed.
3. Run the installer with standard user privileges. The default installation directory is per-user, under `%LOCALAPPDATA%\Programs\Overcode`. The installer presents a directory chooser if you prefer a custom path.
4. Launch Overcode from the Start menu.

A signed installer is scheduled for the next maintenance release.

### macOS — three practical options

A signed and notarized `.dmg` is not produced for v0.1.0 because the build host is Linux and Apple Developer ID signing requires macOS. The following three paths cover every macOS evaluator scenario:

#### Option A — Wait for the CI-built DMG (recommended once available)

The [`.github/workflows/release.yml`](.github/workflows/release.yml) matrix runs on a `macos-latest` runner when a `v*` tag is pushed and produces `Overcode-Mac-<version>-Installer.dmg`. The DMG is attached to the GitHub release.

The CI build is **unsigned** for v0.1.0. Gatekeeper will block first launch. Workarounds:

- Right-click the application in the Applications folder → **Open** → confirm in the dialog.
- Or: System Settings → Privacy & Security → scroll to "Overcode was blocked..." → **Open Anyway**.

#### Option B — Run from source (fastest for evaluators with Node installed)

```bash
git clone https://github.com/Timidan/overcode.git
cd overcode
npm install
cp .env.example .env       # optional; only needed for the env-var credential path
npm run dev
```

The application launches as an Electron development build. Hot-reload is wired up; edits to `src/` are reflected without a restart.

#### Option C — Build locally on a Mac

```bash
git clone https://github.com/Timidan/overcode.git
cd overcode
npm install
npm run build
# Output: release/0.1.0/Overcode-Mac-0.1.0-Installer.dmg
```

The local DMG is also unsigned. Open via the same right-click → **Open** workaround above.

---

## Running Overcode

### First launch

1. Overcode prompts you to confirm the workspace scan roots. The defaults are `~/projects`, `~/Desktop/persona`, `~/Desktop`. Add or remove roots at any time under **Settings → Workspace directories**.
2. The application performs an initial recursive scan and populates the dashboard, activity feed, repository list, and the per-repository views with **real data from your local file system**. No AI calls happen at this stage.
3. To enable the AI features (Impact analysis, Commit assistant, Repository brief, etc.), enter your IBM watsonx.ai credentials. See [API key setup](#api-key-setup) below.
4. To enable GitHub or GitLab integration (PR/MR sync, issue console, pipelines, comment posting), connect under **Settings → Integrations**. Both providers are optional; local Git views are fully usable without either.

### Subsequent launches

Overcode is a long-running application. The activity feed and dashboard refresh from `chokidar` file-system events; remote provider data is refreshed on a polling schedule and persisted to the local cache so the UI is responsive across launches.

### Reset

To remove all stored state — credentials, OAuth tokens, scan results, audit log — delete `~/.overcode/` (or run `./scripts/clean-start.sh --reset-user-data` if running from source).

---

## API key setup

Overcode's twelve AI features require IBM watsonx.ai credentials. There are two supported paths; both are recognized by the same `callGranite` entry point. Stored values take precedence over environment variables when both are present.

### Path 1 — In-app entry (recommended for the packaged installer)

1. Provision a free [IBM Cloud account](https://cloud.ibm.com) and enable watsonx.ai.
2. Create a watsonx.ai project. Note the **Project ID** from the project's General page.
3. Generate an API key under IBM Cloud → Manage → Access (IAM) → **API keys → Create**.
4. Identify your region endpoint URL (commonly `https://us-south.ml.cloud.ibm.com` for Dallas, or your provisioned region).
5. Launch Overcode and open **Settings → AI → Credentials**.
6. Paste the three values into the API key, Project ID, and Region URL fields. Click **Save credentials**.
7. The three credential badges should flip from "Not set" to **"Stored (encrypted on device)"**. Settings calls `Refresh` automatically and the model health probe runs.

Credentials are persisted to `~/.overcode/config.json` and encrypted using the operating-system keystore via Electron `safeStorage` whenever it is available (macOS Keychain, Windows DPAPI, GNOME Keyring / KWallet on Linux). On systems without a keystore, values are written as plaintext in the same file. The credential badge in Settings → AI displays which path is in effect ("Stored (encrypted on device)" indicates the keystore-backed path).

To remove stored credentials, click **Clear stored** under the same panel. If a `WATSONX_*` environment variable is set, the credential badge will then display **"From environment"**.

### Path 2 — Environment variables (recommended for `npm run dev` and CI)

Copy [`.env.example`](.env.example) to `.env` and populate the three values. Required keys:

| Key                  | Example                                     |
| -------------------- | ------------------------------------------- |
| `WATSONX_API_KEY`    | the IBM Cloud IAM API key from step 3 above |
| `WATSONX_PROJECT_ID` | the watsonx.ai project ID from step 2 above |
| `WATSONX_URL`        | e.g. `https://us-south.ml.cloud.ibm.com`    |

When running from source, `dotenv` loads `.env` at startup. The credential badge displays **"From environment"** for any field satisfied this way. The `.env` file is `.gitignore`-d.

### Optional — GitHub and GitLab OAuth

If you want the unified PR / issue / pipeline console, register OAuth applications and enter the client credentials under **Settings → Integrations**:

| Provider | OAuth application callback URL   | Where to register                                                       |
| -------- | -------------------------------- | ----------------------------------------------------------------------- |
| GitHub   | `http://127.0.0.1:3000/callback` | github.com → Settings → Developer settings → OAuth Apps → New OAuth App |
| GitLab   | `http://127.0.0.1:3001/callback` | gitlab.com → Edit profile → Applications → Add new application          |

Both providers are entirely optional. The local Git views, dashboard, repository drill-in, stash, and worktree views work without either.

---

## Build from source

```bash
git clone https://github.com/Timidan/overcode.git
cd overcode
npm install
cp .env.example .env       # optional; only needed if using the env-var credential path
./scripts/clean-start.sh   # development run; alternatively: npm run dev
```

`scripts/clean-start.sh` handles known development-time conditions: stale Vite caches, `ELECTRON_RUN_AS_NODE` leaked from agent shells, and a missing `dist-electron/main.js` on cold start. Recognized flags:

| Flag                | Effect                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--browser`         | Run the renderer in a browser tab against IPC stubs. Layout-only; no Git, OAuth, or Granite calls execute. |
| `--reset-user-data` | Remove `~/.overcode/` (settings, OAuth tokens, scanned-repository cache).                                  |

To build an installer locally:

```bash
npm run build                          # tsc + vite + electron-builder for the host platform
npx electron-builder --linux AppImage  # Linux AppImage only
npx electron-builder --win nsis        # Windows installer (requires wine on Linux/macOS hosts)
npx electron-builder --mac dmg         # macOS DMG (requires a macOS host)
```

Output: `release/0.1.0/Overcode-<platform>-0.1.0.<extension>`. The `release/` directory is `.gitignore`-d; distribution is through GitHub Releases.

---

## Security and privacy

| Boundary                   | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets in version control | `.env` is `.gitignore`-d. No keys, tokens, or OAuth client secrets are committed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Credential storage at rest | OAuth tokens and the watsonx.ai API key + project ID are written to `~/.overcode/config.json` by the main process. Values are encrypted with Electron `safeStorage` when the OS keystore is available (macOS Keychain, Windows DPAPI, GNOME Keyring / KWallet); otherwise stored as plaintext in that file. The renderer cannot read the `accounts` key, the encrypted credential blobs, or the legacy plain credential fields through any IPC channel. Credentials are written exclusively through the dedicated `settings:save-watsonx` channel, never through `store:set`. |
| OAuth flow                 | A cryptographically-random `state` parameter per authorization request, validated on callback. The callback server binds to `127.0.0.1` only and is started on-demand for the duration of a single authorization round-trip.                                                                                                                                                                                                                                                                                                                                                  |
| Renderer trust boundary    | Token material, raw OAuth responses, and raw Granite request bodies do not cross the preload bridge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| External URL handling      | `shell:open` validates URLs against an allowlist of schemes (HTTPS only) and hosts (`github.com`, `gitlab.com`, configured enterprise variants) before calling `shell.openExternal`.                                                                                                                                                                                                                                                                                                                                                                                          |
| Repository data            | All repository content stays on the operator's endpoint. The only outbound transmission of repository-derived content is to the operator's configured watsonx.ai endpoint, and only at the moment an AI feature is invoked. A local audit log under `~/.overcode/config.json` (`ai_audit_log` key) records each call's metadata — feature name, model, byte counts, status, latency — and is surfaced inside Settings → AI governance. Prompt and response bodies are never written to disk.                                                                                  |

---

## IBM technology attribution

**IBM Bob** was used to build the application. Every substantive task — IPC scaffolding, the Electron main and preload processes, the dashboard layout, the activity feed, the AI panel, the OAuth flow, the GitHub and GitLab REST clients, the repository-detail view, the pull-request detail views, the commit-graph rendering, and the eleven AI feature implementations — was produced in the IBM Bob IDE through the Plan → Code workflow. Per-session task reports and the consumption summary are recorded under [`bob_sessions/`](bob_sessions/). A per-session map of generated artifacts is in [`bob_sessions/BOB_HELPED_HERE.md`](bob_sessions/BOB_HELPED_HERE.md).

**IBM watsonx.ai Granite** is the runtime large-language-model service. The default model is `ibm/granite-4-h-small`. All eleven AI features route through a single entry point ([`electron/lib/granite.ts`](electron/lib/granite.ts)) which handles IAM authentication, request composition, JSON-validated response parsing, single-shot repair on parse failure, and audit-log persistence.

---

## Release notes

### 0.1.0 — Initial submission build

- First publicly-available build. Eleven AI features, GitHub + GitLab OAuth, local workspace scan, repository / PR / issue consoles.
- Linux AppImage built locally and launch-tested.
- Windows NSIS installer cross-built via wine; unsigned developer preview.
- macOS DMG packaging deferred to v0.2.0 once the GitHub Actions matrix runs on a macOS runner.

---

## License

Submitted to the IBM Bob Hackathon, May 2026. Provided as-is for evaluation; a formal license will be assigned subsequently.
