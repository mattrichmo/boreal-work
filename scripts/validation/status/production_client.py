#!/usr/bin/env python3
"""Exercise V11 scale reachability through the real production service client.

The fixture is seeded once before service election, then every acceptance read
uses separate ``bwrk`` client processes over the Unix socket. The elected
service reports opt-in store-boundary query metrics for each status request;
this is boundary evidence, not a claim that ordinary clients expose adapter
internals.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
# These are service-boundary query-count ceilings, not row/payload ceilings.
# The canonical status projection currently reads the full work graph, so its
# row and text counters intentionally remain observable rather than being
# mistaken for bounded database work.
MAX_PREPARED_STATEMENTS = 16
MAX_BATCH_CALLS = 4


def parse_envelope(completed: subprocess.CompletedProcess[str]) -> dict:
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(
            f"bwrk returned no JSON envelope (exit={completed.returncode}): "
            f"stdout={completed.stdout!r} stderr={completed.stderr!r}"
        )
    try:
        value = json.loads(lines[-1])
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"bwrk returned invalid JSON (exit={completed.returncode}): "
            f"stdout={completed.stdout!r} stderr={completed.stderr!r}"
        ) from error
    if not isinstance(value, dict):
        raise RuntimeError(f"bwrk envelope is not an object: {value!r}")
    return value


def invoke(
    binary: Path,
    args: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout: float = 60.0,
) -> dict:
    completed = subprocess.run(
        [str(binary), *args],
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    return {
        "exit_code": completed.returncode,
        "envelope": parse_envelope(completed),
        "stderr": completed.stderr,
    }


def service_client(
    binary: Path,
    socket_path: Path,
    project: str,
    args: list[str],
    *,
    cwd: Path,
    timeout: float = 60.0,
) -> dict:
    if args[:1] == ["status"]:
        command = [
            args[0],
            project,
            *args[1:],
            "--actor",
            "v11-agent",
            "--session",
            "session-v11-agent",
        ]
    elif args[:2] == ["work", "show"]:
        command = [args[0], args[1], *args[2:], "--project", project]
    else:
        raise ValueError(f"unsupported production-client command shape: {args!r}")
    return invoke(
        binary,
        [*command, "--socket", str(socket_path), "--json"],
        cwd=cwd,
        timeout=timeout,
    )


def seed_fixture(binary: Path, database: Path, root: Path, count: int) -> dict:
    init = invoke(
        binary,
        [
            "init",
            "--project",
            "v11-project",
            "--project-root",
            str(root),
            "--actor",
            "v11-validator",
            "--db",
            str(database),
            "--operation-id",
            "op_v11_init",
            "--json",
        ],
        cwd=root,
    )
    if init["exit_code"] != 0 or init["envelope"].get("error"):
        raise RuntimeError(f"project init failed: {init}")

    # Keep one production-created canonical row inside the scale fixture. Its
    # cursor and immutable pinned requirements provide the healthy decision
    # case; the other rows exercise missing-pin quarantine at the same scale.
    init_revision = init["envelope"].get("revision")
    if not isinstance(init_revision, int):
        raise RuntimeError(f"project init omitted its revision: {init}")
    operator_session = invoke(
        binary,
        [
            "session",
            "start",
            "--project",
            "v11-project",
            "--session",
            "session-v11-operator",
            "--harness",
            "v11-validator",
            "--actor",
            "v11-validator",
            "--db",
            str(database),
            "--json",
        ],
        cwd=root,
    )
    if operator_session["exit_code"] != 0 or operator_session["envelope"].get("error"):
        raise RuntimeError(f"operator session creation failed: {operator_session}")
    operator_revision = operator_session["envelope"].get("revision")
    if not isinstance(operator_revision, int):
        raise RuntimeError(f"operator session omitted its revision: {operator_session}")
    healthy_work = invoke(
        binary,
        [
            "work",
            "create",
            "--project",
            "v11-project",
            "work-1001",
            "V11 scale item 1001",
            "--actor",
            "v11-validator",
            "--session",
            "session-v11-operator",
            "--expected-revision",
            str(operator_revision),
            "--db",
            str(database),
            "--json",
        ],
        cwd=root,
    )
    if healthy_work["exit_code"] != 0 or healthy_work["envelope"].get("error"):
        raise RuntimeError(f"canonical healthy work creation failed: {healthy_work}")
    work_revision = healthy_work["envelope"].get("revision")
    if not isinstance(work_revision, int):
        raise RuntimeError(f"canonical healthy work omitted its revision: {healthy_work}")

    # Scale setup is deliberately outside the acceptance boundary. It writes
    # through Python's SQLite binding to the initialized schema and leaves
    # target reads to the elected production service. This avoids 1,100
    # process launches while retaining a fully canonical healthy row.
    try:
        with sqlite3.connect(database) as connection:
            connection.execute("PRAGMA foreign_keys = ON")
            for index in range(1, count + 1):
                if index == 1001:
                    continue
                connection.execute(
                    "INSERT INTO work_item (work_id, project_id, kind, parent_id, lifecycle, "
                    "dispatch_policy, priority, acceptance_profile_id, acceptance_profile_version, "
                    "title, description, created_at, updated_at) "
                    "VALUES (?, 'v11-project', 'task', NULL, 'open', 'automatic', ?, "
                    "'focused', 1, ?, 'V11 production-client fixture', 'unix-ms:1', 'unix-ms:1')",
                    (f"work-{index:04d}", index % 256, f"V11 scale item {index}"),
                )
            connection.execute(
                "UPDATE project SET project_revision = project_revision + ?, "
                "updated_at = 'unix-ms:1' WHERE project_id = 'v11-project'",
                (count - 1,),
            )
    except sqlite3.Error as error:
        raise RuntimeError(f"scale fixture seed failed: {error}") from error

    enrollment = invoke(
        binary,
        [
            "auth",
            "key",
            "--project",
            "v11-project",
            "--actor",
            "v11-agent",
            "--actor-role",
            "agent",
            "--db",
            str(database),
            "--json",
        ],
        cwd=root,
    )
    if enrollment["exit_code"] != 0 or enrollment["envelope"].get("error"):
        raise RuntimeError(f"agent enrollment creation failed: {enrollment}")
    enrollment_path = (enrollment["envelope"].get("data") or {}).get("enrollment_path")
    if not isinstance(enrollment_path, str):
        raise RuntimeError(f"agent enrollment omitted its path: {enrollment}")

    grant = invoke(
        binary,
        [
            "auth",
            "grant",
            "--project",
            "v11-project",
            "--actor",
            "v11-validator",
            "--input",
            enrollment_path,
            "--reason",
            "V11 healthy scale-row probe",
            "--expected-revision",
            str(work_revision + count - 1),
            "--yes",
            "--db",
            str(database),
            "--json",
        ],
        cwd=root,
    )
    if grant["exit_code"] != 0 or grant["envelope"].get("error"):
        raise RuntimeError(f"agent principal grant failed: {grant}")

    session = invoke(
        binary,
        [
            "session",
            "start",
            "--project",
            "v11-project",
            "--session",
            "session-v11-agent",
            "--harness",
            "v11-validator",
            "--actor",
            "v11-agent",
            "--db",
            str(database),
            "--json",
        ],
        cwd=root,
    )
    if session["exit_code"] != 0 or session["envelope"].get("error"):
        raise RuntimeError(f"agent session creation failed: {session}")
    return {
        "method": "bwrk canonical work create plus Python SQLite scale inserts",
        "schema": "production schema via bwrk initialization",
        "work_items": count,
        "healthy_work_id": "work-1001",
        "healthy_work_created_by": "bwrk work create",
        "action_actor": "v11-agent",
        "action_session": "session-v11-agent",
        "ordered_ids": "work-0001..work-%04d" % count,
        "production_read_boundary": "not used for setup; service boundary begins after election",
    }


def wait_for_socket(socket_path: Path, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=1)
            raise RuntimeError(
                f"service exited before readiness: code={process.returncode} "
                f"stdout={stdout!r} stderr={stderr!r}"
            )
        if socket_path.exists():
            return
        time.sleep(0.01)
    raise RuntimeError(f"service socket did not appear: {socket_path}")


def wait_ready(binary: Path, socket_path: Path, root: Path) -> None:
    deadline = time.monotonic() + 10.0
    last: object = None
    while time.monotonic() < deadline:
        try:
            response = service_client(
                binary,
                socket_path,
                "v11-project",
                ["status", "--limit", "1", "--offset", "0"],
                cwd=root,
            )
            if response["envelope"].get("error") is None:
                return
            last = response
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
            last = str(error)
        time.sleep(0.02)
    raise RuntimeError(f"service status readiness failed: {last!r}")


def paged_status(
    binary: Path,
    socket_path: Path,
    root: Path,
    offset: int,
    expected_work_id: str,
) -> dict:
    started = time.perf_counter()
    response = service_client(
        binary,
        socket_path,
        "v11-project",
        ["status", "--limit", "1", "--offset", str(offset)],
        cwd=root,
        timeout=120.0,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    envelope = response["envelope"]
    data = envelope.get("data") or {}
    items = data.get("items") or []
    item = items[0] if len(items) == 1 else {}
    actual = item.get("work_id")
    row_diagnostics = [
        diagnostic
        for diagnostic in (data.get("diagnostics") or [])
        if diagnostic.get("work_id") == expected_work_id
    ]
    action_context = item.get("action_context") or {}
    metrics = data.get("service_query_metrics") or {}
    queries = metrics.get("statements_prepared", 0)
    batches = metrics.get("batch_calls", 0)
    query_budget = {
        "max_statements_prepared": MAX_PREPARED_STATEMENTS,
        "max_batch_calls": MAX_BATCH_CALLS,
        "within_budget": (
            isinstance(queries, int)
            and isinstance(batches, int)
            and queries > 0
            and batches > 0
            and queries <= MAX_PREPARED_STATEMENTS
            and batches <= MAX_BATCH_CALLS
        ),
    }
    return {
        "offset": offset,
        "limit": data.get("limit"),
        "total": data.get("total"),
        "has_more": data.get("has_more"),
        "returned_work_id": actual,
        "expected_work_id": expected_work_id,
        "exact_ordinal_reached": actual == expected_work_id,
        "display_status": item.get("display_status"),
        "claimable_for_actor": item.get("claimable_for_actor"),
        "action_context": action_context,
        "row_diagnostics": row_diagnostics,
        "elapsed_ms": round(elapsed_ms, 3),
        "service_query_metrics": metrics,
        "service_sqlite_prepare_count": queries,
        "query_budget": query_budget,
        "transport_outcome": envelope.get("outcome"),
        "error": envelope.get("error"),
        "production_boundary": "bwrk status client -> Unix socket -> elected bwrk service -> SqliteStore",
    }


def stop_service(process: subprocess.Popen[str], socket_path: Path) -> dict:
    if process.poll() is None:
        process.send_signal(signal.SIGTERM)
    try:
        stdout, stderr = process.communicate(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate(timeout=5)
        return {
            "status": "fail",
            "reason": "service did not exit after SIGTERM; forced kill used for cleanup",
            "exit_code": process.returncode,
            "socket_removed": not socket_path.exists(),
            "stdout_tail": stdout[-1000:],
            "stderr_tail": stderr[-1000:],
        }
    return {
        "status": "pass"
        if process.returncode == 0 and not socket_path.exists()
        else "fail",
        "signal": "SIGTERM",
        "exit_code": process.returncode,
        "socket_removed": not socket_path.exists(),
        "stdout_tail": stdout[-1000:],
        "stderr_tail": stderr[-1000:],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=ROOT / "target" / "debug" / "bwrk")
    parser.add_argument("--work-items", type=int, default=1101)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent / "results" / "production-client.latest.json",
    )
    args = parser.parse_args()
    if args.work_items < 1001:
        parser.error("--work-items must be at least 1001")
    binary = args.bin.resolve()
    if not binary.exists():
        parser.error(f"binary does not exist: {binary}")

    with tempfile.TemporaryDirectory(prefix="boreal-v11-production-client-") as directory:
        root = Path(directory)
        database = root / ".boreal" / "boreal.sqlite"
        socket_path = root / "service.sock"
        fixture = seed_fixture(binary, database, root, args.work_items)
        service_env = os.environ.copy()
        service_env["BOREAL_QUERY_METRICS"] = "1"
        service = subprocess.Popen(
            [
                str(binary),
                "service",
                "run",
                "--db",
                str(database),
                "--socket",
                str(socket_path),
                "--json",
            ],
            cwd=root,
            env=service_env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            wait_for_socket(socket_path, service)
            wait_ready(binary, socket_path, root)
            page_101 = paged_status(
                binary,
                socket_path,
                root,
                100,
                "work-0101",
            )
            page_1001 = paged_status(
                binary,
                socket_path,
                root,
                1000,
                "work-1001",
            )
            # Exact item proof must stay on the elected service while it owns
            # the database; do not fall back to a direct read in this client.
            exact_route = service_client(
                binary,
                socket_path,
                "v11-project",
                ["work", "show", "work-1001"],
                cwd=root,
            )
            exact_route_error = exact_route["envelope"].get("error") or {}
            exact_route_data = exact_route["envelope"].get("data") or {}
            exact_lookup = exact_route_data.get("work_id") == "work-1001"
            exact_route_result = {
                "status": (
                    "available"
                    if not exact_route_error and exact_lookup
                    else "unexpected"
                ),
                "expected_work_id": "work-1001",
                "returned_work_id": exact_route_data.get("work_id"),
                "exact_lookup_assertion": exact_lookup,
                "error": exact_route["envelope"].get("error"),
                "data": exact_route_data,
                "reason": (
                    "work show returned a service response"
                    if not exact_route_error and exact_lookup
                    else "work show returned an unexpected service error"
                ),
                "request_shape": "bwrk work show work-1001 --project v11-project",
            }
        finally:
            stop = stop_service(service, socket_path)

    healthy_scale_row = {
        "work_id": page_1001["returned_work_id"],
        "ready": page_1001["display_status"] == "ready",
        "claimable": page_1001["claimable_for_actor"] is True,
        "action_context_available": page_1001["action_context"].get("state") == "available",
        "integrity_valid": page_1001["action_context"].get("integrity") == "valid",
        "missing_facts_empty": page_1001["action_context"].get("missing_facts") == [],
        "diagnostics_empty": page_1001["row_diagnostics"] == [],
    }
    missing_pin_diagnostic = any(
        diagnostic.get("code") == "decision_facts_corrupt"
        and "missing pinned requirement revision" in diagnostic.get("detail", "")
        for diagnostic in page_101["row_diagnostics"]
    )
    missing_pin_fail_closed = {
        "work_id": page_101["returned_work_id"],
        "blocked": page_101["display_status"] == "blocked",
        "nonclaimable": page_101["claimable_for_actor"] is False,
        "integrity_quarantined": page_101["action_context"].get("integrity") == "quarantined",
        "unavailable_facts_reported": "canonical_decision_facts_unavailable"
        in page_101["action_context"].get("missing_facts", []),
        "missing_pin_diagnostic": missing_pin_diagnostic,
    }
    complete = (
        page_101["exact_ordinal_reached"]
        and page_1001["exact_ordinal_reached"]
        and page_101["query_budget"]["within_budget"]
        and page_1001["query_budget"]["within_budget"]
        and all(
            healthy_scale_row[key]
            for key in (
                "ready",
                "claimable",
                "action_context_available",
                "integrity_valid",
                "missing_facts_empty",
                "diagnostics_empty",
            )
        )
        and all(
            missing_pin_fail_closed[key]
            for key in (
                "blocked",
                "nonclaimable",
                "integrity_quarantined",
                "unavailable_facts_reported",
                "missing_pin_diagnostic",
            )
        )
        and exact_route_result["status"] == "available"
        and exact_route_result["exact_lookup_assertion"]
        and stop["status"] == "pass"
    )

    result = {
        "result_version": "boreal.forensic-v11-production-client/1",
        "generated_at_unix_ms": int(time.time() * 1000),
        "scenario": "V11",
        "binary": str(binary),
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "fixture": fixture,
        "service_query_metrics": {
            "status": "available",
            "meaning": "opt-in counters emitted by SqliteStore for the elected service status request",
        },
        "pages": {
            "ordinal_101": page_101,
            "ordinal_1001": page_1001,
        },
        "exact_work_route": exact_route_result,
        "healthy_scale_row": healthy_scale_row,
        "missing_pin_fail_closed": missing_pin_fail_closed,
        "stop_proof": stop,
        "complete_gate": {
            "status": "pass" if complete else "incomplete",
            "reason": (
                "all ordinal, healthy-row, fail-closed, query-budget, exact-lookup, "
                "and service-stop assertions passed"
                if complete
                else "one or more ordinal, healthy-row, fail-closed, query-budget, "
                "exact-lookup, or service-stop assertions failed"
            ),
        },
        "limitations": [
            "The healthy row is created by bwrk; sibling scale rows are inserted directly before service election. Target reads are all through the production bwrk service client.",
            "Service query metrics count store-boundary prepared statements, rows, and text bytes for each status request; they do not replace query-plan or wall-clock analysis.",
            "The public work show route is service-routed, so exact item proof remains inside the elected service boundary.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "page_101": page_101["exact_ordinal_reached"],
                "page_1001": page_1001["exact_ordinal_reached"],
                "healthy_row_claimable": page_1001["claimable_for_actor"] is True,
                "missing_pin_failed_closed": page_101["claimable_for_actor"] is False,
                "prepare_counts": [
                    page_101["service_sqlite_prepare_count"],
                    page_1001["service_sqlite_prepare_count"],
                ],
                "complete_gate": result["complete_gate"]["status"],
            },
            sort_keys=True,
        )
    )
    return 0 if result["complete_gate"]["status"] == "pass" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
