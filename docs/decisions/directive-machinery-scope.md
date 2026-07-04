# Directive Machinery Scope

Status: accepted

Date: 2026-07-04

## Context

Task 19 is a static audit only. It does not delete directive machinery.

The directive registry in `packages/core/src/agent-directive-registry.ts` currently has 15 active entries. They use four emitted directive kinds:

- `recovery`: `blocked.resolve-blockers`, `doctor.recovery-required`
- `obligation`: `verification.evidence-required`, `review.gate-required`, `audit.gate-required`, `git.checkpoint-required`, `git.lane-worktree-required`, `memory.reconcile-source`, `container.descendant-closeout`, `sprint.launch-plan`
- `summary`: `closeout.summary-required`, `handoff.session-summary`, `phase.close-rollup`, `sprint.close-rollup`
- `next_step`: `workflow_next.canonical-next-step`

The type system also allows `warning` and `acknowledgement`, but no registry entry uses either kind.

Prior decisions say directives are projections of enforcement gaps, not a second rule engine. The hard gates now live in closeout gate enforcement, reservation checks, and git lifecycle checks. That means a directive should either help an agent navigate a live command result or be removed instead of duplicating a command that already blocks.

## Static Audit

Method:

- inspected `packages/core/src/agent-directive-registry.ts`;
- inspected directive gap/data projection in `packages/core/src/agent-directive-compiler.ts` and `packages/agent-runtime/src/directives.ts`;
- grepped `skills/` and `workflows/` for every registry id and trigger code.

Exact `skills/` and `workflows/` references were nearly absent. The only exact registry id or trigger-code hit was `git.lane-worktree-required`, referenced in:

- `workflows/00-agent/agent-session.md`
- `workflows/40-work/checkpoint-git-state.md`

Generic directive handling is widespread: skills and workflows say to inspect `agentDirectives`, follow required or blocking directives first, and use `workflow_next` / `bwrk next` for the next command. That is a generic navigation dependency, not evidence that every registry entry is consumed.

| Registry entry | Kind | Exact skill/workflow reference | Audit result |
| --- | --- | --- | --- |
| `blocked.resolve-blockers` | `recovery` | none | Duplicates dependency/readiness blocking already represented by `work.blocked.open-dependency` and dependency workflows. |
| `verification.evidence-required` | `obligation` | none | Duplicates verification closeout gates and `close.no-passing-verification` / declared-command / expected-observable checks. |
| `review.gate-required` | `obligation` | none | Duplicates required review closeout gates. |
| `audit.gate-required` | `obligation` | none | Duplicates required audit closeout gates. |
| `git.checkpoint-required` | `obligation` | none | Duplicates checkpoint closeout gates and the git checkpoint workflow; keep the hard gate, not advisory shadow policy. |
| `git.lane-worktree-required` | `obligation` | 2 exact refs | Keep while lane worktree setup is directive-driven; workflows name it explicitly. |
| `closeout.summary-required` | `summary` | none | Duplicates closeout summary requirements already enforced by closeout paths and workflows. |
| `doctor.recovery-required` | `recovery` | none | Duplicates `doctor`, `sync`, and `gate closeout` health failure paths; useful only as a navigation wrapper. |
| `memory.reconcile-source` | `obligation` | none | Advisory with no first-party workflow reference; no runtime gap producer in `packages/agent-runtime/src/directives.ts`. |
| `handoff.session-summary` | `summary` | none | Handoff workflows already describe handoff summaries; the registry id is not consumed directly. |
| `container.descendant-closeout` | `obligation` | none | Advisory entry with `blocksCloseout`; duplicates hard descendant-work closeout blocking. |
| `phase.close-rollup` | `summary` | none | Phase rollup is procedural workflow/report behavior, not a directive-specific consumer. |
| `sprint.close-rollup` | `summary` | none | Sprint report and sprint close workflows already cover this behavior. |
| `sprint.launch-plan` | `obligation` | none | Advisory with no first-party workflow reference; not emitted by the agent-runtime directive helper. |
| `workflow_next.canonical-next-step` | `next_step` | generic `workflow_next` / `bwrk next` refs | Keep until `bwrk next` has a non-directive next-command envelope. |

## Decision

Keep hard gates as the source of truth:

- closeout gates for verification, checkpoint, review, audit, summary, and descendant-work closure;
- reservation checks for not-ready work, active conflicts, and capacity;
- git lifecycle gates, including branch mismatch and lane worktree requirements.

Do not add new advisory directive entries for these gates unless a first-party skill or workflow names the directive id and uses directive-specific data that is not already present in the command error or JSON result.

Use directives only for live navigation and explicit workflow handoff. Today that means retaining `git.lane-worktree-required` because workflows name it, and retaining `workflow_next.canonical-next-step` because current skills and workflows depend generically on `workflow_next` / `bwrk next`.

## Follow-up Deletion List

A follow-up deletion plan should start with these advisory entries:

- `memory.reconcile-source`
- `handoff.session-summary`
- `container.descendant-closeout`
- `phase.close-rollup`
- `sprint.close-rollup`
- `sprint.launch-plan`

Do not include `workflow_next.canonical-next-step` in that first deletion. It is advisory, but it is the current generic `bwrk next` transport. Removing it should be paired with a replacement next-command envelope and workflow updates.

Required or blocking-looking entries such as `verification.evidence-required`, `review.gate-required`, `audit.gate-required`, `git.checkpoint-required`, `closeout.summary-required`, `blocked.resolve-blockers`, and `doctor.recovery-required` are not enforcement authorities. A later cleanup can remove those directive wrappers too, but only after command results expose equivalent gaps, repair commands, and user-facing messages without the directive bundle.

## Estimated Savings

Deleting the six advisory entries above should save about 300-380 production TypeScript lines:

- about 75 lines from the registry entries;
- about 150-160 lines from typed payload interfaces and payload field maps;
- about 80-140 lines from compiler/runtime data and gap projection branches, depending on how much `handoff` and `workflow_next` sharing remains.

Expected test and fixture churn is another 150-250 lines, mostly in directive compiler, runtime integration, enforcement-gap coverage, and golden fixture tests.

The conservative total follow-up deletion size is therefore about 450-630 lines. If `workflow_next.canonical-next-step` is replaced later, expect an additional 100+ production lines plus broader workflow/test updates.

## Consequences

The directive registry becomes smaller and easier to reason about. Enforcement remains in command/runtime gates where failures can be atomic and fail closed. Workflows remain the source of procedural guidance, and directives stay limited to cases where a command result needs to steer the next agent action.

Future directive entries should include an exact skill/workflow consumer or a clear non-duplicative navigation purpose before being added.
