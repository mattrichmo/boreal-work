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
OPERATOR = "operator"
AGENT = "v12-agent"
HARNESS = "v12-harness"
SESSION = "v12-session"
OPERATOR_SESSION = "v12-operator-session"
CONFIG = "config-v12"
PROJECT_REVISION = 0
OPERATOR_CREDENTIAL = ""
AGENT_CREDENTIAL = ""


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
    global PROJECT_REVISION
    if data.get("command") == "create_work":
        data["expected_revision"] = PROJECT_REVISION
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
    if inner.get("error") is None and isinstance(inner.get("revision"), int):
        PROJECT_REVISION = inner["revision"]
    return inner, inner_raw


def cli_command(
    binary: Path,
    root: Path,
    db: Path,
    args: list[str],
    operation: str,
    socket_path: Path | None = None,
    *,
    actor: str | None = OPERATOR,
    session: str | None = None,
    expected_revision: int | None = None,
) -> dict[str, Any]:
    global PROJECT_REVISION
    command = [str(binary), *args]
    if actor is not None and "--actor" not in args:
        command.extend(["--actor", actor])
    if session is not None:
        if "--harness" not in args:
            command.extend(["--harness", HARNESS])
        if "--session" not in args:
            command.extend(["--session", session])
    if expected_revision is not None:
        command.extend(["--expected-revision", str(expected_revision)])
    command.extend(["--db", str(db), "--operation-id", operation, "--json"])
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
    if envelope.get("error") is None and isinstance(envelope.get("revision"), int):
        PROJECT_REVISION = envelope["revision"]
    return envelope


def credential(root: Path, actor: str) -> str:
    path = root / ".boreal" / "credentials" / f"{digest(actor.encode()).replace(':', '-')}.json"
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        value = document["credential"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        fail(f"isolated project credential for {actor} is unavailable: {error}")
    if not isinstance(value, str) or not value:
        fail(f"isolated project credential for {actor} is invalid")
    return value


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
        "actor_id": OPERATOR,
        "credential_ref": OPERATOR_CREDENTIAL,
        "harness_id": HARNESS,
        "session_id": OPERATOR_SESSION,
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
        "expected_revision": PROJECT_REVISION,
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
        actor=OPERATOR,
        session=OPERATOR_SESSION,
        expected_revision=PROJECT_REVISION,
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
        actor=AGENT,
        session=SESSION,
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
        actor=AGENT,
        session=SESSION,
    )
    if start.get("outcome") != "changed":
        fail(f"sidecar fixture attempt did not start: {start}")

    gate_root = (db.parent / "gates").resolve()
    gate_root.mkdir(parents=True, exist_ok=True)
    if not (gate_root / "verification.json").is_file():
        fail("published verification gate declaration is missing from the project gate root")

    operation = "op_v12_sidecar_run"
    namespace = digest(f"{PROJECT}:{gate_root}".encode()).replace(":", "-")
    stem = digest(operation.encode()).replace(":", "-")
    output_dir = db.parent / "evidence" / namespace
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
        actor=AGENT,
        session=SESSION,
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
        actor=OPERATOR,
        session=OPERATOR_SESSION,
    )
    readback_data = readback.get("data") or {}
    execution = readback_data.get("execution") or {}
    if readback.get("outcome") != "changed" or execution.get("state") != "receipt_committed":
        fail(f"sidecar failure did not read back as receipt_committed: {readback}")
    if not isinstance(execution.get("receipt"), dict) or execution["receipt"].get("operation_id") != operation:
        fail(f"sidecar failure readback omitted the durable receipt: {readback}")
    print("PASS v12-sidecar-export: receipt committed and read back after export failure")


def main() -> int:
    global PROJECT_REVISION, OPERATOR_CREDENTIAL, AGENT_CREDENTIAL
    root = Path(__file__).resolve().parents[3]
    binary = resolve_binary(root)
    with tempfile.TemporaryDirectory(prefix="boreal-v12-security-") as directory:
        fixture = Path(directory)
        db = fixture / ".boreal" / "boreal.sqlite"
        socket_path = fixture / "service.sock"
        source = fixture / "workspace-fixture"
        source.mkdir()
        (source / "source.txt").write_text("V12 source fixture\n", encoding="utf-8")
        verifier = source / "verify.sh"
        verifier.write_text("#!/bin/sh\nprintf 'v12-sidecar-pass\\n'\n", encoding="utf-8")
        verifier.chmod(0o755)

        # Bootstrap is a local-only product operation. Initialize this
        # temporary fixture before the elected service starts; the service
        # intentionally rejects create_project requests.
        project_init = cli_command(
            binary,
            fixture,
            db,
            ["init", "--project", PROJECT, "--project-root", str(fixture)],
            "op_v12_local_init",
        )
        project_data = project_init.get("data") or {}
        if project_init.get("outcome") != "changed" or (project_data.get("setup") or {}).get("project_id") != PROJECT:
            fail(f"local project bootstrap did not initialize {PROJECT}: {project_init}")
        OPERATOR_CREDENTIAL = credential(fixture, OPERATOR)

        enrollment = cli_command(
            binary,
            fixture,
            db,
            ["auth", "key", "--actor", AGENT, "--actor-role", "agent"],
            "op_v12_agent_key",
            actor=None,
        )
        enrollment_path = (enrollment.get("data") or {}).get("enrollment_path")
        if not isinstance(enrollment_path, str):
            fail(f"agent enrollment omitted its private file path: {enrollment}")
        granted = cli_command(
            binary,
            fixture,
            db,
            [
                "auth", "grant", "--actor", OPERATOR, "--input", enrollment_path,
                "--expected-revision", str(PROJECT_REVISION), "--reason", "isolated V12 test agent", "--yes",
            ],
            "op_v12_agent_grant",
            actor=None,
        )
        if granted.get("outcome") != "changed":
            fail(f"agent grant failed: {granted}")
        AGENT_CREDENTIAL = credential(fixture, AGENT)

        operator_session = cli_command(
            binary,
            fixture,
            db,
            ["session", "start", "--project", PROJECT, "--session", OPERATOR_SESSION, "--harness", HARNESS],
            "op_v12_operator_session",
            actor=OPERATOR,
            expected_revision=PROJECT_REVISION,
        )
        if operator_session.get("outcome") != "changed":
            fail(f"operator session setup failed: {operator_session}")
        source_result = cli_command(
            binary,
            fixture,
            db,
            ["source", "add", PROJECT, "--input", str(source), "--origin", "v12-security", "--media-type", "text/plain"],
            "op_v12_source",
            actor=OPERATOR,
            session=OPERATOR_SESSION,
            expected_revision=PROJECT_REVISION,
        )
        source_id = ((source_result.get("data") or {}).get("source") or {}).get("source_version_id")
        if not isinstance(source_id, str) or not source_id:
            fail(f"source fixture did not return a source version identity: {source_result}")

        gate_root = db.parent / "gates"
        gate_root.mkdir(parents=True, exist_ok=True)
        declaration = {
            "gate_id": "verification",
            "policy_revision": 1,
            "kind": "verification",
            "executable": "./verify.sh",
            "verifier_digest": digest(verifier.read_bytes()),
            "argv": ["./verify.sh"],
            "cwd": ".",
            "source_snapshot_hash": source_id,
            "config_identity": CONFIG,
            "environment_fingerprint": "v12-declared-environment",
            "environment_allowlist": [],
            "observables": ["v12-sidecar-pass"],
            "max_runtime_ms": 30_000,
        }
        policy_path = gate_root / "verification.json"
        policy_path.write_text(json.dumps(declaration, indent=2) + "\n", encoding="utf-8")
        published = cli_command(
            binary,
            fixture,
            db,
            [
                "gate", "policy", "publish", "--project", PROJECT, "--gate", "verification",
                "--input", ".boreal/gates/verification.json", "--yes",
            ],
            "op_v12_gate_policy_publish",
            actor=OPERATOR,
            session=OPERATOR_SESSION,
            expected_revision=PROJECT_REVISION,
        )
        if published.get("outcome") != "changed":
            fail(f"gate policy was not published: {published}")

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
