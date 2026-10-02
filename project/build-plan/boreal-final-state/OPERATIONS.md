# Operations target

To be finalized in BW-S11-T06. Minimum operational promises from this plan:

- Machine update is cwd-independent and never depends on an arbitrary project DB.
- Physical Global backup is the disaster-recovery boundary; logical export/import is transfer.
- No live lock is force-broken as normal recovery.
- Direct Boreal installer coordinates the invoking user's package+Global pair; shared package managers never enumerate other users' Global roots.
- Project execution remains usable without Global; Global management remains usable when every linked workspace is unavailable.
