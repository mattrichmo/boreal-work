#!/usr/bin/env python3
"""Verify that every lifecycle fixture ID is mapped to a live Rust test."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC_ROOT = ROOT / "project/spec"
MATRIX_PATH = SPEC_ROOT / "conformance.json"


def fixture_ids() -> set[str]:
    transition = (SPEC_ROOT / "transition-table.md").read_text(encoding="utf-8")
    ids = set(re.findall(r"\| ((?:T|I)\d+) \|", transition))
    clock = json.loads((SPEC_ROOT / "clock-and-attempt.json").read_text(encoding="utf-8"))
    dependency = json.loads((SPEC_ROOT / "dependency.json").read_text(encoding="utf-8"))
    ids.update(case["id"] for case in clock["cases"])
    ids.update(case["id"] for case in dependency["cases"])
    return ids


def load_matrix() -> list[dict[str, str]]:
    matrix = json.loads(MATRIX_PATH.read_text(encoding="utf-8"))
    if matrix.get("schema_version") != "boreal.conformance.v1":
        raise ValueError("conformance matrix has an unsupported schema version")
    entries = matrix.get("entries")
    if not isinstance(entries, list):
        raise ValueError("conformance matrix entries must be a list")
    return entries


def test_list(*, online: bool) -> str:
    command = ["cargo", "test", "--workspace", "--locked"]
    if not online:
        command.append("--offline")
    command.extend(["--", "--list"])
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    output = completed.stdout + completed.stderr
    if completed.returncode != 0:
        raise RuntimeError(f"cargo test --list failed with exit {completed.returncode}:\n{output[-4000:]}")
    return output


def run_selectors(selectors: list[str], *, online: bool) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for selector in selectors:
        command = ["cargo", "test", "--workspace", "--locked"]
        if not online:
            command.append("--offline")
        command.extend(["--", selector])
        completed = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=180,
            check=False,
        )
        results.append(
            {
                "selector": selector,
                "exit_code": completed.returncode,
                "output_tail": (completed.stdout + completed.stderr)[-1200:],
            }
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--online", action="store_true", help="allow Cargo to resolve dependencies")
    parser.add_argument(
        "--run",
        action="store_true",
        help="execute each unique mapped selector; default only checks matrix traceability",
    )
    args = parser.parse_args()

    expected = fixture_ids()
    entries = load_matrix()
    mapped = [entry.get("id") for entry in entries]
    mapped_set = set(mapped)
    duplicate_ids = sorted(identifier for identifier in mapped_set if mapped.count(identifier) > 1)
    missing = sorted(expected - mapped_set)
    extra = sorted(mapped_set - expected)
    malformed = [entry for entry in entries if not entry.get("id") or not entry.get("selector")]
    if duplicate_ids or missing or extra or malformed:
        raise SystemExit(
            json.dumps(
                {
                    "duplicate_ids": duplicate_ids,
                    "missing_ids": missing,
                    "extra_ids": extra,
                    "malformed_entries": malformed,
                },
                indent=2,
            )
        )

    listed = test_list(online=args.online)
    absent_selectors = sorted({entry["selector"] for entry in entries if entry["selector"] not in listed})
    if absent_selectors:
        raise SystemExit(json.dumps({"absent_test_selectors": absent_selectors}, indent=2))

    run_results = run_selectors(
        sorted({entry["selector"] for entry in entries}),
        online=args.online,
    ) if args.run else []
    failed_runs = [result for result in run_results if result["exit_code"] != 0]
    if failed_runs:
        raise SystemExit(json.dumps({"failed_selector_runs": failed_runs}, indent=2))

    result = {
        "schema_version": "boreal.conformance.result.v1",
        "fixture_count": len(expected),
        "mapped_count": len(entries),
        "unique_test_selectors": len({entry["selector"] for entry in entries}),
        "selectors_executed": len(run_results),
        "status": "pass",
        "execution_note": "selectors are included in the workspace test set; cargo workspace execution is the behavior gate",
    }
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, json.JSONDecodeError, RuntimeError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
