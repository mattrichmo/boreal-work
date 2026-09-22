# PF-S03-T10 attempt 3 review evidence

## Disposition

**REJECTED for the bounded PF-S03-T10 leaf.** The focused target is green, but
the claimed corrective coverage is still not sufficient for acceptance.

## Exact reviewed identity

- Source revision: `784a41b3802c29a76721c55eef2e9493283396c2` (dirty)
- `crates/domain/tests/production_properties.rs` SHA-256:
  `4455551dcad2120596fbb7d9edbcfb8c95edd6752792d1d1f7c1943e4fe8cb89`
- `project/validation/production/domain/PF-S03-T10-ORACLE.md` SHA-256:
  `1701bc8596340bf85936619238071a8978de778815ca4afcb2560109e73f961b`
- `project/spec/transition-table.md` SHA-256:
  `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38`
- `project/STATUS_MODEL.md` SHA-256:
  `688595dc7d305a19e018ba727df4c850bc6a6d441e53cd4e537f02d9dc77a914`
- `project/spec/production/contract-manifest.json` SHA-256:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`

## What passed

- 13 focused production-property tests passed.
- The full `boreal-domain` suite passed.
- Strict domain Clippy, workspace formatting, contract validation, and diff
  checks passed.
- The test contains named T01–T18 and I01–I15 crosswalk entries.
- It exercises typed action allow/deny behavior, availability and integrity
  restrictions, schedule boundary predicates, deterministic serialization and
  a shrink/replay helper.

## Blocking findings

1. **Scheduled status is not executable in the asserted domain status.** The
   test explicitly verifies a schedule predicate and then projects the result
   to `Queued` with a reason. It does not exercise a `DerivedStatus::Scheduled`
   value or prove status/3 conformance. This is the same gap identified in the
   rejected attempt-2 review.

2. **The T/I crosswalk is not a semantic oracle for every vector.** It proves
   that all identifiers are present and labels most entries `PureDomain`, but
   several anchors cover multiple IDs and some legal/illegal entries are only
   listed. T18, I07, and I14 are explicitly service-only boundaries. The task
   requires positive and negative executable coverage for every normative
   vector, not identifier completeness alone.

3. **Policy identity is not bound by content at runtime.** The focused identity
   test checks the source revision and that policy hash constants have length
   64; it does not hash the loaded normative files or fail when their content
   changes. The oracle documents hashes, but documentation plus string-length
   assertions cannot detect policy drift deterministically.

4. **Historical invariance remains narrow.** The executable history test covers
   failed, released, and cancelled attempt phases. It does not cover the
   required failed/rejected evidence, submitted results, review decisions,
   reopen generations, or durable recovery obligations. Those facts can affect
   the current decision and are precisely the boundaries that need explicit
   invariance or invalidation assertions.

5. **Shrinking evidence is not a retained failing-case corpus.** A deterministic
   shrink helper and one constructed replay assertion exist, but no generated
   failing seed/input is recorded and replayed from a serialized minimal
   counterexample. This demonstrates helper behavior, not reproducible failure
   preservation for oracle regressions.

6. **Action coverage is useful but incomplete relative to the normative
   matrix.** The tests assert representative allow/deny cases and totality;
   they do not establish expected results for every mapped action/vector pair,
   especially the service-only operation/recovery boundaries.

## Scope and non-claims

No service, store, authenticated identity, transactional mutation, genuine
verifier, receipt persistence, installer, native platform, or release claim is
accepted. Passing commands above are retained as pure-domain evidence only.
Attempt-1 and attempt-2 evidence remain untouched. A new bounded corrective
attempt must address the findings above before another independent review.
