# PF-S03-T09 attempt 2 — evidence

## Source identity

- Input `HEAD`: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Final tree: dirty; no commit or push performed.

Relevant file SHA-256 values at execution:

| File | SHA-256 |
| --- | --- |
| `crates/application/src/status.rs` | `4fbdcc5ceb8f629eefdfd4ab3c4629cb7f3ce5ba4ea406ef655bdb3ba12e4f42` |
| `crates/cli/src/main.rs` | `582c5cd7a18b3eecf0b504d4237b9e790fdbaab15760c05d736f54ea2b47a872` |
| `crates/cli/src/service.rs` | `ecb415ebc91555fdd36a06955b5cc474a93b94b2b38deefb928ce89cabb17a9a` |
| `apps/tui/src/client.ts` | `f9b4c1958eefcd3b9955308f9e579fbbdb3d2663ef874852eebfae460051abaa` |
| `apps/tui/src/test.ts` | `e9ec7309fa6ab43ec6b16a1ede2e37a4d97337aca1514fd7c42b3177ebf8fac0` |

## Implemented behavior

`StatusWork` now carries the domain `ActionDecision` produced alongside the
status decision. The CLI/service status DTO serializes allowed descriptors and
denied descriptors with action name, target, expected project/entity/proof
revision fields, attempt/fence when known, required roles and inputs,
confirmation, recovery flag, denial code/detail, and recovery routes.

Legacy status rows do not provide trustworthy v3 entity/proof identity or an
authenticated session. The application emits:

```json
"action_context": {
  "state": "unavailable",
  "missing_facts": ["entity_revision", "proof_identity", "authenticated_session"]
}
```

The domain action evaluation is marked unavailable and all mutating action
decisions fail closed. Unknown identity/proof revisions are serialized as
`null`; no placeholder profile, source, configuration, receipt, or approval is
presented as canonical.

`claimable` and `claimable_for_actor` are now derived from the same canonical
`ActionDecision::allows(Claim)` result. The application regression proves that
an ordinary Operator cannot receive a positive public claimability value when
the action policy denies Claim. The domain policy remains unchanged.

The TUI validates and consumes the optional server action set. For current
responses, supported action availability and denial explanations come from the
server descriptors. Existing responses without `actions` retain the prior
compatibility behavior; this fallback is explicitly version-compatible and is
not used for current service responses.

## Residual integration requests

These are required before the unavailable compatibility context can be removed:

1. **Store identity facts:** extend the canonical status read with the real
   per-work entity revision and proof revision, pinned proof/profile identity,
   current attempt/fence/session, and durable recovery identity. Do not derive
   these from the project revision or from display gates.
2. **Authenticated authority:** bind the service actor to an authenticated
   principal/session and delegation record. A caller-supplied `actor_id` is not
   sufficient evidence for an action descriptor.
3. **One action snapshot:** have application status and each committing
   mutation consume the same store-owned decision-input snapshot and re-read it
   transactionally. The TUI descriptors are advisory context, never a mutation
   authorization bypass.
4. **Review and expiry projection:** preserve rejected review as typed
   intervention and load unresolved expiry/recovery obligations into status;
   those findings remain in the PF-S03 integration handoff.
5. **Row-scoped corruption:** make gate, receipt, review, and summary decoding
   quarantine the affected row while returning valid siblings. A dashboard
   response must not be treated as complete when its action context is
   unavailable or its counts are incomplete.
6. **Wire-level mutation binding:** add descriptor entity/proof/session fields
   to mutation requests once the store facts exist, and reject stale or foreign
   descriptors inside the service transaction.

Until requests 1–3 are implemented, the current bridge is intentionally a
safe read/projection bridge, not production authorization or a claim that the
full PF-S03 integration is accepted.
