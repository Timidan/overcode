<p align="center">
  <img src="public/brand/current/overcode-banner-dark-nobg.svg" alt="Overcode - all your workspace updates, one calm signal" width="1200">
</p>

<h1 align="center">Overcode</h1>

<p align="center">
  <strong>A native desktop hub for Git workspaces, repository state, BYOK AI providers, and Cognee-backed memory.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.2-1e40af?style=flat-square" alt="Version 0.1.2">
  <img src="https://img.shields.io/badge/Memory-Cognee%20repository%20memory-0f766e?style=flat-square" alt="Cognee repository memory layer">
  <img src="https://img.shields.io/badge/AI-BYOK%20providers-1f70c1?style=flat-square" alt="BYOK AI providers runtime">
  <img src="https://img.shields.io/badge/Runtime-Electron%2030-47848f?style=flat-square" alt="Electron 30">
</p>

<p align="center">
  <sub>Memory powered by</sub>
  <br>
  <a href="https://www.cognee.ai">
    <img src="src/assets/providers/cognee.png" alt="Cognee" height="40">
  </a>
  <br>
  <a href="https://www.cognee.ai"><strong>Cognee</strong></a>
</p>

---

## What Overcode Is

Overcode is a native desktop application that consolidates local Git state, GitHub, and GitLab into a single operator workspace. It is built for engineers who maintain multiple repositories, monitor pull requests and merge requests, and switch between branches, worktrees, and stashes during a normal working day.

The data plane is local. Repositories are read directly from disk through `simple-git` in an isolated worker process. Remote provider data is pulled per-account through user-scoped OAuth and cached locally. AI calls are explicit, routed through the selected provider, and recorded in a local audit log. Cognee is used as an optional repository memory layer for approved summaries and structured facts.

There is no Overcode backend.

---

## OpenAI Build Week

Overcode is entered in the **Developer Tools** category. The application existed before the July 13, 2026 submission window; the judged Build Week contribution is a focused GPT-5.6-assisted extension rather than a claim that the entire product was built during the event.

### What Changed During Build Week

- Replaced a shallow, duplicated memory workflow with one tested repository-memory lifecycle for recall, fact collection, stable deduplication, remember, improve, and forget behavior.
- Migrated repository briefing, impact analysis, commit assistance, issue triage, standup, worktree comparison, pull-request, repository, dashboard, and settings surfaces to that shared boundary.
- Added repository-memory and theme-input tests.
- Removed mandatory route, keyboard-command, AI-panel, and list entrance delays; preserved causal pointer feedback; and made reduced-motion behavior informative without decorative loops.
- Narrowed the worktree-comparison ARIA live region during independent acceptance review so it does not contain an interactive control.

### How Codex And GPT-5.6 Contributed

The implementation was completed in Codex with `gpt-5.6-sol` at `xhigh` reasoning in session `019f7679-b2ee-7961-bdac-6ec8a426ca31`. GPT-5.6 analyzed the existing architecture, implemented the consolidated module and caller migration, refined the interaction motion, and added tests. The human selected the architectural boundary, constrained memory to approved repository summaries and structured facts, chose immediate keyboard behavior with spatial feedback only for pointer input, and made the final accessibility correction. The same GPT-5.6 session reviewed that correction, and `/feedback` was submitted successfully.

Acceptance verification for this contribution:

| Check | Result |
| --- | --- |
| Unit tests | 20 files and 145 tests passed |
| TypeScript | `npx tsc --noEmit` passed |
| Lint | Passed with zero warnings |
| Production package | `npm run build` produced the Linux AppImage |
| Patch hygiene | `git diff --check` passed |

The [Overcode website](https://overcode.timidan.xyz) distributes the prebuilt Linux AppImage from the public GitHub releases. The Build Week contribution is packaged as `v0.1.2`, preserving the historical `v0.1.1` artifact from before the event. Local repository and worktree views need no account, while AI providers, Cognee, GitHub, and GitLab are optional integrations.

---

## Capabilities

| Capability | What it does |
| --- | --- |
| Local workspace scan | Recursively discovers Git repositories beneath operator-configured roots. |
| Repository dashboard | Shows branches, uncommitted files, stashes, worktrees, recent commits, and file-system refresh state. |
| Activity feed | Unifies commits, pull-request transitions, issue updates, and pipeline outcomes across linked accounts. |
| Pull-request console | Combines GitHub PRs and GitLab MRs with hunk-level navigation. |
| Issue console | Shows cross-provider issues with assignee and linked-PR context. |
| AI panel | Runs impact analysis, commit assistance, repository briefings, stash annotation, worktree comparison, code explanation, issue triage, and daily standup generation. |
| Cognee memory | Remembers approved repository summaries, risk notes, module facts, decisions, and recall context across sessions. |

Each AI feature routes through `electron/lib/ai-runtime.ts` and validates structured responses before rendering them. On parse failure the response is repaired once; if repair fails, the UI falls back to a local-data-only envelope instead of surfacing a raw exception.

---

## Architecture Overview

Three isolated process tiers:

1. **Main process** ([electron/](electron/)) - IPC handlers, OAuth callback servers, AI provider adapters, Cognee adapter, and `electron-store` persistence at `~/.overcode/config.json`.
2. **Preload bridge** ([electron/preload.ts](electron/preload.ts)) - typed `window.api` exposed through `contextBridge`.
3. **Renderer** ([src/](src/)) - React 18 + TypeScript, Zustand state, and vanilla CSS design tokens.

`simple-git` and `chokidar` run inside an Electron `utilityProcess` worker so the main process and renderer remain responsive against large repositories.

Architecture diagrams are documented in [ARCHITECTURE_DIAGRAMS.md](ARCHITECTURE_DIAGRAMS.md) and the accompanying Excalidraw source files.

---

## Why Native Desktop

Overcode reads local files and watches them continuously. A hosted web app would need per-folder browser permission, has weaker file-watch behavior, and would require a backend for OAuth callbacks and token storage.

| Concern | Native desktop behavior |
| --- | --- |
| Local repository access | Direct OS-gated filesystem access. |
| File-system change events | Continuous `chokidar` watcher in a utility process. |
| OAuth callback | Local callback server on `127.0.0.1`, started on demand. |
| Credential storage | `electron-store` on the operator's endpoint, encrypted through Electron `safeStorage` when available. |
| Offline behavior | Local Git views remain usable without network. |
| Deployment | One desktop artifact per platform. |

---

## System Requirements

| Component | Minimum |
| --- | --- |
| Operating system | macOS 11, Windows 10 22H2, or glibc 2.31+ Linux |
| Memory | 4 GB available |
| Disk | 500 MB for the application, plus repository metadata cache |
| Network | Outbound HTTPS to OpenRouter, OpenAI, Anthropic, Gemini / AI Studio, Cognee if configured, GitHub, GitLab, and any configured enterprise instances |
| Accounts | Optional AI provider API keys, optional Cognee endpoint, optional GitHub and GitLab OAuth applications |

---

## Running From Source

```bash
git clone https://github.com/Timidan/overcode.git
cd overcode
npm install
cp .env.example .env
npm run dev
```

For a clean development run:

```bash
./scripts/clean-start.sh
```

To remove all stored state, delete `~/.overcode/` or run:

```bash
./scripts/clean-start.sh --reset-user-data
```

---

## AI Provider Setup

Overcode uses bring-your-own-key AI providers. You can save keys for OpenRouter, OpenAI, Anthropic, and Gemini, then choose one active provider and model under Settings -> AI Providers.

OpenRouter is the default because it exposes a broad model catalog, including free and paid models. Direct provider keys are supported for users who prefer billing through OpenAI, Anthropic, or Google AI Studio.

Paid models are allowed. Overcode marks provider-billed models before activation and does not charge for model usage.

Stored Settings values take precedence over environment variables.

### In-App Setup

1. Open **Settings -> AI providers**.
2. Choose OpenRouter, OpenAI, Anthropic, or Gemini.
3. Paste the provider API key, then click **Save credentials**.
4. Choose a catalog model or enter a manual model ID.
5. Acknowledge provider billing if the selected model is paid or pricing is unknown, then click **Activate provider**.

Credentials are persisted to `~/.overcode/config.json` and encrypted with Electron `safeStorage` whenever the operating-system keystore is available. On systems without a keystore, values are stored as plaintext in that file.

### Environment Variables

| Provider | Environment variables |
| --- | --- |
| OpenRouter | `OPENROUTER_API_KEY`, accepted alias `OPENROUTER`, optional `OPENROUTER_MODEL`, optional `OPENROUTER_BASE_URL` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Gemini / AI Studio | `GEMINI_API_KEY`, accepted alias `GOOGLE_API_KEY` |

Run the generic smoke path with:

```bash
node scripts/smoke-ai-provider.mjs
```

Run the OpenRouter-specific check directly with:

```bash
node scripts/smoke-openrouter.mjs
```

---

## Cognee Memory Setup

Cognee memory is enabled when an endpoint and API key are present. `COGNEE_API_URL` is the canonical endpoint variable, while `COGNEE_SERVICE_URL` and `COGNEE_BASE_URL` are accepted aliases.

| Key | Required | Notes |
| --- | --- | --- |
| `COGNEE_API_URL` | one endpoint key | Preferred Cognee API base URL, without a trailing route. |
| `COGNEE_SERVICE_URL` | one endpoint key | Accepted alias. |
| `COGNEE_BASE_URL` | one endpoint key | Accepted alias. |
| `COGNEE_API_KEY` | yes | Sent by the main process; never exposed to the renderer. |

Cognee runs in context-only mode. It stores approved repository memory and recall context, not raw source, raw diffs, prompt bodies, credentials, OAuth tokens, or `.env` values.

---

## GitHub And GitLab OAuth

If you want the unified PR, issue, and pipeline console, register OAuth applications and enter the client credentials under **Settings -> Integrations**.

| Provider | OAuth callback URL | Where to register |
| --- | --- | --- |
| GitHub | `http://127.0.0.1:3000/callback` | GitHub developer settings |
| GitLab | `http://127.0.0.1:3001/callback` | GitLab profile applications |

Both providers are optional. Local Git views work without either.

---

## Build

```bash
npm run build
```

Useful platform-specific commands:

```bash
npx electron-builder --linux AppImage
npx electron-builder --win nsis
npx electron-builder --mac dmg
```

Output is written to `release/0.1.2/`.

---

## Security And Privacy

| Boundary | Implementation |
| --- | --- |
| Secrets in version control | `.env` is ignored. Keys, tokens, and OAuth client secrets are not committed. |
| Credential storage | OAuth and AI provider credentials are written by the main process. The renderer cannot read the raw credential store or secret blobs through IPC. |
| OAuth flow | A random `state` parameter is validated on callback. Local callback servers bind to `127.0.0.1` and are started only for a single authorization round-trip. |
| Renderer trust boundary | Token material, raw OAuth responses, and raw AI request bodies do not cross the preload bridge. |
| External URL handling | `shell:open` validates URLs against an allowlist before calling `shell.openExternal`. |
| Repository data | Repository content stays on the operator's endpoint except for explicit AI calls and approved Cognee memory writes. Audit metadata is stored locally without prompt or response bodies. |

---

## Release Notes

### 0.1.2 — OpenAI Build Week

- Consolidated the repository-memory lifecycle and migrated every AI and repository caller to the shared boundary.
- Added repository-memory and theme-input coverage; 145 tests pass in the release candidate.
- Removed mandatory entrance delays from keyboard, route, AI-panel, and list interactions.
- Refined reduced-motion feedback and corrected the worktree-comparison ARIA live region.

### 0.1.1

- Desktop Git workspace hub with GitHub and GitLab OAuth.
- BYOK-provider-backed AI panel and inline PR analysis workflows.
- Cognee-backed repository memory for remember, recall, improve, and forget flows.
- Linux AppImage, Windows NSIS, and macOS DMG build targets.

---

## License

Overcode is available under the [MIT License](LICENSE).
