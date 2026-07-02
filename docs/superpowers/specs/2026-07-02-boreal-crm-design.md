# Boreal CRM (`bcrm`) — Design Spec

**Date:** 2026-07-02 (rev 2)
**Status:** Draft for review
**One-liner:** boreal-work closes work with evidence; boreal-crm keeps relationships alive with interactions — same records, same git shape, same `next` loop, but the gap generator is a calendar instead of a dependency graph.

**Scope note:** bcrm does not execute outreach (no sending, dialing, calendar writes). It is the system of record and direction: logging, histories, summaries, commitments, closeouts, relationship state, and the `next` loop that tells humans and agents what the relationship graph requires.

---

## 1. Purpose

A local, git-native, agent-ready CRM built on the boreal-work substrate: durable records + derived state + evidence-gated transitions + directives telling actors (reps or agents) what live state requires next.

The core transfer:

| boreal-work | boreal-crm |
|---|---|
| Work item | Contact, Account, Deal |
| Evidence record | **Interaction** (immutable: kind + direction + outcome + timestamp) |
| Derived readiness | Derived **attention state** (`warm`/`cooling`/`stale`/`going_dark`/`at_risk`) |
| Reservations (atomic claim, TTL) | **Ownership** of leads/accounts (atomic, TTL expiry) |
| Closeout gates | **Stage gates** on deal advancement + **interaction next-step invariant** |
| Claims / decisions | **Relationship intel** (source-backed, supersedable) |
| Context pack | **Brief** (pre-interaction bundle) |
| `bwrk next` | `bcrm next` |
| Graph edges (`blocks`) | Relationship graph (`works-at`, `champion-of`, `reports-to`, `introduced-by`) |
| Memory vault | Account wiki + regenerable account digests |
| Raw inbox → reconcile | Free-text capture → structured records |

**The genuinely new mechanic:** enforcement gaps come from **elapsed time** and **dangling threads**, not unmet dependencies. Reminders are not a feature — they are derived gaps produced by the same gap→registry→directive pipeline.

## 2. Assumptions (override freely)

1. **Repo shape:** sibling product inside this monorepo. New `packages/crm-engine` + `apps/crm-cli` (bin `bcrm`), reusing `@boreal/core`, `@boreal/storage`, `@boreal/graph-engine`, `@boreal/agent-runtime`, `@boreal/search`.
2. **v1 scope:** engine + CLI + directive registry + MCP + minimal daemon tick + CSV import + TUI queue/brief/timeline views. Console projections and email/calendar auto-ingestion are v2.
3. **Pipelines:** one configurable pipeline per workspace in v1; multiple named pipelines v2.
4. **Audience:** solo operator / small team plus agents. No multi-tenant, no server.

## 3. Architecture

### 3.1 Package layout

```
packages/crm-engine/        # records, derived state, gap emission, stage policy, identity/merge
apps/crm-cli/               # bcrm command surface (registry + output, mirroring apps/cli)
apps/crm-tui/               # keyboard-driven queue/brief/timeline surface over the same JSON contracts
schemas/directives/         # crm directive bundle reuses boreal.agent-directives.v1 shape
```

Shared, unchanged: `core` (IDs, string safety, errors, directive compiler/registry machinery, enforcement-gap plumbing), `storage` (file-locked transactional store), `graph-engine`, `agent-runtime`, `search` (full-text over interactions/intel).

Where `core` machinery is work-specific today (gap-code unions, directive families, subject types), generalize it to accept a product-supplied registry + code namespace rather than duplicating it. Main refactor risk — see §12.

### 3.2 State roots

- `.boreal/runtime/` — shared store per workspace; CRM records under their own record types (same locking, schema-drift rejection, doctor).
- `memory/` — account wiki pages (`memory/wiki/accounts/...`), **account digests** (regenerable projections, §8), raw inbox for free-text capture.

### 3.3 The time engine (the one new invariant)

All derived CRM state MUST be a pure function `derive(records, now)` with an injectable clock. Nothing about attention states or overdue gaps is stored as authority; they are projections with explicit recompute, exactly like readiness today.

- The daemon only *ticks*: interval recompute, surface newly-opened gaps. It never writes truth.
- Determinism: same records + same `now` ⇒ same gaps, directives, `next`. Tests pin the clock.
- Timezone/business-day SLA math is v2; v1 uses calendar days, UTC.

### 3.4 Idempotent writes (agent survival requirement)

Agents logging from transcripts/emails will retry and re-run. Every record-creating command accepts `--idempotency-key`; absent one, `bcrm log` derives a content key from `(occurredAt, kind, participants, summary-hash)` and rejects exact replays as no-op successes (same envelope, `deduped: true`). Without this, agent participation poisons the store in a week.

## 4. Records (crm-engine)

All records: deterministic IDs (actor + timestamp + nonce), Unicode-normalized machine strings, fail-closed validation — via `core`. Every record carries actor provenance (human vs agent, `sourceRef` for ingested content). Provenance is filterable data, never a verdict layer.

### 4.1 Contact
Person. `name`, `emails[]`, `phones[]`, `role`, `accountId?` (primary), labels, timezone?, body/notes.

- **Identity keys:** emails are natural keys for dedup; creation with a known email fails closed with a pointer to the existing contact (override flag for genuinely shared addresses).
- **Merge is first-class:** `bcrm contact merge <loser> <winner>` — loser becomes an alias record; interactions/commitments/edges are re-pointed via alias resolution, never rewritten (immutability preserved). Doctor reports probable duplicates (`crm.contact.duplicate.suspected`).
- **Lifecycle:** `active` | `archived` (reason: left_company, unresponsive, other) | `do_not_contact`. DNC is a hard flag: suppresses all touch gaps, blocks the contact from `next`, and any attempt to log an outbound interaction warns loudly.
- **Moves:** ending a `works_at` edge (with date) and adding a new one emits `crm.contact.moved` — "your champion changed companies" is one of the highest-value re-engagement signals a CRM can produce, and it falls out of the graph for free.

### 4.2 Account
Company/org. `name`, `domain?`, labels, body. Owns a wiki page and a digest in `memory/`. Lifecycle: `active` | `customer` | `churned` | `archived`.

### 4.3 Deal
Opportunity. `title`, `accountId`, `stage`, `value?`, `currency?`, `expectedCloseAt?`, `contactIds[]`, labels, status (`open` | `won` | `lost`). Stage transitions are **events** recording actor, timestamp, and gate outcomes (including forced advances with reason — the forecast-honesty trail).

**Deal closeout ceremony (won or lost):**
- Requires `--reason` from a small configurable taxonomy (lost: `price`, `timing`, `competitor`, `no_decision`, `bad_fit`, …) plus free-text retro note. Loss reasons feed `bcrm report losses`.
- **Close-won spawns renewals for free:** if the deal has a `termEnds` date, closing won auto-creates a commitment `owed_by_us` due `termEnds − renewalLeadDays` ("begin renewal conversation"). Renewals and recurring cadences need no new machinery — they are long-dated commitments.

### 4.4 Interaction (the evidence analog)
**Immutable once created.** Corrections supersede, never edit.

- `kind`: `call` | `email` | `meeting` | `demo` | `note` | `message`
- `direction`: `outbound` | `inbound` | `mutual` — load-bearing for derivation (§5.1)
- `outcome`: `connected` | `no_answer` | `positive` | `negative` | `neutral` | `info`
- `occurredAt` (backfill-friendly, distinct from `createdAt`)
- `contactIds[]`, `accountId?`, `dealId?`, `summary`, `body?`
- `fulfillsCommitmentIds[]` — the only way a commitment is satisfied
- `nextStep`: **required** — one of:
  - `commitment:<id>` (a commitment was created from this interaction),
  - `touch:<date>` (an explicit scheduled next touch — a lightweight self-commitment),
  - `none` with `--no-next-step-reason` (deal closed, handed off, DNC, etc.)

**The next-step invariant is what turns a log into relationship management.** An interaction without a declared thread-continuation emits `crm.interaction.dangling`, which outranks routine touch gaps in `next`. This is the CRM analog of evidence-gated closure: a conversation isn't "done" on assertion; it's done when the next thread is on the record or explicitly declared closed.

### 4.5 Commitment (first-class accountability)
- `description`, `dueAt`, `direction`: `owed_by_us` | `owed_by_them`
- Subject: at least one of `dealId` / `contactId` / `accountId`
- `status`: `open` | `fulfilled` | `cancelled` — fulfilled ONLY by a referencing interaction; cancel requires reason
- `originInteractionId?` — the promise's provenance
- Derived: `overdue` when `now > dueAt` and open

Scheduled touches (`touch:<date>` next steps) are stored as lightweight commitments so one mechanism drives all future-dated obligations.

### 4.6 Intel (claims layer, reused)
Source-backed statements ("champion is the VP Eng", "budget approved for Q3") with supersession. Subjects: contacts/accounts/deals. Flows into briefs **by explicit link only** — no relevance scoring (§10).

### 4.7 Ownership (reservations, reused)
Atomic claim with TTL on a contact/account/deal; expiry emits `crm.ownership.expired`. Ownership gates `next` routing (whose queue an item lands in), **not** logging — anyone can log an interaction with anyone (the founder talks to the SDR's contact; that's reality, record it). A non-owner interaction surfaces as advisory data to the owner, not a violation.

### 4.8 Relationship graph
graph-engine edges with deterministic natural keys: `works_at(contact→account, from/to dates)`, `champion_of(contact→deal)`, `reports_to(contact→contact)`, `introduced_by(contact→contact)`. Cycle checks on `reports_to`.

### 4.9 Snooze / dismissal (acknowledgement records)
Every reminder system dies of nagware rot: directives pile up, the user stops reading, the queue is dead. bcrm reuses the directive-acknowledgement pattern as durable records:

- `bcrm snooze <directive-subject> --until <date> --reason "..."` — derivation suppresses the gap until the date; the snooze is on the record and visible in reports (chronic snoozing of an account is itself a signal).
- `bcrm dismiss <directive-subject> --reason "..."` — permanent for that gap instance; requires reason.

`next` therefore only ever shows actionable items, and "I ignored it" is impossible to distinguish from "I deferred it deliberately" — by design, the second one is the only path.

### 4.10 Pipeline config (declared policy)
Checked-in workspace config:

```jsonc
{
  "stages": [
    { "id": "lead",        "slaDays": 7,  "gates": [] },
    { "id": "discovery",   "slaDays": 10,
      "gates": [{ "gate": "interaction.logged", "kind": "call|meeting", "note": "intro call logged" }] },
    { "id": "proposal",    "slaDays": 14,
      "gates": [{ "gate": "interaction.logged", "kind": "call|meeting", "note": "discovery call logged" },
                 { "gate": "commitment.none_overdue" }] },
    { "id": "negotiation", "slaDays": 21, "gates": [] },
    { "id": "closed_won",  "slaDays": null,
      "gates": [{ "gate": "artifact.attached", "expectedObservable": "signed contract artifact URI" }] }
  ],
  "contactTouchSlaDays": { "default": 30, "byLabel": { "vip": 14 } },
  "goingDarkThreshold": 3,
  "renewalLeadDays": 60,
  "lossReasons": ["price", "timing", "competitor", "no_decision", "bad_fit"]
}
```

Gates are declared observables. `--force` advances are allowed but recorded and permanently flagged on the deal.

## 5. Derived state and gap codes

### 5.1 Attention state (per contact and per deal)
Computed from interaction recency **and direction**:

- `warm` — touched within SLA
- `cooling` — past 75% of SLA
- `stale` — past SLA, and the silence is ours (no recent outbound)
- `going_dark` — ≥ `goingDarkThreshold` consecutive outbound interactions with no inbound response. **Distinct from stale on purpose:** "we neglected them" and "they're ghosting us" are different problems with different directives (touch them vs. change approach / flag deal risk).
- `at_risk` — past 2× SLA, or open deal with overdue `owed_by_us` commitment, or `going_dark` on a deal in a late stage

Never set by hand; doctor recomputes.

### 5.2 Gap codes (namespace `crm.*`)
- `crm.interaction.dangling` — logged interaction with no next step and no reason
- `crm.commitment.unfulfilled` — ours, overdue
- `crm.commitment.theirs.overdue` — chase
- `crm.contact.touch.overdue` / `crm.contact.going_dark`
- `crm.deal.stage.stalled`
- `crm.deal.gate.unsatisfied` / `crm.deal.gate.forced` (permanent audit gap)
- `crm.deal.close.blocked`
- `crm.contact.moved` — champion/contact changed companies; re-engagement signal
- `crm.contact.duplicate.suspected`
- `crm.ownership.expired`
- `crm.intel.unsourced`
- `crm.capture.untriaged` — raw free-text captures awaiting reconciliation (§7.3)

### 5.3 Directives
Reuse `boreal.agent-directives.v1` bundle shape verbatim. New families: `touch`, `commitment`, `stage`, `gate`, `ownership`, `intel`, `hygiene` (plus shared `doctor`, `handoff`). Registry entries are checked-in trusted text; the compiler fills typed data from live state. **Same safety boundary:** interaction summaries, intel text, and notes are data, never instruction prose — this matters more here than in bwrk, because interaction bodies contain *other people's words*.

### 5.4 `bcrm next` — priority order
1. Dangling interactions (close your open threads first — cheap, high-decay)
2. Overdue `owed_by_us` commitments (accountability outranks everything)
3. `at_risk` deals (value-weighted)
4. `going_dark` subjects (approach change needed)
5. `stale` contacts / chase `owed_by_them`
6. `cooling`, untriaged captures, hygiene (advisory)

Output embeds the **brief** or a one-command pointer to it. `--agent <actor>` scopes to that actor's owned subjects; `--all` shows the global queue.

## 6. The brief

Assembled by explicit links only: last 5 interactions (with direction/outcome), open commitments both directions (ours first), accepted intel, deal stage + gate status + forced flags, relationship edges (who reports to whom, who introduced), snooze history, days-since-last-inbound. One screen. The test: an actor who reads only the brief can conduct the conversation without embarrassment.

## 7. Command surface (`bcrm`)

Stable `--json` envelopes, plain-text default, `agentDirectives` on every output.

### 7.1 Records
```
bcrm init
bcrm contact create|show|list|update|merge|archive|dnc
bcrm account create|show|list|update
bcrm deal   create|show|list|update|advance|close
bcrm link <edge> <from> <to> [--from-date|--to-date]     # works-at, champion-of, reports-to, introduced-by
bcrm import csv <file> --map <mapping>                    # staged: parse → dedupe report → confirm → commit
```

### 7.2 The loop
```
bcrm log --kind call --direction outbound --outcome connected \
         --contact <id> [--deal <id>] --summary "..." [--at <ts>] \
         [--fulfills <commitment-id>] \
         (--next-commitment "send proposal" --due fri | --next-touch <date> | --no-next-step --reason "...")
bcrm commitment add|list|cancel
bcrm deal advance <id> --to proposal [--force --reason "..."]
bcrm deal close <id> --won|--lost --reason <taxonomy> [--note "..."] [--term-ends <date>]
bcrm claim|release|renew <subject-id> --agent <actor> [--ttl 7d]
bcrm next [--agent <actor>|--all]
bcrm brief <contact-id|deal-id>
bcrm snooze <subject> --until <date> --reason "..."
bcrm dismiss <subject> --reason "..."
```

### 7.3 Capture (speed is everything)
Logging must take seconds or humans won't do it, and the whole derivation tower starves. Two paths:

- **Structured** (`bcrm log` above) — the canonical path; what agents use.
- **Raw capture:** `bcrm capture "call w/ dana@acme — discussed pricing, will send proposal Friday"` — lands in the raw inbox untriaged, emits `crm.capture.untriaged`. Reconciliation (human via TUI, or the inbox-triage subagent, §9) turns it into structured interaction + commitment records with the capture as `sourceRef`. Free-text parsing lives in the reconcile step where a human/agent confirms — never silently in the write path.

### 7.4 History, summaries, reports
```
bcrm timeline <contact|account|deal> [--since 90d]   # interleaved interactions, commitments, stage events, snoozes
bcrm search <query>                                  # full-text over interactions/intel (search package)
bcrm account digest <id> [--regen]                   # regenerable narrative projection → memory/wiki (§8)
bcrm pipeline board|report                           # stage counts, value, forced-gate flags, stalled counts
bcrm report touches [--by-owner] | losses | commitments
bcrm doctor [--fix] [--strict]                       # + dupe suspects, orphaned edges, alias integrity
```

## 8. Summaries and digests

Raw interaction history is the truth but unreadable at volume. The **account digest** is a regenerable projection in `memory/wiki/accounts/<account>/digest.md`: relationship narrative, current state, open threads, key intel — rebuilt from records (by the digest-writer subagent or `--regen`), clearly marked as projection, never hand-edited (hand knowledge goes in the wiki page proper). This is the "catch up on Acme in 60 seconds" artifact for humans, and it diffs in git so relationship drift is visible in history.

## 9. Actors: humans, agents, subagents

The surface is designed so each actor type has a native mode:

- **Humans:** TUI for the daily loop (§10), CLI for everything else, digests + timeline for recall.
- **Top-level agents:** run the loop via MCP/CLI JSON — `next` → `brief` → act (draft a follow-up for the human to send) → `log` → repeat. Directive `audience` field routes agent-vs-operator items.
- **Subagent job catalog** (each is read-JSON + idempotent-write + directive-ack, no new infra):
  1. **inbox-triage** — raw captures → structured interactions/commitments (raw-inbox reconcile pattern)
  2. **commitment-extractor** — scan interaction bodies/transcripts for promise-shaped statements; propose commitments with `originInteractionId`
  3. **brief-builder** — pre-meeting brief prep, pushed before scheduled touches
  4. **digest-writer** — regenerate account digests after interaction bursts
  5. **hygiene-auditor** — dupe suspects, orphaned edges, unsourced intel, dangling interactions → hygiene directives

Skills follow `skills/boreal-*` conventions: `bcrm-daily-loop`, `bcrm-log-interaction`, `bcrm-reconcile-captures`, `bcrm-account-digest`.

## 10. TUI (`apps/crm-tui`)

Read-mostly + quick-capture; deep edits stay in the CLI. Built over the same JSON contracts (no second truth). Four views:

1. **Queue** (home) — `bcrm next --all` as a live ranked list. Keys: `j/k` move, `enter` open brief, `l` quick-log against the subject, `c` add commitment, `z` snooze (prompts reason/date), `x` dismiss (prompts reason), `g` jump to timeline.
2. **Brief** — split pane: queue left, brief right; `l` logs an interaction pre-filled with the subject.
3. **Timeline** — per subject, interleaved chronological records; the "what happened with Acme" view.
4. **Board** — pipeline kanban, attention-state colored, forced-gate deals visibly badged.

Quick-log is a single form: kind/direction/outcome pickers, summary line, **next-step field that cannot be skipped** (commitment / touch date / none+reason) — the invariant is enforced in the capture UI, not discovered later as a gap. Target: log a call in under 10 seconds.

## 11. Deliberate non-goals

1. **No verification/summary ceremony.** A logged interaction *is* the evidence. Provenance (human/agent, sourceRef) is recorded data, not a verdict layer.
2. **No relevance-scored brief assembly.** Explicit links only.
3. **No outreach execution.** No sending, dialing, calendar writes. bcrm records and directs.
4. **No silent free-text parsing in write paths.** Raw capture → reconcile with confirmation, always.
5. **No multi-tenant/server/sync.** Git is the sync layer.

## 12. Risks

- **Substrate generalization** (gap-code unions, directive families, subject types in `core` are work-flavored): widen to product-namespaced registries rather than forking the compiler. Fallback: thin CRM-local directive layer over the shared bundle schema.
- **Alias/merge integrity:** re-pointing via alias resolution must be doctor-checkable (no orphaned references after merge). This is new machinery; test it hardest.
- **Shared `state.json` with work records:** record-type namespacing must keep `bwrk doctor` and `bcrm doctor` from fighting; fallback is a sibling store file.
- **Next-step invariant friction:** if it's annoying, people stop logging (worse than dangling threads). Mitigation: `--next-touch <date>` is one flag; TUI makes it one keystroke; `none` is always available with a reason. Watch this in dogfooding — the invariant is right but the ergonomics decide whether it survives.

## 13. Testing

Mirror `tests/runtime` patterns:

- **Pinned-clock derivation tables:** `derive(records, now)` → attention states + gap codes; boundaries at SLA, 75%, 2×; `going_dark` threshold sequences; snooze suppression windows.
- **Directive goldens:** fixture stores → expected bundles.
- **Invariant enforcement:** interaction without next step → gap; commitment only fulfillable by referencing interaction; gate-blocked advances; forced-advance flags; DNC suppression; close-won renewal spawn.
- **Identity:** duplicate-email fail-closed; merge → alias resolution → zero orphaned refs (property test).
- **Idempotency:** replayed `log` with same content key → single record, `deduped: true`.
- **Ownership concurrency:** two actors, one wins.
- **Envelope stability:** schema checks on every command output.

## 14. Build order (input to the implementation plan)

1. Substrate widening in `core` (namespaced gap codes / directive registries) — keep `bwrk` goldens green.
2. `crm-engine`: records + identity/merge + store integration + pinned-clock derivation.
3. Interactions + next-step invariant + commitments + gates (the enforcement spine).
4. Gap emission + directive registry + snooze/dismiss + `next` + `brief`.
5. CLI surface + capture/reconcile + timeline + import + doctor + goldens.
6. TUI (queue, brief, timeline, board).
7. MCP exposure + daemon tick + subagent skills + digests.
