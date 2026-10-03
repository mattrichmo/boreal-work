#!/usr/bin/env python3
"""Run a bounded read-only dispatch-admission smoke through the CLI service.

The smoke starts the CLI service with one dispatch worker and queue capacity
two, launches separate ``bwrk work show`` clients, and sends a status control
request after a dispatch-full response while normal clients are still active.
It records the CLI's actual error envelope and control timing/overlap.  The
optional fake-clock and SIGTERM observations are supplemental; this script is
not a V10 acceptance test or a scale/performance benchmark.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import platform
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SHIM_SOURCE = Path(__file__).with_name("fake_clock.c")
SMOKE_DISPATCH_WORKERS = 1
SMOKE_DISPATCH_CAPACITY = 2


def parse_envelope(completed: subprocess.CompletedProcess[str]) -> dict:
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(
            f"bwrk returned no JSON envelope (exit={completed.returncode}): "
            f"stdout={completed.stdout!r} stderr={completed.stderr!r}"
        )
    try:
        envelope = json.loads(lines[-1])
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"bwrk returned invalid JSON (exit={completed.returncode}): "
            f"stdout={completed.stdout!r} stderr={completed.stderr!r}"
        ) from error
    if not isinstance(envelope, dict):
        raise RuntimeError(f"bwrk envelope is not an object: {envelope!r}")
    return envelope


def invoke(
    binary: Path,
    args: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout: float = 30.0,
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
    envelope = parse_envelope(completed)
    return {
        "exit_code": completed.returncode,
        "envelope": envelope,
        "stderr": completed.stderr,
    }


def client(
    binary: Path,
    socket_path: Path,
    project: str,
    args: list[str],
    *,
    cwd: Path,
    timeout: float = 30.0,
) -> dict:
    if args[:1] == ["status"]:
        command = [args[0], project, *args[1:]]
    elif args[:2] in (["work", "create"], ["work", "claim"]):
        command = [args[0], args[1], project, *args[2:]]
    elif args[:2] == ["work", "show"]:
        # The service adapter's work-show route takes `--project` and a
        # single work identifier. Supplying two positional identifiers is
        # accepted by the direct command parser but dispatches the project ID
        # as the requested work ID over the service boundary.
        command = [args[0], args[1], *args[2:], "--project", project]
    else:
        raise ValueError(f"unsupported production-client command shape: {args!r}")
    return invoke(
        binary,
        [*command, "--socket", str(socket_path), "--json"],
        cwd=cwd,
        timeout=timeout,
    )


def wait_for_socket(socket_path: Path, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=1)
            raise RuntimeError(
                f"service exited before readiness on Unix socket {socket_path}: code={process.returncode} "
                f"stdout={stdout!r} stderr={stderr!r}"
            )
        if socket_path.exists():
            return
        time.sleep(0.01)
    raise RuntimeError(f"service socket did not appear: {socket_path}")


def compile_clock_shim(root: Path) -> tuple[Path | None, str | None]:
    if platform.system() != "Darwin":
        return None, "fake realtime clock interposition is implemented only for macOS"
    cc = os.environ.get("CC", "cc")
    output = root / "libboreal_fake_clock.dylib"
    completed = subprocess.run(
        [cc, "-dynamiclib", "-fPIC", "-O2", str(SHIM_SOURCE), "-o", str(output)],
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        return None, f"could not compile fake clock shim: {completed.stderr.strip()}"
    return output, None


def ready_status(
    binary: Path,
    socket_path: Path,
    project: str,
    root: Path,
) -> dict:
    deadline = time.monotonic() + 10.0
    last: dict | None = None
    while time.monotonic() < deadline:
        try:
            last = client(binary, socket_path, project, ["status"], cwd=root)
            if last["envelope"].get("error") is None:
                return last
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
            last = {"error": str(error)}
        time.sleep(0.02)
    raise RuntimeError(f"service did not answer status readiness: {last!r}")


def run_saturation(
    binary: Path,
    socket_path: Path,
    project: str,
    root: Path,
    count: int,
) -> dict:
    started = time.perf_counter()
    state_lock = threading.Lock()
    active_clients: dict[int, float] = {}
    completed_clients: list[dict] = []
    max_active_clients = 0

    def one(index: int) -> dict:
        nonlocal max_active_clients
        # Keep the saturated workload read-only. Work creation would require
        # optimistic revision/session tokens and would serialize on SQLite,
        # obscuring whether service admission itself applies backpressure.
        request_started = time.perf_counter()
        with state_lock:
            active_clients[index] = request_started
            max_active_clients = max(max_active_clients, len(active_clients))
        response = None
        try:
            response = client(
                binary,
                socket_path,
                project,
                ["work", "show", "dispatch-smoke-seed"],
                cwd=root,
            )
            return {
                "index": index,
                "started_at": request_started,
                "completed_at": time.perf_counter(),
                "response": response,
            }
        finally:
            request_completed = time.perf_counter()
            error = (response or {}).get("envelope", {}).get("error") or {}
            with state_lock:
                active_clients.pop(index, None)
                completed_clients.append(
                    {
                        "index": index,
                        "started_at": request_started,
                        "completed_at": request_completed,
                        "error_code": error.get("code"),
                        "error_message": error.get("message", ""),
                    }
                )

    max_clients = min(count, 64)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_clients) as pool:
        futures = [pool.submit(one, index) for index in range(count)]
        # Wait for an externally visible full-queue response before probing
        # control progress.  The deadline only bounds the harness wait; failure
        # to observe dispatch-full remains a smoke assertion failure.
        admission_deadline = time.perf_counter() + 5.0
        while time.perf_counter() < admission_deadline:
            with state_lock:
                full_seen = any(
                    "dispatch queue is full" in item["error_message"].lower()
                    for item in completed_clients
                )
                requests_active = bool(active_clients)
                requests_remain = len(completed_clients) < count
            if full_seen and requests_active:
                break
            if not requests_remain:
                break
            time.sleep(0.005)

        with state_lock:
            control_started = time.perf_counter()
            active_at_control_start = len(active_clients)
            full_responses_before_control = sum(
                "dispatch queue is full" in item["error_message"].lower()
                and item["completed_at"] <= control_started
                for item in completed_clients
            )
        control = client(
            binary,
            socket_path,
            project,
            ["status", "--limit", "1", "--offset", "0"],
            cwd=root,
            timeout=30.0,
        )
        with state_lock:
            control_completed = time.perf_counter()
            active_at_control_response = len(active_clients)
        results = [future.result() for future in futures]

    normal_finished = time.perf_counter()
    error_objects = [
        item["response"]["envelope"].get("error")
        for item in results
        if item["response"]["envelope"].get("error")
    ]
    dispatch_full_errors = [
        error
        for error in error_objects
        if "dispatch queue is full" in error.get("message", "").lower()
    ]
    grouped_dispatch_errors: dict[tuple[str | None, str], int] = {}
    for error in dispatch_full_errors:
        key = (error.get("code"), error.get("message", ""))
        grouped_dispatch_errors[key] = grouped_dispatch_errors.get(key, 0) + 1
    dispatch_error_details = [
        {"code": code, "message": message, "count": count}
        for (code, message), count in sorted(
            grouped_dispatch_errors.items(), key=lambda item: (item[0][0] or "", item[0][1])
        )
    ]
    overlapping_normal_clients = sum(
        item["started_at"] < control_completed
        and item["completed_at"] > control_started
        for item in results
    )
    control_error = control["envelope"].get("error")
    control_response_received = control["exit_code"] == 0 and control_error is None
    assertions = {
        "dispatch_full_response_observed_before_control": full_responses_before_control > 0,
        "normal_client_active_when_control_started": active_at_control_start > 0,
        "control_response_received": control_response_received,
        "normal_client_active_when_control_responded": active_at_control_response > 0,
        "control_overlapped_normal_client_interval": overlapping_normal_clients > 0,
    }
    assertions["passed"] = all(assertions.values())
    return {
        "normal_requests": count,
        "normal_client_concurrency_limit": max_clients,
        "normal_max_in_flight_client_processes": max_active_clients,
        "normal_elapsed_ms": round((normal_finished - started) * 1000.0, 3),
        "normal_outcomes": {
            outcome: sum(item["response"]["envelope"].get("outcome") == outcome for item in results)
            for outcome in ("changed", "unchanged", "rejected", "failed", "unknown")
        },
        "normal_error_codes": sorted(
            error["code"]
            for error in error_objects
            if error.get("code")
        ),
        "dispatch_full_responses": len(dispatch_full_errors),
        "dispatch_full_error_details": dispatch_error_details,
        "dispatch_full_responses_before_control": full_responses_before_control,
        "control": {
            "outcome": control["envelope"].get("outcome"),
            "exit_code": control["exit_code"],
            "error": control_error,
            "request_started_after_smoke_start_ms": round((control_started - started) * 1000.0, 3),
            "response_completed_after_smoke_start_ms": round((control_completed - started) * 1000.0, 3),
            "latency_ms": round((control_completed - control_started) * 1000.0, 3),
            "normal_clients_active_at_request_start": active_at_control_start,
            "normal_clients_active_at_response": active_at_control_response,
            "overlapping_normal_client_count": overlapping_normal_clients,
            "overlapped_normal_clients": overlapping_normal_clients > 0,
            "dispatch_full_responses_before_request": full_responses_before_control,
            "response_received": control_response_received,
        },
        "assertions": assertions,
        "production_boundary": "separate bwrk client processes over the Unix service socket",
        "saturation_scope": "read-only work-show clients; client overlap is recorded but service queue depth is not externally counted",
    }


def run_fake_clock_probe(
    binary: Path,
    socket_path: Path,
    project: str,
    root: Path,
    clock_file: Path,
    offset_supported: bool,
) -> dict:
    if not offset_supported:
        return {
            "status": "unavailable",
            "reason": "macOS fake clock shim was not available",
        }

    created = client(
        binary,
        socket_path,
        project,
        [
            "work",
            "create",
            "dispatch-smoke-clock-task",
            "Dispatch-admission smoke clock task",
            "--kind",
            "task",
            "--actor",
            "dispatch-smoke-validator",
            "--operation-id",
            "op_smoke_create_clock_task",
        ],
        cwd=root,
    )
    if created["envelope"].get("error"):
        raise RuntimeError(f"clock task creation failed: {created}")
    claimed = client(
        binary,
        socket_path,
        project,
        [
            "work",
            "claim",
            "dispatch-smoke-clock-task",
            "--actor",
            "dispatch-smoke-validator",
            "--harness",
            "dispatch-admission-smoke",
            "--session",
            "dispatch-smoke-clock-session",
            "--lease-ttl",
            "1s",
            "--time-limit",
            "30s",
            "--operation-id",
            "op_smoke_claim_clock_task",
        ],
        cwd=root,
    )
    if claimed["envelope"].get("error"):
        raise RuntimeError(f"clock task claim failed: {claimed}")
    before = client(
        binary,
        socket_path,
        project,
        ["status", "--limit", "1", "--offset", "0"],
        cwd=root,
    )
    clock_file.write_text("2000\n", encoding="ascii")
    after = client(
        binary,
        socket_path,
        project,
        ["status", "--limit", "1", "--offset", "0"],
        cwd=root,
    )
    clock_file.write_text("0\n", encoding="ascii")

    def find_clock_item(envelope: dict) -> dict | None:
        for item in (envelope.get("data") or {}).get("items", []):
            if item.get("work_id") == "dispatch-smoke-clock-task":
                return item
        return None

    before_item = find_clock_item(before["envelope"])
    after_item = find_clock_item(after["envelope"])
    return {
        "status": "pass"
        if before_item is not None
        and after_item is not None
        and before_item.get("display_status") in {"ready", "claimed"}
        and after_item.get("display_status") == "expired_review"
        else "fail",
        "offset_ms": 2000,
        "before_display_status": before_item.get("display_status") if before_item else None,
        "after_display_status": after_item.get("display_status") if after_item else None,
        "server_clock_boundary": "service process only; client wall clock was not interposed",
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
            "reason": "service did not exit after SIGTERM; forced kill used for harness cleanup",
            "exit_code": process.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "socket_removed": not socket_path.exists(),
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
    parser.add_argument("--normal-requests", type=int, default=256)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent / "results" / "dispatch-admission-smoke.latest.json",
    )
    args = parser.parse_args()
    if args.normal_requests < 32:
        parser.error("--normal-requests must be at least 32 to exercise the bounded queue")
    binary = args.bin.resolve()
    if not binary.exists():
        parser.error(f"binary does not exist: {binary}")

    with tempfile.TemporaryDirectory(prefix="boreal-dispatch-admission-smoke-") as directory:
        root = Path(directory)
        database = root / ".boreal" / "boreal.sqlite"
        socket_path = root / "service.sock"
        clock_file = root / "clock-offset-ms"
        clock_file.write_text("0\n", encoding="ascii")
        init = invoke(
            binary,
            [
                "init",
                "--project",
                "dispatch-smoke-project",
                "--project-root",
                str(root),
                "--actor",
                "dispatch-smoke-validator",
                "--db",
                str(database),
                "--operation-id",
                "op_smoke_init",
                "--json",
            ],
            cwd=root,
        )
        if init["exit_code"] != 0 or init["envelope"].get("error"):
            raise RuntimeError(f"project init failed: {init}")

        status = invoke(binary, ["status", "dispatch-smoke-project", "--db", str(database), "--json"], cwd=root)
        revision = (status["envelope"].get("data") or {}).get("revision", status["envelope"].get("revision"))
        if status["exit_code"] != 0 or not isinstance(revision, int):
            raise RuntimeError(f"initial project status omitted its revision: {status}")
        session = invoke(
            binary,
            [
                "session", "start", "--project", "dispatch-smoke-project", "--session", "dispatch-smoke-operator-session",
                "--harness", "dispatch-admission-smoke", "--actor", "dispatch-smoke-validator",
                "--expected-revision", str(revision), "--db", str(database),
                "--operation-id", "op_smoke_session_start", "--json",
            ],
            cwd=root,
        )
        revision = session["envelope"].get("revision")
        if session["exit_code"] != 0 or session["envelope"].get("error") or not isinstance(revision, int):
            raise RuntimeError(f"operator session setup failed: {session}")
        seeded = invoke(
            binary,
            [
                "work", "create", "dispatch-smoke-project", "dispatch-smoke-seed", "Read-only dispatch smoke seed",
                "--kind", "task", "--actor", "dispatch-smoke-validator", "--session", "dispatch-smoke-operator-session",
                "--expected-revision", str(revision), "--db", str(database),
                "--operation-id", "op_smoke_saturation_seed", "--json",
            ],
            cwd=root,
        )
        if seeded["exit_code"] != 0 or seeded["envelope"].get("error"):
            raise RuntimeError(f"saturation seed work setup failed: {seeded}")

        shim, shim_reason = compile_clock_shim(root)
        service_env = os.environ.copy()
        if shim is not None:
            service_env["BOREAL_FAKE_CLOCK_FILE"] = str(clock_file)
            service_env["DYLD_INSERT_LIBRARIES"] = str(shim)
        service = subprocess.Popen(
            [
                str(binary),
                "service",
                "run",
                "--db",
                str(database),
                "--socket",
                str(socket_path),
                # Deliberately use the small 1/2 configuration for this
                # admission smoke. It does not model default or full-load
                # production capacity.
                "--dispatch-workers",
                str(SMOKE_DISPATCH_WORKERS),
                "--dispatch-capacity",
                str(SMOKE_DISPATCH_CAPACITY),
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
            ready_status(binary, socket_path, "dispatch-smoke-project", root)
            saturation = run_saturation(
                binary,
                socket_path,
                "dispatch-smoke-project",
                root,
                args.normal_requests,
            )
            if shim is None:
                clock = {"status": "unavailable", "reason": shim_reason}
            else:
                try:
                    clock = run_fake_clock_probe(
                        binary,
                        socket_path,
                        "dispatch-smoke-project",
                        root,
                        clock_file,
                        True,
                    )
                except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                    clock = {"status": "fail", "reason": str(error)}
        finally:
            stop = stop_service(service, socket_path)

    result = {
        "result_version": "boreal.dispatch-admission-smoke/1",
        "generated_at_unix_ms": int(time.time() * 1000),
        "scenario": "bounded_read_only_dispatch_admission_smoke",
        "binary": str(binary),
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "production_service_boundary": True,
        "configuration": {
            "dispatch_workers": SMOKE_DISPATCH_WORKERS,
            "dispatch_capacity": SMOKE_DISPATCH_CAPACITY,
            "service_defaults_workers": 4,
            "service_defaults_capacity": 32,
            "normal_requests": args.normal_requests,
        },
        "fake_clock": {
            "shim": str(shim) if shim else None,
            "status": clock["status"],
            "reason": clock.get("reason", shim_reason),
            "scope": "supplemental create/claim and expiry-display check in the disposable project; not part of the normal saturation batch",
            "probe": clock,
        },
        "queue_and_control": saturation,
        "service_stop_observation": stop,
        "smoke_status": "pass" if saturation["assertions"]["passed"] else "fail",
        "v10_acceptance": {
            "status": "not_established",
            "reason": "this report is a bounded read-only dispatch-admission smoke, not the V10 acceptance gate",
        },
        "limitations": [
            "The 1-worker/2-capacity setup is a deliberately constrained smoke configuration; production service defaults are 4 workers and capacity 32.",
            "The saturated requests are repeated read-only work-show calls, not a mixed multi-agent workload, fairness test, scale benchmark, or soak.",
            "The CLI may report dispatch-full using protocol_mismatch while preserving the dispatch-queue-full message; this is not evidence of a typed service_busy CLI response.",
            "Control latency is recorded without a preapproved latency budget or a claim about full normal-load progress.",
            "The optional fake-clock probe checks expiry display projection only; it does not prove durable deadline reconciliation, restart recovery, or timer scheduling under a shifted monotonic clock.",
            "SIGTERM process exit and socket removal are supplemental observations; this smoke does not prove V10 stop/recovery behavior under full workload.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "smoke_status": result["smoke_status"],
                "assertions": saturation["assertions"],
                "fake_clock_status": clock["status"],
                "stop_status": stop["status"],
                "v10_acceptance": result["v10_acceptance"]["status"],
            },
            sort_keys=True,
        )
    )
    return 0 if saturation["assertions"]["passed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        message = str(error)
        lowered = message.lower()
        if (
            "operation not permitted" in lowered or "permission denied" in lowered
        ) and ("socket" in lowered or "unix" in lowered):
            print(
                json.dumps(
                    {
                        "output": None,
                        "smoke_status": "unavailable",
                        "assertions": None,
                        "fake_clock_status": "unavailable",
                        "stop_status": "not_run",
                        "v10_acceptance": "not_established",
                        "reason": "Unix socket/process capability unavailable",
                    },
                    sort_keys=True,
                )
            )
            print(
                f"BOREAL_VALIDATION_SKIP: Unix socket/process capability unavailable: {message}",
                file=sys.stderr,
            )
        else:
            print(f"FAIL: {message}", file=sys.stderr)
        raise SystemExit(1) from error
