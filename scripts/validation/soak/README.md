# Process soak

`run.py` repeats the real child-process claim/dependency/idempotency race in
isolated temporary projects and records every round. The aggregate full suite
runs a bounded ten-round soak; operators can increase `--rounds` for a longer
endurance check.

This is intentionally separate from the deterministic fault matrix: a soak
pass demonstrates repeatability under load, not power-loss durability or
indefinite service endurance.
