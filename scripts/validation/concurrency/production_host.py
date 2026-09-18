#!/usr/bin/env python3
"""Exercise V10 through the real ``bwrk service run``/Unix client boundary.

This is intentionally a production-composition harness rather than a Rust
unit test.  It starts the shipping CLI service process, uses separate bwrk
client processes, fills the normal dispatch lane, probes a control request,
advances an optional macOS fake realtime clock, and proves SIGTERM cleanup.
The output distinguishes observed production facts from unavailable host
features; it never turns a missing fake-clock facility into a pass.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import ctypes.util
import json
import os
import platform
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SHIM_SOURCE = Path(__file__).with_name("fake_clock.c")


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
                f"service exited before readiness: code={process.returncode} "
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


def work_create_command(index: int) -> list[str]:
    return [
        "work",
        "create",
        f"v10-work-{index:04d}",
        f"V10 saturation item {index}",
        "--kind",
        "task",
        "--actor",
        "v10-validator",
        "--operation-id",
        f"op_v10_create_{index:04d}",
    ]


def run_saturation(
    binary: Path,
    socket_path: Path,
    project: str,
    root: Path,
    count: int,
) -> dict:
    started = time.perf_counter()

    def one(index: int) -> dict:
        return client(binary, socket_path, project, work_create_command(index), cwd=root)

    results: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(count, 64)) as pool:
        futures = [pool.submit(one, index) for index in range(count)]
        # Give the host a short admission window before probing the reserved
        # control lane.  The worker count/capacity are production defaults.
        time.sleep(0.02)
        control_started = time.perf_counter()
        control = client(
            binary,
            socket_path,
            project,
            ["status", "--limit", "1", "--offset", "0"],
            cwd=root,
            timeout=30.0,
        )
        control_latency_ms = (time.perf_counter() - control_started) * 1000.0
        for future in futures:
            results.append(future.result())

    error_objects = [
        item["envelope"].get("error")
        for item in results
        if item["envelope"].get("error")
    ]
    errors = [item.get("code") for item in error_objects]
    error_messages = [item.get("message", "") for item in error_objects]
    queue_full = any(
        code == "service_busy"
        or "queue is full" in message.lower()
        or "dispatch queue" in message.lower()
        for code, message in zip(errors, error_messages)
    )
    queue_busy_message_count = sum(
        "queue is full" in message.lower() or "dispatch queue" in message.lower()
        for message in error_messages
    )
    return {
        "normal_requests": count,
        "normal_elapsed_ms": round((time.perf_counter() - started) * 1000.0, 3),
        "normal_outcomes": {
            outcome: sum(item["envelope"].get("outcome") == outcome for item in results)
            for outcome in ("changed", "unchanged", "rejected", "failed", "unknown")
        },
        "normal_error_codes": sorted(code for code in errors if code),
        "normal_error_details": error_objects[:20],
        "queue_saturation_observed": queue_full,
        "queue_busy_message_count": queue_busy_message_count,
        "busy_transport_note": "CLI currently maps the service busy protocol to protocol_mismatch while retaining the typed busy message",
        "control": {
            "outcome": control["envelope"].get("outcome"),
            "error_code": (control["envelope"].get("error") or {}).get("code"),
            "latency_ms": round(control_latency_ms, 3),
            "response_received": control["exit_code"] == 0
            and control["envelope"].get("error") is None,
        },
        "production_boundary": "separate bwrk client processes over the Unix service socket",
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
            "v10-clock-task",
            "V10 fake-clock task",
            "--kind",
            "task",
            "--actor",
            "v10-validator",
            "--operation-id",
            "op_v10_create_clock_task",
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
            "v10-clock-task",
            "--actor",
            "v10-validator",
            "--harness",
            "v10-production-host",
            "--session",
            "v10-clock-session",
            "--lease-ttl",
            "1s",
            "--time-limit",
            "30s",
            "--operation-id",
            "op_v10_claim_clock_task",
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
            if item.get("work_id") == "v10-clock-task":
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
        default=Path(__file__).resolve().parent / "results" / "production-host.latest.json",
    )
    args = parser.parse_args()
    if args.normal_requests < 32:
        parser.error("--normal-requests must be at least 32 to exercise the bounded queue")
    binary = args.bin.resolve()
    if not binary.exists():
        parser.error(f"binary does not exist: {binary}")

    with tempfile.TemporaryDirectory(prefix="boreal-v10-production-host-") as directory:
        root = Path(directory)
        database = root / "boreal.sqlite"
        socket_path = root / "service.sock"
        clock_file = root / "clock-offset-ms"
        clock_file.write_text("0\n", encoding="ascii")
        init = invoke(
            binary,
            [
                "init",
                "v10-project",
                "--actor",
                "v10-validator",
                "--db",
                str(database),
                "--operation-id",
                "op_v10_init",
                "--json",
            ],
            cwd=root,
        )
        if init["exit_code"] != 0 or init["envelope"].get("error"):
            raise RuntimeError(f"project init failed: {init}")

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
                # Deliberately use the smallest valid production queue so the
                # harness can prove typed backpressure deterministically while
                # the reserved control lane remains available. Normal users
                # retain the larger service defaults.
                "--dispatch-workers",
                "1",
                "--dispatch-capacity",
                "2",
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
            ready_status(binary, socket_path, "v10-project", root)
            saturation = run_saturation(
                binary,
                socket_path,
                "v10-project",
                root,
                args.normal_requests,
            )
            clock = run_fake_clock_probe(
                binary,
                socket_path,
                "v10-project",
                root,
                clock_file,
                shim is not None,
            )
        finally:
            stop = stop_service(service, socket_path)

    result = {
        "result_version": "boreal.forensic-v10-production-host/1",
        "generated_at_unix_ms": int(time.time() * 1000),
        "scenario": "V10",
        "binary": str(binary),
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "production_service": True,
        "fake_clock": {
            "shim": str(shim) if shim else None,
            "status": "available" if shim else "unavailable",
            "reason": shim_reason,
        },
        "queue_and_control": saturation,
        "deadline_clock": clock,
        "stop_proof": stop,
        "limitations": [
            "The fake clock shifts realtime only inside the service process; monotonic timer scheduling remains real.",
            "Queue saturation is observed from typed service_busy responses; the production CLI does not expose internal queue depth counters.",
            "The current production hook is a wake/stop boundary; this harness does not claim durable expiry reconciliation after a deadline callback.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "clock": clock, "stop": stop}, sort_keys=True))
    return 0 if saturation["queue_saturation_observed"] and saturation["control"]["response_received"] and stop["status"] == "pass" and clock["status"] == "pass" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
