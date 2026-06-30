# Cognee Hackathon Submission Checklist

## Rules Snapshot

- Project: Overcode Cognee integration/refactor for the Cognee hackathon.
- Prior work disclosure: Overcode existed before the hackathon. The submission scope is the new Cognee-backed memory layer, UI/API wiring, lifecycle coverage, demo flow, and cleanup required to present that integration honestly.
- Claim boundary: do not claim the entire Overcode application was created after hackathon start. Evidence should show which files, screens, API routes, and docs were added or changed for Cognee.
- Submission posture: keep the demo focused on working memory behavior inside Overcode, not generic AI assistant claims.
- External dependency posture: use Cognee only for the memory lifecycle steps needed by the submission. Do not adopt extra Cognee-hosted storage, identity, or indexing responsibilities unless the app flow requires them.

## Mandatory Requirements

- [ ] Cognee `remember` flow is present in the app and demoable from a user-visible screen or documented API call.
- [ ] Cognee `recall` flow is present in the app and demoable from a user-visible screen or documented API call.
- [ ] Cognee `improve` or `memify` flow is present in the app and demoable from a user-visible screen or documented API call.
- [ ] Cognee `forget` flow is present in the app and demoable from a user-visible screen or documented API call.
- [ ] Submission evidence distinguishes implemented behavior from planned behavior.
- [ ] Data safety constraints are documented and reflected in the demo script.
- [ ] Previous-event references are removed from submission-facing docs and UI copy, or explicitly marked outside the submitted artifact set.
- [ ] Final video or live demo shows the required narrative: stale worktree -> graph path -> memory-aware impact analysis.
- [ ] AI assistant disclosure names the assistant contribution without overstating autonomous authorship.

## Evidence Map

| Cognee lifecycle | App surface | API or integration point | Evidence status | What to capture |
| --- | --- | --- | --- | --- |
| `remember` | Planned/implemented memory capture action on stale-worktree analysis results | Planned/implemented endpoint or IPC handler that stores structured extracts: repo path, changed files, symbols, risk notes, timestamps, and references | [ ] Verify implementation | Screenshot of the capture action plus request/response or log showing structured memory stored without raw source blobs |
| `recall` | Planned/implemented memory-aware impact panel on the worktree or graph screen | Planned/implemented lookup that retrieves prior structured extracts by repo, file, symbol, branch, or task | [ ] Verify implementation | Demo clip showing prior context returned during a fresh stale-worktree review |
| `improve` / `memify` | Planned/implemented graph enrichment or memory refinement step after analysis | Planned/implemented call that processes remembered extracts into a queryable graph/path summary | [ ] Verify implementation | Evidence that raw extracts become a graph path or higher-signal summary used by impact analysis |
| `forget` | Planned/implemented privacy/control action in memory settings or per-item controls | Planned/implemented delete/forget endpoint by repo, task, memory id, or retention scope | [ ] Verify implementation | Screenshot or terminal output showing selected memory removed and unavailable to subsequent recall |

Implementation notes:

- Prefer a narrow flow: user opens stale worktree -> app derives changed-file/symbol context -> user remembers structured analysis -> Cognee improves/memifies it into retrievable context -> later recall informs impact analysis -> user can forget selected memory.
- Do not store full source files, full diffs, complete chat transcripts, `.env` contents, tokens, credentials, or build artifacts.
- If a lifecycle step is not implemented by submission time, mark it as planned and do not present it as shipped in the demo.

## Cognee Lifecycle Coverage

- `remember`: stores only structured worktree analysis extracts and references. Intended memory units are small records such as file paths, symbol names, dependency edges, risk labels, user decisions, and summary notes.
- `recall`: retrieves relevant prior extracts when a user revisits a stale worktree, opens graph impact analysis, or asks for memory-aware context.
- `improve` / `memify`: turns remembered extracts into a higher-signal graph path or memory summary that can support impact analysis without replaying raw diffs or chats.
- `forget`: removes selected memories by explicit user action, with scopes such as repository, branch/task, memory item, or stale analysis session.

Lifecycle acceptance checks:

- [ ] Each lifecycle action has a visible app entry point or clearly documented API route.
- [ ] Each lifecycle action has at least one concrete evidence artifact.
- [ ] Memory records are inspectable enough to prove structured storage.
- [ ] Forget is tested against the same key used by recall.

## Data Safety

- No secrets in Cognee.
- No raw source blobs in Cognee.
- No full diffs in Cognee.
- No full chat transcripts in Cognee.
- Store structured extracts and references only.
- Allowed examples: repo identifier, relative file path, symbol name, graph edge label, short human summary, risk category, user-approved decision, timestamp, and memory id.
- Disallowed examples: `.env` values, API keys, private tokens, complete file contents, full patch text, full conversation history, generated build outputs, and dependency cache contents.
- Demo data should be scrubbed before recording. Use small synthetic or local-only examples when possible.

## Demo Script

1. Open Overcode on a repository with a stale worktree.
2. Show the changed files and the first-pass analysis state before memory is used.
3. Open the graph path view and show how the app traces from changed files to impacted symbols, routes, or UI surfaces.
4. Trigger Cognee `remember` for the structured stale-worktree analysis extract.
5. Trigger Cognee `improve` or `memify` so the extract becomes a useful graph path or memory summary.
6. Start a second impact-analysis pass and trigger `recall`.
7. Show memory-aware impact analysis: prior decisions, known risk areas, or graph paths appear without storing raw source, full diffs, or full chat transcripts.
8. Trigger `forget` for the demo memory item or session.
9. Re-run recall to show the forgotten item is no longer returned.
10. Close by stating the claim boundary: Overcode is prior work; the hackathon submission is the Cognee memory integration/refactor and supporting evidence.

## Submission Checklist

- [ ] Confirm all required Cognee lifecycle steps are either implemented and evidenced, or clearly labeled as planned.
- [ ] Record demo using the narrative: stale worktree -> graph path -> memory-aware impact analysis.
- [ ] Capture screenshots or terminal logs for `remember`, `recall`, `improve`/`memify`, and `forget`.
- [ ] Verify data safety constraints against the actual payloads sent to Cognee.
- [ ] Remove or quarantine previous-event residue from submission materials, including old assistant branding, exported session folders, old guide PDFs, and event-specific attribution copy.
- [ ] Keep README claims unchanged unless separately authorized.
- [ ] Keep source-code changes out of this documentation pass.
- [ ] Update `docs/cognee-submission-plan.md` with current implementation status before final submission.
- [ ] Include AI assistant disclosure in the final submission materials.

## AI Assistant Disclosure

AI assistance was used to draft and organize hackathon control documentation, submission checklists, and evidence planning. Human maintainers remain responsible for implementation decisions, validation, final claims, and submitted artifacts.

This disclosure does not claim that the full Overcode application was generated during the hackathon. Overcode is existing prior work; the new submission work is the Cognee integration/refactor and supporting demo evidence.
