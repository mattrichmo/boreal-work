#!/usr/bin/env python3
"""Exercise Intake delivery compatibility in a disposable project root."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import platform
import shutil
import socket
import sqlite3
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path
from typing import Any


PROJECT_ID = "s08-t05-project"
ACTOR_ID = "operator"
SESSION_ID = "session-operator"
PREDECESSOR_SOURCE = "f735a903fdc1470f29e98201aedbbb8b3c7d34df"
PREDECESSOR_REASON = "before the intake_delivery additive feature was installed"
ACTIVE_SERVICES: dict[int, tuple[subprocess.Popen[str], Any, Path]] = {}
TEMP_BUILD_DIRS: list[Path] = []
RUN_METADATA: dict[str, Any] = {
    "predecessor_source": PREDECESSOR_SOURCE,
    "predecessor_reason": PREDECESSOR_REASON,
}
COMMAND_EVENTS: list[dict[str, Any]] = []


class ValidationError(RuntimeError):
    pass


def canonical_digest(command: str, payload: dict[str, Any]) -> str:
    value = {
        "command": command,
        "payload": payload,
        "schema": "boreal.operation-request.v1",
    }
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def quote_command(argv: list[str]) -> str:
    return " ".join(json.dumps(str(arg)) for arg in argv)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def output_metadata(value: str) -> dict[str, Any]:
    """Retain only output size and digest; output may contain arbitrary fixture text."""
    encoded = value.encode("utf-8", errors="replace")
    return {
        "bytes": len(encoded),
        "sha256": hashlib.sha256(encoded).hexdigest(),
    }


def persist_failure(error: BaseException) -> Path | None:
    """Retain bounded diagnostics only; never retain the disposable project DB."""
    try:
        root = Path(tempfile.gettempdir()) / "boreal-s08-t05-failures"
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(root, 0o700)
        destination = Path(tempfile.mkdtemp(prefix="run-", dir=root))
        os.chmod(destination, 0o700)
        record = {
            "schema": "boreal.s08.t05.failure.v1",
            "metadata": RUN_METADATA,
            "failure": {
                "type": type(error).__name__,
                "summary": "validation failed; inspect the labeled command digests and rerun locally",
            },
            "commands": COMMAND_EVENTS[-40:],
            "retained_data": "bounded command metadata only; fixture database and service logs were removed",
        }
        output = destination / "failure.json"
        output.write_text(
            json.dumps(record, sort_keys=True, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        os.chmod(output, 0o600)
        return output
    except OSError as write_error:
        print(f"could not persist bounded failure metadata: {write_error}", file=sys.stderr)
        return None


def print_json_result(label: str, value: Any) -> None:
    print(
        f"[{label}:result] "
        + json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    )


def run_cli(
    binary: Path,
    args: list[str],
    cwd: Path,
    label: str,
    *,
    expect_success: bool = True,
) -> tuple[subprocess.CompletedProcess[str], Any | None]:
    argv = [str(binary), *map(str, args)]
    print(f"[{label}] {quote_command(argv)}")
    environment = os.environ.copy()
    environment.update({"BOREAL_PLAIN": "1", "TERM": "dumb"})
    completed = subprocess.run(
        argv,
        cwd=cwd,
        env=environment,
        capture_output=True,
        text=True,
        timeout=90,
    )
    command_path = [Path(args[0]).name] if args else []
    if args and str(args[0]) in {"work", "intake", "service"} and len(args) > 1:
        if not str(args[1]).startswith("--"):
            command_path.append(str(args[1]))
    COMMAND_EVENTS.append(
        {
            "label": label,
            "command": command_path,
            "exit_code": completed.returncode,
            "stdout": output_metadata(completed.stdout),
            "stderr": output_metadata(completed.stderr),
        }
    )
    if expect_success and completed.returncode != 0:
        raise ValidationError(
            f"{label} exited {completed.returncode}:\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    if not expect_success and completed.returncode == 0:
        raise ValidationError(f"{label} unexpectedly succeeded: {completed.stdout}")
    parsed: Any | None = None
    if completed.stdout.strip():
        try:
            parsed = json.loads(completed.stdout)
        except json.JSONDecodeError:
            if expect_success:
                raise ValidationError(
                    f"{label} did not return JSON:\n{completed.stdout}\n{completed.stderr}"
                )
    print(f"[{label}] exit={completed.returncode}")
    return completed, parsed


def object_data(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"expected a JSON object, found {type(value).__name__}")
    data = value.get("data")
    if isinstance(data, dict):
        return data
    if isinstance(data, str):
        try:
            decoded = json.loads(data)
        except json.JSONDecodeError:
            decoded = None
        if isinstance(decoded, dict):
            return decoded
    return value


def revision_of(value: Any) -> int:
    candidates: list[Any] = []
    if isinstance(value, dict):
        candidates.extend([value.get("revision"), value.get("project_revision")])
        data = value.get("data")
        if isinstance(data, dict):
            candidates.extend([data.get("revision"), data.get("project_revision")])
        if isinstance(data, str):
            try:
                decoded = json.loads(data)
            except json.JSONDecodeError:
                decoded = None
            if isinstance(decoded, dict):
                candidates.extend(
                    [decoded.get("revision"), decoded.get("project_revision")]
                )
    for candidate in candidates:
        if isinstance(candidate, int) and not isinstance(candidate, bool):
            return candidate
    raise ValidationError(f"response has no project revision: {value!r}")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def cli_json(
    binary: Path, args: list[str], cwd: Path, label: str
) -> dict[str, Any]:
    _, value = run_cli(binary, [*args, "--json"], cwd, label)
    if not isinstance(value, dict):
        raise ValidationError(f"{label} returned a non-object JSON value")
    return value


def start_service(
    binary: Path, root: Path, database: Path, socket_path: Path, max_requests: int
) -> subprocess.Popen[str]:
    argv = [
        str(binary),
        "service",
        "run",
        "--db",
        str(database),
        "--socket",
        str(socket_path),
        "--max-requests",
        str(max_requests),
        "--json",
    ]
    log_path = root / ".boreal" / "s08-t05-service.log"
    log = log_path.open("w", encoding="utf-8")
    print(f"[service-start] {quote_command(argv)}")
    process = subprocess.Popen(
        argv,
        cwd=root,
        env={**os.environ, "BOREAL_PLAIN": "1", "TERM": "dumb"},
        stdout=log,
        stderr=subprocess.STDOUT,
        text=True,
    )
    ACTIVE_SERVICES[process.pid] = (process, log, log_path)
    for _ in range(400):
        if process.poll() is not None:
            raise ValidationError(
                f"service exited {process.returncode} during startup:\n"
                f"{log_path.read_text(encoding='utf-8', errors='replace')}"
            )
        if socket_path.exists() and stat.S_ISSOCK(socket_path.stat().st_mode):
            time.sleep(0.05)
            return process
        time.sleep(0.025)
    log.close()
    raise ValidationError("service socket did not appear before the startup deadline")


def stop_service(
    process: subprocess.Popen[str], root: Path, expected_requests: int
) -> None:
    try:
        code = process.wait(timeout=15)
    except subprocess.TimeoutExpired as error:
        raise ValidationError(
            "bounded service did not stop after its configured request count"
        ) from error
    log_path = root / ".boreal" / "s08-t05-service.log"
    active = ACTIVE_SERVICES.pop(process.pid, None)
    if active is not None:
        active[1].close()
    if code != 0:
        raise ValidationError(
            f"bounded service exited {code}:\n"
            f"{log_path.read_text(encoding='utf-8', errors='replace')}"
        )
    print(f"[service-stop] exit=0 requests={expected_requests}")


def cleanup_services() -> None:
    for process, log, _log_path in list(ACTIVE_SERVICES.values()):
        if process.poll() is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                process.wait(timeout=5)
        if not log.closed:
            log.close()
    ACTIVE_SERVICES.clear()
    for build_dir in TEMP_BUILD_DIRS:
        shutil.rmtree(build_dir, ignore_errors=True)
    TEMP_BUILD_DIRS.clear()


def send_application_request(
    socket_path: Path,
    operation_id: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    outer = {
        "api_version": "2",
        "schema_version": "boreal.protocol.envelope.v1",
        "operation_id": operation_id,
        "data": data,
    }
    body = json.dumps(
        {"request_id": f"request-{operation_id}", "payload": outer},
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
        stream.settimeout(10)
        stream.connect(str(socket_path))
        stream.sendall(struct.pack(">I", len(body)) + body)
        size = struct.unpack(">I", recv_exact(stream, 4))[0]
        response = json.loads(recv_exact(stream, size))
    require(
        response.get("request_id") == f"request-{operation_id}",
        f"service response correlation mismatch for {operation_id}",
    )
    app_response = response.get("payload")
    require(isinstance(app_response, dict), "service response omitted its payload")
    require(app_response.get("api_version") == "2", "service API version mismatch")
    require(
        app_response.get("operation_id") == operation_id,
        f"service response operation correlation mismatch for {operation_id}",
    )
    require(
        app_response.get("schema_version") == "boreal.protocol.envelope.v1",
        "service envelope schema mismatch",
    )
    envelope = app_response.get("data")
    require(isinstance(envelope, str), "service response omitted the application envelope")
    decoded = json.loads(envelope)
    require(isinstance(decoded, dict), "application response is not an object")
    require(
        decoded.get("operation_id") == operation_id,
        f"application envelope operation mismatch for {operation_id}",
    )
    return decoded


def recv_exact(stream: socket.socket, size: int) -> bytes:
    output = bytearray()
    while len(output) < size:
        chunk = stream.recv(size - len(output))
        if not chunk:
            raise ValidationError("service closed the socket before completing a frame")
        output.extend(chunk)
    return bytes(output)


def envelope_data(envelope: dict[str, Any]) -> dict[str, Any]:
    data = envelope.get("data")
    if isinstance(data, dict):
        return data
    raise ValidationError(f"service envelope has no object data: {envelope!r}")


def build_predecessor(
    repo: Path, scratch: Path, target_dir: Path
) -> tuple[Path, Path]:
    archive = subprocess.run(
        ["git", "archive", "--format=tar", PREDECESSOR_SOURCE],
        cwd=repo,
        capture_output=True,
        check=True,
    )
    source_dir = scratch / "predecessor-source"
    source_dir.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive.stdout), mode="r:") as tar:
        tar.extractall(source_dir)
    environment = os.environ.copy()
    environment.update(
        {
            "CARGO_BUILD_JOBS": "2",
            "CARGO_PROFILE_DEV_DEBUG": "0",
            "CARGO_TARGET_DIR": str(target_dir),
            "BOREAL_BUILD_REVISION": PREDECESSOR_SOURCE,
        }
    )
    command = [
        "cargo",
        "build",
        "--offline",
        "--manifest-path",
        str(source_dir / "Cargo.toml"),
        "-p",
        "boreal-cli",
    ]
    print(f"[predecessor-build] {quote_command(command)} source={PREDECESSOR_SOURCE}")
    result = subprocess.run(
        command,
        cwd=source_dir,
        env=environment,
        text=True,
        capture_output=True,
    )
    COMMAND_EVENTS.append(
        {
            "label": "predecessor-build",
            "command": ["cargo", "build", "--offline", "-p", "boreal-cli"],
            "source_revision": PREDECESSOR_SOURCE,
            "exit_code": result.returncode,
            "stdout": output_metadata(result.stdout),
            "stderr": output_metadata(result.stderr),
        }
    )
    if result.returncode != 0:
        raise ValidationError(
            "predecessor build failed; additive-feature compatibility remains "
            f"unqualified (source {PREDECESSOR_SOURCE}, exit {result.returncode})"
        )
    binary_name = "bwrk.exe" if os.name == "nt" else "bwrk"
    binary = target_dir / "debug" / binary_name
    require(binary.is_file(), f"predecessor binary not found at {binary}")
    return binary, source_dir


def current_binary(repo: Path, configured: Path | None) -> Path:
    if configured:
        binary = configured.expanduser().resolve()
        require(binary.is_file(), f"CLI binary does not exist: {binary}")
        return binary
    target_dir = Path(tempfile.mkdtemp(prefix="boreal-s08-t05-candidate-build-"))
    TEMP_BUILD_DIRS.append(target_dir)
    binary = target_dir / "debug" / ("bwrk.exe" if os.name == "nt" else "bwrk")
    environment = os.environ.copy()
    environment.update(
        {
            "CARGO_BUILD_JOBS": "2",
            "CARGO_PROFILE_DEV_DEBUG": "0",
            "CARGO_TARGET_DIR": str(target_dir),
        }
    )
    command = ["cargo", "build", "--offline", "-p", "boreal-cli"]
    print(f"[candidate-build] {quote_command(command)}")
    result = subprocess.run(
        command,
        cwd=repo,
        env=environment,
        text=True,
        capture_output=True,
    )
    COMMAND_EVENTS.append(
        {
            "label": "candidate-build",
            "command": ["cargo", "build", "--offline", "-p", "boreal-cli"],
            "source_revision": RUN_METADATA.get("candidate_source"),
            "exit_code": result.returncode,
            "stdout": output_metadata(result.stdout),
            "stderr": output_metadata(result.stderr),
        }
    )
    if result.returncode != 0:
        raise ValidationError(
            f"candidate build failed with exit {result.returncode}; "
            "bounded build diagnostics are in the failure metadata"
        )
    require(binary.is_file(), f"candidate binary not found at {binary}")
    return binary.resolve()


def create_receipt_request(
    credential: str,
    expected_revision: int,
    delivery_key: str,
    intake_id: str,
    content: str,
) -> dict[str, Any]:
    bucket_id = "delivery-inbox"
    payload = {
        "schema": "boreal.intake_delivery.payload.v1",
        "bucket_id": bucket_id,
        "kind": "note",
        "content": content,
        "revisit_at_utc_ms": None,
    }
    return {
        "command": "intake_delivery_receive_v1",
        "project_id": PROJECT_ID,
        "actor_id": ACTOR_ID,
        "session_id": SESSION_ID,
        "credential_ref": credential,
        "delivery": {
            "schema_version": "boreal.intake_delivery.receive.v1",
            "expected_revision": expected_revision,
            "delivery_key": delivery_key,
            "origin": {
                "kind": "capture",
                "item_id": "capture-fixture-1",
                "digest": "sha256:" + "a" * 64,
            },
            "intake_id": intake_id,
            "payload": {
                "bucket_id": bucket_id,
                "kind": "note",
                "content": content,
                "revisit_at_utc_ms": None,
            },
            "payload_digest": canonical_digest(
                "intake.delivery.payload/v1", payload
            ),
        },
    }


def current_work_revision(binary: Path, root: Path) -> int:
    response = cli_json(
        binary,
        ["work", "list", PROJECT_ID, "--db", ".boreal/boreal.sqlite"],
        root,
        "work-list-revision",
    )
    return revision_of(response)


def current_intake_revision(binary: Path, root: Path) -> int:
    response = cli_json(
        binary,
        ["intake", "list", "--project", PROJECT_ID, "--db", ".boreal/boreal.sqlite"],
        root,
        "intake-list-revision",
    )
    return revision_of(response)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, help="repository root (defaults from this file)")
    parser.add_argument("--binary", type=Path, help="built candidate bwrk binary")
    parser.add_argument(
        "--predecessor-binary",
        type=Path,
        help="use an already-built binary from before intake_delivery installation",
    )
    parser.add_argument(
        "--skip-predecessor",
        action="store_true",
        help="skip predecessor tolerance; reports it as unqualified",
    )
    args = parser.parse_args()
    repo = (args.repo or Path(__file__).resolve().parents[3]).resolve()
    require((repo / "Cargo.toml").is_file(), f"not a Boreal repository: {repo}")
    require(os.name == "posix", "unsupported: this harness requires Unix-domain sockets")

    candidate_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, text=True, capture_output=True, check=True
    ).stdout.strip()
    require(len(candidate_sha) == 40, f"unexpected candidate source SHA: {candidate_sha}")
    RUN_METADATA["candidate_source"] = candidate_sha
    RUN_METADATA["runtime"] = {
        "os": platform.system(),
        "release": platform.release(),
        "python": platform.python_version(),
        "sqlite": sqlite3.sqlite_version,
    }
    clean_source = subprocess.run(
        ["git", "diff-index", "--quiet", "HEAD", "--"], cwd=repo, check=False
    )
    require(
        clean_source.returncode == 0,
        "candidate checkout has tracked changes; exact source identity cannot be qualified",
    )
    candidate = current_binary(repo, args.binary)
    candidate_version = cli_json(candidate, ["version"], repo, "candidate-build-identity")
    RUN_METADATA["candidate_binary_sha256"] = file_sha256(candidate)
    RUN_METADATA["candidate_build_revision"] = object_data(candidate_version).get(
        "build_revision"
    )
    require(
        RUN_METADATA["candidate_build_revision"] == candidate_sha,
        "candidate binary does not report the current source revision",
    )
    print_json_result("candidate-build-identity", object_data(candidate_version))

    with tempfile.TemporaryDirectory(prefix="boreal-s08-t05-") as temporary:
        scratch = Path(temporary)
        root = scratch / "project"
        root.mkdir()
        database = Path(".boreal/boreal.sqlite")
        socket_path = root / ".boreal" / "s08-t05.sock"
        print(f"candidate source SHA: {candidate_sha}")
        print(f"candidate binary: {candidate}")
        print(f"candidate binary SHA-256: {file_sha256(candidate)}")
        print(
            "harness runtime: "
            f"{platform.system()} {platform.release()}, Python {platform.python_version()}, "
            f"SQLite {sqlite3.sqlite_version}"
        )
        print(f"disposable root: {root}")

        cli_json(
            candidate,
            [
                "init",
                str(root),
                "--project",
                PROJECT_ID,
                "--yes",
                "--agents",
                "codex",
            ],
            repo,
            "initialize-disposable-project",
        )
        require((root / database).is_file(), "init did not create the project database")

        initial_revision = current_work_revision(candidate, root)
        cli_json(
            candidate,
            [
                "work",
                "create",
                PROJECT_ID,
                "baseline-work",
                "Ordinary work before delivery",
                "--kind",
                "task",
                "--expected-revision",
                str(initial_revision),
                "--db",
                str(database),
            ],
            root,
            "create-pre-receipt-work",
        )
        cli_json(
            candidate,
            [
                "intake",
                "bucket",
                "--project",
                PROJECT_ID,
                "baseline-inbox",
                "Baseline Inbox",
                "--db",
                str(database),
            ],
            root,
            "create-pre-receipt-bucket",
        )
        cli_json(
            candidate,
            [
                "intake",
                "capture",
                "--project",
                PROJECT_ID,
                "legacy-intake",
                "Captured before any delivery.",
                "--bucket",
                "baseline-inbox",
                "--db",
                str(database),
            ],
            root,
            "capture-pre-receipt-intake",
        )
        cli_json(
            candidate,
            ["work", "list", PROJECT_ID, "--db", str(database)],
            root,
            "pre-receipt-work-list",
        )
        cli_json(
            candidate,
            ["work", "show", PROJECT_ID, "baseline-work", "--db", str(database)],
            root,
            "pre-receipt-work-show",
        )
        cli_json(
            candidate,
            ["intake", "list", "--project", PROJECT_ID, "--db", str(database)],
            root,
            "pre-receipt-intake-list",
        )
        cli_json(
            candidate,
            [
                "intake",
                "show",
                "--project",
                PROJECT_ID,
                "legacy-intake",
                "--db",
                str(database),
            ],
            root,
            "pre-receipt-intake-show",
        )
        cli_json(
            candidate,
            [
                "intake",
                "disposition",
                "--project",
                PROJECT_ID,
                "legacy-intake",
                "--state",
                "triaged",
                "--expected-revision",
                str(current_intake_revision(candidate, root)),
                "--yes",
                "--db",
                str(database),
            ],
            root,
            "pre-receipt-intake-disposition",
        )

        no_receipt_package = ".boreal/backup-without-delivery"
        cli_json(
            candidate,
            [
                "backup",
                "--project",
                PROJECT_ID,
                no_receipt_package,
                "--db",
                str(database),
            ],
            root,
            "backup-without-receipt",
        )

        credential_path = (
            root
            / ".boreal"
            / "credentials"
            / ("sha256-" + hashlib.sha256(ACTOR_ID.encode()).hexdigest() + ".json")
        )
        credential_record = json.loads(credential_path.read_text(encoding="utf-8"))
        require(
            credential_record.get("project_id") == PROJECT_ID
            and credential_record.get("actor_id") == ACTOR_ID,
            "disposable project credential does not match the fixture",
        )
        credential = credential_record["credential"]

        first_receipt = create_receipt_request(
            credential,
            current_intake_revision(candidate, root),
            "delivery-key-1",
            "delivered-intake",
            "Frozen delivery content.",
        )
        process = start_service(candidate, root, database, socket_path, 5)
        pre_receipt_read = cli_json(
            candidate,
            [
                "intake",
                "show",
                "--project",
                PROJECT_ID,
                "legacy-intake",
                "--socket",
                str(socket_path),
            ],
            root,
            "service-read-preexisting-intake",
        )
        pre_receipt_data = object_data(pre_receipt_read)
        require(
            pre_receipt_data.get("delivery_receipt") is None,
            "existing Intake was incorrectly assigned a delivery receipt",
        )

        first_envelope = send_application_request(
            socket_path, "op_s08_t05_receive_first", first_receipt
        )
        require(first_envelope.get("outcome") == "changed", "first delivery was not committed")
        first_data = envelope_data(first_envelope)
        require(first_data.get("state") == "received", "first delivery readback is not received")
        original_receipt = first_data.get("receipt")
        require(isinstance(original_receipt, dict), "first delivery omitted its receipt")
        require(original_receipt.get("delivery_key") == "delivery-key-1", "wrong receipt key")
        original_revision = revision_of(first_envelope)
        print_json_result("first-delivery-readback", first_envelope)

        duplicate_envelope = send_application_request(
            socket_path,
            "op_s08_t05_receive_duplicate",
            first_receipt,
        )
        require(
            duplicate_envelope.get("outcome") == "unchanged",
            "same-key same-payload retry was not idempotent",
        )
        require(
            revision_of(duplicate_envelope) == original_revision,
            "duplicate delivery changed the project revision",
        )
        print_json_result("same-payload-retry", duplicate_envelope)

        conflict_request = create_receipt_request(
            credential,
            original_revision,
            "delivery-key-1",
            "delivered-intake",
            "Conflicting payload content.",
        )
        conflict_envelope = send_application_request(
            socket_path,
            "op_s08_t05_receive_conflict",
            conflict_request,
        )
        require(
            conflict_envelope.get("outcome") == "conflict",
            "same-key changed-payload retry did not conflict",
        )
        print_json_result("changed-payload-conflict", conflict_envelope)
        after_conflict_envelope = send_application_request(
            socket_path,
            "op_s08_t05_receive_after_conflict",
            first_receipt,
        )
        require(
            after_conflict_envelope.get("outcome") == "unchanged"
            and revision_of(after_conflict_envelope) == original_revision,
            "conflicting delivery changed the project revision",
        )
        print_json_result("retry-after-conflict", after_conflict_envelope)
        stop_service(process, root, expected_requests=5)

        # The current public application exposes disposition but no mutable
        # Intake-content edit command. Exercise the mutable row edit only in
        # this disposable fixture; the receipt remains protected by its own
        # immutable feature-table triggers.
        edited_content = "Edited mutable Intake fixture content."
        edited_digest = "sha256:" + hashlib.sha256(edited_content.encode()).hexdigest()
        with sqlite3.connect(root / database) as connection:
            changed = connection.execute(
                "UPDATE intake_item_v3 "
                "SET content=?, content_revision=content_revision+1, content_digest=? "
                "WHERE project_id=? AND intake_id=?",
                (edited_content, edited_digest, PROJECT_ID, "delivered-intake"),
            ).rowcount
        require(changed == 1, "fixture Intake edit did not update exactly one item")

        receipt_write_errors: list[str] = []
        for sql in [
            "UPDATE intake_delivery_v1 SET payload_digest=? "
            "WHERE project_id=? AND delivery_key=?",
            "DELETE FROM intake_delivery_v1 WHERE project_id=? AND delivery_key=?",
        ]:
            with sqlite3.connect(root / database) as connection:
                try:
                    if sql.startswith("UPDATE"):
                        connection.execute(sql, ("sha256:" + "0" * 64, PROJECT_ID, "delivery-key-1"))
                    else:
                        connection.execute(sql, (PROJECT_ID, "delivery-key-1"))
                    connection.commit()
                except sqlite3.IntegrityError as error:
                    receipt_write_errors.append(str(error))
        require(
            len(receipt_write_errors) == 2
            and all("intake_delivery_receipts_are_immutable" in error for error in receipt_write_errors),
            "receipt UPDATE/DELETE were not both rejected by immutable triggers",
        )
        print("[fixture-intake-edit] updated only the disposable mutable Intake row")
        print("[receipt-mutation-guards] UPDATE and DELETE rejected by schema triggers")

        process = start_service(candidate, root, database, socket_path, 5)
        edited_read = cli_json(
            candidate,
            [
                "intake",
                "show",
                "--project",
                PROJECT_ID,
                "delivered-intake",
                "--socket",
                str(socket_path),
            ],
            root,
            "read-after-fixture-content-edit",
        )
        edited_data = object_data(edited_read)
        require(edited_data.get("item", {}).get("content") == edited_content, "edited content missing")
        require(
            edited_data.get("delivery_receipt") == original_receipt,
            "Intake content edit changed the immutable receipt",
        )
        print_json_result(
            "edited-intake-readback",
            {
                "item": edited_data.get("item"),
                "delivery_receipt": edited_data.get("delivery_receipt"),
                "revision": revision_of(edited_read),
            },
        )

        promote_revision = revision_of(edited_read)
        cli_json(
            candidate,
            [
                "intake",
                "promote",
                "--project",
                PROJECT_ID,
                "delivered-intake",
                "--target-kind",
                "draft_work",
                "--target-id",
                "baseline-work",
                "--expected-revision",
                str(promote_revision),
                "--yes",
                "--socket",
                str(socket_path),
            ],
            root,
            "promote-received-intake",
        )
        promoted_read = cli_json(
            candidate,
            [
                "intake",
                "show",
                "--project",
                PROJECT_ID,
                "delivered-intake",
                "--socket",
                str(socket_path),
            ],
            root,
            "read-after-promotion",
        )
        promoted_data = object_data(promoted_read)
        require(
            promoted_data.get("delivery_receipt") == original_receipt,
            "promotion changed the immutable receipt",
        )
        print_json_result(
            "promoted-intake-readback",
            {
                "item": promoted_data.get("item"),
                "delivery_receipt": promoted_data.get("delivery_receipt"),
            },
        )
        archive_revision = revision_of(promoted_read)
        cli_json(
            candidate,
            [
                "intake",
                "disposition",
                "--project",
                PROJECT_ID,
                "delivered-intake",
                "--state",
                "archived",
                "--expected-revision",
                str(archive_revision),
                "--yes",
                "--socket",
                str(socket_path),
            ],
            root,
            "archive-received-intake",
        )
        archived_read = cli_json(
            candidate,
            [
                "intake",
                "show",
                "--project",
                PROJECT_ID,
                "delivered-intake",
                "--socket",
                str(socket_path),
            ],
            root,
            "read-after-archive",
        )
        archived_data = object_data(archived_read)
        require(
            archived_data.get("item", {}).get("lifecycle") == "archived",
            "received Intake was not archived",
        )
        require(
            archived_data.get("delivery_receipt") == original_receipt,
            "archive changed the immutable receipt",
        )
        print_json_result(
            "archived-intake-readback",
            {
                "item": archived_data.get("item"),
                "delivery_receipt": archived_data.get("delivery_receipt"),
            },
        )
        stop_service(process, root, expected_requests=5)

        with_receipt_package = ".boreal/backup-with-delivery"
        cli_json(
            candidate,
            [
                "backup",
                "--project",
                PROJECT_ID,
                with_receipt_package,
                "--db",
                str(database),
            ],
            root,
            "backup-with-receipt",
        )

        if not args.skip_predecessor:
            predecessor = (
                args.predecessor_binary.expanduser().resolve()
                if args.predecessor_binary
                else None
            )
            if predecessor is None:
                candidate_copy = scratch / "candidate-bwrk"
                shutil.copy2(candidate, candidate_copy)
                predecessor, _ = build_predecessor(
                    repo, scratch, scratch / "predecessor-target"
                )
                candidate = candidate_copy
            require(predecessor.is_file(), f"predecessor binary does not exist: {predecessor}")
            print(f"predecessor source SHA: {PREDECESSOR_SOURCE} ({PREDECESSOR_REASON})")
            print(f"predecessor binary: {predecessor}")
            RUN_METADATA["predecessor_binary_sha256"] = file_sha256(predecessor)
            print(
                "predecessor binary SHA-256: "
                + RUN_METADATA["predecessor_binary_sha256"]
            )
            predecessor_version = cli_json(
                predecessor,
                ["version"],
                root,
                "predecessor-build-identity",
            )
            RUN_METADATA["predecessor_build_revision"] = object_data(
                predecessor_version
            ).get("build_revision")
            require(
                RUN_METADATA["predecessor_build_revision"] == PREDECESSOR_SOURCE,
                "predecessor binary does not report the pinned source revision",
            )
            print_json_result(
                "predecessor-build-identity", object_data(predecessor_version)
            )
            cli_json(
                predecessor,
                ["work", "list", PROJECT_ID, "--db", str(database)],
                root,
                "predecessor-work-list-on-feature-db",
            )
            cli_json(
                predecessor,
                ["work", "show", PROJECT_ID, "baseline-work", "--db", str(database)],
                root,
                "predecessor-work-show-on-feature-db",
            )
            cli_json(
                predecessor,
                ["intake", "list", "--project", PROJECT_ID, "--db", str(database)],
                root,
                "predecessor-intake-list-on-feature-db",
            )
            cli_json(
                predecessor,
                [
                    "intake",
                    "show",
                    "--project",
                    PROJECT_ID,
                    "delivered-intake",
                    "--db",
                    str(database),
                ],
                root,
                "predecessor-intake-show-on-feature-db",
            )
            print("[compatibility] predecessor ordinary reads passed on receipt-bearing database")
        else:
            print("[compatibility] UNQUALIFIED: predecessor binary check explicitly skipped")

        first_restore = cli_json(
            candidate,
            [
                "restore",
                no_receipt_package,
                "--db",
                str(database),
                "--yes",
                "--operation-id",
                "op_s08_t05_restore_without_receipt",
            ],
            root,
            "restore-backup-without-receipt",
        )
        first_restore_data = object_data(first_restore)
        first_instance = first_restore_data.get("current_database_instance_id")
        first_epoch = first_restore_data.get("current_restore_epoch")
        require(isinstance(first_instance, str), "restore-without-receipt omitted physical identity")
        require(isinstance(first_epoch, int), "restore-without-receipt omitted restore epoch")
        print_json_result(
            "restore-without-receipt-result",
            {
                "current_database_instance_id": first_instance,
                "current_restore_epoch": first_epoch,
                "source_database_instance_id": first_restore_data.get(
                    "source_database_instance_id"
                ),
                "source_restore_epoch": first_restore_data.get("source_restore_epoch"),
            },
        )

        process = start_service(candidate, root, database, socket_path, 1)
        no_receipt_read = cli_json(
            candidate,
            [
                "intake",
                "show",
                "--project",
                PROJECT_ID,
                "legacy-intake",
                "--socket",
                str(socket_path),
            ],
            root,
            "post-restore-no-receipt-readback",
        )
        require(
            object_data(no_receipt_read).get("delivery_receipt") is None,
            "restore without a receipt fabricated one",
        )
        no_receipt_item = object_data(no_receipt_read).get("item")
        require(
            isinstance(no_receipt_item, dict)
            and no_receipt_item.get("content") == "Captured before any delivery."
            and no_receipt_item.get("lifecycle") == "triaged",
            "restore without a receipt changed the preexisting Intake row",
        )
        stop_service(process, root, expected_requests=1)

        second_restore = cli_json(
            candidate,
            [
                "restore",
                with_receipt_package,
                "--db",
                str(database),
                "--yes",
                "--operation-id",
                "op_s08_t05_restore_with_receipt",
            ],
            root,
            "restore-backup-with-receipt",
        )
        second_restore_data = object_data(second_restore)
        second_instance = second_restore_data.get("current_database_instance_id")
        second_epoch = second_restore_data.get("current_restore_epoch")
        require(isinstance(second_instance, str), "restore-with-receipt omitted physical identity")
        require(isinstance(second_epoch, int), "restore-with-receipt omitted restore epoch")
        require(first_instance != second_instance, "restore activations reused physical identity")
        require(second_epoch > first_epoch, "restore epoch did not advance between activations")
        print_json_result(
            "restore-with-receipt-result",
            {
                "current_database_instance_id": second_instance,
                "current_restore_epoch": second_epoch,
                "source_database_instance_id": second_restore_data.get(
                    "source_database_instance_id"
                ),
                "source_restore_epoch": second_restore_data.get("source_restore_epoch"),
            },
        )

        process = start_service(candidate, root, database, socket_path, 1)
        receipt_read = cli_json(
            candidate,
            [
                "intake",
                "show",
                "--project",
                PROJECT_ID,
                "delivered-intake",
                "--socket",
                str(socket_path),
            ],
            root,
            "post-restore-receipt-readback",
        )
        restored_data = object_data(receipt_read)
        require(
            restored_data.get("delivery_receipt") == original_receipt,
            "receipt-bearing backup did not restore the original receipt",
        )
        require(
            restored_data.get("item", {}).get("content") == edited_content,
            "receipt-bearing backup did not restore edited mutable Intake content",
        )
        require(
            restored_data.get("item", {}).get("lifecycle") == "archived",
            "receipt-bearing backup did not restore Intake lifecycle",
        )
        print_json_result(
            "restored-receipt-readback",
            {
                "item": restored_data.get("item"),
                "delivery_receipt": restored_data.get("delivery_receipt"),
                "revision": revision_of(receipt_read),
            },
        )
        stop_service(process, root, expected_requests=1)

        compatibility = (
            "passed" if not args.skip_predecessor else "unqualified (explicitly skipped)"
        )
        print(f"candidate source SHA: {candidate_sha}")
        print(f"compatibility claim disposition: {compatibility}")
        print("receipt immutability: passed (fixture content edit, promotion, archive, SQL guards)")
        print("backup/restore without receipt: passed")
        print("backup/restore with receipt: passed")
        print("idempotency and changed-payload conflict: passed")
        print("residual gaps: no public Intake content-edit action; tested via disposable-only SQL fixture")
        print("environment scope: current host/runtime only; no cross-platform claim")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        failure_record = persist_failure(error)
        print(f"intake-delivery validation failed: {error}", file=sys.stderr)
        if failure_record is not None:
            print(f"bounded failure metadata: {failure_record}", file=sys.stderr)
        raise SystemExit(1)
    finally:
        cleanup_services()
