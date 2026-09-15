# Vertical 12 — canonical workflows and legacy parity

Task IDs: P4-10 and P4-11. Read the [parity inventory](../../WORKFLOW_PARITY.md),
[agent guidance protocol](../../AGENT_GUIDANCE.md),
[product contract](../../PRODUCT.md),
[directive handoff](11-agent-guidance.md), and
[task graph](../TASK_INDEX.md). This vertical preserves the useful CLI
workflow experience after the Rust work, evidence, source, and memory paths
exist. It does not import legacy TypeScript modules at runtime.

## Outcome

An agent entering v2 still gets contextual steps that carry it through a
task or project workflow. The command/path names can be cleaned up, but the
working behaviors cannot silently disappear. A fresh agent can route a
request, inspect project/work context, plan milestone/sprint/task work,
claim, checkpoint, attach/verify evidence, satisfy review/audit obligations,
finish/release, resume/handoff, and recover from a known health blocker.
Source/memory intake, cited retrieval, and Git publication have similarly
versioned steps. The Rust application remains the sole state-transition
authority; workflow assets are instructions and typed route metadata, not a
second status store or scheduler.

## Ownership and prerequisites

- Own v2 `workflows/**` or an equivalent versioned packaged asset directory,
  `project/spec/workflows/**` parity fixtures, and
  `crates/application/src/workflow_assets/**` for validation/selection.
- Own `crates/cli/src/commands/workflows.rs` only after Vertical 05 agrees on
  command-registry and protocol integration. Vertical 11 owns directive
  selection; this vertical supplies canonical workflow refs, required input
  names, allowed command paths, finish criteria, and next workflow refs.
- P4-10 waits for P2-09 and P3-09. P4-11 waits for P4-03, P4-04, P4-05,
  and P4-10 so it exercises the actual packaged assets.
  Shared manifest/version edits are coordinated by the integration owner.

## Work

1. Inventory the v1 workflows and directives from the P0-04 parity map.
   For each route, record `keep`, `rework`, or `defer`, why, the v2 command
   replacement, data migration impact, and the product-owner disposition for
   any feature users relied on. Retire duplicate prose, not required behavior.
2. Prepare a bounded core set for P4-05 packaging: route/guide; retrieve project/work/decision
   context; plan work and launch a sprint; claim/start/resume; checkpoint,
   evidence, verification, and finish/release; review/audit gate satisfaction;
   handoff/closeout; doctor/recovery; source intake, cited memory retrieval,
   and publication. Split discovery/design from mutation when authorization
   matters. Each route declares typed inputs, allowed command families,
   enforcement obligations, finish criteria, and next refs.
3. Validate that every workflow reference and command path resolves against
   the versioned Rust command registry and directive registry. Unknown assets
   or incompatible versions return a typed routing error; no best-effort
   fallback to untrusted task text or a stale checkout file.
4. Link workflow assets to the same guide/next DTO. A response gives one
   current, trusted next action and bounded context refs; it does not dump a
   long workflow document every time or require another model turn to parse
   a result file. Packaged assets can be fetched separately by version.
5. Test each route with a scripted client and an unfamiliar agent on a
   fixture project. Include empty queue, existing reservation, blocked and
   operator-only work, pause/retry, stale attempt, missing verification,
   failed evidence, review/audit gate, release, finished work, health repair,
   source/memory citation, and a restart/handoff. Verify exact current
   conditions, action provenance, and preservation of failed history.
6. Measure calls and bytes per useful transition against the legacy
   baseline. A faster v2 result cannot omit verification, context, review,
   or required closeout steps. Keep routine responses bounded with long
   history and event-driven wakeup instead of model-mediated polling.

## Acceptance and gate

P4-10 passes when assets are versioned and packaging-ready with no file-path
dependency on the legacy checkout, each core workflow ref resolves,
and required closeout steps are enforced by the application—not merely
written in Markdown. P4-11 passes against the P4-05 package when the parity
matrix has evidence for
each retained/reworked route and every deferral is explicit, owned, and
user-visible. A fresh agent must be able to complete the core project/work
loop through Boreal's guidance without a bespoke parent prompt. P4-07
independently critiques the result; P4-08 reconciles findings; P4-09
revalidates before release testing.

Handoff: changed paths, asset/registry versions, v1-to-v2 route map,
scripted and unfamiliar-agent transcripts, exact command/environment and
source snapshot, gate/evidence results, payload/call measurements, approved
deferrals, and remaining limitations.
