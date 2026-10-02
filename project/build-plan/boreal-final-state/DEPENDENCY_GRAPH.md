# Dependency graph — active revision 3

The exact edge list is BOREAL_TEMPLATE_V3.json and PLAN_CONTEXT.json. Edges connect direct task items only. Milestone/sprint items are containers; their dependency arrays are empty. Scheduling cycles remain a separate product concept.

## Product sequencing

```text
S00-T90
  |-- S01 recovery --+--> S03 machine update --+
  |-- S02 packaging-+                        |
  |-- S04 bounded reads --> S05 daily --------+--> S06 Inbox/provenance --> S07 daily product
  |-- S12-T01 capability contract
  |      |-- T02 planning --+
  |      |-- T03 execution -+--> T05 typed clients/skills --> T06 headless --> S12-T90
  |      |-- T04 knowledge -+                             ^
  |                                                      S02-T90
  +-- S08 receipt/restore groundwork (T02 also needs S12-T01) --> S08-T90

S12-T01 --> S05-T05
S12-T05 --> S07-T05
S07-T90 + S08-T90 --> S09 Send --> S09-T90
S07-T90 --> S10 measurement/decision --> S10-T90
S09-T90 + S10-T90 + S12-T90 --> S11 final qualification
```

S12 is an early parallel lane despite its preserved numbering. S08's old Global-TUI predecessor is removed; its application receipt contract is independently useful. Send still cannot precede the usable standalone Global product. A ready task does not imply permission to edit another lane's files.

## Release and optional work

Each sprint's T90 depends on its required leaves. S10-T90 depends on T01/T02/T03 only; T04/T05/T06 are preserved outside the required V3 import. All other required sprint leaves and their gates remain. Final S11 leaves wait on all three terminal lanes, and S11-T90 integrates/reviews the final release. The milestone additionally obeys canonical container-close policy; do not treat a GitHub graph as authority to complete runtime records.

## Dispatch

T01/T04 and bounded T05 in S00 preserve their current policies and active ownership. After S00, recovery/packaging/Global reads, S12 contract work and nonconflicting S08 work can overlap. T02/T03/T04 within S12 can overlap after T01 only on disjoint modules. Shared CLI/protocol/store/installer files have one steward across the entire active wave, not one competing steward per sprint.

The plan checker rejects unresolved, duplicate, self or cyclic dependencies and non-task edges. IMPORT.md covers changes to an already-imported runtime graph; reapplying the whole template is not reconciliation.
