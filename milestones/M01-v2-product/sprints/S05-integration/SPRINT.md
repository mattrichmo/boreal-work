# S05 — Migration, canonical workflows, packaging, parity

Parent: [M01](../../README.md). State: **queued on P3-09 and S04 handoff**.
Individual P4-04/P4-10 leaves may start as soon as P3-09 passes; full sprint
integration requires S04 P4-03 and S04-R3. Exit: P4-09 revalidation. Read
[migration handoff](../../../../project/build-plan/verticals/07-migration.md),
[workflow handoff](../../../../project/build-plan/verticals/12-canonical-workflows.md),
[packaging handoff](../../../../project/build-plan/verticals/09-packaging-cutover.md),
[CLI contract](../../../../project/CLI_COMMANDS.md), and
[workflow parity](../../../../project/WORKFLOW_PARITY.md).

## Task graph and parallel lanes

| Task | Prerequisite | Owner/write set | Observable deliverable and gate |
| --- | --- | --- | --- |
| P4-04 — legacy export/import dry run | P3-09 | Migration owner: importer/exporter modules, `docs/MIGRATION.md` under integration edit | Real v1 fixtures preserve supported work, dependency meaning, attempts, expired leases, failed evidence, summaries, memory, Git refs; unsupported/ambiguous records are reported without silent loss. |
| P4-10 — packaged core workflow assets | P2-09/P3-09 | Workflow owner: versioned route/context/plan/claim/finish/review/audit/handoff/health/memory assets | Typed refs/inputs/allowed actions/finish criteria and next refs. Trusted guidance uses Rust enforcement; no second state machine. Starts parallel to P4-04. |
| P4-05 — pin runtime/package | P4-10 | Packaging owner: install/upgrade/rollback and root manifests; one integration editor | Clean install resolves one immutable CLI/service/protocol/directive/workflow identity; pause/rebase/resume works; no live package drift. |
| P4-06 — operator/harness docs | P4-03/04/05/10 | Docs owner with contract reviewers | Fresh user/agent can install, initialize, no-goal start, plan, claim, prove, finish/recover/handoff, publish memory, and diagnose errors with version-matched examples. |
| P4-11 — legacy workflow parity | P4-03/04/05/10 | Independent parity validator: fixtures/reports | Every high-value v1 workflow has scripted and unfamiliar-agent v2 result, keep/rework/defer disposition, conditional next step, gates and honest limitation. |

P4-04 and P4-10 can be parallel after P3-09. TUI may finish P4-03 at the
same time. The integration owner alone edits shared CLI/protocol/manifest
files and merges migration documentation. P4-11 must test the **packaged**
runtime, not a development-only CLI path. `work close`/`agent finish` parity
must not bypass structured receipts or trusted directives.

## Gate chain

| Gate task | Required evidence |
| --- | --- |
| P4-07 — independent UI/migration/release review | Mounted TUI actions, source/memory trust labels, import dry run and unsupported list, CLI/workflow parity, clean install/upgrade/rollback, no-goal guide-to-finish walkthrough. Record findings. |
| P4-08 — reconcile | Owners fix findings or record approved deferral with user impact, path owner, changed fixtures, and rerun checks. |
| P4-09 — revalidate | Fresh install plus imported fixture passes TUI/CLI/core workflow and memory loops on combined code. No unapproved essential parity gap. Only P4-09 unlocks S06. |

The review is not a release decision. A new UI feature must be mounted;
an imported `verified`/`cancelled` legacy dependency cannot silently become
closed under the v2 close-only policy; a broad custom template may be deferred
only with an explicit parity entry. Preserve failed runs and provenance.

## Dispatch ledger — coordinator only

| Task | State | Agent | Input snapshot | Deadline UTC | Evidence/finding link |
| --- | --- | --- | --- | --- | --- |
| P4-04 | pre-gate implementation complete; entry gate open | Singer (Luna) | P3-09 still open | [migration docs](../../../../docs/MIGRATION.md); deterministic provenance/export/import-plan and rollback/unsupported retention tests pass |
| P4-10 | queued on P3-09 | — | — | — | — |

After P4-09, dispatch independent P5-01/02/03 probes via
[handoff](../../../../AGENT_HANDOFF.md).
