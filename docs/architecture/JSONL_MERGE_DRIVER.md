# Boreal JSONL Merge Driver

Boreal reserves append-only JSONL collaboration paths in `.gitattributes` with `merge=boreal-jsonl`. Git only uses that driver after the local repository config defines it.

## Local Setup

Run these commands from the Boreal repo root:

```bash
git config --local merge.boreal-jsonl.name "Boreal deterministic JSONL ledger merge"
git config --local merge.boreal-jsonl.driver "node tools/boreal-jsonl-merge-driver.mjs %O %A %B %P"
```

This writes only to `.git/config` in the current checkout. It does not mutate global Git config.

To remove the local driver:

```bash
git config --local --unset-all merge.boreal-jsonl.name
git config --local --unset-all merge.boreal-jsonl.driver
```

## Behavior

The driver reads the merge base, current side, and other side as strict JSONL. Each non-empty line must parse to a JSON object.

Records are keyed by `meta.id` when present, then `id`, then a stable content hash for objects without either field. Non-conflicting appends are unioned deterministically: base records keep base order, and new records are sorted by key so either merge direction produces the same file.

The driver fails closed when both sides change the same record key differently, when a file contains blank lines, invalid JSON, arrays, primitives, or duplicate record keys with different content.

## Manual Test

The driver can be exercised without changing Git config:

```bash
node tools/boreal-jsonl-merge-driver.mjs /tmp/base.jsonl /tmp/current.jsonl /tmp/other.jsonl memory/raw/index.jsonl
```

On success it overwrites the current-side file argument with the merged JSONL and exits `0`. On conflict it leaves the current-side file unchanged, writes the reason to stderr, and exits nonzero.
