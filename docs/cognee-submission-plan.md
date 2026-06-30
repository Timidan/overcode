# Cognee Submission Plan

## Purpose

This document controls the Cognee hackathon submission work for Overcode. It is separate from product documentation and should stay evidence-focused: what Cognee lifecycle behavior is implemented, how it is demonstrated, and what claims are safe to make.

Overcode is existing prior work. The hackathon submission is the new Cognee integration/refactor, including memory lifecycle wiring, evidence capture, demo flow, and cleanup of outdated previous-event references.

## Submission Scope

- Add or verify Cognee-backed memory behavior for stale worktree analysis.
- Map Cognee lifecycle operations to concrete app screens and APIs.
- Prove data safety through payload shape and demo evidence.
- Show a demo path from stale worktree to graph path to memory-aware impact analysis.
- Avoid broad claims that unrelated Overcode features were built during the hackathon.

## Lifecycle Implementation Plan

| Lifecycle step | User goal | Planned/implemented surface | Planned/implemented API | Evidence target |
| --- | --- | --- | --- | --- |
| `remember` | Save useful context from a stale worktree review | Memory capture action on analysis results | Store structured extracts with repo id, file paths, symbols, graph edges, risk notes, and references | Screenshot or log showing saved memory payload shape |
| `recall` | Bring previous context into a new analysis pass | Memory-aware impact panel or graph context panel | Query by repo, branch/task, file path, symbol, or memory id | Demo showing recalled context influences the analysis |
| `improve` / `memify` | Convert extracts into useful long-lived context | Graph enrichment or memory refinement action | Transform remembered extracts into graph path summaries or memory nodes | Evidence of refined memory used by recall |
| `forget` | Remove stored context when it is no longer wanted | Memory settings or per-memory delete action | Delete by memory id, repo scope, task/session, or retention scope | Before/after recall showing the item is gone |

## Evidence Capture Checklist

- [ ] `remember` payload contains structured extracts only.
- [ ] `recall` result is relevant to the stale worktree or graph path being analyzed.
- [ ] `improve` or `memify` result is more useful than the original extract and avoids raw source storage.
- [ ] `forget` removes data from the same scope used by recall.
- [ ] Demo notes identify exact screens and API routes used.
- [ ] Screenshots or logs are stored outside Cognee if they contain sensitive local details.

## Data Safety Rules

Do not send secrets, raw source blobs, full diffs, or full chat transcripts to Cognee. Store structured extracts and references only.

Allowed data:

- Repository identifier or local project label.
- Relative file paths.
- Symbol names and codegraph-like edge labels.
- Short summaries of findings, decisions, and risk areas.
- Memory ids, timestamps, branch/task labels, and retention scope.

Disallowed data:

- `.env` values, tokens, credentials, or private keys.
- Complete file contents.
- Full patch/diff text.
- Complete assistant/user chat transcripts.
- Build artifacts, dependency caches, or generated release bundles.

## Demo Narrative

The demo should be concrete and repeatable:

1. Start with a stale worktree in Overcode.
2. Show changed files and the initial impact-analysis context.
3. Move to the graph path view and identify impacted symbols, APIs, or screens.
4. Use Cognee `remember` to save the structured analysis extract.
5. Use Cognee `improve` or `memify` to refine the extract into graph/path memory.
6. Re-run analysis and use Cognee `recall` to show memory-aware impact analysis.
7. Use Cognee `forget` on the demo memory and verify recall no longer returns it.
8. State the claim boundary: Overcode is prior work; Cognee memory integration/refactor is the hackathon work.

## Previous-Event Cleanup

- [ ] Remove old event and assistant-branding references from submission-facing copy.
- [ ] Check for old event names, exported assistant session folders, prior guide PDFs, and event-specific attribution copy.
- [ ] Keep historical files untouched unless they are part of the submission surface and cleanup is authorized.
- [ ] Do not edit README.md during this documentation pass.

## Final Review

- [ ] `HACKATHON.md` is the live checklist and matches the current implementation state.
- [ ] Evidence artifacts exist for each implemented lifecycle step.
- [ ] Any planned-but-not-implemented lifecycle behavior is labeled accurately.
- [ ] Data safety claims match actual Cognee payloads.
- [ ] AI assistant disclosure is included in submission materials.
