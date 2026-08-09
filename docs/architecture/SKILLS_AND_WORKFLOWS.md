# Skills And Workflows

Workflows are canonical. Skills are thin adapters. Templates shape output artifacts.

## Directory Layout

```text
workflows/
templates/
skills/
```

## Workflow Metadata

Each workflow uses frontmatter with `id`, `title`, `group`, `status`, `risk`, `writes_state`, `requires_workspace`, `allowed_commands`, and `templates`.

## Skill Metadata

Each skill declares the canonical workflow IDs it can route to. Skill text must reference those IDs and must not duplicate detailed workflow steps.

## Planning Depth

The planning skill chooses the smallest executable shape for the request:

- Quick: one bounded task with observable acceptance and an appropriate verification or checkpoint gate.
- Standard: a container or sprint with implementation tasks, dependencies, and final validation.
- Granular: separate discovery/design, implementation, review/critique, update, and validation passes when uncertainty, design judgment, or risk justifies them.

The `feature-delivery` Markdown contract records the rationale and evidence strategy. The `templates/work-structures/feature-delivery.yaml` template is the reusable state shape for the granular mode; it is validated and dry-run before instantiation.

Review and validation are first-class work when they change delivery confidence. Review findings block the reconciliation/update pass, and every finding-producing validation must block reconciliation, affected contract/artifact updates, and revalidation before parent closeout or the next sprint can advance. A no-findings result is an explicit reconciliation disposition.

## Installer Behavior

The installer should render skills for Codex and Claude into a selected install root. Dry-run mode reports target files and source workflow references without writing.

## Closeout Checkpoints

Workflows that close task, sprint, phase, milestone, or project work must require a Git checkpoint commit or an explicit no-commit reason code when repository state changed. Closeout summaries must report the affected child work, evidence, verification, commit SHA(s), reason code(s), and any remaining dirty paths instead of collapsing broad work into one final narrative.

## Parallel Lane Isolation

When a sprint, phase, or branch will be executed by multiple agents, workflows must apply [Lane Worktree Isolation](LANE_WORKTREE_ISOLATION.md). Shared integration branches are merge targets only; state-changing work must happen in a lane worktree and branch. Workflow outputs and handoffs should name the merge target, lane branch, worktree path, base SHA, validation command, and merge-back status.

## Required Closeout Gates

Required closeout gates are subject-scoped work policy, separate from the workspace-wide `gate closeout` health command. Gate kinds, scope, evidence requirements, force semantics, and summary output are specified in [Required closeout gate contract](CLOSEOUT_GATE_CONTRACT.md). Schema, enforcement, reports, and workflow changes should use that contract as the implementation boundary.

Workflow docs that create, edit, verify, summarize, or close work must expose the gate lifecycle directly: plan gates with `work create` or `work edit --required-gate`, satisfy them with subject-matched passed evidence and verification, inspect `closeoutGateStatus` from CLI JSON output, and force only the specific planned gate with `work edit --force-gate ... --force-gate-reason ... --force-gate-comment ...`. Forced summaries are separate and must not imply forced review, audit, verification, or checkpoint gates.
