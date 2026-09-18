# Process-boundary validation

`claim_race.py` launches real child processes behind an explicit filesystem
release barrier. It verifies two high-value invariants against one SQLite
database:

- sixteen distinct operations contending for the same claim produce exactly
  one winner;
- opposite dependency edges racing between two processes produce one winner
  and never commit a cycle;
- sixteen identical requests with one operation ID produce one `changed`
  result and fifteen `unchanged` replays.

Run it after building the current binary:

```sh
python3 scripts/validation/process/claim_race.py --bin target/debug/bwrk
```

This is intentionally separate from the synthetic Rust-thread concurrency
probe. It does not claim to cover crash injection, stale lock recovery, or
every lifecycle race.
