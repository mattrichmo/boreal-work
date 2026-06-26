# Boreal Live E2E Results Hardening Review - 2026-06-26

Source bundle: `/Users/cybertron/Code/MRMR/.boreal/test-results/boreal-e2e-20260626110040`

Review scope:

- 78 top-level JSON artifacts, including command responses, health checks, import/export captures, search/context captures, and the raw `export.json` document.
- 12 markdown export artifacts under `markdown-export/`.
- Generated command reference artifacts: `commands.json`, `commands.md`, and `help.txt`.
- Orientation against the current Boreal repo in `/Users/cybertron/Code/boreal-work`; no source code changes were made for this review.

## Executive Summary

The live suite exercises the main v1 CLI path successfully: workspace/vault setup, work/dependency lifecycle, reservations, agent start/finish, evidence and verification, claims/decisions, context/search, duplicate/merge, compaction, snapshots, ledgers, import/export, operations, workflows, locks, and doctor checks.

The suite does not show a broad command execution failure. The highest-value hardening work is around what agents will trust after successful commands:

1. Some mutation responses return fresh record state mixed with stale projection text.
2. Strict doctor remains blocked by a source-backed wiki page being classified as an orphan.
3. Generated artifact refresh is split across commands, so `doctor --fix` can still leave ledger/snapshot drift warnings.
4. JSON success semantics are easy to misread because command envelopes can be `ok: true` while nested diagnostic payloads are `ok: false`.
5. Command registry lock metadata should better represent vault and generated-artifact writers.
6. A few smaller output contract and documentation issues are visible in the generated artifacts.

## Result Inventory

Healthy or expected behavior observed:

- `init.json`, `vault-init.json`, and `vault-status.json` show workspace and vault setup as idempotent and structurally healthy.
- `blocker.json`, `dependent.json`, `dep-add.json`, `dep-tree.json`, and `dep-cycles.json` show dependency creation, blocking, and cycle checks working; `dep-cycles.json` is empty.
- `agent-start-blocker.json`, `agent-finish-blocker.json`, `work-claim-dependent.json`, and `agent-finish-dependent.json` show reservation-backed agent execution and closeout working at the state level.
- `source.json`, `raw.json`, `wiki.json`, `claim.json`, `claim-show.json`, `decision.json`, and `decision-show.json` show the memory and knowledge surfaces working.
- `context-rebuild.json`, `context-show-dependent.json`, `context-search.json`, `search-index.json`, and `search-query.json` show context/search surfaces generating and returning results.
- `export-json-result.json`, `export.json`, `export-markdown.json`, `export-ledgers.json`, `import-json.json`, and `import-ledgers.json` show export/import round trips and idempotent skips.
- `duplicate-work-scan.json`, `merge-plan.json`, and `merge-apply.json` show duplicate detection and merge application. The nested `data.ok: false` in duplicate scan means duplicates were found, not that the command crashed.
- `compact-work-analyze.json` and `compact-apply.json` show compaction planning and application while preserving evidence and verification IDs.
- `snapshot-create.json`, `snapshot-list.json`, `snapshot-show.json`, and `snapshot-post-refresh.json` show snapshot creation and lookup.
- `operation-list.json`, `operation-list-session.json`, `operation-show.json`, and `operation-repair-dry-run.json` show operation capture and repair inspection working.
- `workflows-list.json` lists 38 workflows; `commands.json` lists 74 command definitions.

Open hardening signals:

- `doctor-strict.json` and `doctor-strict-post-refresh.json` are command-successful but diagnostically failing because nested `data.ok` is false.
- `doctor-final-fix.json` fixes context/search drift but still reports ledger and snapshot drift.
- `agent-finish-blocker.json` and `agent-finish-dependent.json` return stale `contextSummary` text after close.
- `dependent-after-blocker.json` returns `status: ready` while `blockedBy` still contains the closed dependency ID.
- `commands.md` renders `Repeatable. Repeatable.` for `--skill-target`.

## Findings And Tasks

### F1. Agent finish returns stale context summaries after state changes

Priority: High

Evidence:

- `agent-finish-blocker.json` returns `work.status: closed`, but `work.contextSummary` says the same work item "is in_progress".
- `agent-finish-dependent.json` has the same pattern: returned `work.status: closed`, while `work.contextSummary` still says "is in_progress".
- `doctor-fix-after-blocker.json` and `doctor-final-fix.json` later repair `projection.context_pack` drift, which confirms the stale text is projection drift rather than incorrect work state.
- Markdown export context for the blocker is correct after rebuild: `markdown-export/context/bw_work_63cf8dfe3f80c628.md` says the blocker is closed.

Why it matters:

Agents will often trust the command response they just received. A response that mixes a fresh `status` field with stale narrative context can cause incorrect handoff summaries, redundant work, or mistaken blocker reasoning.

Suggested action:

Make mutation responses that include work views return projection-consistent context, or omit `contextSummary` when the projection has not been refreshed.

Tasks:

- Add a regression test for `agent finish --close --json` that asserts returned `work.contextSummary` reflects the returned `work.status`.
- Reuse the existing handoff projection rebuild path for `agent finish`, or add a narrower `refreshContextForWork(workId)` runtime method for close/verify/evidence mutations.
- If `agent finish` starts rebuilding context/search, update its command registry metadata from `requiresLock: state` to the correct combined lock domain and mark generated artifact writes accurately.
- Add the same freshness assertion for `work close`, `work verify`, and `evidence add` if they return views or context-derived summaries.
- Add a doctor test that verifies no `projection.context_pack` warning appears immediately after the close path that returns a context summary.

Acceptance checks:

- `agent finish --close --json` never returns `work.status: closed` with a summary that says `in_progress`.
- `doctor --strict --json` has no `projection.context_pack` warning immediately after a normal close path, unless another command mutates state afterward.

### F2. `blockedBy` in work views conflates dependency history with active blockers

Priority: Medium

Evidence:

- `dependent-after-blocker.json` returns `status: ready` while `blockedBy` still contains `bw_work_63cf8dfe3f80c628`.
- This is internally explainable because `blockedBy` is currently populated from `work.dependencyIds`, but the field name implies active unresolved blockers.

Why it matters:

Machine consumers and agents can read `blockedBy` as "do not work this yet" even when the item is claimable and ready.

Suggested action:

Separate dependency edges from currently blocking dependencies in the work-view contract.

Tasks:

- Extend `WorkItemView` with `dependencyIds` and `openBlockerIds` or `activeBlockerIds`.
- Populate `openBlockerIds` only with dependencies whose status is not `closed`, `cancelled`, or `verified`.
- Keep `blockedBy` as a deprecated alias for one release, or change it to active blockers only and update command docs.
- Update `work next`, `work show`, `agent start`, and `agent finish` tests to assert ready work has no active blockers.
- Update markdown/human labels to use "Depends on" for historical dependencies and "Blocked by" only for active blockers.

Acceptance checks:

- A ready dependent item whose prerequisite is closed exposes the prerequisite in `dependencyIds`, not in active blockers.
- Agent-facing JSON does not imply a ready item is still blocked.

### F3. Strict doctor fails on a valid source-backed wiki page classified as orphan

Priority: High

Evidence:

- `wiki.json` creates `memory/wiki/boreal-e2e-20260626110040-knowledge-page.md` with a valid raw source reference: `bw_source_09bad15fbadcf49aee6517579b84ef92`.
- `doctor-strict-post-refresh.json` has no ledger drift and no search drift left, but nested `data.ok` remains false because `vault.health` warns about that wiki page as an orphan.
- The warning remains despite `missingSourceRefs: []`, `brokenLinks: []`, and `staleClaims: []`.

Why it matters:

A source-backed page created through the normal CLI can leave strict health red. That makes strict doctor less useful as an end-of-work gate because a healthy one-page wiki can look unhealthy.

Suggested action:

Refine vault health semantics so source-backed entry pages are not treated the same as truly orphaned pages.

Tasks:

- Change `inspectVaultHealth` to classify wiki pages into `entryPages`, `unlinkedPages`, and true `orphanPages`, or exclude valid source-backed pages from `orphanPages`.
- Decide whether strict doctor should fail on warnings at all, or only on warnings above a configured severity.
- Add tests for:
  - source-backed page with no incoming wiki links,
  - unreferenced page with no sources,
  - page with a missing source reference,
  - page with broken links.
- Update doctor output so the page warning includes the concrete repair options: add an inbound wiki link, mark as entry page, compact/archive, or attach source.

Acceptance checks:

- `wiki create --source <raw-id>` followed by refresh does not make strict doctor fail solely due to no inbound wiki links.
- Truly unreferenced pages are still detectable and actionable.

### F4. `doctor --fix` does not produce a single clean generated-artifact state

Priority: Medium

Evidence:

- `doctor-final-fix.json` reports `fixed: projection.context_pack` and `fixed: search.index`, but still reports `warning: snapshot.export_drift` and `warning: ledger.export_drift`.
- `ledger.export_drift` details show `reconstructable: true`, so at least ledger drift is mechanically repairable.
- `ledger-status-post-refresh.json` and `snapshot-post-refresh.json` show the run can reach a fresher state after explicit refresh commands.
- `prime.json`, `session-start.json`, and `session-end.json` all surface recommended actions when sync is degraded: `bwrk export ledgers --json` and `bwrk search index --json`.

Why it matters:

Agents need a dependable closeout command. If `doctor --fix` repairs some generated artifacts but leaves other reconstructable generated artifacts stale, agents must know whether they are done or need another command sequence.

Suggested action:

Add an explicit full refresh path, and make doctor diagnostics clearer about what it will and will not fix.

Tasks:

- Add `bwrk sync refresh --json` or `bwrk doctor --fix-generated --json` to run the safe generated-artifact refresh sequence: context rebuild, search index, ledger export, and optional snapshot creation.
- For `ledger.export_drift` diagnostics, include `repairCommand: "bwrk export ledgers --json"` when `reconstructable: true`.
- For `snapshot.export_drift`, decide whether the repair is "create new snapshot" or "baseline intentionally old", then encode that in the diagnostic details.
- Add an end-to-end closeout test that reaches clean sync with one documented command sequence.
- Update `agent guide` and workflow finish criteria to point to the single refresh path.

Acceptance checks:

- After the documented closeout refresh path, `sync status --json` returns nested `data.ok: true`.
- Doctor output never leaves reconstructable drift without an explicit next command.

### F5. JSON envelopes blur command success and diagnostic success

Priority: Medium

Evidence:

- `doctor-strict.json` has top-level `ok: true` and nested `data.ok: false`.
- `doctor-strict-post-refresh.json` has the same shape.
- `duplicate-work-scan.json` has top-level `ok: true` and nested `data.ok: false` because duplicates were found.

Why it matters:

The shape is defensible if top-level `ok` means "command produced a valid payload", but machine consumers can easily check only the top-level field and miss a failed health result.

Suggested action:

Make the distinction explicit and testable in the output contract.

Tasks:

- Document the JSON envelope contract: top-level `ok` means invocation/serialization success; command-specific health is under `data.ok`.
- Consider adding a top-level `exitCode` or `status` field for command captures produced by the test harness.
- Rename nested health fields where practical, for example `healthOk`, `duplicatesFound`, or `diagnosticOk`, to avoid double-`ok` ambiguity.
- Add contract tests that enforce nonzero process exit for strict diagnostic failures even when stdout is a valid success envelope.
- Add a small parser helper for agents/docs: "treat `data.ok === false` as a failed health gate for diagnostic commands."

Acceptance checks:

- Consumers have one documented way to decide whether a diagnostic gate passed.
- Live result captures preserve both valid JSON output and the process-level pass/fail status.

### F6. Vault and generated-artifact lock metadata is not expressive enough

Priority: Medium

Evidence:

`commands.json` marks these generated/vault writers as `writesGeneratedArtifacts: true` with `requiresLock: none`:

- `install codex`
- `install claude`
- `install skills`
- `export json`
- `export markdown`
- `export ledgers`
- `vault init`
- `raw add`
- `wiki create`
- `snapshot create`

Some internal locking exists. For example, `raw add` appends through `appendVaultJsonlRecord`, which uses a vault JSONL file lock. But `wiki create` checks existence and then writes with atomic rename without a command-level or wiki-path lock. Export and snapshot commands are generated-file writers that may race with concurrent state mutations unless the read/write boundary is explicitly protected.

Why it matters:

The registry is meant to be a machine-readable concurrency contract. If it says no lock is required while the implementation relies on hidden narrower locks or has no lock, schedulers and agents cannot coordinate safely.

Suggested action:

Introduce explicit lock domains for vault and generated artifacts, then align registry metadata and implementation.

Tasks:

- Add command lock values such as `vault`, `generated`, `state-read+generated`, or equivalent names that match the actual runtime behavior.
- Protect `wiki create` with a per-slug or wiki-global lock so two agents cannot pass the existence check and race the write.
- Review export/snapshot commands for consistent state reads while generated files are written.
- Update `commands.json` tests to assert that every command with `writesGeneratedArtifacts: true` has either a declared lock domain or documented internal per-file lock.
- Document which generated artifacts are safe to regenerate concurrently and which are single-writer.

Acceptance checks:

- The command registry accurately tells an agent which commands can run concurrently.
- Wiki page creation is race-safe for duplicate slugs.

### F7. Generated command docs duplicate repeatability wording

Priority: Low

Evidence:

- `commands.md` renders `--skill-target` as: `Skill target to record: codex or claude. Repeatable. Repeatable.`
- The command registry flag summary already includes "Repeatable.", and the markdown generator appends the repeatable suffix again.

Suggested action:

Keep repeatability as metadata, not prose.

Tasks:

- Remove "Repeatable." from the `--skill-target` summary in `COMMAND_DEFINITIONS`, or make `commandsMarkdown()` dedupe the suffix.
- Add a generated-doc test that forbids `Repeatable. Repeatable.`.
- Regenerate/update `docs/cli/COMMANDS.md` if it carries the same string.

Acceptance checks:

- Generated command docs render each repeatable flag with exactly one repeatability note.

## Suggested Implementation Order

1. Fix response freshness first: F1 and F2. These directly affect agent trust in command responses.
2. Fix strict health semantics next: F3 and F4. This makes closeout gates reliable.
3. Clarify machine contracts: F5 and F6. This makes future automation safer.
4. Polish generated docs: F7.

## Candidate Work Items

### Task: Fresh work views after agent finish

Labels: `hardening`, `agent-runtime`, `context`

Acceptance:

- Closing work through `agent finish --close --json` returns a work view whose `status`, `contextSummary`, evidence count, and verification count all reflect the same post-transaction state.
- Regression test covers both blocker and dependent close paths.
- Doctor does not need to fix context drift created by the immediately preceding finish command.

### Task: Split dependency IDs from active blockers

Labels: `hardening`, `work-view`, `agent-contract`

Acceptance:

- Work views expose all dependencies separately from unresolved blockers.
- Ready work never reports a closed prerequisite as an active blocker.
- Existing JSON consumers have a documented migration path if `blockedBy` changes.

### Task: Reclassify source-backed wiki entry pages

Labels: `hardening`, `vault`, `doctor`

Acceptance:

- Source-backed wiki pages created by `wiki create --source` do not fail strict doctor solely because they lack inbound links.
- Truly unreferenced wiki pages remain discoverable as warnings with explicit repair actions.

### Task: Add one generated-artifact refresh command

Labels: `hardening`, `sync`, `doctor`

Acceptance:

- A single documented command sequence refreshes context, search index, ledgers, and snapshot baseline where appropriate.
- Diagnostics include repair commands for every mechanically repairable drift.

### Task: Formalize JSON health-gate semantics

Labels: `hardening`, `cli-contract`, `json`

Acceptance:

- CLI docs and tests distinguish command invocation success from diagnostic pass/fail.
- Test result capture includes process exit code or an equivalent machine-readable gate status.

### Task: Align generated/vault lock metadata with implementation

Labels: `hardening`, `concurrency`, `command-registry`

Acceptance:

- Every generated/vault writer has an explicit registry lock contract.
- Concurrent duplicate wiki creation cannot silently overwrite or race.
- Registry validation tests fail if a writer command declares no lock without an explicit exemption.

### Task: Clean generated command reference repeatability prose

Labels: `docs`, `cli`

Acceptance:

- Generated docs contain no duplicate repeatability sentences.
- Tests guard the generated command reference against this regression.

