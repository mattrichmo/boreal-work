# Agent Directive Taxonomy Cut

Status: accepted

Date: 2026-07-02

## Context

Agent directives are now projections of enforcement gaps. The previous public bundle shape combined severity, kind, lifecycle, and UI lane fields, but most combinations did not change consumer behavior.

Lifecycle also mirrored gap liveness: an active gap emits a directive, and a satisfied gap stops emitting one.

## Decision

Expose exactly three directive severities in emitted bundles: `blocking`, `required`, and `advisory`.

Drop `lifecycle` from emitted directive bundles. Keep registry lifecycle metadata for registry list/show and supersession validation, but do not emit runtime lifecycle state in `agentDirectives`.

Keep `kind` in bundles because CLI, console, and workflow consumers still use it to distinguish next-step, recovery, summary, acknowledgement, and obligation rendering.

## Consequences

UI lanes derive directly from severity. Conflict metadata remains the way to show that a lower-priority directive is deferred by a blocking directive.

Existing consumers must stop branching on `info`, `action`, or emitted `lifecycle`; legacy unknown severity input should be treated as advisory by defensive display adapters.
