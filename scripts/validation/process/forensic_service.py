#!/usr/bin/env python3
"""Exercise production-composed service/process forensic scenarios.

This harness deliberately drives the built ``bwrk`` binary through its CLI
and Unix-socket service boundary.  It is a C4-A evidence runner, not a unit
test adapter: every state assertion comes from a public ``bwrk`` readback.

Covered gates:

* V01: operation identity survives service restart and changed payloads
  become conflicts;
* V02: admitted/running/exited/receipt_committed/unknown evidence execution
  readback;
* V05: same-session success and wrong-session rejection;
* V08: parent exit, inherited stdout pipe, SIGTERM, and bounded cleanup;
* V09: all currently available database-mutating direct routes reject while
  the production service owns the canonical database.

The runner never opens SQLite itself.  Temporary project setup and all
observations use ``bwrk`` commands.  A nonzero result means the named gate
failed or could not be observed in the current environment.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
DEFAULT_BIN = ROOT / "target" / "debug" / "bwrk"
GATE_SOURCE = ROOT / "project" / "spec" / "gates"
_SOCKET_COUNTER = 0


class HarnessError(RuntimeError):
    """A scenario failed or could not establish its production boundary."""


def short_socket(label: str) -> Path:
    """Return a unique macOS-safe endpoint (macOS caps sockaddr_un paths)."""
    global _SOCKET_COUNTER
    _SOCKET_COUNTER += 1
    safe = "".join(character for character in label if character.isalnum() or character == "-")[:22]
    return Path(f"/tmp/boreal-c4a-{os.getpid()}-{_SOCKET_COUNTER}-{safe}.sock")


def op(value: str) -> str:
    """Normalize a harness label to the public operation-id grammar."""
    return value if value.startswith("op_") else f"op_{value}"


@dataclass
class Call:
    args: list[str]
    exit_code: int
    envelope: dict[str, Any] | None
    stdout: str
    stderr: str

    @property
    def outcome(self) -> str | None:
        return (self.envelope or {}).get("outcome")

    @property
    def error_code(self) -> str | None:
        return ((self.envelope or {}).get("error") or {}).get("code")

    def data(self) -> dict[str, Any]:
        value = (self.envelope or {}).get("data")
        return value if isinstance(value, dict) else {}

    def compact(self) -> dict[str, Any]:
        return {
            "args": self.args,
            "exit_code": self.exit_code,
            "outcome": self.outcome,
            "error_code": self.error_code,
            "envelope": self.envelope,
            "stdout_tail": self.stdout[-1200:],
            "stderr_tail": self.stderr[-1200:],
        }


def parse_envelope(stdout: str) -> dict[str, Any] | None:
    for line in reversed([line for line in stdout.splitlines() if line.strip()]):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def run_cli(
    binary: Path,
    args: Iterable[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> Call:
    argv = [str(binary), *[str(value) for value in args]]
    completed = subprocess.run(
        argv,
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    return Call(
        args=argv,
        exit_code=completed.returncode,
        envelope=parse_envelope(completed.stdout),
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def wait_for_socket(path: Path, process: subprocess.Popen[str], timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists() and stat_is_socket(path):
            return
        if process.poll() is not None:
            output = ""
            if process.stdout is not None:
                output = process.stdout.read()
            raise HarnessError(
                f"service exited before binding {path}: code={process.returncode} output={output[-1600:]}"
            )
        time.sleep(0.01)
    raise HarnessError(f"service did not bind socket within {timeout:.1f}s: {path}")


def stat_is_socket(path: Path) -> bool:
    return path.exists() and path.stat().st_mode & 0o170000 == 0o140000


def start_service(
    binary: Path,
    db: Path,
    socket_path: Path,
    *,
    cwd: Path,
    max_requests: int | None = None,
    extra_env: dict[str, str] | None = None,
    stdout: Any = subprocess.PIPE,
) -> subprocess.Popen[str]:
    args = [
        str(binary),
        "service",
        "run",
        "--db",
        str(db),
        "--socket",
        str(socket_path),
        "--json",
    ]
    if max_requests is not None:
        args.extend(["--max-requests", str(max_requests)])
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    process = subprocess.Popen(
        args,
        cwd=cwd,
        env=env,
        stdout=stdout,
        stderr=subprocess.STDOUT,
        text=True,
    )
    wait_for_socket(socket_path, process)
    return process


def stop_process(process: subprocess.Popen[str], *, timeout: float = 8.0) -> str:
    if process.poll() is None:
        process.send_signal(signal.SIGTERM)
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        output, _ = process.communicate(timeout=timeout)
        raise HarnessError(f"service did not stop after SIGTERM: output={output[-1600:]}")
    return output or ""


def service_call(
    binary: Path,
    db: Path,
    socket_path: Path,
    args: Iterable[str],
    *,
    cwd: Path,
    operation: str,
    actor: str = "agent-1",
    harness: str = "cli",
    session: str = "c4-a-session",
    timeout: float = 30.0,
) -> Call:
    command = list(args)
    command.extend(
        [
            "--actor",
            actor,
            "--harness",
            harness,
            "--session",
            session,
            "--operation-id",
            op(operation),
            "--db",
            str(db),
            "--socket",
            str(socket_path),
            "--json",
        ]
    )
    return run_cli(binary, command, cwd=cwd, timeout=timeout)


def assert_success(call: Call, label: str, outcome: str | None = None) -> dict[str, Any]:
    if call.exit_code != 0 or call.envelope is None:
        raise HarnessError(f"{label} failed: {call.compact()}")
    if outcome is not None and call.outcome != outcome:
        raise HarnessError(f"{label} expected outcome {outcome!r}: {call.compact()}")
    return call.data()


def assert_error(call: Call, codes: set[str], label: str) -> None:
    if call.exit_code == 0 or call.error_code not in codes:
        raise HarnessError(f"{label} expected one of {sorted(codes)}: {call.compact()}")


def prepare_project(binary: Path, root: Path, project: str, work: str) -> tuple[Path, Path]:
    db = root / "boreal.sqlite"
    gates = root / "gates"
    gates.mkdir(parents=True, exist_ok=True)
    for gate in ("checkpoint.json", "verification.json", "summary.json"):
        (gates / gate).write_bytes((GATE_SOURCE / gate).read_bytes())
    initialized = run_cli(
        binary,
        [
            "init",
            project,
            "--db",
            str(db),
            "--operation-id",
            op(f"{project}-init"),
            "--json",
        ],
        cwd=root,
    )
    assert_success(initialized, f"{project} init")
    created = run_cli(
        binary,
        [
            "work",
            "create",
            project,
            work,
            "C4-A validation work",
            "--kind",
            "task",
            "--db",
            str(db),
            "--operation-id",
            op(f"{project}-work-create"),
            "--json",
        ],
        cwd=root,
    )
    assert_success(created, f"{project} work create")
    return db, gates


def service_once(
    binary: Path,
    root: Path,
    db: Path,
    args: Iterable[str],
    *,
    operation: str,
    max_requests: int = 1,
    extra_env: dict[str, str] | None = None,
    session: str = "c4-a-session",
) -> Call:
    socket_path = short_socket(operation)
    process = start_service(
        binary,
        db,
        socket_path,
        cwd=root,
        max_requests=max_requests,
        extra_env=extra_env,
    )
    call = service_call(
        binary,
        db,
        socket_path,
        args,
        cwd=root,
        operation=operation,
        session=session,
    )
    if process.poll() is None and max_requests is not None:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            stop_process(process)
    elif process.poll() is None:
        stop_process(process)
    else:
        process.communicate()
    return call


def operation_show_direct(binary: Path, root: Path, db: Path, project: str, operation: str) -> Call:
    return run_cli(
        binary,
        [
            "operation",
            "show",
            project,
            op(operation),
            "--db",
            str(db),
            "--json",
        ],
        cwd=root,
    )


def operation_state(call: Call) -> str | None:
    return call.data().get("execution", {}).get("state") if isinstance(call.data().get("execution"), dict) else None


def evidence_setup(
    binary: Path,
    root: Path,
    *,
    project: str,
    work: str,
    session: str,
    gate: str = "verification",
    slow_gate: bool = False,
) -> tuple[Path, Path, str, int]:
    db, gates = prepare_project(binary, root, project, work)
    source_input = root / "evidence-source.txt"
    source_input.write_text("C4-A evidence source fixture\n")
    source_added = run_cli(
        binary,
        [
            "source",
            "add",
            project,
            "--input",
            str(source_input),
            "--origin",
            "c4-a-evidence-fixture",
            "--db",
            str(db),
            "--operation-id",
            op(f"{project}-source-add"),
            "--json",
        ],
        cwd=root,
    )
    source_id = (assert_success(source_added, f"{project} source add").get("source") or {}).get(
        "source_version_id"
    )
    if not isinstance(source_id, str):
        raise HarnessError(f"source add did not return a source version identity: {source_added.compact()}")
    config_identity = "config-c4-a-fixture"
    for gate_file in gates.glob("*.json"):
        declaration = json.loads(gate_file.read_text())
        declaration["source_snapshot_hash"] = source_id
        declaration["config_identity"] = config_identity
        gate_file.write_text(json.dumps(declaration, indent=2) + "\n")
    if slow_gate:
        write_slow_gate(gates)
    socket_path = short_socket("setup")
    process = start_service(binary, db, socket_path, cwd=root, max_requests=2)
    claimed = service_call(
        binary,
        db,
        socket_path,
        [
            "work",
            "claim",
            project,
            work,
            "--source-version",
            source_id,
            "--config-identity",
            config_identity,
        ],
        cwd=root,
        operation=f"{project}-claim",
        session=session,
    )
    claim_data = assert_success(claimed, f"{project} work claim", "changed")
    started = service_call(
        binary,
        db,
        socket_path,
        ["agent", "start", work, "--project", project],
        cwd=root,
        operation=f"{project}-agent-start",
        session=session,
    )
    if process.poll() is None:
        process.wait(timeout=10)
    else:
        process.communicate()
    data = assert_success(started, f"{project} agent start", "changed")
    attempt_id = data.get("attempt_id") or claim_data.get("attempt_id")
    fence = data.get("fence") or claim_data.get("fence")
    if not isinstance(attempt_id, str) or not isinstance(fence, int):
        raise HarnessError(f"agent start did not return attempt identity: {started.compact()}")
    return db, root / "gates", attempt_id, fence


def run_v01(binary: Path, parent: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="boreal-v01-", dir=parent) as directory:
        root = Path(directory)
        db, _ = prepare_project(binary, root, "v01-project", "seed")
        create_args = [
            "work",
            "create",
            "v01-project",
            "restart-task",
            "Restart identity",
            "--kind",
            "task",
        ]
        first = service_once(binary, root, db, create_args, operation="v01-create")
        assert_success(first, "V01 first create", "changed")
        replay = service_once(binary, root, db, create_args, operation="v01-create")
        assert_success(replay, "V01 replay after restart", "unchanged")
        changed = service_once(
            binary,
            root,
            db,
            [
                "work",
                "create",
                "v01-project",
                "restart-task",
                "Changed payload",
                "--kind",
                "task",
            ],
            operation="v01-create",
        )
        assert_error(changed, {"operation_conflict", "claim_conflict"}, "V01 changed payload")
        readback = operation_show_direct(binary, root, db, "v01-project", "v01-create")
        data = assert_success(readback, "V01 direct operation readback", "changed")
        operation = data.get("operation") or {}
        if operation.get("result", {}).get("work_id") != "restart-task":
            raise HarnessError(f"V01 readback lost original operation result: {readback.compact()}")
        work_readback = run_cli(
            binary,
            ["work", "show", "v01-project", "restart-task", "--db", str(db), "--json"],
            cwd=root,
        )
        work_data = assert_success(work_readback, "V01 work readback")
        if work_data.get("title") != "Restart identity":
            raise HarnessError(f"V01 changed payload altered the committed work: {work_readback.compact()}")
        return {
            "status": "pass",
            "observed": {
                "first": first.compact(),
                "replay_after_restart": replay.compact(),
                "changed_payload": changed.compact(),
                "readback": readback.compact(),
                "work_readback": work_readback.compact(),
            },
        }


def write_slow_gate(gates: Path) -> None:
    declaration = json.loads((gates / "verification.json").read_text())
    declaration["executable"] = "sleep"
    declaration["argv"] = ["sleep", "2"]
    declaration["observables"] = []
    (gates / "verification.json").write_text(json.dumps(declaration, indent=2) + "\n")


def run_v02(binary: Path, parent: Path) -> dict[str, Any]:
    observations: dict[str, Any] = {}

    with tempfile.TemporaryDirectory(prefix="boreal-v02-admitted-", dir=parent) as directory:
        root = Path(directory)
        db, _, attempt, fence = evidence_setup(
            binary, root, project="v02-admitted", work="task", session="session-admitted"
        )
        socket_path = short_socket("admitted")
        service = start_service(
            binary,
            db,
            socket_path,
            cwd=root,
            extra_env={"BOREAL_VALIDATION_FAILPOINT": "after_evidence_admission"},
        )
        evidence = service_call(
            binary,
            db,
            socket_path,
            [
                "evidence",
                "run",
                "--project",
                "v02-admitted",
                "--work",
                "task",
                "--gate",
                "verification",
                "--attempt",
                attempt,
                "--fence",
                str(fence),
            ],
            cwd=root,
            operation="v02-admitted-op",
            session="session-admitted",
        )
        service.wait(timeout=10)
        readback = operation_show_direct(binary, root, db, "v02-admitted", "v02-admitted-op")
        if operation_state(readback) != "admitted":
            raise HarnessError(f"V02 admitted state was not readable: {readback.compact()}")
        observations["admitted"] = {"evidence": evidence.compact(), "readback": readback.compact()}

    with tempfile.TemporaryDirectory(prefix="boreal-v02-exited-", dir=parent) as directory:
        root = Path(directory)
        db, _, attempt, fence = evidence_setup(
            binary, root, project="v02-exited", work="task", session="session-exited"
        )
        socket_path = short_socket("exited")
        service = start_service(
            binary,
            db,
            socket_path,
            cwd=root,
            extra_env={"BOREAL_VALIDATION_FAILPOINT": "after_evidence_exit"},
        )
        evidence = service_call(
            binary,
            db,
            socket_path,
            [
                "evidence",
                "run",
                "--project",
                "v02-exited",
                "--work",
                "task",
                "--gate",
                "verification",
                "--attempt",
                attempt,
                "--fence",
                str(fence),
            ],
            cwd=root,
            operation="v02-exited-op",
            session="session-exited",
        )
        service.wait(timeout=10)
        readback = operation_show_direct(binary, root, db, "v02-exited", "v02-exited-op")
        if operation_state(readback) != "exited":
            raise HarnessError(f"V02 exited state was not readable: {readback.compact()}")
        observations["exited"] = {"evidence": evidence.compact(), "readback": readback.compact()}

    with tempfile.TemporaryDirectory(prefix="boreal-v02-running-", dir=parent) as directory:
        root = Path(directory)
        db, _, attempt, fence = evidence_setup(
            binary,
            root,
            project="v02-running",
            work="task",
            session="session-running",
            slow_gate=True,
        )
        socket_path = short_socket("running")
        service = start_service(binary, db, socket_path, cwd=root)
        evidence_args = [
            str(binary),
            "evidence",
            "run",
            "--project",
            "v02-running",
            "--work",
            "task",
            "--gate",
            "verification",
            "--attempt",
            attempt,
            "--fence",
            str(fence),
            "--actor",
            "agent-1",
            "--harness",
            "cli",
            "--session",
            "session-running",
            "--operation-id",
                op("v02-running-op"),
            "--db",
            str(db),
            "--socket",
            str(socket_path),
            "--json",
        ]
        evidence_process = subprocess.Popen(
            evidence_args,
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        running_readback: Call | None = None
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and evidence_process.poll() is None:
            candidate = service_call(
                binary,
                db,
                socket_path,
                ["operation", "show", "v02-running", op("v02-running-op")],
                cwd=root,
                operation=f"v02-running-read-{int(time.monotonic() * 1000)}",
                session="session-running",
            )
            if operation_state(candidate) == "running":
                running_readback = candidate
                break
            time.sleep(0.03)
        stdout, stderr = evidence_process.communicate(timeout=10)
        evidence = Call(
            args=evidence_args,
            exit_code=evidence_process.returncode,
            envelope=parse_envelope(stdout),
            stdout=stdout,
            stderr=stderr,
        )
        if running_readback is None:
            stop_process(service)
            raise HarnessError(f"V02 running state was not observed: {evidence.compact()}")
        final_readback = service_call(
            binary,
            db,
            socket_path,
            ["operation", "show", "v02-running", op("v02-running-op")],
            cwd=root,
            operation="v02-running-final-read",
            session="session-running",
        )
        stop_process(service)
        if operation_state(final_readback) != "receipt_committed":
            raise HarnessError(f"V02 receipt_committed state was not readable: {final_readback.compact()}")
        observations["running"] = {"readback": running_readback.compact(), "evidence": evidence.compact()}
        observations["receipt_committed"] = {"readback": final_readback.compact()}

    with tempfile.TemporaryDirectory(prefix="boreal-v02-unknown-", dir=parent) as directory:
        root = Path(directory)
        db, _, attempt, fence = evidence_setup(
            binary, root, project="v02-unknown", work="task", session="session-unknown"
        )
        socket_path = short_socket("unknown")
        crashed = start_service(
            binary,
            db,
            socket_path,
            cwd=root,
            extra_env={"BOREAL_VALIDATION_FAILPOINT": "after_evidence_admission"},
        )
        evidence = service_call(
            binary,
            db,
            socket_path,
            [
                "evidence",
                "run",
                "--project",
                "v02-unknown",
                "--work",
                "task",
                "--gate",
                "verification",
                "--attempt",
                attempt,
                "--fence",
                str(fence),
            ],
            cwd=root,
            operation="v02-unknown-op",
            session="session-unknown",
        )
        crashed.wait(timeout=10)
        recovered_socket = short_socket("recovered")
        recovered = start_service(binary, db, recovered_socket, cwd=root, max_requests=1)
        readback = service_call(
            binary,
            db,
            recovered_socket,
            ["operation", "show", "v02-unknown", op("v02-unknown-op")],
            cwd=root,
            operation="v02-unknown-readback",
            session="session-unknown",
        )
        recovered.wait(timeout=10)
        if operation_state(readback) != "unknown" or readback.outcome != "unknown":
            raise HarnessError(f"V02 restart did not reconcile unknown: {readback.compact()}")
        observations["unknown"] = {"evidence": evidence.compact(), "readback": readback.compact()}

    return {"status": "pass", "observed": observations}


def run_v05(binary: Path, parent: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="boreal-v05-", dir=parent) as directory:
        root = Path(directory)
        db, _ = prepare_project(binary, root, "v05-project", "task")
        socket_path = short_socket("v05")
        service = start_service(binary, db, socket_path, cwd=root, max_requests=3)
        started = service_call(
            binary,
            db,
            socket_path,
            ["agent", "start", "task", "--project", "v05-project"],
            cwd=root,
            operation="v05-start",
            session="same-session",
        )
        data = assert_success(started, "V05 agent start", "changed")
        heartbeat = service_call(
            binary,
            db,
            socket_path,
            [
                "agent",
                "heartbeat",
                "--project",
                "v05-project",
                "--work",
                "task",
                "--attempt",
                data["attempt_id"],
                "--fence",
                str(data["fence"]),
            ],
            cwd=root,
            operation="v05-heartbeat-same",
            session="same-session",
        )
        assert_success(heartbeat, "V05 same-session heartbeat")
        wrong = service_call(
            binary,
            db,
            socket_path,
            [
                "agent",
                "heartbeat",
                "--project",
                "v05-project",
                "--work",
                "task",
                "--attempt",
                data["attempt_id"],
                "--fence",
                str(data["fence"]),
            ],
            cwd=root,
            operation="v05-heartbeat-wrong",
            session="wrong-session",
        )
        assert_error(wrong, {"attempt_conflict", "permission_denied"}, "V05 wrong-session heartbeat")
        service.wait(timeout=10)
        return {
            "status": "pass",
            "observed": {
                "start": started.compact(),
                "same_session": heartbeat.compact(),
                "wrong_session": wrong.compact(),
            },
        }


PARENT_CODE = r'''
import os, subprocess, sys
from pathlib import Path
binary, db, socket_path, pid_path = sys.argv[1:]
service = subprocess.Popen(
    [binary, "service", "run", "--db", db, "--socket", socket_path, "--json"],
    stdout=None,
    stderr=None,
    text=True,
)
Path(pid_path).write_text(str(service.pid))
os._exit(0)
'''


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def run_v08(binary: Path, parent: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="boreal-v08-", dir=parent) as directory:
        root = Path(directory)
        db, _ = prepare_project(binary, root, "v08-project", "task")
        socket_path = short_socket("v08")
        pid_path = root / "service.pid"
        helper = subprocess.Popen(
            [sys.executable, "-c", PARENT_CODE, str(binary), str(db), str(socket_path), str(pid_path)],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        helper.wait(timeout=10)
        if helper.returncode != 0 or not pid_path.exists():
            output, _ = helper.communicate(timeout=2)
            raise HarnessError(f"V08 parent fixture failed: code={helper.returncode} output={output}")
        service_pid = int(pid_path.read_text())
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not stat_is_socket(socket_path):
            if not process_alive(service_pid):
                break
            time.sleep(0.01)
        if not stat_is_socket(socket_path) or not process_alive(service_pid):
            output, _ = helper.communicate(timeout=2)
            raise HarnessError(f"V08 service did not survive parent exit: output={output}")
        os.kill(service_pid, signal.SIGTERM)
        try:
            output, _ = helper.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            os.kill(service_pid, signal.SIGKILL)
            helper.communicate(timeout=5)
            raise HarnessError("V08 inherited stdout pipe stayed open after service SIGTERM")
        if process_alive(service_pid):
            raise HarnessError(f"V08 service remained alive after SIGTERM: pid={service_pid}")
        if stat_is_socket(socket_path):
            raise HarnessError("V08 service left its endpoint after bounded shutdown")
        return {
            "status": "pass",
            "observed": {
                "helper_exit_code": helper.returncode,
                "service_pid": service_pid,
                "service_output_tail": output[-1600:],
                "pipe_eof_after_sigterm": True,
                "socket_removed": True,
            },
        }


def direct_mutation_cases(root: Path, project: str, db: Path) -> list[list[str]]:
    input_path = root / "source.txt"
    input_path.write_text("C4-A source fixture\n")
    common = ["--db", str(db), "--json"]
    attempt = ["--attempt", "missing-attempt", "--fence", "1"]
    return [
        ["init", project, "--yes"],
        ["setup", project, "--yes"],
        ["install", project, "--yes"],
        ["work", "create", project, "direct-new", "Direct new", "--kind", "task"],
        ["work", "edit", project, "task", "--title", "edited", "--expected-revision", "0"],
        ["dep", "add", project, "task", "direct-new", "--expected-revision", "0"],
        ["dep", "remove", project, "task", "direct-new", "--expected-revision", "0"],
        ["work", "claim", project, "task", "--session", "direct-session"],
        ["work", "accept", project, "task", *attempt],
        ["work", "heartbeat", project, "task", *attempt],
        ["work", "renew", project, "task", *attempt, "--lease-ttl", "30s"],
        ["work", "release", project, "task", *attempt, "--reason", "operator_requested"],
        ["work", "finish", project, "task", *attempt],
        ["agent", "start", "task", "--project", project],
        ["agent", "heartbeat", "--project", project, "--work", "task", *attempt],
        ["agent", "renew", "--project", project, "--work", "task", *attempt],
        ["agent", "release", "task", "--project", project, *attempt],
        ["agent", "finish", "task", "--release", "--project", project, *attempt],
        ["evidence", "add", "--project", project, "--work", "task", "--gate", "verification", "--receipt", str(root / "missing-receipt.json")],
        ["evidence", "run", "--project", project, "--work", "task", "--gate", "verification"],
        ["session", "start", "--project", project, "--session", "direct-session", "--harness", "c4-a"],
        ["session", "end", "--project", project, "--session", "direct-session"],
        ["intake", "bucket", project, "direct-bucket", "Direct bucket"],
        ["intake", "capture", project, "direct-intake", "Direct intake", "--bucket", "direct-bucket", "--kind", "note"],
        ["work", "hold", "add", project, "task", "--reason", "blocked", "--expected-revision", "0"],
        ["work", "hold", "resolve", project, "task", "missing-hold", "--reason", "resolved", "--expected-revision", "0"],
        ["work", "dispatch", "set", project, "task", "--dispatch", "paused", "--expected-revision", "0"],
        ["source", "add", project, "--input", str(input_path), "--origin", "c4-a-fixture"],
    ]


def run_v09(binary: Path, parent: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="boreal-v09-", dir=parent) as directory:
        root = Path(directory)
        db, _ = prepare_project(binary, root, "v09-project", "task")
        socket_path = short_socket("v09")
        service = start_service(binary, db, socket_path, cwd=root)
        records = []
        unavailable_routes = {
            ("intake", "bucket"),
            ("intake", "capture"),
        }
        try:
            for index, command in enumerate(direct_mutation_cases(root, "v09-project", db)):
                operation = op(f"v09-direct-{index}")
                full = [
                    *command,
                    "--actor",
                    "c4-a-validator",
                    "--harness",
                    "c4-a",
                    "--session",
                    "direct-session",
                    "--operation-id",
                    operation,
                    "--db",
                    str(db),
                    "--json",
                ]
                call = run_cli(binary, full, cwd=root)
                route = " ".join(command[:3])
                expected_error = (
                    "unknown_command_namespace"
                    if tuple(command[:2]) in unavailable_routes
                    else "service_busy"
                )
                records.append(
                    {
                        "route": route,
                        "expected_error": expected_error,
                        **call.compact(),
                    }
                )
                if call.error_code != expected_error:
                    raise HarnessError(f"V09 direct mutation bypassed election: {records[-1]}")
        finally:
            stop_process(service)
        return {
            "status": "pass",
            "observed": {
                "route_count": len(records),
                "routes": records,
                "expected_error": {
                    "available_mutations": "service_busy",
                    "unavailable_future_routes": "unknown_command_namespace",
                },
            },
        }


SCENARIOS = {
    "V01": run_v01,
    "V02": run_v02,
    "V05": run_v05,
    "V08": run_v08,
    "V09": run_v09,
}


def markdown(result: dict[str, Any]) -> str:
    lines = [
        "# C4-A production service forensic evidence",
        "",
        f"Status: **{result['pass_count']} pass, {result['fail_count']} fail, {result['unavailable_count']} unavailable**",
        f"Binary: `{result['binary']}`",
        "",
        "This report is production-composed evidence from the built `bwrk` binary. It does not infer a gate from unit tests. Unavailable or failed states remain explicit.",
        "",
        "| Gate | Status | Notes |",
        "| --- | --- | --- |",
    ]
    for gate in result["gates"]:
        note = gate.get("error") or ", ".join(gate.get("observed", {}).keys())
        lines.append(f"| `{gate['id']}` | **{gate['status']}** | {note} |")
    lines.extend(["", "## Limitations", ""])
    for limitation in result["limitations"]:
        lines.append(f"- {limitation}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=DEFAULT_BIN)
    parser.add_argument("--only", action="append", choices=sorted(SCENARIOS))
    parser.add_argument("--output", type=Path, default=HERE / "results" / "forensic-service.latest.json")
    parser.add_argument("--report", type=Path, default=HERE / "results" / "forensic-service.latest.md")
    args = parser.parse_args()
    binary = args.bin.resolve()
    if not binary.exists():
        raise SystemExit(f"binary does not exist: {binary}")
    selected = args.only or list(SCENARIOS)
    gates = []
    with tempfile.TemporaryDirectory(prefix="boreal-c4-a-") as parent:
        parent_path = Path(parent)
        for gate_id in selected:
            try:
                record = SCENARIOS[gate_id](binary, parent_path)
            except (HarnessError, OSError, subprocess.SubprocessError, ValueError, KeyError) as error:
                record = {"status": "fail", "error": str(error)}
            gates.append({"id": gate_id, **record})
    result = {
        "schema": "boreal.c4-a.production-service.v1",
        "binary": str(binary),
        "gates": gates,
        "pass_count": sum(g["status"] == "pass" for g in gates),
        "fail_count": sum(g["status"] == "fail" for g in gates),
        "unavailable_count": sum(g["status"] == "unavailable" for g in gates),
        "limitations": [
            "V04, V06, V07, V10, V11, and V12 remain outside this C4-A lane.",
            "The V02 admitted/exited observations use the debug-only production failpoints already exposed by the validation build; they do not claim optimized-build crash coverage.",
            "V08 proves the service process lifetime and inherited pipe boundary, not every external executor descendant shape.",
            "V09 enumerates every currently available database-mutating CLI route reported by the checked-in command registry; machine update/upgrade routes are intentionally excluded because they do not mutate the project database.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    args.report.write_text(markdown(result))
    print(json.dumps({k: result[k] for k in ("schema", "pass_count", "fail_count", "unavailable_count")}))
    return 0 if result["fail_count"] == 0 and result["unavailable_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
