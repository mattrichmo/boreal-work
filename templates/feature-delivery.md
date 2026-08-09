---
id: boreal.template.feature-delivery.v1
title: Feature Delivery Plan
status: v1
---

# Feature Delivery Plan

## Purpose

Use this output contract when planning a feature, client page, workflow, refactor, or other deliverable that may benefit from explicit discovery, implementation, critique, update, validation, and post-validation reconciliation passes. It records why the chosen planning depth is appropriate; the YAML work-structure template is the canonical reusable state shape.

## Required Fields

- Objective and bounded scope
- Planning mode and rationale
- Constraints and non-goals
- Assumptions and open questions
- Work-stage and dependency map
- Review/critique, reconciliation, and validation strategy
- Done definition and evidence expectations
- Next action

## Template

### Objective And Scope

- Target:
- User or system outcome:
- In scope:
- Out of scope:

### Planning Mode

Choose quick, standard, or granular and explain why. Granular planning is appropriate when discovery, visual/design judgment, implementation, review/critique, a follow-up reconciliation/update, or separate validation materially changes the delivery risk.

### Constraints And Assumptions

- Constraints:
- Assumptions:
- Open questions:

### Work-Stage Map

Describe the stages and their blocking direction. A common granular shape is:

`discovery/design → implementation → review/critique → update → validation → reconciliation/update → revalidation → advance`

Name which stages are tasks, which are sprints or containers, and which evidence or closeout gates apply. Any finding-producing check must be followed by reconciliation; a later sprint or parent must depend on the revalidation/reconciliation result, not directly on the check.

### Review And Validation

- Review artifact and reviewer:
- Critique findings and disposition:
- Validation commands or walkthrough:
- Validation findings, reconciliation/update owner, and revalidation:
- Visual/accessibility/regression checks:
- Required evidence:

### Done Definition

State the observable final result, child-work completion rule, accepted deferrals, checkpoint/commit expectation, and the gate proving that findings were reconciled before advancement.

### Risks And Open Questions

List unresolved decisions, likely scope changes, dependency risks, and follow-up work.

### Next Action

Name the next Boreal workflow or exact CLI command to run.
