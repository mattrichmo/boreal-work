# PF-S02-T10 recovery contract fixture — attempt 22 integration requests

1. Independently review the test diff and confirm it exercises the authoritative
   fail-closed plain API and the identity-bound canonical release path.
2. Confirm the full-store, recovery, integration, format, contract, and diff
   results on the same combined tree before changing acceptance state.
3. Keep PF-S02-T10 unaccepted until the combined-tree review and its remaining
   plan-level gates are complete.
4. Do not weaken the production guard or reintroduce a plain `released`
   resolution path merely to preserve an older fixture.
