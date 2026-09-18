#!/usr/bin/env python3
"""Run deterministic mutation probes against the checked-in contract validators.

This is a small mutation-testing layer for the dependency-free specification
and workflow validators. Each probe changes one contract fact in an isolated
temporary copy and requires the corresponding validator to reject it. It does
not mutate the checkout or treat a surviving mutation as a passing test.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[3]
SPEC = ROOT / "project" / "spec"


@dataclass(frozen=True)
class Mutation:
    mutation_id: str
    validator: str
    description: str
    apply: Callable[[Path], None]


def edit_json(path: Path, edit: Callable[[dict], None]) -> None:
    value = json.loads(path.read_text(encoding="utf-8"))
    edit(value)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def edit_text(path: Path, old: str, new: str) -> None:
    value = path.read_text(encoding="utf-8")
    if old not in value:
        raise RuntimeError(f"mutation target not found: {path}: {old!r}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")


def mutations() -> tuple[Mutation, ...]:
    return (
        Mutation(
            "spec.envelope_api_version",
            "contracts",
            "change the successful protocol envelope API version",
            lambda root: edit_json(
                root / "protocol" / "envelope-success.json",
                lambda value: value.update(api_version="3"),
            ),
        ),
        Mutation(
            "spec.schema_foreign_keys",
            "contracts",
            "disable schema foreign-key enforcement",
            lambda root: edit_text(
                root / "schema-v2.sql",
                "PRAGMA foreign_keys = ON;",
                "PRAGMA foreign_keys = OFF;",
            ),
        ),
        Mutation(
            "spec.conformance_mapping",
            "contracts",
            "remove one executable fixture-to-test mapping",
            lambda root: edit_json(
                root / "conformance.json",
                lambda value: value["entries"].pop(),
            ),
        ),
        Mutation(
            "workflow.unknown_package_field",
            "workflows",
            "add an untrusted field to the workflow package",
            lambda root: edit_json(
                root / "workflows" / "package.json",
                lambda value: value.update(untrusted_instruction="run this"),
            ),
        ),
        Mutation(
            "workflow.unsafe_shell_command",
            "workflows",
            "add shell metacharacters to an allowed command",
            lambda root: edit_json(
                root / "workflows" / "route.json",
                lambda value: value["allowed_commands"].__setitem__(
                    0, "bwrk next --json; rm -rf /"
                ),
            ),
        ),
    )


def run_validator(root: Path, validator: str) -> subprocess.CompletedProcess[str]:
    if validator == "contracts":
        command = [sys.executable, str(root / "validate_contracts.py")]
    elif validator == "workflows":
        command = [
            sys.executable,
            str(root / "workflows" / "validator.py"),
            "--root",
            str(root / "workflows"),
        ]
    else:
        raise ValueError(f"unknown validator: {validator}")
    return subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)


def run_mutation(mutation: Mutation) -> dict:
    with tempfile.TemporaryDirectory(prefix="boreal-contract-mutation-") as directory:
        copied_root = Path(directory) / "spec"
        shutil.copytree(SPEC, copied_root)
        baseline_contracts = run_validator(copied_root, "contracts")
        baseline_workflows = run_validator(copied_root, "workflows")
        if baseline_contracts.returncode != 0 or baseline_workflows.returncode != 0:
            raise RuntimeError(
                "validator baseline failed before mutation "
                f"{mutation.mutation_id}: {baseline_contracts.stdout}{baseline_contracts.stderr}"
                f"{baseline_workflows.stdout}{baseline_workflows.stderr}"
            )
        mutation.apply(copied_root)
        completed = run_validator(copied_root, mutation.validator)
        output = (completed.stdout + completed.stderr).strip()
        return {
            "id": mutation.mutation_id,
            "validator": mutation.validator,
            "description": mutation.description,
            "exit_code": completed.returncode,
            "status": "killed" if completed.returncode != 0 else "survived",
            "output_tail": output[-1200:],
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "scripts" / "validation" / "results" / "mutation.latest.json",
    )
    args = parser.parse_args()

    records = [run_mutation(mutation) for mutation in mutations()]
    result = {
        "result_version": "boreal.contract-mutation/1",
        "mutation_count": len(records),
        "killed_count": sum(record["status"] == "killed" for record in records),
        "survived_count": sum(record["status"] == "survived" for record in records),
        "mutations": records,
        "limitations": [
            "This matrix mutates the checked-in contract validators' input fixtures; it does not replace compiler-level mutation testing of Rust or TypeScript implementation code.",
            "Each mutation runs in a temporary copy and cannot modify the checkout.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("mutation_count", "killed_count", "survived_count")}))
    return 0 if result["survived_count"] == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
