# PF-S03-T09 attempt 2 — bounded application/service/TUI bridge

This attempt implements only the coordinator-requested bridge. It does not
edit the domain policy definitions, store core, plan, state, ledger, or
`memory/`.

Input commit: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`

The working tree contains other coordinator/worker changes. The final source
identity is therefore not a commit identity; the file hashes in `EVIDENCE.md`
bind this attempt's changed source files.

Bounded objective:

- carry the domain action decision on each application status row;
- expose structured action descriptors, denials, reasons, and revisions in the
  existing status envelope;
- make the TUI consume those descriptors for supported work actions;
- preserve the old TUI derivation path only when an older response omits the
  new optional `actions` field;
- make public claimability use the action decision rather than the independent
  legacy status hint;
- fail closed and visibly when legacy rows do not provide v3 identity/proof
  facts.

The compatibility adapter intentionally does not fabricate proof/profile
identities or expose a placeholder entity revision as authoritative data.
