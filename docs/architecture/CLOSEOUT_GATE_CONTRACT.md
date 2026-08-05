# Required Closeout Gate Contract

Required closeout gates are per-work policy requirements that must be satisfied before a work item, sprint, phase, milestone, or project can close. They are separate from the `gate closeout` workspace health command: `gate closeout` checks workspace readiness, while required closeout gates check whether a specific subject has the review, audit, verification, and checkpoint proof its plan requires.

This contract defines the implementation boundary for the closeout-gates sprint. Runtime and CLI changes should preserve these terms so schema, enforcement, reports, and workflows do not drift.

## Gate Kinds

The first supported gate kinds are:

| Kind | Purpose | Satisfied By |
| --- | --- | --- |
| `verification` | Proves the subject met its acceptance criteria. | Existing `work verify` records with `verdict=passed` and evidence whose subject matches the work being closed. |
| `checkpoint` | Proves repository state was checkpointed or intentionally left uncommitted. | At least one closeout summary commit SHA, or a dirty-path note whose prefix is an accepted checkpoint reason code. |
| `review` | Requires an explicit review pass before closeout. | Evidence with `kind=review`, `outcome=passed`, a matching subject, and notes or URI that identify the reviewed diff, artifact, or work scope. |
| `audit` | Requires a broader check for policy, security, data, or workflow risks before closeout. | Evidence with `kind=review`, `kind=command`, or `kind=artifact`, `outcome=passed`, a matching subject, and a summary that records findings disposition. |

Additional gate kinds must not be inferred from labels alone. A future custom kind needs a schema enum addition or a typed extension field, plus doctor/report coverage.

## Scope

A required gate belongs to one closeout subject and has an explicit scope:

- `self`: only the subject itself must satisfy the gate.
- `direct_children`: every direct child in the dependency tree must satisfy the gate before the parent closes.
- `descendants`: every descendant in the dependency tree must satisfy the gate before the parent closes.

Task closeout normally uses `self`. Sprint, phase, milestone, and project closeout may use `direct_children` or `descendants` when the parent is acting as a release gate.

The subject identity must be stored with the gate as `subjectType` and `subjectId`. Enforcement must not rely on labels, title matching, current active sprint, or search results to determine the gated subject.

## Runtime Shape

The runtime model should persist required gates as typed records or a typed work-record field with this logical shape:

```ts
type CloseoutGateKind = "verification" | "checkpoint" | "review" | "audit";
type CloseoutGateScope = "self" | "direct_children" | "descendants";
type CloseoutGateStatus = "open" | "satisfied" | "forced";

interface RequiredCloseoutGate {
  id: string;
  subjectType: "work" | "sprint" | "phase" | "milestone" | "project";
  subjectId: string;
  kind: CloseoutGateKind;
  scope: CloseoutGateScope;
  status: CloseoutGateStatus;
  requiredEvidenceKinds: string[];
  requiredOutcome: "passed";
  minEvidenceCount: number;
  declaredCommand?: string;
  expectedObservable?: string;
  createdAt: string;
  createdBy: ActorRef;
  satisfiedBy?: {
    evidenceIds?: string[];
    verificationIds?: string[];
    agentSummaryIds?: string[];
    commitShas?: string[];
    dirtyPathNotes?: string[];
  };
  force?: {
    reason: string;
    comment: string;
    actor: ActorRef;
    evidenceIds?: string[];
    forcedAt: string;
  };
}
```

The schema may store this inline on work records or in a separate state section, but command output should expose the same logical fields so later reports and agents can depend on one contract.

`declaredCommand` is an optional exact command string that the filer expects closeout evidence to record. `expectedObservable` is an optional deterministic substring that must appear in satisfying evidence text or a linked artifact once evaluation is wired. It is intentionally a substring, not a regular expression, so gate declarations cannot smuggle executable or ambiguous matching logic into closeout. Both fields are additive: existing gates omit them and evaluate exactly as before. When present, they participate in the deterministic gate ID so two gate declarations with different done conditions do not collapse into one record.

## Evidence Requirements

All gate evidence must be subject-matched. A gate cannot be satisfied by evidence attached to a different work item unless the gate scope explicitly evaluates a parent/child relationship.

Minimum requirements by kind:

- `verification`: at least one passed verification record for the subject, backed by evidence with a passed or observed outcome.
- `checkpoint`: at least one final or forced agent summary for the subject with `commitShas.length > 0`, or a dirty-path note whose prefix is one of the checkpoint reason codes in `apps/cli/src/summary-policy.ts`.
- `review`: at least one passed review evidence record for the subject. The evidence body or URI must name the reviewed scope. Implementations should warn when the reviewer actor is the same as the closer, unless the gate was forced.
- `audit`: at least one passed review, command, or artifact evidence record for the subject. The summary must state whether findings were absent, fixed, deferred into linked work, or forced.

## Force Semantics

Forcing a gate is an audited bypass, not a normal success path.

- Force is per gate, not per close command.
- A forced gate must store a machine-readable reason code and a human comment.
- A forced gate should attach evidence when evidence exists, but it may close without satisfying the normal evidence rule only when the force record is present.
- `--force-summary` satisfies only the agent-summary requirement. It must not implicitly force `review`, `audit`, `verification`, or `checkpoint` gates.
- Parent closeout must include child forced gates in its rollup output so a sprint or milestone cannot hide bypassed work.

Suggested initial force reason codes:

- `review_unavailable`
- `audit_unavailable`
- `external_review_record`
- `legacy_backfill`
- `user_accepted_risk`
- `emergency_closeout`

## Closeout And Summary Output

Every command that can close or cancel gated work must return gate status in its JSON envelope. The output should include:

- `requiredGates`: every gate evaluated for the subject.
- `gate.status`: `satisfied`, `open`, or `forced`.
- `gate.satisfiedBy`: evidence IDs, verification IDs, summary IDs, commit SHAs, and dirty-path notes used for the decision.
- `gate.force`: reason/comment/actor/timestamp when a gate was forced.
- `gateGaps`: unsatisfied gates that prevented closeout.

Agent summary Markdown must render a `Closeout Gates` section listing each gate, its scope, outcome, satisfying evidence, forced reason/comment when present, and checkpoint commit or dirty-path reason. Sprint reports and project closeout reports must roll those rows up for child work.

Doctor, `gate closeout`, and generated reports should treat unsatisfied required gates as blocking for non-legacy terminal work. Legacy imported terminal work can remain warning-only when it predates the policy enforcement date.

## Downstream Implementation Order

The remaining closeout-gates tasks should follow this order:

1. Persist the `RequiredCloseoutGate` contract on work records or a dedicated runtime section.
2. Enforce required gates in work, sprint, and agent closeout paths.
3. Expose planning and force controls through CLI/workflow commands.
4. Add doctor, `gate closeout`, sprint report, and agent summary coverage.
5. Run the review and audit validation suite against the implementation.
