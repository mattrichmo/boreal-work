# Boreal CRM (`bcrm`) — Design Spec

**Date:** 2026-07-02
**Status:** Draft for review
**One-liner:** boreal-work closes work with evidence; boreal-crm keeps relationships alive with interactions — same records, same git shape, same `next` loop, but the gap generator is a calendar instead of a dependency graph.

---

## 1. Purpose

A local, git-native, agent-ready CRM built on the boreal-work substrate: durable records + derived state + evidence-gated transitions + directives telling actors (reps or agents) what live state requires next.

The core transfer:

| boreal-work | boreal-crm |
|---|---|
| Work item | Contact, Account, Deal |
| Evidence record | **Interaction** (immutable: kind + outcome + timestamp) |
| Derived readiness | Derived **attention state** (`warm`/`cooling`/`stale`/`at_risk`) |
| Reservations (atomic claim, TTL) | **Ownership** of leads/accounts (atomic, TTL expiry) |
| Closeout gates | **Stage gates** on deal advancement |
| Claims / decisions | **Relationship intel** (source-backed, supersedable) |
| Context pack | **Brief** (pre-interaction bundle) |
| `bwrk next` | `bcrm next` |
| Graph edges (`blocks`) | Relationship graph (`works-at`, `champion-of`, `reports-to`, `introduced-by`) |
| Memory vault | Account wiki (human-readable relationship history, diffs in git) |

**The genuinely new mechanic:** in boreal-work, enforcement gaps come from unmet dependencies; in bcrm they come from **elapsed time**. Reminders are not a feature — they are derived gaps (`contact.touch.overdue`, `deal.stage.stalled`, `commitment.unfulfilled`) produced by the same gap→registry→directive pipeline.

## 2. Assumptions (decisions taken while user was away — override freely)

1. **Repo shape:** sibling product inside this monorepo. New `packages/crm-engine` + `apps/crm-cli` (bin `bcrm`), reusing `@boreal/core`, `@boreal/storage`, `@boreal/graph-engine`, `@boreal/agent-runtime`. No fork, no package extraction/publishing project first.
2. **v1 scope:** engine + CLI + directive registry + tests. MCP tool exposure follows the same JSON contracts (cheap, in v1). Daemon gains a minimal clock-tick role. Console projections and TUI are v2.
3. **Ingestion:** email/calendar/transcript auto-ingestion is v2, via the raw-inbox → reconcile pattern. v1 logs interactions manually (`bcrm log`) or via agent.
4. **Pipelines:** one configurable pipeline per workspace in v1 (stages, per-stage SLAs, per-stage gates declared in config). Multiple named pipelines are v2.
5. **Audience:** solo operator / small team plus agents. No multi-tenant, no server.

## 3. Architecture

### 3.1 Package layout

```
packages/crm-engine/        # records, derived state, gap emission, stage policy
apps/crm-cli/               # bcrm command surface (registry + output, mirroring apps/cli)
schemas/directives/         # crm-directive-bundle reuses boreal.agent-directives.v1 shape
```

Shared, unchanged: `core` (IDs, string safety, errors, directive compiler/registry machinery, enforcement-gap plumbing), `storage` (file-locked transactional store), `graph-engine` (deterministic natural-key edges, cycle checks), `agent-runtime`.

Where `core` machinery is work-specific today (e.g. gap-code unions, directive families, subject types), generalize it to accept a product-supplied registry + code namespace rather than duplicating it. This is the "forces the substrate to be generic" payoff and the main refactor risk — see §9.

### 3.2 State roots

Same two-root model:

- `.boreal/runtime/` — one shared store per workspace. CRM records live under their own record types in the same `state.json` store (same locking, same schema-drift rejection, same doctor).
- `memory/` — account wiki pages (`memory/wiki/accounts/...`), ledgers for interaction history projections, raw inbox for future ingestion.

### 3.3 The time engine (the one new invariant)

All derived CRM state MUST be a pure function `derive(records, now)`. Nothing about attention states or overdue gaps is stored as authority; they are projections with an explicit recompute (`bcrm doctor` / on-read recompute), exactly like readiness today.

- Every command that reads derived state computes it against an injectable clock (`core/time.ts` already provides this).
- The daemon's role is only to *tick*: on an interval, run the same recompute and surface newly-opened gaps (notification/log). It never writes truth — same daemon philosophy as today.
- Determinism: same records + same `now` ⇒ same gaps, same directives, same `next`. Tests pin the clock.

## 4. Records (crm-engine)

All records get deterministic IDs (actor + timestamp + nonce), Unicode-normalized machine strings, fail-closed validation — via `core`.

### 4.1 Contact
Person. `name`, optional `emails[]`, `phones[]`, `role`, `accountId?` (primary), labels, body/notes. Mutable profile fields; history via events.

### 4.2 Account
Company/org. `name`, `domain?`, labels, body. Owns a wiki page in `memory/`.

### 4.3 Deal
Opportunity. `title`, `accountId`, `stage` (from pipeline config), `value?`, `currency?`, `expectedCloseAt?`, `contactIds[]`, labels, status (`open` | `won` | `lost`). Stage transitions are **events**, each recording actor, timestamp, and gate outcomes (including forced advances with reason — this is the forecast-honesty trail).

### 4.4 Interaction (the evidence analog)
**Immutable once created.**

- `kind`: `call` | `email` | `meeting` | `demo` | `note` | `message`
- `outcome`: `connected` | `no_answer` | `positive` | `negative` | `neutral` | `info`
- `occurredAt` (may differ from `createdAt` — backfilled logging is normal)
- `contactIds[]`, `accountId?`, `dealId?`
- `summary` (short), `body?` (long, e.g. transcript pointer)
- `fulfillsCommitmentIds[]` — the only way a commitment is satisfied
- `sourceRef?` — provenance for ingested interactions (v2)

Corrections are new records that supersede, never edits — same as evidence today.

### 4.5 Commitment (first-class accountability)
"I'll send the proposal by Tuesday."

- `description`, `dueAt`, `direction`: `owed_by_us` | `owed_by_them`
- `dealId?`, `contactId?`, `accountId?` (at least one subject required)
- `status`: `open` | `fulfilled` | `cancelled` — `fulfilled` ONLY by an interaction referencing it; `cancelled` requires a reason.
- Derived: `overdue` when `now > dueAt` and still open.

### 4.6 Intel (claims layer, reused)
Source-backed statements: "champion is the VP Eng", "budget approved for Q3". Reuses the claim/source/supersession machinery. Subjects are contacts/accounts/deals. Accepted intel flows into briefs **by explicit link only** — no relevance scoring (deliberate non-goal, §8).

### 4.7 Ownership (reservations, reused)
A rep/agent claims a contact, account, or deal atomically with a TTL. Expiry emits `ownership.expired` gaps → lead-rot handling for free. Renew/release/repair semantics identical to work reservations.

### 4.8 Relationship graph
Edges via graph-engine with deterministic natural keys: `works_at(contact→account)`, `champion_of(contact→deal)`, `reports_to(contact→contact)`, `introduced_by(contact→contact)`. Cycle checks apply where meaningful (`reports_to`).

### 4.9 Pipeline config (declared policy)
Checked-in workspace config (not runtime state):

```jsonc
{
  "stages": [
    { "id": "lead",        "slaDays": 7,
      "gates": [] },
    { "id": "discovery",   "slaDays": 10,
      "gates": [{ "gate": "interaction.logged", "kind": "call|meeting", "note": "intro call logged" }] },
    { "id": "proposal",    "slaDays": 14,
      "gates": [{ "gate": "interaction.logged", "kind": "call|meeting", "note": "discovery call logged" },
                 { "gate": "commitment.none_overdue" }] },
    { "id": "negotiation", "slaDays": 21, "gates": [] },
    { "id": "closed_won",  "slaDays": null,
      "gates": [{ "gate": "artifact.attached", "expectedObservable": "signed contract artifact URI" }] }
  ],
  "contactTouchSlaDays": { "default": 30, "byLabel": { "vip": 14 } }
}
```

Gates are declared observables, same shape as declared closeout gates today. `--force` advances are allowed but recorded and permanently flagged on the deal.

## 5. Derived state and gap codes

### 5.1 Attention state (per contact and per deal)
Computed from `now - lastTouch` vs. the applicable SLA:

- `warm` — touched within SLA
- `cooling` — past 75% of SLA
- `stale` — past SLA
- `at_risk` — past 2× SLA, or open deal with an overdue `owed_by_us` commitment

Never set by hand. `bcrm doctor` recomputes projections.

### 5.2 Gap codes (namespace `crm.*`)
Stable machine strings, emitted by enforcement logic, consumed by the directive registry:

- `crm.contact.touch.overdue`
- `crm.deal.stage.stalled`
- `crm.deal.gate.unsatisfied`
- `crm.deal.gate.forced` (audit gap — a deal advanced past an unmet gate)
- `crm.commitment.unfulfilled` (ours, overdue)
- `crm.commitment.theirs.overdue` (chase)
- `crm.ownership.expired`
- `crm.intel.unsourced`
- `crm.deal.close.blocked` (won/lost attempted without terminal gates)

### 5.3 Directives
Reuse `boreal.agent-directives.v1` bundle shape verbatim. New families: `touch`, `commitment`, `stage`, `gate`, `ownership`, `intel` (plus shared `doctor`, `handoff`). Registry entries are checked-in trusted text; the compiler fills typed data (names, ages, deal stages, command templates) from live state. **Same safety boundary:** interaction summaries, intel text, and notes are data, never instruction prose.

### 5.4 `bcrm next` — priority order
Narrows the bundle to one executable directive, ranked:

1. Overdue `owed_by_us` commitments (accountability outranks everything)
2. `at_risk` deals (stalled stage past SLA, weighted by value)
3. `at_risk` / `stale` contacts
4. Chase: `owed_by_them` overdue commitments
5. `cooling` (advisory)

Output includes the **brief** (or a one-command pointer to it): last 5 interactions, open commitments both directions, accepted intel (explicitly linked), deal stage + gate status, relationship edges.

## 6. Command surface (`bcrm`)

Every command: stable `--json` envelope, plain-text default, `agentDirectives` in output — mirroring `apps/cli` conventions (command registry, output helpers, doctor).

```
bcrm init

# records
bcrm contact create|show|list|update
bcrm account create|show|list|update
bcrm deal   create|show|list|update
bcrm link <edge> <from> <to>              # works-at, champion-of, reports-to, introduced-by

# the loop
bcrm log --kind call --outcome connected --contact <id> [--deal <id>]
         [--fulfills <commitment-id>] --summary "..." [--at <timestamp>]
bcrm commitment add "send proposal" --due 2026-07-08 --deal <id> --direction owed_by_us
bcrm commitment list [--overdue] | cancel <id> --reason "..."
bcrm deal advance <id> --to proposal [--force --reason "..."]
bcrm deal close <id> --won|--lost --reason "..."

# ownership
bcrm claim <subject-id> --agent <actor> [--ttl 7d] | release | renew

# guidance
bcrm next [--agent <actor>] [--json]
bcrm brief <contact-id|deal-id>

# knowledge
bcrm intel add "champion is VP Eng" --subject <id> --source <ref>
bcrm intel supersede <id> --with "..." --source <ref>

# projections & health
bcrm pipeline board | report            # stage counts, value, forced-gate flags, stalled counts
bcrm report touches [--by-owner]        # touch frequency, stale counts per owner
bcrm doctor [--fix] [--strict]
```

## 7. Surfaces beyond the CLI

- **MCP (v1):** expose the same operations project-scoped over stdio, same envelopes — reuse `apps/mcp` patterns; agents run the SDR loop (draft follow-up → `bcrm log` → `bcrm next`).
- **Daemon (v1, minimal):** interval tick → recompute → report newly-opened time gaps. No writes.
- **Console (v2):** pipeline-by-stage, touch-frequency per owner, stale-account counts, forecast view where forced-gate deals are visibly flagged (the anti-happy-ears report).
- **Skills/workflows (v1, small set):** `bcrm-daily-loop` (work `next` until clear), `bcrm-log-interaction`, `bcrm-account-wiki` (reconcile interactions → wiki page), following `skills/boreal-*` conventions.

## 8. Deliberate non-goals

1. **No verification/summary ceremony.** A logged interaction *is* the evidence. Verdict records on top would be self-assertion theater.
2. **No relevance-scored brief assembly.** Briefs use explicit links (intel→subject, interaction→deal) only.
3. **No email sending, dialing, or calendar write.** bcrm records and directs; execution stays with the human/agent.
4. **No multi-tenant/server/sync service.** Git is the sync layer, as today.

## 9. Risks

- **Substrate generalization** is the real work: gap-code unions, directive families, and subject types in `core` are currently work-flavored. Approach: widen to product-namespaced registries (`directives.v1` registry per product, `crm.*` gap namespace) rather than `crm-engine` forking the compiler. If widening turns invasive, fallback is a thin CRM-local directive layer over the shared bundle schema.
- **Clock-derived state in a store built for event-derived state:** keep derived-on-read as the authority and treat any cached attention projections exactly like readiness projections (doctor-repairable).
- **Shared `state.json`** with work records: record-type namespacing must be airtight so `bwrk doctor` and `bcrm doctor` don't fight. Alternative if it gets messy: a sibling store file under `.boreal/runtime/`.

## 10. Testing

Mirror `tests/runtime` patterns:

- **Pinned-clock derivation tests:** table-driven `derive(records, now)` → expected attention states and gap codes; boundary cases at exactly SLA, 75%, 2×.
- **Directive goldens:** fixture stores → expected `agentDirectives` bundles (same golden style as `agent-directive-goldens`).
- **Gate enforcement:** advance blocked without gate-satisfying interaction/artifact; `--force` records the flag; `close --won` blocked without terminal gate.
- **Commitment lifecycle:** only fulfillable via referencing interaction; cancel requires reason; overdue ranking in `next`.
- **Ownership concurrency:** two actors claim the same lead — exactly one wins (reuse reservation test patterns).
- **Envelope stability:** JSON schema checks on every command output.

## 11. Build order (input to the implementation plan)

1. Substrate widening in `core` (namespaced gap codes / directive registries) — smallest safe change, keep `bwrk` goldens green.
2. `crm-engine`: records + store integration + pinned-clock derivation.
3. Gates + commitments + interactions (the enforcement spine).
4. Gap emission + directive registry + `bcrm next` + `brief`.
5. CLI surface + doctor + goldens.
6. MCP exposure + daemon tick + skills.
