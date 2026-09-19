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
import shutil
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
        command = [args[0], project, *args[1:]]
    elif args[:2] == ["work", "show"]:
        command = [args[0], args[1], project, *args[2:]]
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
            "v11-project",
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

    # Scale setup is deliberately outside the acceptance boundary.  It uses
    # the checked-in v2 schema after bwrk initializes the project and leaves
    # the target reads to the elected production service.  This avoids 1,101
    # process launches while retaining a schema-valid, reproducible fixture.
    sqlite = shutil.which("sqlite3")
    if sqlite is None:
        raise RuntimeError("sqlite3 CLI is required to seed the V11 scale fixture")
    rows = [
        "PRAGMA foreign_keys = ON;",
        "INSERT OR IGNORE INTO acceptance_profile "
        "(profile_id, version, policy_digest, definition_json, created_at) "
        "VALUES ('focused', 1, 'sha256:v11-validator', '{}', 'unix-ms:1');",
    ]
    for index in range(1, count + 1):
        work_id = f"work-{index:04d}"
        title = f"V11 scale item {index}"
        rows.append(
            "INSERT INTO work_item (work_id, project_id, kind, parent_id, lifecycle, "
            "dispatch_policy, priority, acceptance_profile_id, acceptance_profile_version, "
            "title, description, created_at, updated_at) VALUES "
            f"('{work_id}', 'v11-project', 'task', NULL, 'open', 'automatic', "
            f"{index % 256}, 'focused', 1, '{title}', 'V11 production-client fixture', "
            "'unix-ms:1', 'unix-ms:1');"
        )
    rows.append(
        "UPDATE project SET project_revision = project_revision + "
        f"{count}, updated_at = 'unix-ms:1' WHERE project_id = 'v11-project';"
    )
    sql = "\n".join(rows) + "\n"
    completed = subprocess.run(
        [sqlite, str(database)],
        input=sql,
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"scale fixture seed failed: {completed.stderr.strip()}")
    return {
        "method": "sqlite3 CLI after bwrk init",
        "schema": "project/spec/schema-v2.sql via bwrk initialization",
        "work_items": count,
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
    actual = items[0].get("work_id") if len(items) == 1 else None
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
        database = root / "boreal.sqlite"
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
                ["work", "show", "work-0101"],
                cwd=root,
            )
            exact_route_error = exact_route["envelope"].get("error") or {}
            exact_route_result = {
                "status": (
                    "available"
                    if not exact_route_error
                    else "unexpected"
                ),
                "error": exact_route["envelope"].get("error"),
                "data": exact_route["envelope"].get("data"),
                "reason": (
                    "work show returned a service response"
                    if not exact_route_error
                    else "work show returned an unexpected service error"
                ),
            }
        finally:
            stop = stop_service(service, socket_path)

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
        "stop_proof": stop,
        "complete_gate": {
            "status": "pass"
            if page_101["exact_ordinal_reached"]
            and page_1001["exact_ordinal_reached"]
            and page_101["query_budget"]["within_budget"]
            and page_1001["query_budget"]["within_budget"]
            and exact_route_result["status"] == "available"
            and stop["status"] == "pass"
            else "incomplete",
            "reason": (
                "ordinal reachability, service-side query evidence within the "
                "declared query-count budget, and public work show service "
                "routing are real"
                if exact_route_result["status"] == "available"
                else "ordinal reachability or public work show service evidence is incomplete"
            ),
        },
        "limitations": [
            "The scale fixture is schema-valid direct SQL setup before service election; target reads are all through the production bwrk service client.",
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
