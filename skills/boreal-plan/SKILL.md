---
name: boreal-plan
description: "Boreal v2 planning skill. Use when creating or refining milestones, sprints, tasks, dependencies, acceptance, or sprint launch intent."
---

# Boreal v2 Plan

Use this thin adapter to plan hierarchy and delivery through the Rust-owned Boreal v2 application.

## Contract

- Read `boreal.yaml` and resolve `boreal.workflow.plan.v1` with `bwrk workflows show <ref> --json`.
- Establish project context before mutation. Represent hierarchy explicitly as `milestone`, `sprint`, and `task`; keep parent, sprint, dependency, acceptance, and launch intent typed.
- Discover actor-claimable tasks with `work ready`; inspect active cycles with `cycle current`. Templates support parameters, dependencies, labels and acceptance profiles; `template run` previews by default and applies the whole plan atomically with `--apply --yes --expected-revision`.
- Use the workflow's allowed `work`, `cycle`, `sprint`, `dep`, and template commands. Do not emulate rollups, readiness, cycle checks, or lifecycle transitions in the harness.
- Treat the application response, revision, the returned trusted directive/action descriptors, and required gates as authoritative. One state-changing action per response.
- Preserve rejected or superseded planning attempts as evidence; never overwrite historical work to make a plan appear complete.

## Completion

Report the created or updated work IDs, explicit hierarchy, dependency/acceptance state, sprint action if any, receipt, and the next safe action.
