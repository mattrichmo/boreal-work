# R-CLI — project/CLI_COMMANDS.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/CLI_COMMANDS.md:L1–L282`  
**File SHA-256:** `d65591d2e271d30efd385fada58fd59f39e24ab3cd116cf4ce74c6e44001d8a8`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Public command vocabulary, aliases and retained agent/work/sprint semantics.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,282p' 'project/CLI_COMMANDS.md'
```

## Exact baseline excerpt

````text
    1 | # V2 CLI commands to preserve
    2 | 
    3 | Status: proposed product contract for P0-03 command fixtures and P0-04 legacy
    4 | parity review. This is the **required behavior surface**; the Rust CLI
    5 | implements the current bounded local/service slice, while the full command
    6 | surface remains under integration.
    7 | The exact flag grammar, aliases, and wire schemas must be frozen as fixtures
    8 | before agents automate them. See [INTERFACES.md](INTERFACES.md),
    9 | [AGENT_GUIDANCE.md](AGENT_GUIDANCE.md), and
   10 | [WORKFLOW_PARITY.md](WORKFLOW_PARITY.md). The authoritative status/deadline
   11 | semantics live in [STATUS_MODEL.md](STATUS_MODEL.md).
   12 | 
   13 | ## How to read this inventory
   14 | 
   15 | `Keep spelling` means a v1 command path is part of the v2 compatibility
   16 | contract, though unsafe or ambiguous flags may change with a clear error.
   17 | `Keep behavior` means the capability must survive, but the v2 spelling shown
   18 | here is proposed; P0 must record the alias or migration. `New` means v2 needs
   19 | the command to make the preserved workflow coherent. A command listed here
   20 | must call the same Rust application use case as the local API and TUI.
   21 | 
   22 | This is deliberately not a promise to port every v1 flag or administrative
   23 | subcommand. We preserve the agent's ability to discover work, understand
   24 | conditions, act, prove results, recover, and find the next task. Any omitted
   25 | working v1 command with meaningful user impact requires an explicit
   26 | keep/rework/defer disposition in the P0-04 parity inventory; omission is not
   27 | approval to delete the behavior.
   28 | 
   29 | ## Current dashboard composition
   30 | 
   31 | The current v2 snapshot has a composed, one-command dashboard path. From a
   32 | project directory with an existing `.boreal/boreal.sqlite`, the normal user
   33 | entry point is:
   34 | 
   35 | ```sh
   36 | bwrk dashboard
   37 | ```
   38 | 
   39 | The accepted context forms are `bwrk dashboard [PROJECT]`,
   40 | `bwrk dashboard --project PROJECT`, and `bwrk dashboard --db PATH` with the
   41 | same actor, harness, session, and optional work context flags shown in the
   42 | CLI help. In interactive mode the CLI resolves the existing database and
   43 | project, starts a private supervised Rust service, launches the packaged or
   44 | development TUI, forwards the TUI result, and attempts to clean up the managed
   45 | runtime. Normal-exit cleanup is covered by the current launcher smoke tests;
   46 | cleanup/readiness behavior across every startup and signal failure path is
   47 | still release hardening.
   48 | No separate `service run` terminal is required for ordinary dashboard use.
   49 | 
   50 | `bwrk dashboard --json` is the non-interactive branch. It reads the canonical
   51 | derived status projection and emits the versioned envelope without launching a
   52 | TUI or private service. The database must already exist; dashboard is not an
   53 | initialization command. Without an explicit project, the current launcher
   54 | checks `BOREAL_PROJECT`/`BOREAL_PROJECT_ID`, metadata files beside the selected
   55 | database (`project-id`, `project`, or `project.json`), and then accepts the
   56 | database only when it contains exactly one project. Multiple or ambiguous
   57 | identifiers require `--project`. It does not yet search the current directory
   58 | and its ancestors for project metadata when `--db` points elsewhere.
   59 | 
   60 | `bwrk view` is an implemented exact top-level compatibility alias for
   61 | `bwrk dashboard`; use `bwrk view --project PROJECT` when selecting a project.
   62 | The positional `view PROJECT` form is not part of the current parser surface.
   63 | `bwrk dashboard --socket PATH` is rejected because dashboard owns its private
   64 | endpoint and does not attach to or reuse an already-running service. Do not
   65 | run a separate `service run` against the same database while launching
   66 | dashboard. Use `service run` plus a separately connected client only for a
   67 | shared-agent or protocol-debugging session.
   68 | 
   69 | The direct TUI invocation is a developer/debug seam, not the normal product
   70 | entry point. It requires an already-running service and an explicit socket,
   71 | for example:
   72 | 
   73 | ```sh
   74 | npm --prefix apps/tui run start -- \
   75 |   --socket /path/to/service.sock \
   76 |   --project PROJECT \
   77 |   --actor ACTOR \
   78 |   --harness HARNESS \
   79 |   --session SESSION \
   80 |   --interactive
   81 | ```
   82 | 
   83 | The TUI remains a client of the Rust service and never opens SQLite directly.
   84 | The dashboard command currently supplies the composition and cleanup that this
   85 | developer path leaves to the caller. A working dashboard command does not
   86 | claim that the full v1 sprint, history, source, memory, or operator surface has
   87 | already been ported; those capabilities retain their dispositions below.
   88 | 
   89 | ## Non-negotiable command behavior
   90 | 
   91 | - Every `--json` result uses one versioned envelope with transport outcome,
   92 |   application outcome, operation ID, revision, bounded data, typed error,
   93 |   and optional checked detail reference. List payloads remain arrays.
   94 | - `guide`/`next` gives one contextual trusted action, exact argv/cwd/runner,
   95 |   required/blocking obligations, and why; it never executes arbitrary task
   96 |   prose. No-goal entry, active-attempt resume, and explicit idle are normal.
   97 | - Mutations use operation IDs, expected revision when needed, and attempt
   98 |   fences; unknown outcomes are resolved by readback, not blind retry.
   99 | - Claim, release, verification, and finish re-evaluate conditional status,
  100 |   dependencies, eligibility, capacity, and gates in one authoritative Rust
  101 |   path. No CLI spelling bypasses a required gate or converts operator-only
  102 |   work into automatic work.
  103 | - `queued` means a normal upstream wait, `blocked` means intervention is
  104 |   needed, and lease or hard-budget expiry flags an open task for review; these are never
  105 |   agent-editable status fields. `--ttl`/renewable lease and a hard attempt
  106 |   time limit must have distinct, documented grammar and output fields. A
  107 |   claim without `--time-limit` gets a two-hour hard deadline from `claimed_at`;
  108 |   explicit `--time-limit` overrides it without changing lease semantics.
  109 | - A high-level `agent finish` remains the normal consolidated close/release
  110 |   path. Low-level evidence/gate commands remain available for inspection,
  111 |   augmentation, and audited recovery, not as a second normal lifecycle.
  112 | - Routine status and guide responses are bounded independent of history;
  113 |   detail and history are explicitly paginated or referenced.
  114 | 
  115 | ## Required commands and purposes
  116 | 
  117 | The tables below are grouped by the job an agent is trying to complete;
  118 | they are not separate storage or workflow engines.
  119 | 
  120 | ### Discover, resume, and hand off
  121 | 
  122 | | Current command | V2 disposition | Purpose to preserve |
  123 | | --- | --- | --- |
  124 | | `bwrk commands` | Keep spelling | Machine-readable command/flag/output registry. An agent can discover valid syntax without guessing or repeatedly reading help. |
  125 | | `bwrk help [path]` / `--help` | Keep spelling | Human command discovery, generated from the same registry as validation. |
  126 | | `bwrk prime` | Keep spelling | Compact project/startup brief when an agent enters a workspace without a goal. |
  127 | | `bwrk agent guide` | Keep spelling | Trusted, contextual operating loop and exact next-step directives, including required evidence and recovery. |
  128 | | `bwrk next` | Keep spelling | Select one safe, revision-bound action for the current actor/attempt, or say explicitly why there is no action. |
  129 | | `bwrk agent status` | Keep spelling | Bounded current reservations/attempts, capacity, claimable work, and next obligation. No historical-assignment dump. |
  130 | | `bwrk agent start [work-ref]` | Keep spelling | Resume an existing current attempt or atomically claim suitable work; return contextual handoff. |
  131 | | `bwrk agent finish <work-ref>` | Keep spelling | Consolidated, resumable evidence → verify → summary → close/release path, with exact unmet obligations. |
  132 | | `bwrk session start` / `bwrk session end` | Keep spelling | Durable actor/session identity and handoff boundary; not a second claim authority. |
  133 | 
  134 | The v1 `bwrk status` path is a compatibility alias for `prime`, **not** an
  135 | active-state or health command. Keep it as that alias until a deliberate
  136 | deprecation/migration; use `agent status`, `dashboard`, and `sync status` for
  137 | those distinct views. The v1 `bwrk start` alias maps to `agent start`.
  138 | 
  139 | ### Plan and inspect milestone → sprint → task work
  140 | 
  141 | | Current command | V2 disposition | Purpose to preserve |
  142 | | --- | --- | --- |
  143 | | `bwrk work create` | Keep spelling | Create a task, sprint, milestone, or other supported work kind with parent, source, acceptance, gate, and initial-eligibility data. |
  144 | | `bwrk work edit` | Keep spelling | Change mutable planning fields without losing dependencies, evidence, reservations, or history. |
  145 | | `bwrk work show` | Keep spelling | Inspect one work item's current status, blockers, gates, attempt, and contextual directives. |
  146 | | `bwrk work list` | Keep spelling | Bounded filtered work listing with stable typed JSON. |
  147 | | `bwrk work rollup` | Keep spelling | Milestone/sprint/task hierarchy and aggregate status. |
  148 | | `bwrk work next` | Keep spelling | Read-only dependency-valid, eligible candidate queue. It does not mark an item ready. |
  149 | | `bwrk work ready` | Keep spelling | Explicit transition to ready after rechecking conditions; **not** a read-only synonym for `work next`. |
  150 | | `bwrk work parallel` | Keep spelling | Show work that can proceed concurrently without violating dependency/capacity policy. |
  151 | | `bwrk work review-candidates` | Keep spelling | Surface completed implementation needing independent review. |
  152 | | `bwrk work recent-closed` | Keep spelling | Bounded recent closeout view; historical detail remains paginated. |
  153 | | `bwrk dep add` / `bwrk dep remove` | Keep spelling | Mutate the blocking graph with cycle and readiness checks. |
  154 | | `bwrk dep tree` / `bwrk dep cycles` | Keep spelling | Explain dependency structure and cycles without changing it. |
  155 | | `bwrk sprint list` / `bwrk sprint show` | Keep spelling | Find sprints and inspect their scoped work. |
  156 | | `bwrk sprint launch` | Keep spelling | Turn a planned sprint/work structure into an actionable, conditional workflow. |
  157 | | `bwrk sprint current` / `bwrk sprint status` | Keep spelling | Show the active sprint identity and concise state; preserve their distinct current outputs. |
  158 | | `bwrk sprint activate` | Keep spelling | Explicitly select the active sprint. |
  159 | | `bwrk sprint board` | Keep spelling | Task-state board for humans and agents, backed by the same authoritative snapshot. |
  160 | | `bwrk sprint report` / `bwrk sprint metrics` | Keep spelling | Sprint progress, throughput, and quality reporting without scanning full history on routine status. |
  161 | | `bwrk sprint close` | Keep spelling | Verified sprint closeout with outstanding-work, evidence, and health checks. |
  162 | 
  163 | There is no v1 `bwrk milestone ...` or `bwrk task ...` family. Preserve
  164 | `work create --kind milestone|sprint|task`, hierarchy, and rollups as the
  165 | canonical entity surface. Friendly `milestone`/`task` façades can be additive
  166 | later, never a second status model. `bwrk work block` is a compatibility path
  167 | for adding a blocking dependency.
  168 | 
  169 | ### Claim, validate, and complete
  170 | 
  171 | | Current command | V2 disposition | Purpose to preserve |
  172 | | --- | --- | --- |
  173 | | `bwrk work claim [work-ref]` | Keep spelling | Atomically acquire eligible work and create the one current fenced attempt. |
  174 | | `bwrk work reserve` | Keep spelling | Explicit lease/reservation for a chosen agent; never an untracked alternative to an attempt. |
  175 | | `bwrk work renew` / `bwrk agent renew` | Keep spelling | Renew only the caller's current fenced lease. Runtime liveness is separate. |
  176 | | `bwrk reservation list` | Keep spelling | Inspect current live reservations and detect orphan/ownership issues. |
  177 | | `bwrk evidence run` | Keep spelling | Execute an approved bounded command and record a structured, attested receipt against an input snapshot. |
  178 | | `bwrk evidence add` | Keep spelling | Attach externally obtained evidence with provenance; self-report is not silently promoted to executor attestation. |
  179 | | `bwrk work verify` | Keep spelling | Check gate satisfaction using structured receipts and return specific mismatch reasons. |
  180 | | `bwrk work release` | Keep spelling | Release only the current attempt and recompute work eligibility, preserving failed evidence. |
  181 | | `bwrk work close` | Keep spelling | Audited lower-level closeout/recovery path; cannot bypass `agent finish` obligations. |
  182 | | `bwrk work reconcile` | Keep spelling | Diagnose/recover inconsistent work, reservation, and attempt state without erasing history. |
  183 | | `bwrk work cancel` / `bwrk work reopen` | Keep spelling | Explicit terminal/re-entry transitions with historical attempts and summaries retained. |
  184 | | `bwrk work split` | Keep spelling | Divide oversized work while keeping parentage and evidence provenance. |
  185 | | `bwrk summary compose` / `bwrk summary create` | Keep spelling | Durable typed implementation, verification, and handoff summaries; finish ordinarily composes these. |
  186 | | `bwrk summary show` / `bwrk summary list` / `bwrk summary render` | Keep spelling | Inspect current and superseded summaries without treating invalid history as current truth. |
  187 | | `bwrk gate closeout` | Keep spelling | Explicit project/operator closeout validation; not an expensive mandatory preflight for every task mutation. |
  188 | 
  189 | The old `work reserve` must be mapped to the v2 attempt model in P0; a lease
  190 | alone must not count as accepted execution. Direct `work close` and summary
  191 | commands stay available for audited recovery and review, while `agent finish`
  192 | is the default workflow. `summary backfill` is migration tooling, not a
  193 | normal agent step. Keep `bwrk done`/`bwrk pause` only as compatibility aliases
  194 | after their existing behavior is fixture-tested.
  195 | 
  196 | ### Build product memory and retrieve context
  197 | 
  198 | | Current command | V2 disposition | Purpose to preserve |
  199 | | --- | --- | --- |
  200 | | `bwrk raw add` / `bwrk raw list` / `bwrk raw show` | Keep spelling | Immutable intake before interpretation, with bounded queue/record reads and provenance. |
  201 | | `bwrk raw triage` | Keep spelling | Explicitly promote or disposition intake into work/source/knowledge without losing the original. |
  202 | | `bwrk source add` / `bwrk source list` / `bwrk source show` | Keep spelling | Durable source identities and links used by work, decisions, and published memory. |
  203 | | `bwrk wiki create` / `bwrk wiki list` / `bwrk wiki show` | Keep spelling | Human-readable project knowledge with source/provenance links. |
  204 | | `bwrk decision create` / `bwrk decision list` / `bwrk decision show` | Keep spelling | Record and inspect durable architectural/product decisions with rationale. |
  205 | | `bwrk decision supersede` | Keep spelling | Replace a decision while retaining its earlier version and causal links. |
  206 | | `bwrk context show` / `bwrk context search` | Keep spelling | Bounded context-pack retrieval for an agent's current work. |
  207 | | `bwrk context rebuild` | Keep spelling | Explicitly rebuild derived context packs; no hidden projection rewrite on a TUI read. |
  208 | | `bwrk search query` | Keep spelling | Search the broader work/evidence/source/knowledge corpus, distinct from context-pack search. |
  209 | | `bwrk search index` | Keep spelling | Explicitly rebuild/check the derived search index. |
  210 | 
  211 | There is no v1 `bwrk memory ...` namespace. V2's source → draft → publish
  212 | memory lifecycle is a **new capability**, not a rename of `raw`, `source`,
  213 | `wiki`, or `decision`; P0 must settle how these existing records map into
  214 | publication without creating duplicate authorities. The existing global
  215 | `bwrk capture` is a convenience alias for raw intake. Knowledge `claim`
  216 | create/list/show/review remains in the parity review because the complex
  217 | adjudication workflow is explicitly deferred, but its existing records and
  218 | provenance must survive migration.
  219 | 
  220 | ### Setup, trusted workflow discovery, and health
  221 | 
  222 | | Current command | V2 disposition | Purpose to preserve |
  223 | | --- | --- | --- |
  224 | | `bwrk init` | Keep spelling | Safe idempotent workspace initialization and explicit local data layout. |
  225 | | `bwrk setup` | Keep spelling | Guided project setup including runtime, Git/memory safeguards, and agent entrypoints. |
  226 | | `bwrk workflows list` / `bwrk workflows show` | Keep spelling | Discover trusted checked-in playbooks and their allowed command steps. |
  227 | | `bwrk directives list` / `bwrk directives show` | Keep spelling | Inspect versioned trusted directive definitions and compatibility lifecycle. |
  228 | | `bwrk doctor` / `bwrk doctor skills` | Keep spelling | Read-only health diagnostics by default; explicit idempotent repair cannot weaken integrity. |
  229 | | `bwrk sync status` | Keep spelling | Read-only collaboration/projection health, distinct from agent or sprint status. |
  230 | | `bwrk sync refresh` | Keep spelling | Explicit derived-artifact refresh without claiming to repair canonical corruption. |
  231 | | `bwrk dashboard [PROJECT]` | Keep spelling | One-terminal human/TUI project overview from the same revisioned read model; interactive mode privately supervises the service/TUI, while `--json` is a direct non-interactive status read. |
  232 | 
  233 | `bwrk install` is a v1 alias/convenience family for setup and adapter/skill
  234 | installation; retain the relevant compatibility behavior, not a second
  235 | initializer. `bwrk view` is the implemented exact top-level alias for
  236 | `dashboard`; its positional-project form is not currently accepted.
  237 | `directives compile/render/explain` and acknowledgement/debug tooling belong
  238 | in the P0 parity matrix and can be ported with the directive registry, but are
  239 | not routine agent steps.
  240 | 
  241 | ## New v2 commands or API operations—not observed v1 paths
  242 | 
  243 | | Proposed surface | Why it is needed | Status |
  244 | | --- | --- | --- |
  245 | | `bwrk agent resume` | Explicit resume/readback of the current attempt after process or model interruption. | Additive convenience; `agent start` must remain safe to resume. |
  246 | | `bwrk work accept` | Runtime acknowledgement that an assignment was actually accepted by a session. | Required operation; CLI spelling/visibility to freeze in P0. |
  247 | | `bwrk work heartbeat` / `bwrk work checkpoint` | Separate cheap liveness from meaningful durable progress. | Required operations; harness adapter may be the normal caller. |
  248 | | `bwrk work finish` | Low-level fenced atomic finish primitive under `agent finish`. | Required operation; external CLI exposure is a P0 decision. |
  249 | | `bwrk status --active --since <revision>` | Bounded revisioned active snapshot/change query. | **Do not use this spelling while `status` means `prime`**; choose an additive path such as `agent status --since` or `snapshot active`. |
  250 | | `bwrk memory ...` | New explicit source/draft/publication/retrieval façade if the memory-bank design warrants it. | Behavior required by memory plan; grammar and relationship to existing `raw/source/wiki/decision` freeze in P0. |
  251 | 
  252 | ## Deliberate parity decisions, not silent deletions
  253 | 
  254 | - `bwrk orchestrate start|list|show|tick|progress|nudge|pause|resume|cancel|fail`
  255 |   currently exposes orchestration. Preserve run/assignment visibility,
  256 |   pause/resume/cancel, and audited manual adoption where useful, but replace
  257 |   repeated model-mediated `tick → show → work show` with the bounded status,
  258 |   deterministic dispatch, and event/backoff model. Automatic harness launch
  259 |   is deferred; do not promise drop-in v1 orchestration parity at launch.
  260 | - `bwrk template list|show|validate|run|capture` is a useful executable work
  261 |   structure system, distinct from `workflows` playbooks. P0 must inventory
  262 |   actual in-use templates and choose which built-in molds to bring into v2;
  263 |   broad custom authoring/capture is deferred, not proof that templates are
  264 |   disposable. A retained `run` must have dry-run, cycle, and provenance checks.
  265 | - `bwrk global ...` and `dashboard global` are cross-project functions, outside
  266 |   the initial single-project service. Keep their data/export compatibility
  267 |   under review; do not let global views become a second project truth.
  268 | - Legacy export/import/snapshot/registry, operation-log maintenance, and
  269 |   install/update commands need a P0-04 disposition and migration tests before
  270 |   cutover. The local audit trail and failed receipts are never discarded just
  271 |   because a particular admin command is not in the launch CLI.
  272 | 
  273 | ## Fixture gate for declaring CLI parity
  274 | 
  275 | For every kept path, capture v1 usage/flags, one successful and one rejected
  276 | example, output types, side effects, and the v2 application use case. Test
  277 | aliases and help against the same command registry. Include conditional
  278 | ready/blocked/operator-only transitions, claim/resume/expiry, repeated and
  279 | mutually exclusive flags, structured evidence, stale receipts, interrupted
  280 | finish, and a no-goal `prime → guide/next → start → finish → next` journey.
  281 | Measure output bytes and lock wait/hold time during TUI + multi-agent use;
  282 | syntax parity without workflow parity does not satisfy this contract.
````
