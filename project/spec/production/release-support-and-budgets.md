# Boreal v2 support, security, resource, and release budgets

**Contract:** `boreal.support-release/1`
**Decision:** DEC-11
**Status:** proposed PF-S01-T09 contract; targets are not evidence that the
current source or a release artifact satisfies them.

This document fixes the acceptance budgets that later implementation,
service, native, migration, and release tasks must measure. It deliberately
does not turn historical fixture passes, unavailable toolchains, or local
documentation into product acceptance.

## 1. Supported product boundary

Boreal is a project-local Rust service/CLI with a TypeScript terminal client.
The supported installation owns `bin/bwrk`, the recursively packaged TUI
under `lib/boreal/tui`, and release metadata under `share/boreal`. A project
database, its referenced blobs, workspace binding, local service runtime, and
curated-memory publication state form one project scope. A package upgrade
must not switch that scope or silently adopt another directory's metadata.

The supported release matrix is the matrix already owned by the release
workflow:

| Target | Runner/release mode | Required acceptance | Current status |
| --- | --- | --- | --- |
| `aarch64-apple-darwin` | macOS 14 arm64, archive and prefix install | BSD tar extraction, executable ABI, installer rollback, project-local init/dashboard, linked SQLite floor, TUI smoke | unmeasured by this contract |
| `x86_64-apple-darwin` | macOS 13 Intel, archive and prefix install | same target-specific checks | unmeasured by this contract |
| `x86_64-unknown-linux-gnu` | Ubuntu 22.04 glibc, archive and prefix install | GNU tar extraction, executable ABI, installer rollback, project-local init/dashboard, linked SQLite floor, TUI smoke | unmeasured by this contract |

These are the only release targets until a reviewed DEC-11 amendment adds a
target, runner, runtime floor, packaging rule, and rollback test. Windows,
remote hosting, musl, universal macOS archives, and cross-project global
operation are not implied support. A target may be published only when its
artifact has an explicit `pass`, `unsupported` with owner/follow-up, or
`failed` disposition; absence of a runner is never a pass.

The release builder must produce a deterministic target archive containing
the binary, the complete compiled TUI tree, release identity, license, and
checksums. A source-only contract or a contract-asset identity is not a
replacement for a rebuilt binary identity.

## 2. Measurement rules and evidence states

Every budget record names the exact source revision, target, host/runner,
kernel/OS, CPU and memory, Rust/Node/TypeScript versions, linked SQLite
version/source ID/compile options, database fixture digest, command argv/cwd,
operation IDs where relevant, raw measurements, and artifact digests.

Evidence uses one of these states:

- `pass`: the exact required observable was measured on the actual combined
  source or artifact and met the fixed threshold;
- `fail`: the observable ran and exceeded a threshold or violated an
  invariant;
- `unsupported`: the required environment/capability was unavailable, with a
  named owner and follow-up; this blocks a release claim for that target;
- `unmeasured`: no valid run exists yet; this is a release blocker;
- `not_applicable`: only when the contract explicitly says the case does not
  apply to the named target.

Thresholds must be selected before a run. A failed measurement cannot be made
to pass by changing the fixture, removing outliers, increasing the threshold,
or switching to a fixture controller. A threshold change requires a reviewed
DEC-11 amendment with rationale, migration/release impact, and a new baseline.
Record p50, p95, p99, maximum, count, and error/timeout count where the
metric is sampled; a mean alone is insufficient for a tail-sensitive gate.

## 3. Resource and responsiveness budgets

The following are initial production acceptance budgets for the declared
workload. They are contract targets, not claims about the current code.

| Surface | Fixed workload | Threshold | Required observable |
| --- | --- | --- | --- |
| project dashboard snapshot | 10,000 tasks, 100,000 dependency edges, 3 concurrent read clients, no writer | p95 <= 500 ms, p99 <= 1,000 ms, 0 fabricated/incomplete totals | revision-consistent counts, page cursor, exact/partial totals, diagnostics |
| bounded list/search page | 10,000 tasks, page size 100, 3 concurrent clients | p95 <= 250 ms; response <= 256 KiB inline | query digest, stable cursor, bounded decoded rows/text, exact/partial total |
| writer queue admission | 3 concurrent agents, 1 writer, 20 mutations/s for 60 s | p95 queue wait <= 250 ms; no starvation > 2 s; no duplicate operation effect | operation IDs, busy/retry-after behavior, committed/rejected/unknown readback |
| mutation transaction hold | claim/start/checkpoint/finish/close, 3 agents, 1 writer | p95 <= 100 ms, p99 <= 250 ms; no external process/Git work inside transaction | measured transaction hold separately from queue wait |
| heartbeat fairness | 3 active attempts, heartbeat every 10 s, concurrent planning/review writes | no heartbeat starves a foreground mutation for > 2 s; expired authority never extends | lease and hard-budget clocks remain distinct |
| service reconnect | one active subscription, forced socket/service restart, 100 pending IDs | resnapshot begins <= 2 s after reconnect; no stale-project repaint; no duplicate mutation | gap cursor forces full snapshot; operation readback resolves unknown outcomes |
| memory/history growth | 100,000 retained audit/attempt/evidence rows, 1,000-row page | p95 page <= 500 ms and no unbounded inline response | old history remains queryable and failed evidence is not deleted |
| offline/last-known view | service unavailable after a trusted snapshot | render <= 1 s; mutations disabled; snapshot timestamp/project identity visible | no fresh counts, project fallback, or local alternative database |

The full-project benchmark may report larger times as diagnostic evidence,
but it cannot substitute for the bounded page and concurrency gates. The
release floor for linked SQLite is **3.51.3 or newer**. The builder and
installed binary must verify the actual linked runtime; advertising the floor
without checking it is a failure.

## 4. Security and boundary budgets

The following are nonwaivable invariants. A failure blocks the relevant task,
release target, and any dependent acceptance gate until repaired or explicitly
rejected as out of support by an authorized DEC-11 amendment:

1. A project request cannot read, mutate, cache, subscribe to, or resolve an
   operation from another project, including after copied metadata, symlink,
   `..`, moved-root, restore, or late-response cases.
2. The canonical database path is resolved and rechecked against the intended
   project binding after symlink and parent resolution. A lexical prefix check
   alone is insufficient.
3. Every consequential mutation authenticates the operation context and
   rereads canonical facts inside its committing transaction. Caller-supplied
   actor IDs, session strings, display statuses, client affordances, or cached
   eligibility cannot prove authority.
4. Attempt fences, lease deadlines, hard execution deadlines, project/entity
   revisions, proof-relevant revisions, restore epochs, and operation IDs are
   checked for the action being committed. A heartbeat cannot extend an
   immutable hard deadline.
5. Failed evidence, rejected review, expiry, cancellation, exceptions,
   superseded outcomes, and prior attempts remain auditable. Deleting an
   observation cannot delete an immutable requirement or manufacture a pass.
6. A quarantined or unreadable canonical scope fails closed with a typed
   diagnostic and repair/recovery actions only. It is never normalized to
   `not_found`, success, ordinary queued work, or a fabricated empty profile.
7. Verification commands are attributable and bound to the declared source,
   configuration, gate, subject, output digest, and executor. Raw JSON that
   merely says `passed` is not proof that the declared command ran.
8. Trusted workflow/directive assets produce argv/cwd/runner data; untrusted
   work text, source content, summaries, and raw memory cannot become shell
   commands. No shell `eval` or equivalent interpretation is allowed.
9. Secrets, credentials, tokens, raw receipts, and private paths are redacted
   from ordinary UI, logs, evidence summaries, and release artifacts while
   remaining available through authorized advanced diagnostics.
10. A live lock is never force-broken as normal recovery. Process/resource
    release and database fence revocation are separate operations, and a
    shared worktree is not reused while an old writer may still be active.

Required security measurements include project isolation fixtures, symlink
and canonical-path cases, stale/foreign principal cases, malformed and
oversized protocol frames, repeated-connection behavior, process cleanup,
file permissions, secret-redaction scans, and audit authorization. Existing
security probes are useful focused evidence but do not establish OS-level
isolation, denial-of-service resistance, database permissions, outbox
recovery, or deployment hardening without those additional runs.

### Bounded source, receipt, and process limits

These limits are part of the acceptance contract and apply before a record is
committed. A rejected oversized input retains its request digest and typed
reason; it is not silently truncated into a passing observation.

| Input or resource | Limit | Required behavior and observable |
| --- | --- | --- |
| raw source body | 4 MiB per source version; 64 MiB total per intake operation | reject above the limit with `invalid_argument` and `source_size_limit`; preserve URI/metadata and request digest, not a partial trusted source |
| structured receipt | 1 MiB serialized payload; 512 KiB retained stdout/stderr per gate; 64 artifact references; 8 nesting levels | reject an invalid/oversized receipt, or store an explicitly marked untrusted overflow detail reference; preserve the original output digest and never treat truncation as proof |
| receipt evidence items | 256 items per gate and 16 KiB per item | bounded validation and typed count/size diagnostics; detail retrieval is digest-bound and permission-checked |
| inline diagnostics/detail | 256 KiB response body; 2 MiB authorized detail object | return `detail_ref` with digest, size, retention state, and source revision above the inline limit; clients cannot substitute another detail object |
| verifier process tree | only descendants of the admitted verifier identity and recorded process group; no unrelated PID may be terminated | record root/group identity, descendant count, and command/cwd before execution and during cleanup |
| normal verifier cleanup | request termination at deadline, observe all owned descendants gone within 5 s after graceful signal | `pass` only when the process group is gone and resources are released; otherwise `cleanup_pending`/`failed` with the owned PIDs and recovery job |
| cleanup escalation | an authorized operator may escalate only for the recorded owned process group after the 5 s grace period; final deadline 30 s | record signal, result, remaining descendants, and resource disposition; never call this a database-lock break or silently reuse a shared worktree |

The verifier runner must fail closed if process ownership cannot be proven.
On supported macOS/Linux runners, the cleanup fixture starts a parent with
known descendants, records the group, exercises normal and timeout paths, and
asserts zero owned descendants after the cleanup deadline. An unsupported
process-group primitive is an `unsupported` target result, not a successful
cleanup claim. A still-running descendant blocks reuse of the associated
worktree/resource and creates a durable recovery obligation.

### Credentials and audit access

Credential enrollment uses the platform credential store: macOS Keychain on
macOS targets and the user-scoped Secret Service/libsecret store on Linux.
The Linux release is unsupported for credential enrollment when that store is
unavailable; there is no plaintext file or environment-variable fallback.
Credential references, not secret material, are stored in the project
database. Any optional file-based bootstrap token is created with owner-only
permissions (`0600`), is short-lived, is never printed, and is immediately
replaced by a credential-store reference or rejected.

Reads of raw receipts, process diagnostics, and advanced audit detail require
an authenticated principal with the `audit.read` capability and project
membership. Secret fields are redacted before persistence to ordinary audit
events and before transport. Credential rotation/revocation increments the
credential identity/revocation revision; an old token is rejected on the
next authenticated operation and the rejection is readable by operation ID.
The normal TUI/CLI cannot request raw secret material. Acceptance evidence
must include an authorized-read pass, an unauthorized-read denial, a revoked
credential denial, and a redaction scan over persisted/logged output.

## 5. Artifact, dependency, and installer trust

Every release target must publish:

- a normalized archive and per-target manifest;
- SHA-256 checksums covering the exact archive and staged payload;
- component identities for binary, TUI, protocol, schema, workflow,
  directive, memory, and toolchain assets;
- provenance naming the source tag/commit, builder workflow, target, linked
  SQLite identity, and toolchain versions;
- an authenticated release signature or an explicitly recorded unsupported
  signing disposition owned by the release steward before publication.

The installer must reject path traversal, unexpected symlinks, malformed or
wrong-target archives, checksum mismatch, and incomplete TUI payloads. It
installs into a caller-selected prefix, keeps a recoverable previous payload
until activation succeeds, and does not edit shell profiles or silently
change global PATH ordering. The package must not copy only one generated
entrypoint when the release manifest declares the full TUI tree.

Dependency policy is locked-file builds, declared minimum Node 20–26 support
for the TUI toolchain, the verified Rust toolchain, and a recorded audit of
direct/transitive release dependencies. No network download is a substitute
for a missing artifact in a release smoke test. The release must fail closed
when the generated binary/TUI/manifest identities disagree.

## 6. Backup, restore, upgrade, and rollback budgets (RPO/RTO)

The supported recovery unit is the project database plus referenced blobs,
curated-memory Git revision, contract/version manifest, and restore epoch.
Backups use a consistent live-database mechanism; a copied WAL or an
uncoordinated file copy is not accepted as a backup proof.

| Recovery property | Budget / invariant | Required evidence |
| --- | --- | --- |
| Recovery point objective | <= 15 minutes for declared scheduled backups; every accepted outcome before the last backup is reported as potentially absent | timestamped backup manifest, source DB revision, blob/Git references |
| Recovery time objective | <= 10 minutes for a 10,000-task project on the supported reference runner | timed restore, integrity check, service reopen, first bounded snapshot |
| Restore identity | restore creates a new database/restore epoch; stale clients, fences, leases, subscriptions, and pending operations cannot cross it | stale-client rejection and operation readback evidence |
| Backup completeness | all referenced blobs and the exact curated-memory commit are present or the backup is marked incomplete | manifest cross-check and missing-reference diagnostic |
| Upgrade safety | binary/TUI activation is atomic; database migrations are separately ordered and reversible/forward-only as specified; old binary is not opened on incompatible schema | interruption points before/after activation and migration readback |
| Rollback | restore the prior compatible package without implying that a newer database can be downgraded; retain the failed package and migration evidence | real prefix rollback and compatibility rejection |

Failure at any point yields a durable external-job/readback state, never a
false successful upgrade. Active attempts are not silently paused, released,
or transferred by package installation; a separate authorized maintenance
operation must reconcile them.

## 7. Required release evidence package

The release steward must assemble one evidence bundle per target containing:

1. clean source/tag identity and dirty-tree rejection;
2. locked Rust format/test/build results and TUI build/typecheck/test results;
3. protocol, schema, workflow, directive, memory, and package identity
   manifests;
4. SQLite runtime floor and compile-feature probe;
5. resource budget measurements with raw JSON and benchmark fixture digest;
6. security/isolation/corruption and unknown-outcome evidence;
7. real archive extraction using the target's supported tar implementation,
   clean-prefix install, version/manifest check, init and dashboard smoke;
8. upgrade interruption, rollback, backup/restore, and project isolation
   results;
9. signing/checksum/provenance verification and publication URLs when
   publishing is authorized;
10. an explicit disposition for every skipped native/platform check.

Fixture controllers, fake releases, presentation-only PTYs, a source ZIP,
or a passing TypeScript suite may support a component but cannot close the
real-service or release rows.

## 8. Ownership and amendment rules

The security/release steward owns this contract and its measurements. Store,
service, TUI, migration, and release tasks consume the thresholds but do not
silently weaken them. Critical integrity, isolation, authority, proof, and
restore-identity failures are nonwaivable. A proposed relaxation must name
the authorizer, contract version, affected task/gate, tradeoff, migration and
rollback impact, and replacement acceptance evidence.

The current contract does not claim that any target, signing path, native
benchmark, backup/restore, or production release has passed. Those claims are
reserved for the exact artifact-level and installed-binary evidence required
by PF-S01-T09, later implementation tasks, and the PF-S01 independent
review/reconciliation/revalidation chain.

## 9. Traceability and baseline discrepancy

T09 is a contract task and makes no schema/protocol implementation change.
Its impact is deliberately explicit:

| Surface | T09 effect | Owner/gate |
| --- | --- | --- |
| T08 service envelope | consumes revision, operation ID, detail reference, typed outcome, external-job stages, and readback rules; adds no new envelope field | PF-S01-T11 contract integration; PF-S02 service/store implementation |
| protocol/error registry | requires the later typed `integrity_quarantined`, size-limit, cleanup, credential, and unsupported-target dispositions to remain fail-closed and diagnostic | PF-S01-T11 integrates the registry; PF-S02/PF-S04 implement and test it |
| schema/migration | requires durable job, operation, restore-epoch, credential-revision, detail-digest, and recovery-obligation identities; does not create tables in T09 | PF-S02 schema/migration tasks; migration impact is additive and rollback-reviewed |
| release manifest/package | requires target, binary/TUI, SQLite, toolchain, checksum, signature, and provenance identities; no builder code changes here | PF-S16 release implementation and PF-S20/PF-S21 gates |
| security/performance evidence | fixes the workloads, limits, disposition states, and nonwaivable boundaries used by later native/platform runs | PF-S02/PF-S04/PF-S16 validation lanes |

The baseline discrepancy is recorded rather than hidden: current packaging
documentation says signing, active-attempt coordination, full target
upgrade/recovery, and several native/multi-process checks remain open; the
historical performance/security runs are fixture or focused evidence; and the
current manifest advertises a SQLite floor whose actual linked runtime still
requires verification. DEC-11 therefore remains a proposed contract decision
until this artifact is independently accepted and the later implementation
and release gates produce exact evidence. T09 does not relabel any historical
pass or claim that the discrepancy is resolved.
