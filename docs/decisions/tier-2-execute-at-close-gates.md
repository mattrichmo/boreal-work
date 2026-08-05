# Tier 2 Execute-At-Close Gates

Status: accepted design; the safe execution boundary is implemented and closeout integration remains opt-in.

Date: 2026-07-02

## Context

Tier 1 declared closeout gates record the command an agent claims to have run and the expected observable result. That improves closeout review, but it still trusts the recorded command instead of executing it at close time.

The runtime already has the building block for bounded command execution in `runBoundedProcess`. A tier 2 gate can use that primitive later to execute a filer-declared command during closeout, capture bounded output, and attach the result as evidence automatically.

## Decision

The safe execution boundary is active as an implementation contract; gate-to-evidence and closeout enforcement remain separate integrations.

When implementation is approved, gate execution should be guarded by a new `RuntimePolicy` flag such as `executeDeclaredGatesAtClose`, defaulting to `false`. Existing tier 1 declared-gate behavior stays unchanged when the flag is disabled.

The only executable input may be the checked-in `declaredCommand` string stored on the required gate. Runtime code must not assemble shell text from agent notes, summaries, directive payloads, evidence text, or user-facing reason strings.

The command must run from the resolved workspace root unless a later accepted decision adds a narrower cwd field to the gate schema. Environment handling should start from the current CLI process environment with no automatic secret expansion beyond what the operator already provided to the process.

Execution must use bounded process limits: timeout, stdout byte cap, stderr byte cap, captured hashes, and explicit timeout or output-limit failure states. Non-zero exit, timeout, output cap breach, spawn failure, and expected-observable mismatch all fail the gate.

On execution, the runtime should auto-record command evidence containing the declared command, cwd, exit code, timeout flag, stdout/stderr byte counts and hashes, bounded output excerpts, and the expected observable check result. The verification step should reference that evidence rather than a manually asserted command.

## Consequences

Closeout can become slower or less deterministic when the policy is enabled, so the default-off flag is required for compatibility.

The provenance rule keeps the safety boundary clear: trusted code executes only gate-declared commands, while untrusted runtime text remains evidence data.

`executeDeclaredGate` now enforces this boundary: no shell, strict token parsing, approved executable list, workspace-contained real path, allowlisted environment keys, dry-run preview, timeout and stream caps, and abort-signal cancellation. It accepts only `source: required_closeout_gate`; callers cannot route work descriptions, notes, summaries, or evidence text through the API.
