# Ordered implementation change log

No original implementation Git commits are available in the supplied archive.
No implementation commit IDs are invented here. The source commit
`abf87bb528b55632499bb246c10aeb902680a582` is the user-supplied **dirty baseline**
identity only, not a commit containing these changes. A synthetic local baseline
was used for comparisons and is not included as original history.

| Order | Logical change | Purpose |
|---|---|---|
| 01 | Connect canonical submission/review/accepted-outcome lifecycle | Replace uncalled helpers with exact-context transactional writers; preserve failed history. |
| 02 | Separate sealed proof from execution ownership | Retain candidate identity and resource/recovery obligations after a lease ends. |
| 03 | Add local principal/credential authority | Explicit project binding, random local keys, delegated roots, sessions, roles and revocation. |
| 04 | Add canonical completion operations | Review decisions, exceptions, edge waivers, reopen/cancel/retry/publish and checkpoint with revision-bound audit. |
| 05 | Unify fact/action projection and caller context | Complete action vocabulary, explicit session, bounded whole-row pagination and consistent counts. |
| 06 | Connect milestone/task/cycle planning | One canonical containment/dependency graph, concurrent cycles, commitment/carry-over/mapping history. |
| 07 | Add durable memory draft/review/publication/readback | Frozen admission identity, genuine Git readback and separate database reconciliation. |
| 08 | Harden maintenance and legacy import | Irreversible terminal jobs, read-only doctor and nonaccepted historical completion disposition. |
| 09 | Update trusted workflow package and guidance | Digest-verified assets and registry-compatible conditional server action guidance. |
| 10 | Harden terminal authority and recovery | Project/epoch isolation, stale revision high-water marks, read-only outage rows, pending original-operation readback and red diagnostic rows. |
| 11 | Complete release asset staging and installed-byte checks | Full TUI tree, all UI modules, absolute binary checks/rollback and disposable two-project smoke entry point. |
| 12 | Fix integration checks and package exact overlay | Typed checkpoint audit migration, strict legacy-placeholder immutability, server-action fixtures, workflow validator parity, CRC/hash/preflight/replay. |

## Merge order

Apply all replacement/addition files together using the baseline repository's
`scripts/apply_overlay.py` with the exact source ZIP and a separate backup.
The logical rows above are not independent tested commits. In particular, do
not merge protocol/TUI changes without their domain/application/store changes,
or completion writers without completion migrations v2–v6. Compile and run
focused Rust lifecycle, identity and migration checks before deploying.

No published release, Rust build pass, or original repository Git ancestry is claimed.
