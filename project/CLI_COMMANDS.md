# V2 CLI commands to preserve

Status: proposed product contract for P0-03 command fixtures and P0-04 legacy
parity review. This is the **required behavior surface**; the Rust CLI
implements the current bounded local/service slice, while the full command
surface remains under integration.
The exact flag grammar, aliases, and wire schemas must be frozen as fixtures
before agents automate them. See [INTERFACES.md](INTERFACES.md),
[AGENT_GUIDANCE.md](AGENT_GUIDANCE.md), and
[WORKFLOW_PARITY.md](WORKFLOW_PARITY.md). The authoritative status/deadline
semantics live in [STATUS_MODEL.md](STATUS_MODEL.md).

## How to read this inventory

`Keep spelling` means a v1 command path is part of the v2 compatibility
contract, though unsafe or ambiguous flags may change with a clear error.
`Keep behavior` means the capability must survive, but the v2 spelling shown
here is proposed; P0 must record the alias or migration. `New` means v2 needs
the command to make the preserved workflow coherent. A command listed here
must call the same Rust application use case as the local API and TUI.

This is deliberately not a promise to port every v1 flag or administrative
subcommand. We preserve the agent's ability to discover work, understand
conditions, act, prove results, recover, and find the next task. Any omitted
working v1 command with meaningful user impact requires an explicit
keep/rework/defer disposition in the P0-04 parity inventory; omission is not
approval to delete the behavior.

## Non-negotiable command behavior

- Every `--json` result uses one versioned envelope with transport outcome,
  application outcome, operation ID, revision, bounded data, typed error,
  and optional checked detail reference. List payloads remain arrays.
- `guide`/`next` gives one contextual trusted action, exact argv/cwd/runner,
  required/blocking obligations, and why; it never executes arbitrary task
  prose. No-goal entry, active-attempt resume, and explicit idle are normal.
- Mutations use operation IDs, expected revision when needed, and attempt
  fences; unknown outcomes are resolved by readback, not blind retry.
- Claim, release, verification, and finish re-evaluate conditional status,
  dependencies, eligibility, capacity, and gates in one authoritative Rust
  path. No CLI spelling bypasses a required gate or converts operator-only
  work into automatic work.
- `queued` means a normal upstream wait, `blocked` means intervention is
  needed, and lease or hard-budget expiry flags an open task for review; these are never
  agent-editable status fields. `--ttl`/renewable lease and a hard attempt
  time limit must have distinct, documented grammar and output fields. A
  claim without `--time-limit` gets a two-hour hard deadline from `claimed_at`;
  explicit `--time-limit` overrides it without changing lease semantics.
- A high-level `agent finish` remains the normal consolidated close/release
  path. Low-level evidence/gate commands remain available for inspection,
  augmentation, and audited recovery, not as a second normal lifecycle.
- Routine status and guide responses are bounded independent of history;
  detail and history are explicitly paginated or referenced.

## Required commands and purposes

The tables below are grouped by the job an agent is trying to complete;
they are not separate storage or workflow engines.

### Discover, resume, and hand off

| Current command | V2 disposition | Purpose to preserve |
| --- | --- | --- |
| `bwrk commands` | Keep spelling | Machine-readable command/flag/output registry. An agent can discover valid syntax without guessing or repeatedly reading help. |
| `bwrk help [path]` / `--help` | Keep spelling | Human command discovery, generated from the same registry as validation. |
| `bwrk prime` | Keep spelling | Compact project/startup brief when an agent enters a workspace without a goal. |
| `bwrk agent guide` | Keep spelling | Trusted, contextual operating loop and exact next-step directives, including required evidence and recovery. |
| `bwrk next` | Keep spelling | Select one safe, revision-bound action for the current actor/attempt, or say explicitly why there is no action. |
| `bwrk agent status` | Keep spelling | Bounded current reservations/attempts, capacity, claimable work, and next obligation. No historical-assignment dump. |
| `bwrk agent start [work-ref]` | Keep spelling | Resume an existing current attempt or atomically claim suitable work; return contextual handoff. |
| `bwrk agent finish <work-ref>` | Keep spelling | Consolidated, resumable evidence → verify → summary → close/release path, with exact unmet obligations. |
| `bwrk session start` / `bwrk session end` | Keep spelling | Durable actor/session identity and handoff boundary; not a second claim authority. |

The v1 `bwrk status` path is a compatibility alias for `prime`, **not** an
active-state or health command. Keep it as that alias until a deliberate
deprecation/migration; use `agent status`, `dashboard`, and `sync status` for
those distinct views. The v1 `bwrk start` alias maps to `agent start`.

### Plan and inspect milestone → sprint → task work

| Current command | V2 disposition | Purpose to preserve |
| --- | --- | --- |
| `bwrk work create` | Keep spelling | Create a task, sprint, milestone, or other supported work kind with parent, source, acceptance, gate, and initial-eligibility data. |
| `bwrk work edit` | Keep spelling | Change mutable planning fields without losing dependencies, evidence, reservations, or history. |
| `bwrk work show` | Keep spelling | Inspect one work item's current status, blockers, gates, attempt, and contextual directives. |
| `bwrk work list` | Keep spelling | Bounded filtered work listing with stable typed JSON. |
| `bwrk work rollup` | Keep spelling | Milestone/sprint/task hierarchy and aggregate status. |
| `bwrk work next` | Keep spelling | Read-only dependency-valid, eligible candidate queue. It does not mark an item ready. |
| `bwrk work ready` | Keep spelling | Explicit transition to ready after rechecking conditions; **not** a read-only synonym for `work next`. |
| `bwrk work parallel` | Keep spelling | Show work that can proceed concurrently without violating dependency/capacity policy. |
| `bwrk work review-candidates` | Keep spelling | Surface completed implementation needing independent review. |
| `bwrk work recent-closed` | Keep spelling | Bounded recent closeout view; historical detail remains paginated. |
| `bwrk dep add` / `bwrk dep remove` | Keep spelling | Mutate the blocking graph with cycle and readiness checks. |
| `bwrk dep tree` / `bwrk dep cycles` | Keep spelling | Explain dependency structure and cycles without changing it. |
| `bwrk sprint list` / `bwrk sprint show` | Keep spelling | Find sprints and inspect their scoped work. |
| `bwrk sprint launch` | Keep spelling | Turn a planned sprint/work structure into an actionable, conditional workflow. |
| `bwrk sprint current` / `bwrk sprint status` | Keep spelling | Show the active sprint identity and concise state; preserve their distinct current outputs. |
| `bwrk sprint activate` | Keep spelling | Explicitly select the active sprint. |
| `bwrk sprint board` | Keep spelling | Task-state board for humans and agents, backed by the same authoritative snapshot. |
| `bwrk sprint report` / `bwrk sprint metrics` | Keep spelling | Sprint progress, throughput, and quality reporting without scanning full history on routine status. |
| `bwrk sprint close` | Keep spelling | Verified sprint closeout with outstanding-work, evidence, and health checks. |

There is no v1 `bwrk milestone ...` or `bwrk task ...` family. Preserve
`work create --kind milestone|sprint|task`, hierarchy, and rollups as the
canonical entity surface. Friendly `milestone`/`task` façades can be additive
later, never a second status model. `bwrk work block` is a compatibility path
for adding a blocking dependency.

### Claim, validate, and complete

| Current command | V2 disposition | Purpose to preserve |
| --- | --- | --- |
| `bwrk work claim [work-ref]` | Keep spelling | Atomically acquire eligible work and create the one current fenced attempt. |
| `bwrk work reserve` | Keep spelling | Explicit lease/reservation for a chosen agent; never an untracked alternative to an attempt. |
| `bwrk work renew` / `bwrk agent renew` | Keep spelling | Renew only the caller's current fenced lease. Runtime liveness is separate. |
| `bwrk reservation list` | Keep spelling | Inspect current live reservations and detect orphan/ownership issues. |
| `bwrk evidence run` | Keep spelling | Execute an approved bounded command and record a structured, attested receipt against an input snapshot. |
| `bwrk evidence add` | Keep spelling | Attach externally obtained evidence with provenance; self-report is not silently promoted to executor attestation. |
| `bwrk work verify` | Keep spelling | Check gate satisfaction using structured receipts and return specific mismatch reasons. |
| `bwrk work release` | Keep spelling | Release only the current attempt and recompute work eligibility, preserving failed evidence. |
| `bwrk work close` | Keep spelling | Audited lower-level closeout/recovery path; cannot bypass `agent finish` obligations. |
| `bwrk work reconcile` | Keep spelling | Diagnose/recover inconsistent work, reservation, and attempt state without erasing history. |
| `bwrk work cancel` / `bwrk work reopen` | Keep spelling | Explicit terminal/re-entry transitions with historical attempts and summaries retained. |
| `bwrk work split` | Keep spelling | Divide oversized work while keeping parentage and evidence provenance. |
| `bwrk summary compose` / `bwrk summary create` | Keep spelling | Durable typed implementation, verification, and handoff summaries; finish ordinarily composes these. |
| `bwrk summary show` / `bwrk summary list` / `bwrk summary render` | Keep spelling | Inspect current and superseded summaries without treating invalid history as current truth. |
| `bwrk gate closeout` | Keep spelling | Explicit project/operator closeout validation; not an expensive mandatory preflight for every task mutation. |

The old `work reserve` must be mapped to the v2 attempt model in P0; a lease
alone must not count as accepted execution. Direct `work close` and summary
commands stay available for audited recovery and review, while `agent finish`
is the default workflow. `summary backfill` is migration tooling, not a
normal agent step. Keep `bwrk done`/`bwrk pause` only as compatibility aliases
after their existing behavior is fixture-tested.

### Build product memory and retrieve context

| Current command | V2 disposition | Purpose to preserve |
| --- | --- | --- |
| `bwrk raw add` / `bwrk raw list` / `bwrk raw show` | Keep spelling | Immutable intake before interpretation, with bounded queue/record reads and provenance. |
| `bwrk raw triage` | Keep spelling | Explicitly promote or disposition intake into work/source/knowledge without losing the original. |
| `bwrk source add` / `bwrk source list` / `bwrk source show` | Keep spelling | Durable source identities and links used by work, decisions, and published memory. |
| `bwrk wiki create` / `bwrk wiki list` / `bwrk wiki show` | Keep spelling | Human-readable project knowledge with source/provenance links. |
| `bwrk decision create` / `bwrk decision list` / `bwrk decision show` | Keep spelling | Record and inspect durable architectural/product decisions with rationale. |
| `bwrk decision supersede` | Keep spelling | Replace a decision while retaining its earlier version and causal links. |
| `bwrk context show` / `bwrk context search` | Keep spelling | Bounded context-pack retrieval for an agent's current work. |
| `bwrk context rebuild` | Keep spelling | Explicitly rebuild derived context packs; no hidden projection rewrite on a TUI read. |
| `bwrk search query` | Keep spelling | Search the broader work/evidence/source/knowledge corpus, distinct from context-pack search. |
| `bwrk search index` | Keep spelling | Explicitly rebuild/check the derived search index. |

There is no v1 `bwrk memory ...` namespace. V2's source → draft → publish
memory lifecycle is a **new capability**, not a rename of `raw`, `source`,
`wiki`, or `decision`; P0 must settle how these existing records map into
publication without creating duplicate authorities. The existing global
`bwrk capture` is a convenience alias for raw intake. Knowledge `claim`
create/list/show/review remains in the parity review because the complex
adjudication workflow is explicitly deferred, but its existing records and
provenance must survive migration.

### Setup, trusted workflow discovery, and health

| Current command | V2 disposition | Purpose to preserve |
| --- | --- | --- |
| `bwrk init` | Keep spelling | Safe idempotent workspace initialization and explicit local data layout. |
| `bwrk setup` | Keep spelling | Guided project setup including runtime, Git/memory safeguards, and agent entrypoints. |
| `bwrk workflows list` / `bwrk workflows show` | Keep spelling | Discover trusted checked-in playbooks and their allowed command steps. |
| `bwrk directives list` / `bwrk directives show` | Keep spelling | Inspect versioned trusted directive definitions and compatibility lifecycle. |
| `bwrk doctor` / `bwrk doctor skills` | Keep spelling | Read-only health diagnostics by default; explicit idempotent repair cannot weaken integrity. |
| `bwrk sync status` | Keep spelling | Read-only collaboration/projection health, distinct from agent or sprint status. |
| `bwrk sync refresh` | Keep spelling | Explicit derived-artifact refresh without claiming to repair canonical corruption. |
| `bwrk dashboard` | Keep spelling | Human/TUI project overview from the same revisioned read model. |

`bwrk install` is a v1 alias/convenience family for setup and adapter/skill
installation; retain the relevant compatibility behavior, not a second
initializer. `bwrk view` aliases `dashboard`. `directives compile/render/explain`
and acknowledgement/debug tooling belong in the P0 parity matrix and can be
ported with the directive registry, but are not routine agent steps.

## New v2 commands or API operations—not observed v1 paths

| Proposed surface | Why it is needed | Status |
| --- | --- | --- |
| `bwrk agent resume` | Explicit resume/readback of the current attempt after process or model interruption. | Additive convenience; `agent start` must remain safe to resume. |
| `bwrk work accept` | Runtime acknowledgement that an assignment was actually accepted by a session. | Required operation; CLI spelling/visibility to freeze in P0. |
| `bwrk work heartbeat` / `bwrk work checkpoint` | Separate cheap liveness from meaningful durable progress. | Required operations; harness adapter may be the normal caller. |
| `bwrk work finish` | Low-level fenced atomic finish primitive under `agent finish`. | Required operation; external CLI exposure is a P0 decision. |
| `bwrk status --active --since <revision>` | Bounded revisioned active snapshot/change query. | **Do not use this spelling while `status` means `prime`**; choose an additive path such as `agent status --since` or `snapshot active`. |
| `bwrk memory ...` | New explicit source/draft/publication/retrieval façade if the memory-bank design warrants it. | Behavior required by memory plan; grammar and relationship to existing `raw/source/wiki/decision` freeze in P0. |

## Deliberate parity decisions, not silent deletions

- `bwrk orchestrate start|list|show|tick|progress|nudge|pause|resume|cancel|fail`
  currently exposes orchestration. Preserve run/assignment visibility,
  pause/resume/cancel, and audited manual adoption where useful, but replace
  repeated model-mediated `tick → show → work show` with the bounded status,
  deterministic dispatch, and event/backoff model. Automatic harness launch
  is deferred; do not promise drop-in v1 orchestration parity at launch.
- `bwrk template list|show|validate|run|capture` is a useful executable work
  structure system, distinct from `workflows` playbooks. P0 must inventory
  actual in-use templates and choose which built-in molds to bring into v2;
  broad custom authoring/capture is deferred, not proof that templates are
  disposable. A retained `run` must have dry-run, cycle, and provenance checks.
- `bwrk global ...` and `dashboard global` are cross-project functions, outside
  the initial single-project service. Keep their data/export compatibility
  under review; do not let global views become a second project truth.
- Legacy export/import/snapshot/registry, operation-log maintenance, and
  install/update commands need a P0-04 disposition and migration tests before
  cutover. The local audit trail and failed receipts are never discarded just
  because a particular admin command is not in the launch CLI.

## Fixture gate for declaring CLI parity

For every kept path, capture v1 usage/flags, one successful and one rejected
example, output types, side effects, and the v2 application use case. Test
aliases and help against the same command registry. Include conditional
ready/blocked/operator-only transitions, claim/resume/expiry, repeated and
mutually exclusive flags, structured evidence, stale receipts, interrupted
finish, and a no-goal `prime → guide/next → start → finish → next` journey.
Measure output bytes and lock wait/hold time during TUI + multi-agent use;
syntax parity without workflow parity does not satisfy this contract.
