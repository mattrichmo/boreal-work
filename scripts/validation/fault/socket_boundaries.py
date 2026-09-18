#!/usr/bin/env python3
"""Exercise the production CLI/service boundary at four socket fault points.

The proxy speaks the real Boreal four-byte-length-prefixed Unix transport. It
does not synthesize application responses or retry requests. Each cell runs a
real mutating CLI command with one operation ID, drops the connection at one
delivery boundary, then performs public operation/work readback after the
service exits. A successful cell proves the caller preserves the original
identity and does not silently manufacture a fresh mutation ID.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PROCESS_HARNESS = ROOT / "scripts" / "validation" / "process" / "forensic_service.py"


def load_process_harness():
    spec = importlib.util.spec_from_file_location("boreal_c4a_process", PROCESS_HARNESS)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load process harness: {PROCESS_HARNESS}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


F = load_process_harness()


class ProxyError(RuntimeError):
    pass


def recv_exact(connection: socket.socket, size: int) -> bytes:
    value = bytearray()
    while len(value) < size:
        block = connection.recv(size - len(value))
        if not block:
            raise ProxyError("peer closed before a complete frame arrived")
        value.extend(block)
    return bytes(value)


def recv_frame(connection: socket.socket) -> bytes:
    prefix = recv_exact(connection, 4)
    size = int.from_bytes(prefix, "big")
    return prefix + recv_exact(connection, size)


def send_frame(connection: socket.socket, frame: bytes) -> None:
    connection.sendall(frame)


class FaultProxy:
    """Forward one request and deliberately drop one delivery boundary."""

    def __init__(self, path: Path, backend: Path, mode: str):
        self.path = path
        self.backend = backend
        self.mode = mode
        self.error: str | None = None
        self.accepted = threading.Event()
        self.finished = threading.Event()
        self.thread = threading.Thread(target=self._serve, name=f"fault-proxy-{mode}", daemon=True)

    def start(self) -> None:
        self.path.unlink(missing_ok=True)
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(str(self.path))
        self.listener.listen(1)
        self.thread.start()

    def join(self, timeout: float = 10.0) -> None:
        self.thread.join(timeout=timeout)
        if self.thread.is_alive():
            raise ProxyError(f"proxy did not finish after {timeout:.1f}s")
        if self.error:
            raise ProxyError(self.error)

    def _serve(self) -> None:
        client = None
        backend = None
        try:
            client, _ = self.listener.accept()
            self.accepted.set()
            if self.mode == "before_admission":
                client.close()
                return
            request = recv_frame(client)
            backend = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            backend.connect(str(self.backend))
            send_frame(backend, request)
            if self.mode == "after_request":
                # Keep the backend connection alive and drain its response so
                # the service itself sees a normal write boundary. The caller
                # is already disconnected after full request delivery.
                client.close()
                recv_frame(backend)
                return
            response = recv_frame(backend)
            if self.mode == "after_commit":
                client.close()
                return
            if self.mode == "mid_response":
                split = max(5, len(response) // 2)
                client.sendall(response[:split])
                client.close()
                return
            raise ProxyError(f"unknown proxy mode: {self.mode}")
        except (OSError, ProxyError) as error:
            self.error = str(error)
        finally:
            for connection in (client, backend):
                if connection is not None:
                    try:
                        connection.close()
                    except OSError:
                        pass
            try:
                self.listener.close()
            except OSError:
                pass
            self.path.unlink(missing_ok=True)
            self.finished.set()


def run_cell(binary: Path, parent: Path, mode: str) -> dict[str, Any]:
    with __import__("tempfile").TemporaryDirectory(prefix=f"boreal-v03-{mode}-", dir=parent) as directory:
        root = Path(directory)
        db, _ = F.prepare_project(binary, root, f"v03-{mode}", "seed")
        backend = F.short_socket(f"v03-backend-{mode}")
        proxy_path = F.short_socket(f"v03-proxy-{mode}")
        service = F.start_service(binary, db, backend, cwd=root)
        proxy = FaultProxy(proxy_path, backend, mode)
        proxy.start()
        operation = F.op(f"v03-{mode}-create")
        call = F.service_call(
            binary,
            db,
            proxy_path,
            [
                "work",
                "create",
                f"v03-{mode}",
                "faulted-task",
                "Fault boundary task",
                "--kind",
                "task",
            ],
            cwd=root,
            operation=operation,
        )
        proxy.join()
        service_output = F.stop_process(service)
        if call.exit_code == 0 or call.error_code not in {"unknown_outcome", "service_unavailable"}:
            raise ProxyError(f"{mode} did not preserve uncertain delivery: {call.compact()}")
        readback = F.operation_show_direct(binary, root, db, f"v03-{mode}", operation)
        if mode == "before_admission":
            if readback.error_code != "not_found":
                raise ProxyError(f"before-admission fault unexpectedly committed: {readback.compact()}")
            committed = False
        else:
            F.assert_success(readback, f"{mode} operation readback", "changed")
            work = F.run_cli(
                binary,
                ["work", "show", f"v03-{mode}", "faulted-task", "--db", str(db), "--json"],
                cwd=root,
            )
            work_data = F.assert_success(work, f"{mode} work readback")
            if work_data.get("title") != "Fault boundary task":
                raise ProxyError(f"{mode} changed the committed work unexpectedly: {work.compact()}")
            committed = True
        return {
            "status": "pass",
            "mode": mode,
            "committed": committed,
            "client": call.compact(),
            "readback": readback.compact(),
            "service_output_tail": service_output[-1200:],
        }


def markdown(result: dict[str, Any]) -> str:
    lines = [
        "# C4-A socket delivery-boundary evidence",
        "",
        f"Status: **{result['pass_count']} pass, {result['fail_count']} fail**",
        f"Binary: `{result['binary']}`",
        "",
        "| Boundary | Status | Committed after fault |",
        "| --- | --- | --- |",
    ]
    for cell in result["cells"]:
        lines.append(f"| `{cell['mode']}` | **{cell['status']}** | `{cell.get('committed')}` |")
    lines.extend(
        [
            "",
            "The proxy drops only the caller-side Unix connection. It does not retry, rewrite, or fabricate the request. For the three post-delivery cells, the same operation ID is read back after the service stops; the before-admission cell remains absent.",
            "",
            "This is V03 evidence only. It does not claim V04 live DTO fixtures, V06 full-screen fault coverage, V07 controller refresh separation, or V12 byte-boundary coverage.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=ROOT / "target" / "debug" / "bwrk")
    parser.add_argument("--only", action="append", choices=("before_admission", "after_request", "after_commit", "mid_response"))
    parser.add_argument("--output", type=Path, default=HERE / "results" / "socket-boundaries.latest.json")
    parser.add_argument("--report", type=Path, default=HERE / "results" / "socket-boundaries.latest.md")
    args = parser.parse_args()
    binary = args.bin.resolve()
    if not binary.exists():
        raise SystemExit(f"binary does not exist: {binary}")
    modes = args.only or ["before_admission", "after_request", "after_commit", "mid_response"]
    cells = []
    with __import__("tempfile").TemporaryDirectory(prefix="boreal-c4-a-fault-") as parent:
        parent_path = Path(parent)
        for mode in modes:
            try:
                cells.append(run_cell(binary, parent_path, mode))
            except (F.HarnessError, OSError, ProxyError, TimeoutError) as error:
                cells.append({"mode": mode, "status": "fail", "error": str(error)})
    result = {
        "schema": "boreal.c4-a.socket-boundaries.v1",
        "binary": str(binary),
        "cells": cells,
        "pass_count": sum(cell["status"] == "pass" for cell in cells),
        "fail_count": sum(cell["status"] == "fail" for cell in cells),
        "unavailable_count": 0,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    args.report.write_text(markdown(result))
    print(json.dumps({key: result[key] for key in ("schema", "pass_count", "fail_count", "unavailable_count")}))
    return 0 if result["fail_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
