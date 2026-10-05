#!/usr/bin/env python3
"""Exercise the compiled TUI entrypoint through a real POSIX pseudo-terminal."""

from __future__ import annotations

import argparse
import json
import os
import pty
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def run(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)


def run_envelope(command: list[str], cwd: Path) -> dict:
    result = run(command, cwd)
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    try:
        envelope = json.loads(lines[-1])
    except (IndexError, json.JSONDecodeError) as error:
        raise RuntimeError(
            f"fixture command returned no JSON envelope: {command}: {result.stdout}{result.stderr}"
        ) from error
    if (
        result.returncode != 0
        or not isinstance(envelope, dict)
        or envelope.get("outcome") not in {"changed", "unchanged"}
    ):
        raise RuntimeError(f"fixture command failed: {command}: {result.stdout}{result.stderr}")
    return envelope


def wait_for_socket(path: Path, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            try:
                with socket.socket(socket.AF_UNIX) as probe:
                    probe.connect(str(path))
                return True
            except OSError:
                pass
        time.sleep(0.01)
    return False


def read_until(master: int, marker: bytes, timeout: float = 5.0) -> bytes:
    deadline = time.monotonic() + timeout
    captured = bytearray()
    while time.monotonic() < deadline:
        remaining = max(0.01, deadline - time.monotonic())
        ready, _, _ = select.select([master], [], [], remaining)
        if not ready:
            continue
        try:
            captured.extend(os.read(master, 65536))
        except OSError:
            break
        if marker in captured:
            return bytes(captured)
    raise RuntimeError(f"TUI did not render {marker!r}; output={bytes(captured)!r}")


def run_tui_pty(
    socket_path: Path,
    project: str,
    *,
    actor: str,
    credential: str,
    harness: str,
    session: str,
) -> tuple[int, bytes]:
    master, slave = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.close(master)
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        if slave > 2:
            os.close(slave)
        environment = os.environ.copy()
        environment["BOREAL_CREDENTIAL"] = credential
        environment["TERM"] = "xterm-256color"
        os.execvpe(
            "node",
            [
                "node",
                str(ROOT / "apps/tui/dist/entrypoint.js"),
                "--socket",
                str(socket_path),
                "--project",
                project,
                "--actor",
                actor,
                "--harness",
                harness,
                "--session",
                session,
                "--interactive",
            ],
            environment,
        )
    os.close(slave)
    try:
        output = read_until(master, b"WORK QUEUE")
        if b"BOREAL / WORK" not in output or b"ALL WORK" not in output or b"revision" not in output:
            raise RuntimeError(f"TUI rendered without the monitoring view: {output!r}")
        os.write(master, b"q")
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            waited, status = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                return os.waitstatus_to_exitcode(status), output
            ready, _, _ = select.select([master], [], [], 0.05)
            if ready:
                try:
                    output += os.read(master, 65536)
                except OSError:
                    waited, status = os.waitpid(pid, os.WNOHANG)
                    if waited == pid:
                        return os.waitstatus_to_exitcode(status), output
                    break
        waited, status = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            return os.waitstatus_to_exitcode(status), output
        os.kill(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
        raise RuntimeError(f"TUI did not exit after q: status={status} output={output!r}")
    finally:
        os.close(master)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bin", type=Path, default=ROOT / "target/debug/bwrk")
    args = parser.parse_args()
    if os.name != "posix":
        print("BOREAL_VALIDATION_SKIP: PTY smoke requires POSIX")
        return 0

    with tempfile.TemporaryDirectory(prefix="boreal-tui-pty-") as directory:
        root = Path(directory)
        project = "tui-pty-project"
        project_root = root / project
        database = project_root / ".boreal" / "boreal.sqlite"
        socket_path = project_root / ".boreal" / f"service-{os.getpid()}.sock"
        try:
            run_envelope(
                [
                    str(args.bin), "init", project, "--db", str(database),
                    "--operation-id", "pty-init", "--json",
                ],
                root,
            )
            key = run_envelope(
                [
                    str(args.bin), "auth", "key", "--actor", "pty-agent",
                    "--actor-role", "agent", "--db", str(database), "--json",
                ],
                project_root,
            )
            enrollment = key.get("data", {}).get("enrollment_path")
            if not isinstance(enrollment, str):
                raise RuntimeError("auth key did not return an enrollment path")
            credential = json.loads(Path(enrollment).read_text(encoding="utf-8")).get("credential")
            if not isinstance(credential, str) or not credential:
                raise RuntimeError("local test-agent enrollment did not contain a credential")
            status = run_envelope([str(args.bin), "status", "--db", str(database), "--json"], project_root)
            revision = status.get("revision")
            if not isinstance(revision, int):
                raise RuntimeError("status did not return the current project revision")
            run_envelope(
                [
                    str(args.bin), "auth", "grant", "--actor", "operator",
                    "--input", enrollment, "--expected-revision", str(revision),
                    "--reason", "Authorize the isolated PTY fixture agent", "--yes",
                    "--db", str(database), "--json",
                ],
                project_root,
            )
            status = run_envelope([str(args.bin), "status", "--db", str(database), "--json"], project_root)
            revision = status.get("revision")
            if not isinstance(revision, int):
                raise RuntimeError("status did not return the current project revision")
            run_envelope(
                [
                    str(args.bin), "session", "start", "--project", project,
                    "--actor", "pty-agent", "--session", "pty-session",
                    "--harness", "pty-harness", "--expected-revision", str(revision),
                    "--db", str(database), "--json",
                ],
                project_root,
            )
            status = run_envelope([str(args.bin), "status", "--db", str(database), "--json"], project_root)
            revision = status.get("revision")
            if not isinstance(revision, int):
                raise RuntimeError("status did not return the current project revision")
            run_envelope(
                [
                    str(args.bin), "work", "create", project, "pty-task", "PTY dashboard",
                    "--kind", "task", "--actor", "pty-agent", "--session", "pty-session",
                    "--expected-revision", str(revision), "--db", str(database),
                    "--operation-id", "pty-work", "--json",
                ],
                project_root,
            )

            service = subprocess.Popen(
                [str(args.bin), "service", "run", "--db", str(database), "--socket", str(socket_path), "--json"],
                cwd=project_root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            if not wait_for_socket(socket_path):
                service.terminate()
                stdout, stderr = service.communicate(timeout=3)
                if "operation not permitted" in f"{stdout}{stderr}".lower() or "eperm" in f"{stdout}{stderr}".lower():
                    print("BOREAL_VALIDATION_SKIP: Unix socket creation is unavailable")
                    return 0
                raise RuntimeError(f"service did not become ready: {stdout}{stderr}")
            try:
                exit_code, output = run_tui_pty(
                    socket_path,
                    project,
                    actor="pty-agent",
                    credential=credential,
                    harness="pty-harness",
                    session="pty-session",
                )
                if exit_code != 0:
                    raise RuntimeError(f"TUI exited {exit_code}: {output!r}")
                print(f"TUI PTY smoke: PASS ({len(output)} bytes captured)")
            finally:
                service.send_signal(signal.SIGTERM)
                service.communicate(timeout=5)
        finally:
            try:
                socket_path.unlink()
            except FileNotFoundError:
                pass
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"TUI PTY smoke: FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
