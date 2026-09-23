# PF-S03-T09 — attempt 4 start

This bounded remediation addresses the exact PF-S03 action/status findings
reported against commit 5584d461a8192cd06999f14069b3fe590b059406:

- do not fabricate v3 entity, proof, or session facts for legacy status rows;
- do not let unavailable v3 context suppress valid legacy claim/start discovery;
- do not expose contradictory legacy claimability and action denial;
- keep action descriptors optional for legacy rows and fail closed when a real
  descriptor set is present;
- map status/2 blocked plus structured expiry reasons back to the
  expired_review recovery state in the TUI.

Scope is limited to:

- crates/application/src/status.rs
- crates/cli/src/main.rs (the shared status serializer used by direct and
  service status routes)
- apps/tui/src/client.ts
- apps/tui/src/test.ts
- this attempt's evidence files

The current source base moved to HEAD 6d2ded13616615ef7866695b6ac5fe1341583db8
while another lane checkpointed unrelated work. The working tree remains
dirty. No STATE.json, plan graph, acceptance ledger, memory/, store file,
commit, or push is part of this attempt.
