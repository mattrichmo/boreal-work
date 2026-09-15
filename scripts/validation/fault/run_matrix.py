#!/usr/bin/env python3
"""Run the bounded, deterministic P5-02 fault/clock/reorder matrix."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
REPORT = ROOT / "project" / "build-plan" / "baseline" / "P5-02-FAULT-CLOCK-REORDER.md"


CELLS = [
    {
        "id": "lease.default_two_hour_budget",
        "family": "lease_hard_deadline",
        "kind": "rust_test",
        "package": "boreal-application",
        "test": "runtime::tests::default_deadlines_keep_two_hour_budget_immutable",
        "args": ["--lib"],
        "evidence": "AttemptPolicy default hard deadline is immutable and separate from the lease.",
    },
    {
        "id": "lease.hard_deadline_blocks_heartbeat",
        "family": "lease_hard_deadline",
        "kind": "rust_test",
        "package": "boreal-application",
        "test": "runtime::tests::hard_deadline_wins_over_lease_and_blocks_heartbeat",
        "args": ["--lib"],
        "evidence": "Controlled clock proves hard deadline wins and heartbeat is rejected.",
    },
    {
        "id": "lease.expiry_requires_fenced_stop",
        "family": "lease_hard_deadline",
        "kind": "rust_test",
        "package": "boreal-application",
        "test": "runtime::tests::expiry_requires_deadline_but_allows_fenced_stop",
        "args": ["--lib"],
        "evidence": "Expired attempts require explicit confirmation and retain fenced recovery.",
    },
    {
        "id": "fence.stale_revision_fence_owner",
        "family": "stale_fence",
        "kind": "rust_test",
        "package": "boreal-store",
        "test": "lifecycle_rejects_stale_revision_fence_and_wrong_owner_without_writes",
        "args": ["--test", "store_contracts"],
        "evidence": "Stale revision/fence and wrong-owner mutations fail without writes.",
    },
    {
        "id": "fence.stale_receipt_retained",
        "family": "stale_fence",
        "kind": "rust_test",
        "package": "boreal-store",
        "test": "receipt_subject_and_fence_failures_are_retained_as_historical_facts",
        "args": ["--test", "store_contracts"],
        "evidence": "Receipt subject/fence failure is retained as an immutable historical fact.",
    },
    {
        "id": "replay.operation_and_lifecycle",
        "family": "duplicate_replay",
        "kind": "rust_test",
        "package": "boreal-store",
        "test": "current_attempt_lifecycle_persists_each_mutation_and_replays_atomically",
        "args": ["--test", "store_contracts"],
        "evidence": "Duplicate operation identity replays the committed lifecycle result.",
    },
    {
        "id": "notifications.duplicate_revision_coalesced",
        "family": "duplicate_reorder_notifications",
        "kind": "rust_test",
        "package": "boreal-service",
        "test": "notifications::tests::duplicate_revision_notifications_are_coalesced",
        "args": ["--lib"],
        "evidence": "Duplicate revision publication is coalesced and subjects are unioned.",
    },
    {
        "id": "notifications.old_cursor_resnapshot",
        "family": "duplicate_reorder_notifications",
        "kind": "rust_test",
        "package": "boreal-service",
        "test": "notifications::tests::an_old_cursor_requests_one_resnapshot_and_then_stays_current",
        "args": ["--lib"],
        "evidence": "A cursor that fell behind the bounded log requests one resnapshot.",
    },
    {
        "id": "notifications.out_of_order_rejected",
        "family": "duplicate_reorder_notifications",
        "kind": "rust_fixture",
        "evidence": "Out-of-order revision publication is rejected by the public service API.",
    },
    {
        "id": "restart.operation_recovery",
        "family": "restart_recovery",
        "kind": "rust_test",
        "package": "boreal-service",
        "test": "recovery::tests::restart_preserves_queued_and_fences_in_flight_work_for_readback",
        "args": ["--lib"],
        "evidence": "Restart marks in-flight operations unknown and preserves queued work.",
    },
    {
        "id": "restart.host_rebind_recovery",
        "family": "restart_recovery",
        "kind": "rust_test",
        "package": "boreal-service",
        "test": "host::tests::restart_rebinds_endpoint_and_reports_in_flight_recovery",
        "args": ["--lib"],
        "evidence": "Service host rebinds its endpoint and reports in-flight recovery.",
    },
    {
        "id": "bounded.guided_flow_recovery",
        "family": "bounded_fault_outcomes",
        "kind": "rust_test",
        "package": "boreal-application",
        "test": "p2_guided_flow_claims_three_harnesses_and_fences_recovery",
        "args": ["--test", "p2_guided_flow"],
        "evidence": "Bounded three-harness flow records expiry, fenced replacement, and service recovery.",
    },
]


def digest(path: Path) -> str:
    h = hashlib.sha256()
    for item in sorted(path.rglob("*")):
        relative = item.relative_to(path)
        generated = "target" in relative.parts or ".git" in relative.parts
        generated = generated or "results" in relative.parts
        generated = generated or item.name == "P5-02-FAULT-CLOCK-REORDER.md"
        if item.is_file() and not generated:
            h.update(str(relative).encode())
            h.update(item.read_bytes())
    return "sha256:" + h.hexdigest()


def run_rust(cell: dict) -> dict:
    command = ["cargo", "test", "--locked", "--offline", "-p", cell["package"], *cell["args"], cell["test"]]
    # Cargo's `--` is not needed for a named test filter; keep the command
    # entirely stable so the result can be compared across repeated runs.
    started = datetime.now(timezone.utc).isoformat()
    proc = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=180)
    output = (proc.stdout + proc.stderr).strip()
    return {
        **cell,
        "command": command,
        "started_at": started,
        "exit_code": proc.returncode,
        "status": "pass" if proc.returncode == 0 else "fail",
        "output_tail": output[-1600:],
    }


def run_fixture(cell: dict) -> dict:
    command = [
        "cargo", "run", "--locked", "--offline", "--manifest-path",
        str(HERE / "notification-fixture" / "Cargo.toml"),
    ]
    proc = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=180)
    output = (proc.stdout + proc.stderr).strip()
    return {
        **cell,
        "command": command,
        "status": "pass" if proc.returncode == 0 else "fail",
        "exit_code": proc.returncode,
        "output_tail": output[-1600:],
    }


def report(data: dict) -> str:
    rows = []
    for c in data["cells"]:
        rows.append(f"| `{c['id']}` | {c['family']} | {c['status']} | `{c['kind']}` | {c['evidence']} |")
    gaps = "\n".join(f"- {gap}" for gap in data["gaps"])
    return f"""# P5-02 fault/clock/reorder evidence

Status: **early matrix passed** ({data['pass_count']}/{data['cell_count']} cells); this is not a release gate.

Run identity: `{data['run_id']}`
Workspace: `{data['workspace_digest']}`
Tool command profile: `cargo test --locked --offline`, named tests, sequential execution.

## Cells

| Cell | Family | Result | Harness | Evidence |
| --- | --- | --- | --- | --- |
{chr(10).join(rows)}

## Explicit gaps

{gaps}

The matrix is deterministic in fixture inputs and test selection. Wall-clock
timestamps in the JSON are provenance only. A pass demonstrates the named
contract under the current source/dependency identity; it does not establish
fault injection, OS/process crash recovery, clock skew, notification transport
reordering, concurrency budgets, or complete P5 acceptance.
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, default=REPORT)
    parser.add_argument("--results", type=Path, default=RESULTS / "latest.json")
    args = parser.parse_args()
    cells = []
    for cell in CELLS:
        try:
            cells.append(run_fixture(cell) if cell["kind"] == "rust_fixture" else run_rust(cell))
        except (subprocess.TimeoutExpired, OSError) as exc:
            cells.append({**cell, "status": "fail", "exit_code": None, "error": str(exc)})
    data = {
        "schema": "boreal.p5-02-fault-matrix.v1",
        "run_id": "p5-02-early-" + digest(HERE / "notification-fixture")[:16].removeprefix("sha256:"),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "workspace_digest": digest(ROOT),
        "cell_count": len(cells),
        "pass_count": sum(c["status"] == "pass" for c in cells),
        "fail_count": sum(c["status"] == "fail" for c in cells),
        "cells": cells,
        "gaps": [
            "No production fault injector or virtual-clock runner exists; exact expiry is covered only through controlled-clock Rust tests.",
            "The reorder cell validates the public NotificationHub contract in a local fixture, not a real delayed/reordered socket notification stream.",
            "No OS/process crash is injected during a committed write; host/recovery behavior is exercised by deterministic service tests only.",
            "No multi-process clock-skew, network/socket drop, queue saturation, or randomized/property-based fault matrix is covered.",
            "Full P5 independent review, release/cutover evidence, and broader P3/P4 acceptance remain outside this early harness.",
        ],
    }
    args.results.parent.mkdir(parents=True, exist_ok=True)
    args.results.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    args.report.write_text(report(data))
    print(json.dumps({k: data[k] for k in ("run_id", "cell_count", "pass_count", "fail_count")}, sort_keys=True))
    return 0 if data["fail_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
