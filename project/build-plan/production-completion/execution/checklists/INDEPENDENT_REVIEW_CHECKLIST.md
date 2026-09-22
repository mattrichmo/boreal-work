# Independent review checklist

## Independence

- [ ] Reviewer did not implement the reviewed task or perform its shared-file
      integration.
- [ ] Reviewer has the exact combined source identity and task/sprint scope.
- [ ] Reviewer has access to raw evidence, not only a worker summary.

## Correctness

- [ ] Check the intended invariant and all relevant architecture boundaries.
- [ ] Inspect positive, negative, malformed, stale, boundary, and race cases.
- [ ] Verify failed evidence and historical attempts remain preserved.
- [ ] Verify authorization is not inferred from a display status or client-side
      predicate.
- [ ] Verify project identity, revisions, fences, subjects, and operation IDs
      are bound at the committing boundary where required.
- [ ] Verify the TUI/CLI/service does not invent data or access the canonical DB
      outside the service boundary.

## Findings and decision

- [ ] Each finding has severity, exact path/behavior, impact, owner, and
      disposition: fixed, no_change, or deferred.
- [ ] Required remediation is a new bounded task with a write set and
      dependency, not a silent edit to the original acceptance.
- [ ] Review result is recorded even when there are no findings.
- [ ] Review does not self-accept the implementation.
