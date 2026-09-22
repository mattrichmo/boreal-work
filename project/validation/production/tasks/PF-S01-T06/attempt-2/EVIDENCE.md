# PF-S01-T06 attempt 2 — evidence

The acceptance/proof contract separates immutable requirements, observations,
and decisions; pins content-addressed profile versions; defines one relevant
proof selector; preserves failed/stale/unrelated evidence; distinguishes
rejected review from missing review; binds close intent to exact proof context;
and defines scoped exceptions, migration, corruption, and conformance rules.
The machine-readable registry includes focused, reviewed, and operator
profiles with immutable versions and explicit review requirements.

Changed product paths:

- `project/spec/production/acceptance-and-proof.md`
- `project/spec/production/profile-registry.json`

The first worker attempt was interrupted before evidence; no acceptance was
inferred. The first independent review rejected the registry because its
immutable profiles lacked content digest, author/publisher, publication,
supersession, verifier, observable, subject, and review-policy metadata; that
review is preserved in `REVIEW-KEPLER.md`. The registry was amended with those
fields and real canonical profile digests. JSON, contract, and Markdown checks
were rerun after amendment. This attempt remains subject to independent
acceptance, reconciliation, and sprint revalidation and makes no
product/service/release claim.
