# Vertical 10 — local trust and resource boundaries

Task IDs: P3-07, P5-03, P5-05–P5-07. Read
[the architecture](../../ARCHITECTURE.md),
[source workflow](../../SOURCE_ENGINE.md), and
[memory contract](../../MEMORY_BANK.md).

## Outcome and ownership

One project, harness, or raw source cannot silently read or mutate another
project's state, impersonate a replacement attempt, execute source text as
instructions, or exhaust the service through unbounded inputs. This vertical
owns boundary tests, threat model, and hardening changes agreed with each
module owner; it does not create a second authorization path.

## Prerequisites

P0-01 determines whether the first release is same-host only and which actors
may publish/cancel. P2-09 provides the local service and attempt fences.
P3-09 provides source/memory behavior. Full review begins at P5-03.

## Review and implementation steps

1. Record trust boundaries for local socket access, actor/harness identity,
   attempt token/fence, project root, imported Git state, external URLs,
   source bytes, output blobs, and referenced response files.
2. Test socket ownership/permissions and project binding. A request for one
   workspace cannot be redirected to another by a path or forged root field.
3. Validate path canonicalization, symlink escape, URL scheme/redirect limits,
   content size, parser time/memory budgets, and response-reference size and
   digest. Never execute instructions embedded in raw sources.
4. Confirm service queue and readers have bounded request count/size/time;
   long-lived subscribers cannot keep SQLite read transactions open or starve
   WAL checkpointing.
5. Test Git memory publication against dirty worktrees, unexpected branch
   movement, conflicting human edits, and injected frontmatter. Publication
   uses its dedicated worktree and reports conflicts.
6. Review logs/metrics for source content, tokens, secrets, and unbounded
   cardinality. Preserve provenance without leaking full raw output into
   routine status.

## Acceptance and failures

- Cross-project reads/writes and stale-attempt updates fail with typed errors
  and leave state unchanged.
- Source prompt text remains quoted data; it cannot trigger CLI commands or
  publication without an explicit reviewed operation.
- Oversized or slow source and API requests receive bounded errors while
  unrelated task claims and status reads remain available.
- Socket/service restart and Git conflict cases fail closed without breaking
  live locks or overwriting human work.

Handoff evidence: threat model, negative-test results, exact paths/subjects
used, any accepted limitation with owner/gate, and rerun checks after fixes.
Security review findings flow through P5-05 -> P5-06 -> P5-07.
