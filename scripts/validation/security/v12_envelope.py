#!/usr/bin/env python3
"""Production-path V12 envelope and committed-sidecar validation.

This harness deliberately stays outside the product crates.  It initializes a
real v2 database through ``bwrk``, starts the production local service, sends
versioned requests over the Unix socket, and uses the CLI service route for
the evidence/receipt assertion.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


MAX_INLINE_OUTPUT_BYTES = 65_536
PROJECT = "v12-security"
ACTOR = "v12-agent"
HARNESS = "v12-harness"
SESSION = "v12-session"
CONFIG = "config-v12"


class V12Failure(RuntimeError):
    pass


def digest(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def fail(message: str) -> None:
    raise V12Failure(message)


def receive_exact(stream: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = stream.recv(remaining)
        if not chunk:
            fail(f"service socket closed with {remaining} bytes remaining")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def raw_payload(response_body: bytes) -> tuple[dict[str, Any], bytes]:
    """Return the decoded response and exact JSON bytes of its payload value."""

    text = response_body.decode("utf-8")
    marker = '"payload":'
    start = text.find(marker)
    if start < 0:
        fail(f"service response has no payload: {text[:300]}")
    value_start = start + len(marker)
    decoder = json.JSONDecoder()
    value, end = decoder.raw_decode(text[value_start:])
    if not isinstance(value, dict):
        fail("service response payload is not an envelope object")
    return value, text[value_start : value_start + end].encode("utf-8")


def raw_object_field(object_bytes: bytes, field: str) -> tuple[Any, bytes]:
    text = object_bytes.decode("utf-8")
    marker = f'"{field}":'
    start = text.find(marker)
    if start < 0:
        fail(f"service object omitted {field!r}")
    value_start = start + len(marker)
    decoder = json.JSONDecoder()
    value, end = decoder.raw_decode(text[value_start:])
    return value, text[value_start : value_start + end].encode("utf-8")


def service_request(socket_path: Path, operation: str, data: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    payload = {
        "api_version": "2",
        "schema_version": "boreal.protocol.envelope.v1",
        "operation_id": operation,
        "data": data,
    }
    request = {
        "request_id": f"v12-{operation}",
        "payload": payload,
    }
    body = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
        stream.settimeout(30)
        stream.connect(str(socket_path))
        stream.sendall(struct.pack(">I", len(body)) + body)
        size = struct.unpack(">I", receive_exact(stream, 4))[0]
        response_body = receive_exact(stream, size)
    outer, outer_raw = raw_payload(response_body)
    if outer.get("api_version") != "2" or outer.get("schema_version") != "boreal.protocol.envelope.v1":
        fail(f"service transport payload has an unexpected application envelope: {outer}")
    inner, inner_raw = raw_object_field(outer_raw, "data")
    if not isinstance(inner, dict):
        fail("service application response omitted its versioned result envelope")
    if inner.get("api_version") != "2" or inner.get("schema_version") != "boreal.protocol.envelope.v1":
        fail(f"service response nested data is not the versioned result envelope: {inner}")
    return inner, inner_raw


def cli_command(binary: Path, root: Path, db: Path, args: list[str], operation: str, socket_path: Path | None = None) -> dict[str, Any]:
    command = [str(binary), *args, "--actor", ACTOR, "--db", str(db), "--operation-id", operation, "--json"]
    if socket_path is not None:
        command.extend(["--socket", str(socket_path)])
    result = subprocess.run(command, cwd=root, capture_output=True, check=False)
    if result.returncode != 0:
        fail(
            f"CLI command failed ({result.returncode}): {' '.join(command)}\n"
            f"stdout={result.stdout.decode(errors='replace')}\n"
            f"stderr={result.stderr.decode(errors='replace')}"
        )
    try:
        envelope = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        fail(
            f"CLI command did not return JSON: {error}\n"
            f"stdout={result.stdout.decode(errors='replace')}\n"
            f"stderr={result.stderr.decode(errors='replace')}"
        )
    if not isinstance(envelope, dict):
        fail("CLI response envelope is not an object")
    return envelope


def resolve_binary(root: Path) -> Path:
    configured = os.environ.get("BOREAL_BWRK")
    candidate = Path(configured) if configured else root / "target" / "debug" / "bwrk"
    if candidate.is_file() and os.access(candidate, os.X_OK):
        return candidate
    build = subprocess.run(
        ["cargo", "build", "--bin", "bwrk", "--locked", "--offline"],
        cwd=root,
        capture_output=True,
        check=False,
    )
    if build.returncode != 0:
        fail(
            "unable to build bwrk for V12: "
            + build.stdout.decode(errors="replace")
            + build.stderr.decode(errors="replace")
        )
    candidate = root / "target" / "debug" / "bwrk"
    if not candidate.is_file():
        fail(f"cargo build completed but {candidate} is unavailable")
    return candidate


def wait_for_socket(process: subprocess.Popen[bytes], socket_path: Path) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            fail(f"service exited before readiness: {process.returncode}")
        if socket_path.exists():
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                    probe.settimeout(1)
                    probe.connect(str(socket_path))
                return
            except OSError:
                pass
        time.sleep(0.05)
    fail(f"service socket did not become ready: {socket_path}")


def stop_service(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGTERM)
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def start_service(binary: Path, root: Path, db: Path, socket_path: Path) -> subprocess.Popen[bytes]:
    process = subprocess.Popen(
        [str(binary), "service", "run", "--db", str(db), "--socket", str(socket_path)],
        cwd=root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    wait_for_socket(process, socket_path)
    return process


def create_work_data(work_id: str, title: str, operation: str) -> dict[str, Any]:
    # This is the exact request shape emitted by the production CLI service
    # adapter for `work create`; the request itself is sent to that adapter,
    # not to a test handler.
    return {
        "project_id": PROJECT,
        "actor_id": ACTOR,
        "harness_id": HARNESS,
        "session_id": SESSION,
        "command": "create_work",
        "work_id": work_id,
        "kind": "task",
        "parent_id": None,
        "title": title,
        "description": "",
        "priority": 0,
        "dispatch": "automatic",
        "hold": None,
        "profile": "focused",
        "profile_version": "1",
        "expected_revision": None,
        "operation_id": operation,
    }


def envelope_size(value: dict[str, Any], raw: bytes) -> int:
    if value.get("detail_ref") is not None:
        size = value["detail_ref"].get("size_bytes")
        if not isinstance(size, int):
            fail("oversized service envelope omitted detail_ref.size_bytes")
        return size
    return len(raw)


def run_envelope_matrix(socket_path: Path) -> None:
    # The probes establish the serialized-byte delta for ASCII and for a
    # non-ASCII character. This catches a character-count implementation that
    # accidentally treats UTF-8 as one byte per code point.
    probe_ascii, raw_ascii = service_request(
        socket_path,
        "op_v12_e_a00000",
        create_work_data("env-a-00000", "a", "op_v12_e_a00000"),
    )
    probe_unicode, raw_unicode = service_request(
        socket_path,
        "op_v12_e_u00000",
        create_work_data("env-u-00000", "é", "op_v12_e_u00000"),
    )
    if probe_ascii.get("outcome") != "changed" or probe_unicode.get("outcome") != "changed":
        fail(f"envelope calibration work creation did not commit: ascii={probe_ascii} unicode={probe_unicode}")
    base = len(raw_ascii) - 1
    unicode_delta = len(raw_unicode) - base
    if unicode_delta <= 1:
        fail(f"Unicode calibration did not expand serialized bytes: ascii=1 unicode={unicode_delta}")

    def exact_case(target: int, unicode_case: bool) -> tuple[dict[str, Any], bytes, str, str]:
        operation_prefix = "op_v12_e_u" if unicode_case else "op_v12_e_a"
        work_prefix = "env-u-" if unicode_case else "env-a-"
        title_bytes = target - base
        if title_bytes <= 0:
            fail(f"calibration base exceeds target {target}: {base}")
        for attempt, variant in enumerate("abcd"):
            operation = f"{operation_prefix}{target}{variant}"
            work_id = f"{work_prefix}{target}{variant}"
            if unicode_case:
                unicode_count = max(1, min(8, title_bytes // unicode_delta))
                unicode_bytes = unicode_count * unicode_delta
                ascii_count = title_bytes - unicode_bytes
                if ascii_count < 0:
                    fail(f"Unicode envelope target {target} has negative ASCII padding")
                title = "é" * unicode_count + "a" * ascii_count
            else:
                title = "a" * title_bytes
            envelope, raw = service_request(
                socket_path,
                operation,
                create_work_data(work_id, title, operation),
            )
            measured = envelope_size(envelope, raw)
            if measured == target:
                return envelope, raw, title, operation
            title_bytes += target - measured
            if title_bytes <= 0:
                fail(f"envelope correction crossed zero for target {target}")
        fail(f"envelope target {target} did not converge after correction attempts")

    for target in (65_535, 65_536, 65_537):
        envelope, raw, title, operation = exact_case(target, False)
        if target <= MAX_INLINE_OUTPUT_BYTES:
            if envelope.get("data", {}).get("title") != title:
                fail(f"ASCII envelope target {target} lost its inline title")
        else:
            if envelope.get("data") is not None or envelope.get("detail_ref", {}).get("uri") != f"operation:{operation}":
                fail(f"ASCII envelope target {target} did not switch to an operation reference")
        print(f"PASS v12-envelope-ascii-{target}: exact serialized service envelope bytes")

    for target in (65_535, 65_536, 65_537):
        envelope, raw, title, operation = exact_case(target, True)
        if len(title) >= len(title.encode("utf-8")):
            fail(f"Unicode envelope target {target} did not expand request UTF-8 bytes")
        if target <= MAX_INLINE_OUTPUT_BYTES:
            if envelope.get("data", {}).get("title") != title:
                fail(f"Unicode envelope target {target} lost its inline title")
        else:
            if envelope.get("data") is not None or envelope.get("detail_ref", {}).get("uri") != f"operation:{operation}":
                fail(f"Unicode envelope target {target} did not switch to an operation reference")
        print(
            f"PASS v12-envelope-unicode-{target}: exact serialized bytes with UTF-8 expansion "
            f"(title_chars={len(title)} title_bytes={len(title.encode('utf-8'))})"
        )


def run_sidecar_failure(binary: Path, root: Path, db: Path, socket_path: Path, source_id: str) -> None:
    work_id = "sidecar-work"
    create = cli_command(
        binary,
        root,
        db,
        ["work", "create", PROJECT, work_id, "V12 sidecar export", "--kind", "task"],
        "op_v12_sidecar_create",
        socket_path,
    )
    if create.get("outcome") != "changed":
        fail(f"sidecar fixture work was not created: {create}")

    claim = cli_command(
        binary,
        root,
        db,
        [
            "work",
            "claim",
            PROJECT,
            work_id,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--source-version",
            source_id,
            "--config-identity",
            CONFIG,
        ],
        "op_v12_sidecar_claim",
        socket_path,
    )
    claim_data = claim.get("data") or {}
    attempt_id = claim_data.get("attempt_id")
    fence = claim_data.get("fence")
    if not isinstance(attempt_id, str) or not isinstance(fence, int):
        fail(f"sidecar fixture claim omitted attempt identity: {claim}")

    start = cli_command(
        binary,
        root,
        db,
        [
            "agent",
            "start",
            work_id,
            "--project",
            PROJECT,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--attempt",
            attempt_id,
            "--fence",
            str(fence),
        ],
        "op_v12_sidecar_start",
        socket_path,
    )
    if start.get("outcome") != "changed":
        fail(f"sidecar fixture attempt did not start: {start}")

    gate_root = (root / "gates").resolve()
    gate_root.mkdir(parents=True, exist_ok=True)
    (gate_root / "verification.json").write_text(
        json.dumps(
            {
                "gate_id": "verification",
                "kind": "verification",
                "executable": "/usr/bin/printf",
                "argv": ["/usr/bin/printf", "v12-sidecar-pass"],
                "cwd": ".",
                "source_snapshot_hash": source_id,
                "config_identity": CONFIG,
                "environment_fingerprint": "v12-declared-environment",
                "environment_allowlist": [],
                "observables": ["v12-sidecar-pass"],
                "max_runtime_ms": 30_000,
            }
        ),
        encoding="utf-8",
    )

    operation = "op_v12_sidecar_run"
    namespace = digest(f"{PROJECT}:{gate_root}".encode()).replace(":", "-")
    stem = digest(operation.encode()).replace(":", "-")
    output_dir = root / "evidence" / namespace
    output_dir.mkdir(parents=True, exist_ok=True)
    receipt_path = output_dir / f"{stem}.json"
    receipt_path.mkdir()

    result = cli_command(
        binary,
        root,
        db,
        [
            "evidence",
            "run",
            "--project",
            PROJECT,
            "--work",
            work_id,
            "--gate",
            "verification",
            "--attempt",
            attempt_id,
            "--fence",
            str(fence),
            "--harness",
            HARNESS,
            "--session",
            SESSION,
        ],
        operation,
        socket_path,
    )
    result_data = result.get("data") or {}
    export = result_data.get("export") or {}
    if result.get("outcome") != "changed":
        fail(f"sidecar failure changed the application outcome: {result}")
    if result_data.get("result") != "passed":
        fail(f"sidecar fixture gate did not commit a passed receipt: {result}")
    if export.get("status") != "committed_export_failed" or export.get("code") != "receipt_sidecar_export_failed":
        fail(f"sidecar failure was not typed as committed_export_failed: {result}")
    if not export.get("retryable") or not receipt_path.is_dir():
        fail(f"sidecar failure did not retain the retryable directory conflict: {result}")

    readback = cli_command(
        binary,
        root,
        db,
        ["operation", "show", PROJECT, operation],
        "op_v12_sidecar_readback",
        socket_path,
    )
    readback_data = readback.get("data") or {}
    execution = readback_data.get("execution") or {}
    if readback.get("outcome") != "changed" or execution.get("state") != "receipt_committed":
        fail(f"sidecar failure did not read back as receipt_committed: {readback}")
    if not isinstance(execution.get("receipt"), dict) or execution["receipt"].get("operation_id") != operation:
        fail(f"sidecar failure readback omitted the durable receipt: {readback}")
    print("PASS v12-sidecar-export: receipt committed and read back after export failure")


def main() -> int:
    root = Path(__file__).resolve().parents[3]
    binary = resolve_binary(root)
    with tempfile.TemporaryDirectory(prefix="boreal-v12-security-") as directory:
        fixture = Path(directory)
        db = fixture / "boreal.sqlite"
        socket_path = fixture / "service.sock"
        source = fixture / "source.txt"
        source.write_text("V12 source fixture\n", encoding="utf-8")

        # The project must be created through the production service route so
        # this fixture proves the same create_project boundary used by a live
        # CLI client. Source registration is currently a direct-only route,
        # so the service is stopped safely before that setup step and then
        # restarted for the actual V12 assertions.
        service = start_service(binary, fixture, db, socket_path)
        try:
            project_init = cli_command(
                binary,
                fixture,
                db,
                ["init", PROJECT],
                "op_v12_init",
                socket_path,
            )
            project_data = project_init.get("data") or {}
            if project_init.get("outcome") != "changed" or project_data.get("project_id") != PROJECT:
                fail(f"production create_project route did not initialize {PROJECT}: {project_init}")
        finally:
            stop_service(service)

        source_result = cli_command(
            binary,
            fixture,
            db,
            ["source", "add", PROJECT, "--input", str(source), "--origin", "v12-security", "--media-type", "text/plain"],
            "op_v12_source",
        )
        source_id = ((source_result.get("data") or {}).get("source") or {}).get("source_version_id")
        if not isinstance(source_id, str) or not source_id:
            fail(f"source fixture did not return a source version identity: {source_result}")

        service = start_service(binary, fixture, db, socket_path)
        try:
            run_sidecar_failure(binary, fixture, db, socket_path, source_id)
            run_envelope_matrix(socket_path)
        finally:
            stop_service(service)
            if service.returncode not in (0, -signal.SIGTERM):
                stdout = service.stdout.read().decode(errors="replace") if service.stdout else ""
                stderr = service.stderr.read().decode(errors="replace") if service.stderr else ""
                fail(f"service exited unexpectedly: {service.returncode}\nstdout={stdout}\nstderr={stderr}")

    print("PASS v12: production CLI/service envelope and sidecar gates")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except V12Failure as error:
        print(f"FAIL v12: {error}", file=sys.stderr)
        raise SystemExit(1)
