#!/usr/bin/env python3
"""Run repeated process-level lifecycle races and retain soak evidence."""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=ROOT / "target" / "debug" / "bwrk")
    parser.add_argument("--rounds", type=int, default=20)
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "scripts" / "validation" / "results" / "soak.latest.json",
    )
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error("--rounds must be positive")
    if args.workers < 2:
        parser.error("--workers must be at least 2")
    if not args.bin.exists():
        parser.error(f"binary does not exist: {args.bin}")

    started = time.perf_counter()
    rounds: list[dict] = []
    for index in range(1, args.rounds + 1):
        command = [
            sys.executable,
            "scripts/validation/process/claim_race.py",
            "--bin",
            str(args.bin.resolve()),
            "--workers",
            str(args.workers),
        ]
        round_started = time.perf_counter()
        try:
            completed = subprocess.run(
                command,
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
                timeout=120,
            )
            output = (completed.stdout + completed.stderr).strip()
            rounds.append(
                {
                    "round": index,
                    "status": "pass" if completed.returncode == 0 else "fail",
                    "exit_code": completed.returncode,
                    "duration_ms": round((time.perf_counter() - round_started) * 1000, 3),
                    "command": command,
                    "output_tail": output[-1200:],
                }
            )
        except subprocess.TimeoutExpired as error:
            rounds.append(
                {
                    "round": index,
                    "status": "fail",
                    "exit_code": 124,
                    "duration_ms": round((time.perf_counter() - round_started) * 1000, 3),
                    "command": command,
                    "output_tail": f"timed out: {error}",
                }
            )

    result = {
        "result_version": "boreal.process-soak/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "binary": str(args.bin.resolve()),
        "rounds_requested": args.rounds,
        "workers": args.workers,
        "rounds_completed": len(rounds),
        "pass_count": sum(item["status"] == "pass" for item in rounds),
        "fail_count": sum(item["status"] == "fail" for item in rounds),
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 3),
        "rounds": rounds,
        "coverage": [
            "Each round races process-level claims, opposite dependency edges, and idempotent operation replay.",
            "The process race uses an isolated temporary SQLite project per round.",
        ],
        "limitations": [
            "This is a bounded process soak, not an indefinite endurance run or a multi-host test.",
            "It does not claim power-loss durability or replace the deterministic fault matrix.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "rounds_requested": result["rounds_requested"],
                "rounds_completed": result["rounds_completed"],
                "pass_count": result["pass_count"],
                "fail_count": result["fail_count"],
                "elapsed_ms": result["elapsed_ms"],
            }
        )
    )
    return 0 if result["fail_count"] == 0 and result["rounds_completed"] == args.rounds else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
