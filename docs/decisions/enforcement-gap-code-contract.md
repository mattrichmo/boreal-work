# Enforcement Gap Code Contract

Status: accepted

Date: 2026-07-02

## Context

Agent directives should be projections of runtime enforcement, not a second rule engine. That requires enforcement points to describe missing requirements with stable machine codes that the directive registry can key against later.

## Decision

Use `EnforcementGap` as the public shape for enforcement misses. Every gap has a stable `code`, `subjectType`, `subjectId`, optional `targetId`, and optional typed `data` payload.

Gap codes use dotted namespaces followed by concise kebab-case leaves, for example `gate.verification.unsatisfied`, `work.blocked.open-dependency`, `reservation.not-ready`, `close.no-passing-verification`, and `summary.missing`.

The checked-in `ENFORCEMENT_GAP_CODES` constant is the source of truth. The JSON schema in `schemas/enforcement/enforcement-gap.schema.json` mirrors it so fixtures and external consumers can validate the contract before runtime emission is wired.

## Consequences

New enforcement behavior must add a code before directives depend on it. Runtime details stay in `data`; registry instruction text must not parse free-form reason strings.
