# Boreal V1 Workflows

Boreal v1.0 is the project-scoped memory and work runtime for humans and agents. It must support raw intake, retrieval, reconciliation, durable memory, task structure, agent execution, handoff, and health checks without leaking memory across repositories.

## Core Concepts

- Raw source: immutable inbox/source material captured before interpretation.
- Memory: reconciled durable project truth in wiki pages, claims, decisions, evidence, and context.
- Work: issues, tasks, sprints, milestones, dependencies, reservations, verification, closeout, and right-sized planning structures.
- Workflow: canonical procedure with allowed commands, safety constraints, and finish criteria.
- Template: human-readable artifact shape used by workflows.
- Skill: agent-facing adapter that routes requests to canonical workflows.

## Raw To Memory

Raw material is captured first, then triaged, then reconciled into durable memory. Reconciliation may create wiki pages, claims, decisions, evidence, or work. Raw records are not rewritten to hide uncertainty.

## V1 Success Criteria

- Every common user ask routes to a workflow.
- Planning can be quick, standard, or granular without forcing every request into the most elaborate shape.
- Granular delivery can represent discovery/design, implementation, review/critique, update, and final validation as separate dependent work.
- Every skill references existing workflow files.
- Every workflow lists allowed commands, templates, safety constraints, failure handling, and finish criteria.
- Skill installs are explicitly project- or user-scoped; project installs may opt into folder-scoped metadata, and they never fall back to another repository.
- Doctor checks can validate workflow/skill references and install state.
