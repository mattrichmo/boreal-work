#!/usr/bin/env python3
"""Run the dependency-light P5 SQLite/application concurrency probe matrix."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).resolve().parent
V2_ROOT = HERE.parents[2]
MANIFEST = HERE / "Cargo.toml"
BINARY = HERE / "target" / "release" / "boreal-v2-concurrency-probe"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def sha256_paths(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(str(path.relative_to(V2_ROOT)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def source_files() -> list[Path]:
    roots = [
        HERE / "Cargo.toml",
        HERE / "Cargo.lock",
        HERE / "src" / "main.rs",
        V2_ROOT / "project" / "spec" / "schema-v2.sql",
    ]
    for relative in ("crates/domain/src", "crates/store/src", "crates/application/src"):
        roots.extend(path for path in (V2_ROOT / relative).rglob("*") if path.is_file())
    return roots


def rustc_version() -> str:
    return subprocess.run(["rustc", "-Vv"], check=True, text=True, capture_output=True).stdout.strip()


def run_probe(workers: int, iterations: int, tui: bool) -> dict:
    command = [
        str(BINARY),
        "--workers",
        str(workers),
        "--iterations",
        str(iterations),
        "--tui",
        "on" if tui else "off",
    ]
    completed = subprocess.run(command, text=True, capture_output=True)
    if completed.returncode != 0:
        raise RuntimeError(
            f"probe failed for workers={workers}, tui={'on' if tui else 'off'} "
            f"with exit {completed.returncode}: {completed.stderr.strip()}"
        )
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise RuntimeError(f"probe emitted {len(lines)} JSON lines for {command!r}")
    value = json.loads(lines[0])
    value["command"] = command
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--output", type=Path, default=HERE / "results" / "latest.json")
    parser.add_argument(
        "--online",
        action="store_true",
        help="allow Cargo to resolve dependencies from the network",
    )
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error("--iterations must be positive")

    cargo_network_args = [] if args.online else ["--offline"]
    subprocess.run(
        ["cargo", "build", "--manifest-path", str(MANIFEST), "--release", "--locked", *cargo_network_args],
        cwd=V2_ROOT,
        check=True,
    )
    identity = {
        "probe_version": "p5-concurrency-probe/0.1",
        "validation_profile": "P5-early-concurrency-v1",
        "schema_version": 2,
        "status_contract_version": "boreal.work-status/2",
        "worker_model": "synthetic_logical_workers",
        "os_process_model": "one probe process; one Rust thread per logical worker; optional one TUI sampler thread",
        "rustc": rustc_version(),
        "binary_sha256": sha256_file(BINARY),
        "fixture_identity": "synthetic:fresh-db:p5-workflow-v1",
        "input_sha256": sha256_paths(source_files()),
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
    }

    runs = []
    for workers in (1, 3, 10, 30, 50):
        for tui in (False, True):
            run = run_probe(workers, args.iterations, tui)
            run["validation_identity"] = identity
            run["fresh_database"] = True
            run["database_lifetime"] = "created under OS temp directory and deleted after run"
            runs.append(run)

    result = {
        "result_version": "p5-concurrency-results/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "iterations": args.iterations,
        "matrix": {"logical_workers": [1, 3, 10, 30, 50], "tui": ["off", "on"]},
        "runs": runs,
        "limitations": [
            "Logical workers are Rust threads in one OS process, not separate OS processes or machines.",
            "queue_ms is arrival delay from the common release barrier; it is not SQLite internal lock-wait time.",
            "hold_ms is application mutation-call duration and includes any SQLite lock wait; exact SQLite lock hold is not exposed.",
            "TUI on is a status-reader sampler, not the TypeScript TUI or a separate TUI process.",
            "This is an early synthetic baseline: it uses unique seeded tasks, no network, no source/memory workload, and no fault injection.",
            "A successful run is evidence that this bounded lifecycle path completed; it is not a release-performance or multi-process acceptance result.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
