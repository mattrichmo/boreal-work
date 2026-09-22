# R-AGENTS — AGENTS.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `AGENTS.md:L1–L39`  
**File SHA-256:** `2d39fe3fc1e57119537f0d969e26b990584be7d2fc5ce932236e2b385541bcb3`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Non-negotiable crate direction, client authority, failed-history retention and file-based dispatch instructions.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,39p' 'AGENTS.md'
```

## Exact baseline excerpt

````text
    1 | # Boreal v2 contributor instructions
    2 | 
    3 | ## Scope
    4 | 
    5 | This is the authoritative v2 workspace. Do not add imports from the legacy
    6 | workspace. If legacy behavior is needed, document it in `docs/MIGRATION.md`
    7 | and port the behavior behind the v2 boundary.
    8 | 
    9 | ## Architecture rules
   10 | 
   11 | - Keep dependencies flowing from adapters to application to domain.
   12 | - Keep domain code free of storage, terminal UI, JSON, and process concerns.
   13 | - Keep the store responsible for transaction and revision boundaries.
   14 | - Keep lifecycle transitions in the application/domain layer, never in CLI or
   15 |   TUI handlers.
   16 | - Keep the TypeScript TUI on the versioned Rust service API. It must not read
   17 |   the canonical database directly or spawn one CLI process per refresh.
   18 | - Treat projections, search indexes, and dashboard rollups as rebuildable
   19 |   derived data.
   20 | - Keep published curated memory in Git with explicit publication/reconciliation
   21 |   state; keep live work and attempts in the transactional store.
   22 | - Preserve failed evidence and historical attempts.
   23 | - Preserve the self-guiding agent protocol: conditional status, trusted
   24 |   versioned directives, contextual `guide`/`next`, required gates, and the
   25 |   consolidated claim/evidence/finish or release path. Do not ship a CRUD-only
   26 |   CLI as feature parity.
   27 | - Never force-break a live lock as a normal recovery mechanism.
   28 | - Read `project/README.md`, `project/build-plan/README.md`, and the assigned
   29 |   leaf's vertical handoff before implementing a new v2 slice. Start from
   30 |   `MASTER_PLAN.md`, the assigned milestone sprint's `SPRINT.md`, and
   31 |   `AGENT_HANDOFF.md` for file-based dispatch. The build-plan task graph and
   32 |   write boundaries govern multi-agent assignments. Do not use legacy `bwrk`
   33 |   to create or close these plan items.
   34 | 
   35 | ## Browser automation
   36 | 
   37 | Do not launch `/Applications/Google Chrome.app` for automated screenshots,
   38 | CDP, Playwright, Puppeteer, or browser smoke tests. Use Playwright-managed
   39 | Chromium and do not use `--channel=chrome`.
````
