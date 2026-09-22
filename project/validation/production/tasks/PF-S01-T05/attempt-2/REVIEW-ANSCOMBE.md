# Independent review — PF-S01-T05

**Reviewer:** Anscombe (`01a0c73b-e0e4-7cc0-9dee-b27254cc2793`)
**Decision:** REJECTED pending amendment

Findings:

1. Secondary-reason ordering conflicted between the artifact/registry and the
   existing transition fixture's lexical ordering.
2. `quarantined` was described as an integrity dimension but used as if it
   were a product status, without a display-status, primary-reason, or client
   mapping.
3. Older-client behavior lacked an exact status/3-to-status/2 mapping and
   explicit fail-closed handling for new dimensions/action descriptors.
4. The machine-readable registry omitted the artifact's structured reason
   shape and the existing `expiry_review_required` compatibility code.

The rejection is preserved before amendment. No source, state, or prior
evidence was edited by the reviewer.
