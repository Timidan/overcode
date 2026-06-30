# Overcode Recall Fast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition Overcode for the Cognee hackathon and implement the first load-bearing Cognee memory loop for stale worktrees and memory-aware impact analysis.

**Architecture:** Git and provider APIs remain the source of mechanical truth, OpenRouter remains the stateless reasoning gateway, electron-store remains local app state, and Cognee becomes the semantic memory layer for risks, decisions, modules, worktrees, and AI outputs across time. The first proof slice is worktree recall feeding impact analysis.

**Tech Stack:** Electron 30, React 18, TypeScript, vanilla CSS, electron-store, simple-git worker, OpenRouter, Cognee REST/Cloud or local endpoint through an optional main-process adapter.

## Global Constraints

- Remove previous-event submission identity before final submission: no old event names, old assistant-branded attribution, exported assistant session folders, prior guide PDFs, or event-specific evidence artifacts.
- Preserve existing working Git/GitHub/GitLab/OpenRouter behavior unless a change is directly required for Cognee memory.
- Cognee stores structured extracts and references only; never store secrets, raw source blobs, full diffs, full prompt transcripts, or high-churn line numbers.
- Cognee is optional at runtime: missing configuration must degrade to disabled status and local-only AI output, not crashes.
- The visible demo must prove graph-shaped memory: stale worktree -> related issue/PR/stash/module -> prior risk/decision -> memory-aware impact analysis.
- Keep code changes scoped and use the existing IPC, preload, Zustand, AI panel, and vanilla CSS patterns.

---

### Task 1: Remove Old Previous-Event Submission Identity

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `src/screens/Settings.tsx`
- Modify: `electron/lib/ai-runtime.ts`
- Delete: old exported assistant session evidence folder
- Delete if present and only old-submission-specific: old assistant prompt batches and prior event guide PDF

**Interfaces:**
- Consumes: existing docs and app copy.
- Produces: repo copy that no longer presents Overcode as a previous event submission.

- [ ] Remove previous-event names, exported session references, and old assistant attribution from docs and app copy.
- [ ] Preserve OpenRouter as the current inference gateway.
- [ ] Run strict previous-event reference search.
- [ ] Run `npm run lint`.

### Task 2: Add Hackathon Evidence Brief

**Files:**
- Create: `HACKATHON.md`
- Create: `docs/cognee-submission-plan.md`

**Interfaces:**
- Consumes: Cognee hackathon rules and current Overcode direction.
- Produces: live submission checklist and evidence map.

- [ ] Add rules snapshot, mandatory requirements, evidence map, Cognee lifecycle coverage, data safety, demo script, checklist, and AI assistant disclosure.
- [ ] Map `remember`, `recall`, `improve`/`memify`, and `forget` to concrete Overcode surfaces.
- [ ] Note existing Overcode baseline versus new Cognee work honestly.

### Task 3: Add Memory Schema and Pure Helpers

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/cognee-memory-types.ts`
- Create: `src/lib/cognee-memory.ts`
- Create: `src/lib/cognee-memory.test.ts`

**Interfaces:**
- Produces `normalizeModulePath`, `moduleKeyFromPath`, `buildWorktreeRecallQuery`, `buildImpactMemoryContext`, and `buildWorktreeMemoryDocument`.

- [ ] Add failing tests first for path normalization, recall query creation, memory context rendering, and no raw diff/source retention.
- [ ] Implement deterministic dependency-free helpers.
- [ ] Run unit tests and `npm run lint`.

### Task 4: Add Optional Cognee Main-Process Adapter and IPC

**Files:**
- Create: `electron/lib/cognee.ts`
- Modify: `electron/ipc-handlers.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/preload.d.ts`
- Modify: `src/lib/ipc.ts`

**Interfaces:**
- Produces IPC channels `memory:remember`, `memory:recall`, `memory:improve`, `memory:forget`, and `memory:status`.

- [ ] Implement optional status and safe disabled fallback when Cognee is not configured.
- [ ] Accept structured memory documents and recall queries only.
- [ ] Add renderer-safe typed methods.
- [ ] Run `npm run lint`.

### Task 5: Add Worktree Recall UI

**Files:**
- Modify: `src/components/WorktreeList.tsx`
- Modify: `src/components/WorktreeList.css`
- Create: `src/components/WorktreeRecallCard.tsx`
- Create: `src/components/WorktreeRecallCard.css`

**Interfaces:**
- Consumes memory recall IPC and memory helper query builders.
- Produces visible recall card for a selected worktree.

- [ ] Add a `Recall` button next to inspect/summarize.
- [ ] Show likely intent, related artifacts, prior risks/decisions, suggested next action, and graph path when memory exists.
- [ ] Show disabled/empty states when Cognee is not configured or returns no memory.
- [ ] Do not show raw diffs/source in recall UI.
- [ ] Run `npm run lint`.

### Task 6: Inject Memory into Impact Analysis

**Files:**
- Modify: `src/components/ai/ImpactAnalysis.tsx`
- Modify: `src/components/ai/AIResultViews.tsx`
- Modify: `src/components/ai/AIResultViews.css`
- Modify: `src/lib/ai-features.ts`

**Interfaces:**
- Consumes memory recall context from IPC/helper layer.
- Produces memory-aware impact prompt and visible “Memory used” section.

- [ ] Recall module/worktree/repo memories before the AI call.
- [ ] Inject bounded memory context into the prompt.
- [ ] Show memory-used evidence in the rendered result.
- [ ] Remember structured impact output after a successful analysis when Cognee is configured.
- [ ] Run `npm run lint`.

### Task 7: Add Improve/Forget Governance Controls

**Files:**
- Modify: `src/screens/Settings.tsx`
- Modify: `src/screens/Settings.css`
- Modify: `src/lib/ipc.ts`

**Interfaces:**
- Consumes `memory:status`, `memory:improve`, and `memory:forget`.
- Produces visible governance controls proving the lifecycle beyond recall.

- [ ] Show Cognee memory status in Settings.
- [ ] Add “Improve repo memory” and “Forget repo memory” controls with clear disabled states.
- [ ] Keep copy privacy-forward and concrete.
- [ ] Run `npm run lint`.

### Task 8: Final Verification and Submission Pass

**Files:**
- Modify: `README.md`
- Modify: `HACKATHON.md`
- Modify: any docs that mention new feature evidence.

**Interfaces:**
- Consumes final implemented surfaces.
- Produces coherent submission story and verified build.

- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run strict previous-event reference search.
- [ ] Verify Cognee evidence exists for `remember`, `recall`, `improve`, and `forget`.
- [ ] Update README demo instructions and HACKATHON checklist.
