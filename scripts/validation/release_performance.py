#!/usr/bin/env python3
"""Run the reproducible release, doctor, schema, backup, and scale gates.

This runner is intentionally an evidence collector, not a performance claim.
It invokes focused native tests and records their JSON markers together with
the command, toolchain, runtime, and explicit limitations.  The 100k status
probe is ignored by ordinary workspace tests and is run here on purpose.

Examples:

    python3 scripts/validation/release_performance.py --output /tmp/boreal-release.json
    python3 scripts/validation/release_performance.py --sizes 10000,100000 --release
    python3 scripts/validation/release_performance.py --skip-benchmark
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
MARKERS = {
    "runtime": re.compile(r"^RELEASE_RUNTIME (\{.*\})$", re.MULTILINE),
    "schema": re.compile(r"^RELEASE_SCHEMA (\{.*\})$", re.MULTILINE),
    "benchmark": re.compile(r"^RELEASE_STATUS_BENCHMARK (\{.*\})$", re.MULTILINE),
}


def command_text(command: list[str]) -> str:
    return " ".join(command)


def run(command: list[str], *, env: dict[str, str] | None = None) -> dict[str, Any]:
    completed = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
    )
    record: dict[str, Any] = {
        "command": command,
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
    if completed.returncode != 0:
        raise RuntimeError(
            f"command failed ({completed.returncode}): {command_text(command)}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    return record


def markers(output: str, kind: str) -> list[dict[str, Any]]:
    return [json.loads(value) for value in MARKERS[kind].findall(output)]


def cargo_test(test: str, *, release: bool = False, ignored: bool = False) -> dict[str, Any]:
    command = ["cargo", "test", "-p", "boreal-store", "--test", test]
    if release:
        command.append("--release")
    command.extend(["--offline"])
    if ignored:
        command.extend(["--", "--ignored", "--nocapture"])
    elif test == "release_acceptance":
        command.extend(["--", "--nocapture"])
    return run(command)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "scripts/validation/results/release-performance.latest.json",
    )
    parser.add_argument(
        "--sizes",
        default="10000,100000",
        help="comma-separated ignored benchmark sizes (default: 10000,100000)",
    )
    parser.add_argument("--release", action="store_true", help="run native probes in release mode")
    parser.add_argument("--skip-benchmark", action="store_true")
    parser.add_argument(
        "--skip-doctor",
        action="store_true",
        help="skip the public CLI doctor gate only for isolated store measurements",
    )
    parser.add_argument(
        "--require-sqlite-floor",
        action="store_true",
        help="fail after writing evidence when the linked SQLite is below 3.51.3",
    )
    args = parser.parse_args()

    sizes = []
    for raw in args.sizes.split(","):
        try:
            value = int(raw)
        except ValueError as exc:
            parser.error(f"invalid benchmark size: {raw!r}")
            raise AssertionError from exc
        if value <= 0:
            parser.error("benchmark sizes must be positive")
        sizes.append(value)

    evidence: dict[str, Any] = {
        "result_version": "boreal.release-performance/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repository": str(ROOT),
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "policy": {
            "sqlite_runtime_floor": "3.51.3",
            "sqlite_floor_action": "release gate; report unsupported when linked runtime is below floor",
            "sqlite_floor_enforced": args.require_sqlite_floor,
            "status_page_limit": "must bound returned payload; native store scaling is measured separately",
            "backup": "online backup/restore only; do not copy a live WAL database main file alone",
        },
        "checks": [],
        "limitations": [
            "This script does not prove multi-process crash safety or platform-wide descendant cleanup.",
            "The status benchmark measures the current full canonical read and is not proof of bounded database work.",
            "A runtime below the SQLite floor is recorded as unsupported evidence; this runner does not silently upgrade a linked system library.",
            "The benchmark is not a before/after speedup claim and has no target latency assertion until a native baseline is accepted.",
        ],
    }

    for test, label in (("release_acceptance", "runtime/schema acceptance"), ("schema_v3", "schema-v3 migration"), ("runtime_backup", "backup/restore")):
        result = cargo_test(test, release=args.release)
        evidence["checks"].append({"label": label, "status": "pass", "command": result["command"]})
        if test == "release_acceptance":
            combined = result["stdout"] + result["stderr"]
            runtime = markers(combined, "runtime")
            schema = markers(combined, "schema")
            if len(runtime) != 1 or len(schema) != 1:
                raise RuntimeError(
                    "release_acceptance did not emit exactly one RELEASE_RUNTIME and RELEASE_SCHEMA marker"
                )
            evidence["runtime"] = runtime[0]
            evidence["schema"] = schema[0]

    if args.skip_doctor:
        evidence["checks"].append(
            {
                "label": "public doctor and bounded-status acceptance",
                "status": "skipped",
                "reason": "explicit --skip-doctor; this is not release evidence",
            }
        )
    else:
        doctor = run(
            ["cargo", "test", "-p", "boreal-cli", "--test", "release_acceptance", "--offline"]
        )
        evidence["checks"].append(
            {
                "label": "public doctor and bounded-status acceptance",
                "status": "pass",
                "command": doctor["command"],
            }
        )

    if not args.skip_benchmark:
        env = os.environ.copy()
        env["BOREAL_RELEASE_BENCH_SIZES"] = ",".join(str(size) for size in sizes)
        command = ["cargo", "test", "-p", "boreal-store", "--test", "release_acceptance"]
        if args.release:
            command.append("--release")
        command.extend(["--offline", "--", "--ignored", "--nocapture"])
        result = run(command, env=env)
        records = markers(result["stdout"] + result["stderr"], "benchmark")
        if len(records) != 1:
            raise RuntimeError("benchmark did not emit exactly one RELEASE_STATUS_BENCHMARK marker")
        evidence["benchmark"] = records[0]
        evidence["checks"].append(
            {
                "label": "status scale benchmark",
                "status": "pass",
                "command": result["command"],
                "sizes": sizes,
            }
        )
    else:
        evidence["checks"].append({"label": "status scale benchmark", "status": "skipped"})

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.output}")
    print(json.dumps({"checks": evidence["checks"], "output": str(args.output)}, indent=2))
    if "runtime" in evidence:
        print(
            "SQLite runtime: "
            f"{evidence['runtime']['runtime']['libversion']} "
            f"(floor met={evidence['runtime']['meets_floor']})"
        )
    if "benchmark" in evidence:
        for measurement in evidence["benchmark"]["measurements"]:
            print(
                "status baseline: "
                f"works={measurement['work_items']} "
                f"elapsed_ms={measurement['elapsed_ms']:.3f} "
                f"rows={measurement['rows_returned']} "
                f"text_bytes={measurement['text_bytes_read']}"
            )
    if args.require_sqlite_floor and not evidence["runtime"]["meets_floor"]:
        print(
            "FAIL: linked SQLite is below the required 3.51.3 release floor; "
            "evidence was written but this run is not release-eligible",
            file=sys.stderr,
        )
        return 2
    print("No performance improvement or SQLite support claim is made by this run alone.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
