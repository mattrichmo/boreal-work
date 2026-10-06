#!/usr/bin/env python3
"""Exercise the Global TUI in a portable PTY, including terminal resizes."""

from __future__ import annotations

import argparse
import json
import os
import re
import select
import signal
import struct
import subprocess
import sys
import tempfile
import time
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
TUI_ENTRY = ROOT / "apps/global-tui/dist/entrypoint.js"
RESIZE_CASES = ((80, 24), (36, 12), (140, 36), (52, 16))


def external_temporary_directory() -> tempfile.TemporaryDirectory[str]:
    """Create short socket paths outside the checkout using host temp roots."""
    checkout = ROOT.resolve()
    candidates = (Path(tempfile.gettempdir()), Path("/tmp"))
    attempted: set[Path] = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved in attempted:
            continue
        attempted.add(resolved)
        if resolved == checkout or checkout in resolved.parents:
            continue
        if len(os.fsencode(resolved / "s")) > 90:
            continue
        try:
            return tempfile.TemporaryDirectory(prefix="bgpty-", dir=str(resolved))
        except OSError:
            continue
    raise OSError("no short writable temporary directory outside the checkout")


def run_json(binary: Path, environment: dict[str, str], cwd: Path, *arguments: str) -> dict:
    command = [str(binary), *arguments, "--json"]
    result = subprocess.run(
        command,
        cwd=cwd,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
        timeout=20,
    )
    if result.returncode != 0:
        raise RuntimeError(f"fixture command failed: {command}: {result.stdout}{result.stderr}")
    try:
        envelope = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"fixture command returned invalid JSON: {command}: {result.stdout}") from error
    if not isinstance(envelope, dict) or envelope.get("error") is not None:
        raise RuntimeError(f"fixture command returned an error: {command}: {result.stdout}")
    data = envelope.get("data")
    return data if isinstance(data, dict) else {}


def wait_for_socket(path: Path, process: subprocess.Popen[str], timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=1)
            details = f"{stdout}{stderr}"
            if "eperm" in details.lower() or "operation not permitted" in details.lower():
                print("BOREAL_VALIDATION_SKIP: local Unix sockets are unavailable")
                raise PermissionError(f"BOREAL_VALIDATION_SKIP: {details}")
            raise RuntimeError(f"Global service exited before opening its socket: {details}")
        if path.exists():
            return
        time.sleep(0.025)
    raise RuntimeError(f"Global service did not create its socket at {path}")


def read_until(master: int, marker: bytes, timeout: float = 8.0) -> bytes:
    deadline = time.monotonic() + timeout
    captured = bytearray()
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], max(0.01, deadline - time.monotonic()))
        if not ready:
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        captured.extend(chunk)
        if marker in captured:
            return bytes(captured)
    raise RuntimeError(f"Global TUI did not render {marker!r}: {bytes(captured)!r}")


def drain(master: int, duration: float = 0.08) -> None:
    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], max(0.0, deadline - time.monotonic()))
        if not ready:
            return
        try:
            if not os.read(master, 65536):
                return
        except OSError:
            return


def set_window(master: int, pid: int, columns: int, rows: int) -> None:
    import fcntl
    import termios

    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    os.kill(pid, signal.SIGWINCH)


def terminal_width(value: str) -> int:
    width = 0
    for character in value:
        if unicodedata.combining(character) or unicodedata.category(character) in {"Cf", "Mn", "Me"}:
            continue
        width += 2 if unicodedata.east_asian_width(character) in {"W", "F"} else 1
    return width


def read_resized_frame(master: int, columns: int, rows: int, timeout: float = 5.0) -> bytes:
    deadline = time.monotonic() + timeout
    captured = bytearray()
    row_marker = f"\x1b[{rows};1H".encode()
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], max(0.01, deadline - time.monotonic()))
        if not ready:
            continue
        try:
            captured.extend(os.read(master, 65536))
        except OSError:
            break
        clear = captured.rfind(b"\x1b[2J")
        if clear < 0:
            continue
        frame = bytes(captured[clear:])
        if row_marker not in frame:
            continue
        painted_rows = {
            int(value)
            for value in re.findall(rb"\x1b\[(\d+);1H", frame)
        }
        if painted_rows != set(range(1, rows + 1)):
            continue
        first_row = re.search(rb"\x1b\[1;1H([^\x1b]*)\x1b\[K", frame)
        if not first_row:
            continue
        rendered_width = terminal_width(first_row.group(1).decode("utf-8", errors="replace"))
        if rendered_width != columns:
            raise RuntimeError(
                f"Global TUI rendered {rendered_width} columns after resize to {columns}x{rows}"
            )
        return frame
    raise RuntimeError(
        f"Global TUI did not repaint {columns}x{rows} after resize: {bytes(captured)!r}"
    )


def stop_service(service: subprocess.Popen[str]) -> str:
    if service.poll() is None:
        service.send_signal(signal.SIGTERM)
    try:
        stdout, stderr = service.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        service.kill()
        stdout, stderr = service.communicate(timeout=2)
        raise RuntimeError(f"Global service failed to stop cleanly: {stdout}{stderr}")
    return f"{stdout}{stderr}"


def wait_for_child(pid: int, timeout_seconds: float) -> bool:
    """Reap a child with bounded, non-blocking waits."""
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            waited, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return True
        if waited == pid:
            return True
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        time.sleep(min(0.025, remaining))


def stop_child(pid: int) -> None:
    """Terminate the TUI child, escalate, and never block indefinitely."""
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    if wait_for_child(pid, 0.75):
        return
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if not wait_for_child(pid, 0.75):
        raise RuntimeError("Global TUI child did not exit after SIGKILL")


def cleanup_resources(
    child: int | None,
    master: int | None,
    service: subprocess.Popen[str],
    socket_path: Path,
) -> None:
    """Attempt every cleanup step, even when an earlier one fails."""
    try:
        if child is not None:
            stop_child(child)
    finally:
        try:
            if master is not None:
                os.close(master)
        finally:
            try:
                stop_service(service)
            finally:
                try:
                    socket_path.unlink()
                except FileNotFoundError:
                    pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=ROOT / "target/debug/bwrk")
    parser.add_argument("--tui-entry", type=Path, default=TUI_ENTRY)
    args = parser.parse_args()
    if os.name != "posix":
        print("BOREAL_VALIDATION_SKIP: Global TUI PTY smoke requires POSIX")
        return 0
    import pty

    binary = args.bin.expanduser().resolve()
    tui_entry = args.tui_entry.expanduser().resolve()
    if not binary.is_file():
        raise RuntimeError(f"Boreal binary is missing: {binary}")
    if not tui_entry.is_file():
        raise RuntimeError(f"Global TUI entrypoint is missing: {tui_entry}; run npm test --prefix apps/global-tui")

    with external_temporary_directory() as temporary:
        root = Path(temporary)
        global_root = root / "global"
        socket_path = root / "s"
        environment = os.environ.copy()
        environment.update(
            {
                "BOREAL_GLOBAL_ROOT": str(global_root),
                "TERM": "xterm-256color",
                "NO_COLOR": "1",
            }
        )
        run_json(binary, environment, root, "global", "bootstrap")
        if not (global_root / "global.sqlite").is_file():
            raise RuntimeError("Global bootstrap did not place its database under BOREAL_GLOBAL_ROOT")
        project = run_json(binary, environment, root, "global", "project", "add", "--name", "PTY project")
        project_id = project.get("id")
        if not isinstance(project_id, str):
            raise RuntimeError(f"Global project fixture has no project ID: {project}")
        run_json(
            binary,
            environment,
            root,
            "global",
            "todo",
            "add",
            "--title",
            "PTY smoke item",
            "--project",
            project_id,
        )

        service = subprocess.Popen(
            [str(binary), "global", "service", "run", "--socket", str(socket_path)],
            cwd=root,
            env=environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        master: int | None = None
        child: int | None = None
        try:
            wait_for_socket(socket_path, service)
            child, master = pty.fork()
            if child == 0:
                child_environment = os.environ.copy()
                child_environment.update(environment)
                os.execvpe(
                    "node",
                    [
                        "node",
                        str(tui_entry),
                        "--socket",
                        str(socket_path),
                        "--interactive",
                        "--theme",
                        "mono",
                    ],
                    child_environment,
                )

            startup_output = read_until(master, b"\x1b[?1049h", timeout=12)
            drain(master)
            for index, (columns, rows) in enumerate(RESIZE_CASES):
                set_window(master, child, columns, rows)
                frame = read_resized_frame(master, columns, rows)
                if b"BOREAL" not in frame:
                    raise RuntimeError(f"Global TUI lost its title after resizing to {columns}x{rows}")
                if index == 0 and b"PTY smoke item" not in frame:
                    raise RuntimeError("Global TUI did not show the isolated fixture item at normal size")
                drain(master)

            os.write(master, b"q")
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                waited, status = os.waitpid(child, os.WNOHANG)
                if waited == child:
                    child = None
                    exit_code = os.waitstatus_to_exitcode(status)
                    if exit_code != 0:
                        raise RuntimeError(f"Global TUI exited {exit_code}; output={startup_output!r}")
                    break
                ready, _, _ = select.select([master], [], [], 0.05)
                if ready:
                    try:
                        os.read(master, 65536)
                    except OSError:
                        pass
            else:
                raise RuntimeError("Global TUI did not exit after q")
            if service.poll() is not None:
                raise RuntimeError("Global service exited while the TUI was open")
            print("PASS Global TUI PTY: normal 80x24, narrow 36x12, wide 140x36, resized 52x16; isolated BOREAL_GLOBAL_ROOT")
            return 0
        finally:
            cleanup_resources(child, master, service, socket_path)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PermissionError as error:
        # wait_for_socket already emitted the machine-readable skip marker.
        if "BOREAL_VALIDATION_SKIP:" not in str(error):
            print(f"Global TUI PTY smoke: FAIL: {error}", file=sys.stderr)
            raise SystemExit(1)
        raise SystemExit(0)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Global TUI PTY smoke: FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
