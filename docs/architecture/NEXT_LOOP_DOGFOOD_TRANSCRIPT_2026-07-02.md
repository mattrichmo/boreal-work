# Next Loop Dogfood Transcript - 2026-07-02

Work item: `bw_work_4989ec10d44e5e9a`

Fixture workspace: `/private/tmp/boreal-next-dogfood.FxT1EJ`

## Scope

This transcript records the disposable-workspace dogfood run for `bwrk next`. The fixture created a ready work item with a declared verification gate, then completed it end to end using commands selected from `bwrk next` output.

One implementation issue surfaced during the first pass: ready work with a declared gate selected the raw gate validation command before claim. The fix now filters ready-work selection to the canonical workflow-next directive when sync health is clean, so a ready item is claimed before declared validation commands are considered.

## Fixture Setup

```bash
pnpm bwrk init --workspace /private/tmp/boreal-next-dogfood.FxT1EJ --setup-memory --memory-layout child --memory-git-mode separate --install-root /private/tmp/boreal-next-dogfood.FxT1EJ/.agents/skills --skill-target codex --json
```

```bash
pnpm bwrk --workspace /private/tmp/boreal-next-dogfood.FxT1EJ work create "Fixture next loop done gate" --description "Create a fixture-output.txt file, attach evidence, verify, and close through commands selected by bwrk next." --required-gate verification --gate-command "test -f fixture-output.txt" --gate-expect "fixture-output.txt exists" --ready --json
```

Created fixture work `bw_work_70589e92c853889a` with gate `bw_gate_da7c60c14e266c64`.

## Initial Bug Evidence

Before the ready-work selector fix, the first `bwrk next --agent cybertron --json` in the fixture returned the declared gate command:

```bash
test -f fixture-output.txt
```

That was premature because no reservation existed yet. The selector was updated so ready work prefers `workflow_next.canonical-next-step` when sync is healthy.

## Next-Driven Run

After the fix, every `bwrk` command in this sequence was selected from the prior `bwrk next` result.

| Step | Selected or executed command | Result |
| --- | --- | --- |
| 1 | `bwrk next --agent cybertron --json` | selected `bwrk sync refresh --json` |
| 2 | `bwrk sync refresh --json` | passed |
| 3 | `bwrk next --agent cybertron --json` | selected `bwrk work claim --agent cybertron --json` |
| 4 | `bwrk work claim --agent cybertron --json` | claimed reservation `bw_reservation_2924d12e08a84d9d` |
| 5 | `bwrk next --agent cybertron --json` | selected `test -f fixture-output.txt` |
| 6 | create `fixture-output.txt` | implemented the fixture change |
| 7 | `test -f fixture-output.txt` | passed |
| 8 | `bwrk agent finish current --agent cybertron --summary "fixture-output.txt exists; created fixture-output.txt and passed the declared done-gate command from bwrk next." --kind command --outcome passed --command "test -f fixture-output.txt" --verdict passed --notes "Declared observable fixture-output.txt exists." --close --reason "Declared next-driven validation passed." --dirty-path "no_repo_changes:disposable_fixture_workspace_not_committed" --json` | closed fixture work |
| 9 | `bwrk next --agent cybertron --json` | selected `bwrk sync refresh --json` |
| 10 | `bwrk sync refresh --json` | passed |
| 11 | `bwrk next --agent cybertron --json` | returned idle with `directive: null` and `syncOk: true` |

The fixture closeout produced evidence `bw_evidence_9801082657b5cf74`, verification `bw_verification_bf473c9f17379a8f`, and summary `bw_summary_a301a45aecc19c53`.

## Boundary Observed

`bwrk next` selects the next executable command. Raw declared validation commands are intentionally surfaced for active reservations, but the executor still records evidence, verification, summary, and closeout through `bwrk agent finish`.

## Validation

The selector fix and termination property were validated with:

```bash
pnpm vitest tests/runtime/cli-agent-directives.test.ts --run -t "returns one next directive"
pnpm vitest tests/runtime/cli-agent-directives.test.ts --run
pnpm vitest tests/runtime/file-store.test.ts --run
pnpm test
```
