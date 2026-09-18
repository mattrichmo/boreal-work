#!/usr/bin/env python3
"""Run the reproducible Rust status-read baseline and retain its evidence."""

from __future__ import annotations

import argparse
import json
import platform
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PATTERN = re.compile(r"^STATUS_BENCHMARK (\{.*\})$", re.MULTILINE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent / "results" / "latest.json",
    )
    parser.add_argument("--release", action="store_true", help="build the fixture with --release")
    args = parser.parse_args()

    command = ["cargo", "test", "-p", "boreal-store", "--test", "status_benchmark"]
    if args.release:
        command.append("--release")
    command.extend(["--offline", "--", "--nocapture"])
    completed = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        sys.stderr.write(completed.stdout)
        sys.stderr.write(completed.stderr)
        return completed.returncode

    matches = PATTERN.findall(completed.stdout)
    if len(matches) != 1:
        raise RuntimeError(
            f"expected one STATUS_BENCHMARK record, found {len(matches)}; "
            "run cargo test directly with --nocapture to inspect output"
        )
    fixture = json.loads(matches[0])
    result = {
        **fixture,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "command": command,
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.output}")
    for measurement in result["measurements"]:
        print(
            "status baseline: "
            f"works={measurement['work_items']} "
            f"elapsed_ms={measurement['elapsed_ms']:.3f} "
            f"prepared={measurement['statements_prepared']} "
            f"rows={measurement['rows_returned']} "
            f"text_bytes={measurement['text_bytes_read']}"
        )
    print("No performance improvement is claimed; this is a current-state baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
