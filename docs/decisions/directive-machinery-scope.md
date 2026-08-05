# Directive Registry Scope

Status: accepted.

## Context

Agent directives are projections of live enforcement gaps, not a second rule engine. Hard requirements remain in closeout gates, reservation checks, Git lifecycle checks, health checks, and other command/runtime boundaries.

## Decision

Keep directives for two purposes:

- explain a live enforcement gap with trusted, typed data;
- identify the next safe command or workflow handoff.

Use command results and closeout gates as the source of truth for verification, review, audit, checkpoint, summary, readiness, and descendant-work requirements. Do not add a directive that merely repeats an existing failure message or gate unless a first-party workflow consumes directive-specific data.

The current registry retains navigation contracts for lane worktree requirements and the canonical `workflow_next` / `bwrk next` path. Other directives remain subject to the same non-duplication rule.

## Requirements for new directives

Every new registry entry must:

1. map to a stable enforcement-gap code or a documented navigation boundary;
2. use trusted checked-in instruction text;
3. expose only typed runtime data in its payload;
4. name a first-party skill, workflow, command, or adapter that consumes it; and
5. preserve fail-closed behavior when required data is missing.

This keeps enforcement atomic at the runtime boundary and keeps workflows responsible for procedural guidance.
