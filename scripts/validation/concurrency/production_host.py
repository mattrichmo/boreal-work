#!/usr/bin/env python3
"""Run bounded dispatch-admission and stop/recovery probes through the CLI service.

The smoke starts the CLI service with one dispatch worker and queue capacity
two, launches separate ``bwrk work show`` clients, and sends a status control
request after a dispatch-full response while normal clients are still active.
It records the CLI's actual error envelope and control timing/overlap. The
optional fake-clock observation is supplemental. The stop/recovery probe uses
normal service defaults and checks post-restart durable readback, but this
script remains partial V10 evidence and is not a scale/performance test.
"""

from __future__ import annotations

import argparse
import concurrent.futures
from dataclasses import dataclass, field
import hashlib
import json
import os
import platform
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SHIM_SOURCE = Path(__file__).with_name("fake_clock.c")
SMOKE_DISPATCH_WORKERS = 1
SMOKE_DISPATCH_CAPACITY = 2
AGENT_INPUT_SCHEMA = "boreal.v10-agent-input.v1"
AGENT_INPUT_FIELDS = frozenset(
    {
        "schema_version",
        "project_id",
        "actor_id",
        "project_root",
        "work_id",
        "source_version_id",
        "config_identity",
        "session_id",
        "harness_id",
        "attempt_id",
        "fence",
    }
)
MAX_AGENT_INPUT_BYTES = 16 * 1024
MAX_CREDENTIAL_BYTES = 8 * 1024


@dataclass(frozen=True)
class AgentInput:
    project_id: str
    actor_id: str
    project_root: Path
    work_id: str
    source_version_id: str
    config_identity: str
    session_id: str
    harness_id: str
    attempt_id: str
    fence: int
    credential: str = field(repr=False, compare=False)


def sanitized_environment(source: dict[str, str] | None = None) -> dict[str, str]:
    environment = (source if source is not None else os.environ).copy()
    environment.pop("BOREAL_CREDENTIAL", None)
    for key in (
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "LD_AUDIT",
        "LD_ORIGIN_PATH",
        "LD_DYNAMIC_WEAK",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "DYLD_FRAMEWORK_PATH",
        "DYLD_FALLBACK_LIBRARY_PATH",
        "DYLD_FALLBACK_FRAMEWORK_PATH",
        "DYLD_ROOT_PATH",
        "DYLD_IMAGE_SUFFIX",
        "DYLD_FORCE_FLAT_NAMESPACE",
    ):
        environment.pop(key, None)
    return environment


def current_cli_source_id() -> str:
    """Mirror crates/cli/build.rs source fingerprint for the current checkout."""
    paths: set[Path] = set()
    for directory in (ROOT / "crates", ROOT / "skills", ROOT / "project/spec/workflows"):
        if not directory.is_dir():
            continue
        for current, child_directories, filenames in os.walk(directory, followlinks=False):
            current_path = Path(current)
            child_directories[:] = [
                name
                for name in child_directories
                if not (current_path / name).is_symlink()
            ]
            for filename in filenames:
                path = current_path / filename
                if path.is_symlink():
                    continue
                relative = path.relative_to(ROOT)
                if any(part in {"tests", "benches", "examples"} for part in relative.parts):
                    continue
                extension = relative.suffix[1:] if relative.suffix else ""
                if path.name == "Cargo.toml" or extension in {"rs", "md", "yaml", "yml", "json", "toml"}:
                    paths.add(path)
    paths.update(
        path
        for path in (
            ROOT / "Cargo.toml",
            ROOT / "Cargo.lock",
            ROOT / "apps/tui/installer/wizard.cjs",
            ROOT / "apps/tui/installer/wizard-body.cjs",
        )
        if path.is_file() and not path.is_symlink()
    )
    digest = hashlib.sha256()
    for path in sorted(paths):
        try:
            relative = path.relative_to(ROOT).as_posix()
            digest.update(relative.encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\n")
        except OSError as error:
            raise RuntimeError("Agent preflight cannot fingerprint current CLI source inputs") from error
    return f"sha256:{digest.hexdigest()}"


def verify_agent_cli(
    binary: Path,
    *,
    trusted_sha256: str,
    snapshot_directory: Path,
) -> tuple[Path, dict]:
    """Copy and verify the independently pinned CLI bytes before credential use."""
    try:
        metadata = binary.lstat()
    except OSError as error:
        raise RuntimeError("Agent preflight CLI is unavailable") from error
    if (
        binary.resolve() != (ROOT / "target/debug/bwrk").resolve()
        or stat.S_ISLNK(metadata.st_mode)
        or not stat.S_ISREG(metadata.st_mode)
        or not metadata.st_mode & 0o111
        or not hasattr(os, "geteuid")
        or metadata.st_uid != os.geteuid()
        or metadata.st_mode & 0o022
    ):
        raise RuntimeError("Agent preflight CLI is not a private executable owned by the running user")
    if (
        not isinstance(trusted_sha256, str)
        or len(trusted_sha256) != 71
        or not trusted_sha256.startswith("sha256:")
        or any(char not in "0123456789abcdef" for char in trusted_sha256[7:])
    ):
        raise RuntimeError("Agent preflight requires a trusted CLI SHA-256 build record")
    try:
        source_fd = os.open(binary, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
    except OSError as error:
        raise RuntimeError("Agent preflight CLI changed before it could be pinned") from error
    try:
        opened = os.fstat(source_fd)
        if (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino):
            raise RuntimeError("Agent preflight CLI changed before it could be pinned")
        snapshot_fd, snapshot_name = tempfile.mkstemp(prefix="bwrk-", dir=snapshot_directory)
        snapshot_path = Path(snapshot_name)
        digest = hashlib.sha256()
        try:
            while True:
                chunk = os.read(source_fd, 1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                view = memoryview(chunk)
                while view:
                    written = os.write(snapshot_fd, view)
                    view = view[written:]
            os.fsync(snapshot_fd)
            os.fchmod(snapshot_fd, 0o500)
        finally:
            os.close(snapshot_fd)
        binary_sha256 = f"sha256:{digest.hexdigest()}"
        if binary_sha256 != trusted_sha256:
            snapshot_path.unlink(missing_ok=True)
            raise RuntimeError("Agent preflight CLI digest does not match the trusted build record")
    finally:
        os.close(source_fd)

    revision = subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD"],
        cwd=ROOT,
        env=sanitized_environment(),
        text=True,
        capture_output=True,
        timeout=10.0,
        check=False,
    )
    if revision.returncode != 0 or not revision.stdout.strip():
        raise RuntimeError("Agent preflight cannot establish the current source revision")
    source_changes = subprocess.run(
        [
            "git",
            "diff",
            "--quiet",
            "HEAD",
            "--",
            "Cargo.toml",
            "Cargo.lock",
            "crates",
            "skills",
            "project/spec/workflows",
            "apps/tui/installer/wizard.cjs",
            "apps/tui/installer/wizard-body.cjs",
        ],
        cwd=ROOT,
        env=sanitized_environment(),
        timeout=10.0,
        check=False,
    )
    if source_changes.returncode != 0:
        raise RuntimeError("Agent preflight refuses a CLI built from dirty source inputs")
    untracked_sources = subprocess.run(
        [
            "git",
            "ls-files",
            "--others",
            "--",
            "crates",
            "skills",
            "project/spec/workflows",
            "Cargo.toml",
            "Cargo.lock",
            "apps/tui/installer/wizard.cjs",
            "apps/tui/installer/wizard-body.cjs",
        ],
        cwd=ROOT,
        env=sanitized_environment(),
        text=True,
        capture_output=True,
        timeout=10.0,
        check=False,
    )
    if untracked_sources.returncode != 0 or untracked_sources.stdout.strip():
        raise RuntimeError("Agent preflight refuses untracked CLI source inputs")
    version = subprocess.run(
        [str(snapshot_path), "--version", "--json"],
        cwd=ROOT,
        env=sanitized_environment(),
        text=True,
        capture_output=True,
        timeout=10.0,
        check=False,
    )
    try:
        lines = [line for line in version.stdout.splitlines() if line.strip()]
        envelope = json.loads(lines[-1]) if lines else None
        data = envelope.get("data") if isinstance(envelope, dict) else None
    except (json.JSONDecodeError, AttributeError):
        data = None
    if (
        version.returncode != 0
        or not isinstance(data, dict)
        or data.get("build_revision") != revision.stdout.strip()
        or data.get("build_source_id") != current_cli_source_id()
    ):
        raise RuntimeError("Agent preflight CLI build does not match the current source revision")
    return snapshot_path, {
        "path": str(binary),
        "sha256": binary_sha256,
        "build_revision": data["build_revision"],
        "build_source_id": data["build_source_id"],
    }


def _strict_json_object(encoded: bytes, *, description: str) -> dict:
    def no_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    try:
        value = json.loads(encoded, object_pairs_hook=no_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise RuntimeError(f"{description} is malformed") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{description} must be a JSON object")
    return value


def _private_file_bytes(path: Path, *, max_bytes: int, description: str) -> bytes:
    if not hasattr(os, "geteuid") or not hasattr(os, "O_NOFOLLOW"):
        raise RuntimeError(f"secure {description} checks require a supported Unix platform")
    try:
        before = path.lstat()
        if (
            not path.is_absolute()
            or path.is_symlink()
            or not path.is_file()
            or before.st_uid != os.geteuid()
            or before.st_mode & 0o077
            or before.st_size <= 0
            or before.st_size > max_bytes
        ):
            raise RuntimeError(f"{description} is insecure or has an invalid size")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
    except RuntimeError:
        raise
    except OSError as error:
        raise RuntimeError(f"{description} is unavailable or insecure") from error
    try:
        current = os.fstat(fd)
        if (
            not stat.S_ISREG(current.st_mode)
            or current.st_uid != os.geteuid()
            or current.st_mode & 0o077
            or current.st_size <= 0
            or current.st_size > max_bytes
            or (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino)
        ):
            raise RuntimeError(f"{description} is insecure or has an invalid size")
        with os.fdopen(fd, "rb") as stream:
            fd = -1
            encoded = stream.read(max_bytes + 1)
        if len(encoded) > max_bytes:
            raise RuntimeError(f"{description} exceeds the size limit")
        return encoded
    finally:
        if fd >= 0:
            os.close(fd)


def _private_directory_fd(parent_fd: int, name: str, *, description: str) -> int:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(name, flags, dir_fd=parent_fd)
    except OSError as error:
        raise RuntimeError(f"{description} is unavailable or insecure") from error
    metadata = os.fstat(fd)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or metadata.st_mode & 0o077
    ):
        os.close(fd)
        raise RuntimeError(f"{description} is insecure")
    return fd


def _read_standard_credential(project_root: Path, project_id: str, actor_id: str) -> str:
    if not hasattr(os, "geteuid") or not hasattr(os, "O_NOFOLLOW"):
        raise RuntimeError("secure credential checks require a supported Unix platform")
    actor_hash = hashlib.sha256(actor_id.encode("utf-8")).hexdigest()
    credential_name = f"sha256-{actor_hash}.json"
    root_fd = boreal_fd = credentials_fd = credential_fd = -1
    try:
        root_fd = os.open(
            project_root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
        )
        root_meta = os.fstat(root_fd)
        if not stat.S_ISDIR(root_meta.st_mode) or root_meta.st_uid != os.geteuid():
            raise RuntimeError("project root is not an owned directory")
        boreal_fd = _private_directory_fd(root_fd, ".boreal", description="credential directory")
        credentials_fd = _private_directory_fd(
            boreal_fd, "credentials", description="credential directory"
        )
        try:
            credential_fd = os.open(
                credential_name,
                os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
                dir_fd=credentials_fd,
            )
        except OSError as error:
            raise RuntimeError("standard local credential is unavailable or insecure") from error
        metadata = os.fstat(credential_fd)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.geteuid()
            or metadata.st_mode & 0o077
            or metadata.st_size <= 0
            or metadata.st_size > MAX_CREDENTIAL_BYTES
        ):
            raise RuntimeError("standard local credential is insecure or has an invalid size")
        with os.fdopen(credential_fd, "rb") as stream:
            credential_fd = -1
            encoded = stream.read(MAX_CREDENTIAL_BYTES + 1)
        if len(encoded) > MAX_CREDENTIAL_BYTES:
            raise RuntimeError("standard local credential exceeds the size limit")
    except OSError as error:
        raise RuntimeError("standard local credential is unavailable or insecure") from error
    finally:
        for fd in (credential_fd, credentials_fd, boreal_fd, root_fd):
            if fd >= 0:
                os.close(fd)

    value = _strict_json_object(encoded, description="standard local credential")
    if (
        set(value) != {"schema_version", "project_id", "actor_id", "credential"}
        or value.get("schema_version") != "boreal.local-credential.v1"
        or value.get("project_id") != project_id
        or value.get("actor_id") != actor_id
        or not isinstance(value.get("credential"), str)
        or not value["credential"].strip()
    ):
        raise RuntimeError("standard local credential does not match the descriptor")
    return value["credential"]


def load_agent_input(path: Path) -> AgentInput:
    """Load a private, nonsecret descriptor and its existing standard credential."""
    descriptor_path = path.expanduser().absolute()
    descriptor = _strict_json_object(
        _private_file_bytes(
            descriptor_path,
            max_bytes=MAX_AGENT_INPUT_BYTES,
            description="Agent input descriptor",
        ),
        description="Agent input descriptor",
    )
    if set(descriptor) != AGENT_INPUT_FIELDS or descriptor.get("schema_version") != AGENT_INPUT_SCHEMA:
        raise RuntimeError("Agent input descriptor has an unsupported schema or fields")
    string_fields = (
        "project_id",
        "actor_id",
        "work_id",
        "source_version_id",
        "config_identity",
        "session_id",
        "harness_id",
        "attempt_id",
    )
    for name in string_fields:
        value = descriptor.get(name)
        if (
            not isinstance(value, str)
            or not value
            or value != value.strip()
            or len(value) > 512
            or any(ord(character) < 0x20 for character in value)
        ):
            raise RuntimeError(f"Agent input descriptor has an invalid {name}")
    fence = descriptor.get("fence")
    if type(fence) is not int or fence <= 0:
        raise RuntimeError("Agent input descriptor has an invalid fence")
    root_value = descriptor.get("project_root")
    if not isinstance(root_value, str) or not Path(root_value).is_absolute():
        raise RuntimeError("Agent input project_root must be absolute")
    try:
        project_root = Path(root_value).resolve(strict=True)
    except OSError as error:
        raise RuntimeError("Agent input project_root is unavailable") from error
    if not project_root.is_dir():
        raise RuntimeError("Agent input project_root is not a directory")
    credential = _read_standard_credential(project_root, descriptor["project_id"], descriptor["actor_id"])
    return AgentInput(
        project_id=descriptor["project_id"],
        actor_id=descriptor["actor_id"],
        project_root=project_root,
        work_id=descriptor["work_id"],
        source_version_id=descriptor["source_version_id"],
        config_identity=descriptor["config_identity"],
        session_id=descriptor["session_id"],
        harness_id=descriptor["harness_id"],
        attempt_id=descriptor["attempt_id"],
        fence=fence,
        credential=credential,
    )


def invoke_with_credential(
    binary: Path,
    args: list[str],
    *,
    cwd: Path,
    credential: str,
    timeout: float = 30.0,
) -> dict:
    """Run one CLI process with a credential only in that child's environment."""
    child_env = sanitized_environment()
    child_env["BOREAL_CREDENTIAL"] = credential
    argv = [str(binary), *args]
    completed = subprocess.run(
        argv,
        cwd=cwd,
        env=child_env,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    # Credential-bearing child output is intentionally never returned or
    # included in an exception. Only the bounded JSON envelope is interpreted.
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    try:
        envelope = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError as error:
        raise RuntimeError("credentialed CLI returned an invalid JSON envelope") from error
    if not isinstance(envelope, dict):
        raise RuntimeError("credentialed CLI returned no JSON envelope")
    return {"exit_code": completed.returncode, "envelope": envelope}


def _require_cli_success(result: dict, *, command: str) -> dict:
    envelope = result.get("envelope")
    error = envelope.get("error") if isinstance(envelope, dict) else None
    if result.get("exit_code") != 0 or error:
        code = error.get("code") if isinstance(error, dict) else None
        raise RuntimeError(f"Agent preflight {command} failed closed (error_code={code or 'unknown'})")
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise RuntimeError(f"Agent preflight {command} returned no structured data")
    return data


def run_agent_input_preflight(
    binary: Path,
    descriptor_path: Path,
    *,
    trusted_binary_sha256: str,
    invoke_fn=invoke_with_credential,
) -> dict:
    """Authenticate and prove exact session/claim/resume bindings before probes."""
    with tempfile.TemporaryDirectory(prefix="boreal-agent-cli-verified-") as directory:
        pinned_binary, cli_identity = verify_agent_cli(
            binary,
            trusted_sha256=trusted_binary_sha256,
            snapshot_directory=Path(directory),
        )
        agent = load_agent_input(descriptor_path)
        return _run_agent_input_preflight_steps(
            pinned_binary,
            agent,
            cli_identity,
            invoke_fn=invoke_fn,
        )


def _run_agent_input_preflight_steps(
    binary: Path,
    agent: AgentInput,
    cli_identity: dict,
    *,
    invoke_fn,
) -> dict:
    """Run read-only identity queries through one pinned executable snapshot."""
    def run(arguments: list[str], command: str) -> dict:
        return invoke_fn(
            binary,
            [*arguments, "--json"],
            cwd=agent.project_root,
            credential=agent.credential,
        )

    authority = _require_cli_success(
        run(
            ["auth", "show", "--project", agent.project_id, "--actor", agent.actor_id],
            "auth show",
        ),
        command="auth show",
    )
    if (
        authority.get("project_id") != agent.project_id
        or authority.get("actor_id") != agent.actor_id
        or authority.get("role") != "agent"
    ):
        raise RuntimeError("Agent preflight authority readback did not prove an authorized Agent")

    session = _require_cli_success(
        run(
            [
                "session",
                "show",
                "--project",
                agent.project_id,
                "--session",
                agent.session_id,
                "--actor",
                agent.actor_id,
            ],
            "session show",
        ),
        command="session show",
    )
    if (
        session.get("project_id") != agent.project_id
        or session.get("session_id") != agent.session_id
        or session.get("actor_id") != agent.actor_id
        or session.get("harness_id") != agent.harness_id
        or session.get("state") != "active"
    ):
        raise RuntimeError("Agent preflight session readback does not match the descriptor")

    work = _require_cli_success(
        run(
            [
                "work",
                "show",
                agent.project_id,
                agent.work_id,
                "--actor",
                agent.actor_id,
            ],
            "work show",
        ),
        command="work show",
    )
    if work.get("project_id") != agent.project_id or work.get("work_id") != agent.work_id:
        raise RuntimeError("Agent preflight work readback does not match the descriptor")
    resume = _require_cli_success(
        run(
            [
                "agent",
                "resume",
                "--project",
                agent.project_id,
                "--actor",
                agent.actor_id,
                "--harness",
                agent.harness_id,
                "--session",
                agent.session_id,
                "--attempt",
                agent.attempt_id,
            ],
            "agent resume",
        ),
        command="agent resume",
    )
    context = resume.get("context")
    status = resume.get("status")
    provenance = resume.get("provenance")
    if (
        not isinstance(context, dict)
        or not isinstance(status, dict)
        or not isinstance(provenance, dict)
        or context.get("mode") != "resume"
        or context.get("project_id") != agent.project_id
        or context.get("actor_id") != agent.actor_id
        or context.get("harness_id") != agent.harness_id
        or context.get("session_id") != agent.session_id
        or status.get("work_id") != agent.work_id
        or status.get("attempt_id") != agent.attempt_id
        or type(status.get("fence")) is not int
        or status.get("fence") != agent.fence
        or provenance.get("source_snapshot_hash") != agent.source_version_id
        or provenance.get("config_identity") != agent.config_identity
    ):
        raise RuntimeError("Agent preflight resume readback does not match the existing attempt binding")

    return {
        "status": "read_only_preflight_pass",
        "cli_identity": cli_identity,
        "attempted": False,
        "authorized_agent": True,
        "actor_role": "agent",
        "project_id": agent.project_id,
        "actor_id": agent.actor_id,
        "session_id": agent.session_id,
        "harness_id": agent.harness_id,
        "work_id": agent.work_id,
        "source_version_id": agent.source_version_id,
        "config_identity": agent.config_identity,
        "attempt_id": agent.attempt_id,
        "fence": agent.fence,
        "authority_readback": {
            "project_id": authority["project_id"],
            "actor_id": authority["actor_id"],
            "role": authority["role"],
        },
        "session_readback": {
            "project_id": session["project_id"],
            "session_id": session["session_id"],
            "actor_id": session["actor_id"],
            "harness_id": session["harness_id"],
            "state": session["state"],
        },
        "work_readback": {
            "project_id": work["project_id"],
            "work_id": work["work_id"],
            "kind": work.get("kind"),
            "lifecycle": work.get("lifecycle"),
        },
        "claim_readback": {
            "project_id": context["project_id"],
            "actor_id": context["actor_id"],
            "harness_id": context["harness_id"],
            "session_id": context["session_id"],
            "work_id": status["work_id"],
            "attempt_id": status["attempt_id"],
            "fence": status["fence"],
            "source_version_id": provenance["source_snapshot_hash"],
            "config_identity": provenance["config_identity"],
        },
        "resume_status": "pass",
        "reason": "read-only canonical readbacks verified the existing Agent, session, work, current attempt, and fence; no attempt was claimed",
        "credential_exposed": False,
    }


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


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def json_contains_field(value: object, field: str, expected: object) -> bool:
    if isinstance(value, dict):
        return value.get(field) == expected or any(
            json_contains_field(item, field, expected) for item in value.values()
        )
    if isinstance(value, list):
        return any(json_contains_field(item, field, expected) for item in value)
    return False


def failed_response_breakdown(workload: list[dict]) -> dict:
    by_request_kind: dict[str, int] = {}
    by_error_code: dict[str, int] = {}
    unexpected_invalid_argument = 0
    for item in workload:
        if item.get("exit_code") == 0:
            continue
        request_kind = str(item.get("request_kind") or "unknown")
        error = item.get("error")
        code = str(error.get("code") or "unavailable") if isinstance(error, dict) else "unavailable"
        by_request_kind[request_kind] = by_request_kind.get(request_kind, 0) + 1
        by_error_code[code] = by_error_code.get(code, 0) + 1
        if code == "invalid_argument" and request_kind in {"status", "work_show"}:
            unexpected_invalid_argument += 1
    return {
        "classification": "observed_only",
        "owner_approved_maximum": None,
        "owner_approved": False,
        "by_request_kind": dict(sorted(by_request_kind.items())),
        "by_error_code": dict(sorted(by_error_code.items())),
        "unexpected_invalid_argument_responses": unexpected_invalid_argument,
        "invalid_argument_classification": "unexpected_error_for_valid_shaped_read_only_requests",
        "valid_read_only_shapes": {
            "status": ["status", "<project>", "--limit", "8", "--offset", "0"],
            "work_show": ["work", "show", "<work-id>", "--project", "<project>"],
        },
    }


def validation_identity(binary: Path) -> dict:
    def git_value(*args: str) -> str | None:
        completed = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            env=sanitized_environment(),
            text=True,
            capture_output=True,
            check=False,
        )
        return completed.stdout.strip() if completed.returncode == 0 else None

    status = git_value("status", "--porcelain")
    diff = subprocess.run(
        ["git", "diff", "--binary", "HEAD"],
        cwd=ROOT,
        env=sanitized_environment(),
        capture_output=True,
        check=False,
    )
    version = subprocess.run(
        [str(binary), "--version"],
        cwd=ROOT,
        env=sanitized_environment(),
        text=True,
        capture_output=True,
        timeout=10.0,
        check=False,
    )
    return {
        "run_id": f"{int(time.time() * 1000)}-{os.getpid()}-{uuid.uuid4().hex[:8]}",
        "source": {
            "commit": git_value("rev-parse", "HEAD"),
            "tree": git_value("rev-parse", "HEAD^{tree}"),
            "dirty": bool(status),
            "diff_sha256": (
                f"sha256:{hashlib.sha256(diff.stdout).hexdigest()}"
                if diff.returncode == 0
                else None
            ),
            "production_host_sha256": file_sha256(Path(__file__).resolve()),
        },
        "binary": {
            "path": str(binary),
            "sha256": file_sha256(binary),
            "version": version.stdout.strip() if version.returncode == 0 else None,
            "version_exit_code": version.returncode,
        },
    }


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
        env=sanitized_environment(env),
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
    active_processes: dict[int, subprocess.Popen[str]] | None = None,
    active_process_lock: threading.Lock | None = None,
    active_process_max: list[int] | None = None,
    admission_stopped: threading.Event | None = None,
) -> dict | None:
    if args[:1] == ["status"]:
        command = [args[0], project, *args[1:]]
    elif args[:2] in (
        ["work", "create"],
        ["work", "claim"],
        ["work", "edit"],
        ["operation", "show"],
    ):
        command = [args[0], args[1], project, *args[2:]]
    elif args[:2] == ["work", "show"]:
        # The service adapter's work-show route takes `--project` and a
        # single work identifier. Supplying two positional identifiers is
        # accepted by the direct command parser but dispatches the project ID
        # as the requested work ID over the service boundary.
        command = [args[0], args[1], *args[2:], "--project", project]
    else:
        raise ValueError(f"unsupported production-client command shape: {args!r}")
    args = [*command, "--socket", str(socket_path), "--json"]
    if active_processes is None:
        return invoke(binary, args, cwd=cwd, timeout=timeout)
    if active_process_lock is None:
        raise ValueError("tracked clients require their registry lock")

    argv = [str(binary), *args]
    with active_process_lock:
        # The stop/recovery probe shares this lock with its SIGTERM admission
        # boundary. A request either starts before the boundary and is
        # included in the active-process snapshot, or is not started at all.
        if admission_stopped is not None and admission_stopped.is_set():
            return None
        process = subprocess.Popen(
            argv,
            cwd=cwd,
            env=sanitized_environment(),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        active_processes[process.pid] = process
        process_started_at = time.perf_counter()
        process_started_monotonic_ns = time.monotonic_ns()
        if active_process_max is not None:
            active_process_max[0] = max(active_process_max[0], len(active_processes))
    try:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            process.kill()
            stdout, stderr = process.communicate()
            raise subprocess.TimeoutExpired(
                error.cmd, error.timeout, output=stdout, stderr=stderr
            ) from error
        process_completed_at = time.perf_counter()
        process_completed_monotonic_ns = time.monotonic_ns()
    finally:
        with active_process_lock:
            active_processes.pop(process.pid, None)
    completed = subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)
    envelope = parse_envelope(completed)
    return {
        "exit_code": process.returncode,
        "envelope": envelope,
        "stderr": stderr,
        "client_pid": process.pid,
        "client_process_started_at": process_started_at,
        "client_process_started_monotonic_ns": process_started_monotonic_ns,
        "client_process_completed_at": process_completed_at,
        "client_process_completed_monotonic_ns": process_completed_monotonic_ns,
    }


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
        env=sanitized_environment(),
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
    active_client_processes: dict[int, subprocess.Popen[str]] = {}
    max_active_client_processes = [0]
    completed_clients: list[dict] = []

    def one(index: int) -> dict:
        # Keep the saturated workload read-only. Work creation would require
        # optimistic revision/session tokens and would serialize on SQLite,
        # obscuring whether service admission itself applies backpressure.
        request_started = time.perf_counter()
        with state_lock:
            active_clients[index] = request_started
        response = None
        try:
            response = client(
                binary,
                socket_path,
                project,
                ["work", "show", "dispatch-smoke-seed"],
                cwd=root,
                active_processes=active_client_processes,
                active_process_lock=state_lock,
                active_process_max=max_active_client_processes,
            )
            return {
                "index": index,
                "started_at": response["client_process_started_at"],
                "completed_at": response["client_process_completed_at"],
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
                requests_active = any(
                    process.poll() is None for process in active_client_processes.values()
                )
                requests_remain = len(completed_clients) < count
            if full_seen and requests_active:
                break
            if not requests_remain:
                break
            time.sleep(0.005)

        with state_lock:
            control_started = time.perf_counter()
            active_at_control_start = sum(
                process.poll() is None for process in active_client_processes.values()
            )
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
            active_processes=active_client_processes,
            active_process_lock=state_lock,
            active_process_max=max_active_client_processes,
        )
        with state_lock:
            control_completed = control["client_process_completed_at"]
            active_at_control_response = sum(
                process.poll() is None for process in active_client_processes.values()
            )
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
        "normal_max_in_flight_client_processes": max_active_client_processes[0],
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


def stop_service(
    process: subprocess.Popen[str],
    socket_path: Path,
    *,
    active_client_count: int | None = None,
    active_client_processes: dict[int, subprocess.Popen[str]] | None = None,
    active_process_lock: threading.Lock | None = None,
) -> dict:
    requested_at = time.perf_counter()
    signal_sent_monotonic_ns = None
    active_client_process_pids: list[int] = []
    active_client_snapshot_monotonic_ns = None
    if process.poll() is None:
        if active_client_processes is not None:
            if active_process_lock is None:
                raise ValueError("tracked shutdown requires the client registry lock")
            with active_process_lock:
                active_client_process_pids = sorted(
                    pid
                    for pid, client_process in active_client_processes.items()
                    if client_process.poll() is None
                )
                active_client_count = len(active_client_process_pids)
                active_client_snapshot_monotonic_ns = time.monotonic_ns()
                process.send_signal(signal.SIGTERM)
                signal_sent_monotonic_ns = time.monotonic_ns()
        else:
            process.send_signal(signal.SIGTERM)
            signal_sent_monotonic_ns = time.monotonic_ns()
    try:
        stdout, stderr = process.communicate(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate(timeout=5)
        exited_at_unix_ms = time.time_ns() // 1_000_000
        return {
            "status": "fail",
            "reason": "service did not exit after SIGTERM; forced kill used for harness cleanup",
            "exit_code": process.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "socket_removed": not socket_path.exists(),
            "active_client_processes_at_request": active_client_count,
            "active_client_process_pids_at_request": active_client_process_pids,
            "active_client_snapshot_monotonic_ns": active_client_snapshot_monotonic_ns,
            "signal_sent_monotonic_ns": signal_sent_monotonic_ns,
            "service_exited_at_unix_ms": exited_at_unix_ms,
            "request_to_exit_ms": round((time.perf_counter() - requested_at) * 1000.0, 3),
        }
    exited_at_unix_ms = time.time_ns() // 1_000_000
    return {
        "status": "pass"
        if process.returncode == 0 and not socket_path.exists()
        else "fail",
        "signal": "SIGTERM",
        "exit_code": process.returncode,
        "socket_removed": not socket_path.exists(),
        "active_client_processes_at_request": active_client_count,
        "active_client_process_pids_at_request": active_client_process_pids,
        "active_client_snapshot_monotonic_ns": active_client_snapshot_monotonic_ns,
        "signal_sent_monotonic_ns": signal_sent_monotonic_ns,
        "service_exited_at_unix_ms": exited_at_unix_ms,
        "request_to_exit_ms": round((time.perf_counter() - requested_at) * 1000.0, 3),
        "stdout_tail": stdout[-1000:],
        "stderr_tail": stderr[-1000:],
    }


def start_service(
    binary: Path,
    database: Path,
    socket_path: Path,
    root: Path,
    env: dict[str, str],
    *,
    dispatch_workers: int | None = None,
    dispatch_capacity: int | None = None,
) -> subprocess.Popen[str]:
    command = [
        str(binary),
        "service",
        "run",
        "--db",
        str(database),
        "--socket",
        str(socket_path),
        "--json",
    ]
    if dispatch_workers is not None:
        command.extend(["--dispatch-workers", str(dispatch_workers)])
    if dispatch_capacity is not None:
        command.extend(["--dispatch-capacity", str(dispatch_capacity)])
    return subprocess.Popen(
        command,
        cwd=root,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def run_stop_recovery_probe(
    binary: Path,
    database: Path,
    socket_path: Path,
    project: str,
    root: Path,
    env: dict[str, str],
    actor: str,
    session: str,
    *,
    worker_count: int = 32,
    requests_per_worker: int = 8,
) -> dict:
    """Exercise SIGTERM drain and durable operation readback across restart.

    The host uses its normal 4-worker/32-capacity defaults. Separate CLI
    processes issue status and work-show calls while one attributable create
    operation is admitted. SIGTERM is sent while client processes are active;
    after shutdown the same database is served again and both the operation
    record and created work are read through supported application routes.
    """
    service = start_service(binary, database, socket_path, root, env)
    workload_lock = threading.Lock()
    release = threading.Event()
    stop_admission = threading.Event()
    active: set[int] = set()
    active_client_processes: dict[int, subprocess.Popen[str]] = {}
    max_active_client_processes = [0]
    requests_started = 0
    completed_requests = 0

    def one_request(index: int, iteration: int) -> dict | None:
        nonlocal requests_started, completed_requests
        request_kind = "status" if iteration % 2 == 0 else "work_show"
        args = ["status", "--limit", "8", "--offset", "0"] if request_kind == "status" else [
            "work", "show", "dispatch-smoke-seed"
        ]
        with workload_lock:
            active.add(index)
            requests_started += 1
        started_at = time.perf_counter()
        started_at_monotonic_ns = time.monotonic_ns()
        counted_request = True
        try:
            response = client(
                binary,
                socket_path,
                project,
                args,
                cwd=root,
                timeout=15.0,
                active_processes=active_client_processes,
                active_process_lock=workload_lock,
                active_process_max=max_active_client_processes,
                admission_stopped=stop_admission,
            )
            if response is None:
                with workload_lock:
                    active.discard(index)
                    requests_started -= 1
                counted_request = False
                return None
            return {
                "worker": index,
                "iteration": iteration,
                "request_kind": request_kind,
                "started_at": response["client_process_started_at"],
                "started_at_monotonic_ns": response["client_process_started_monotonic_ns"],
                "completed_at": response["client_process_completed_at"],
                "completed_at_monotonic_ns": response["client_process_completed_monotonic_ns"],
                "exit_code": response["exit_code"],
                "outcome": response["envelope"].get("outcome"),
                "error": response["envelope"].get("error"),
            }
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            return {
                "worker": index,
                "iteration": iteration,
                "request_kind": request_kind,
                "started_at": started_at,
                "started_at_monotonic_ns": started_at_monotonic_ns,
                "completed_at": time.perf_counter(),
                "completed_at_monotonic_ns": time.monotonic_ns(),
                "exit_code": None,
                "outcome": "unavailable",
                "error": {"message": str(error)},
            }
        finally:
            with workload_lock:
                active.discard(index)
                if counted_request:
                    completed_requests += 1

    def one_worker(index: int) -> list[dict]:
        release.wait(timeout=10.0)
        results = []
        for iteration in range(requests_per_worker):
            if stop_admission.is_set():
                break
            result = one_request(index, iteration)
            if result is None:
                break
            results.append(result)
        return results

    try:
        wait_for_socket(socket_path, service)
        ready_status(binary, socket_path, project, root)
        before = client(binary, socket_path, project, ["status", "--limit", "1", "--offset", "0"], cwd=root)
        revision = before["envelope"].get("revision")
        if not isinstance(revision, int):
            raise RuntimeError(f"stop/recovery status omitted revision: {before}")

        with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as pool:
            futures = [pool.submit(one_worker, index) for index in range(worker_count)]
            release.set()
            admission_deadline = time.perf_counter() + 5.0
            while time.perf_counter() < admission_deadline:
                with workload_lock:
                    active_now = len(active)
                    started_now = requests_started
                    finished_now = completed_requests
                if active_now >= min(8, worker_count) and started_now >= min(8, worker_count):
                    break
                if finished_now >= worker_count * requests_per_worker:
                    break
                time.sleep(0.002)

            operation_id = "op_v10_stop_recovery_create"
            work_id = "dispatch-stop-recovery-result"
            mutation = client(
                binary,
                socket_path,
                project,
                [
                    "work",
                    "create",
                    work_id,
                    "Stop and recovery durable result",
                    "--kind",
                    "task",
                    "--actor",
                    actor,
                    "--session",
                    session,
                    "--expected-revision",
                    str(revision),
                    "--operation-id",
                    operation_id,
                ],
                cwd=root,
                timeout=15.0,
            )
            # Prevent each worker from starting its remaining iterations once
            # shutdown begins. The client checks this event under the same
            # lock that registers subprocesses, so the shutdown snapshot still
            # includes every request admitted before this boundary.
            with workload_lock:
                stop_admission.set()
            stop = stop_service(
                service,
                socket_path,
                active_client_processes=active_client_processes,
                active_process_lock=workload_lock,
            )
            active_at_stop = stop.get("active_client_processes_at_request", 0)
            pending_at_stop = active_at_stop
            workload = [item for future in futures for item in future.result(timeout=30.0)]

        # Restart on the same SQLite file before retrying or interpreting an
        # uncertain delivery. This readback is the gate that permits any retry.
        restarted = start_service(binary, database, socket_path, root, env)
        try:
            wait_for_socket(socket_path, restarted)
            ready_status(binary, socket_path, project, root)
            readback = client(
                binary,
                socket_path,
                project,
                ["operation", "show", operation_id],
                cwd=root,
            )
            operation = (readback["envelope"].get("data") or {}).get("operation")
            operation_readback_before_retry = readback["envelope"].get("data")
            operation_error_before_retry = readback["envelope"].get("error")
            work_readback_before_retry = client(
                binary,
                socket_path,
                project,
                ["work", "show", work_id],
                cwd=root,
            )
            retry = None
            if operation_error_before_retry and operation_error_before_retry.get("code") == "not_found":
                # Not-found from the canonical store after restart proves the
                # original create was not committed. Reuse its exact operation
                # identity and expected revision, then read it back again.
                retry = client(
                    binary,
                    socket_path,
                    project,
                    [
                        "work",
                        "create",
                        work_id,
                        "Stop and recovery durable result",
                        "--kind",
                        "task",
                        "--actor",
                        actor,
                        "--session",
                        session,
                        "--expected-revision",
                        str(revision),
                        "--operation-id",
                        operation_id,
                    ],
                    cwd=root,
                    timeout=15.0,
                )
                readback = client(
                    binary,
                    socket_path,
                    project,
                    ["operation", "show", operation_id],
                    cwd=root,
                )
                operation = (readback["envelope"].get("data") or {}).get("operation")
            work_readback = client(
                binary,
                socket_path,
                project,
                ["work", "show", work_id],
                cwd=root,
            )
        finally:
            restart_stop = stop_service(restarted, socket_path)

        mutation_error = mutation["envelope"].get("error") or {}
        observed_busy = mutation_error.get("code") == "service_busy"
        durable_operation = (
            isinstance(operation, dict)
            and operation.get("operation_id") == operation_id
            and operation.get("project_id") == project
            and operation.get("command") in {"work.create", "work_create"}
            and (operation.get("result") or {}).get("work_id") == work_id
        )
        original_operation = (operation_readback_before_retry or {}).get("operation") or {}
        original_operation_durable = (
            isinstance(original_operation, dict)
            and original_operation.get("operation_id") == operation_id
            and original_operation.get("project_id") == project
            and original_operation.get("command") in {"work.create", "work_create"}
            and (original_operation.get("result") or {}).get("work_id") == work_id
        )
        original_work_durable = (
            not work_readback_before_retry["envelope"].get("error")
            and json_contains_field(
                work_readback_before_retry["envelope"].get("data"), "work_id", work_id
            )
        )
        durable_work = (
            not work_readback["envelope"].get("error")
            and json_contains_field(work_readback["envelope"].get("data"), "work_id", work_id)
        )
        graceful_drain = stop.get("exit_code") == 0 and stop.get("socket_removed") is True
        service_summary: dict = {}
        for line in stop.get("stdout_tail", "").splitlines():
            try:
                envelope = json.loads(line)
            except json.JSONDecodeError:
                continue
            data = envelope.get("data")
            if isinstance(data, dict) and data.get("service") == "stopped":
                service_summary = data
        error_groups: dict[tuple[str, str], int] = {}
        for item in workload:
            error = item.get("error")
            if isinstance(error, dict):
                key = (str(error.get("code") or "unknown"), str(error.get("message") or ""))
                error_groups[key] = error_groups.get(key, 0) + 1
        workload_summary_errors = [
            {"code": code, "message": message, "count": count}
            for (code, message), count in sorted(error_groups.items())
        ]
        progress_windows: dict[int, dict[str, object]] = {}
        for item in workload:
            worker_progress = progress_windows.setdefault(
                item["worker"],
                {
                    "started_at_monotonic_ns": item["started_at_monotonic_ns"],
                    "finished_at_monotonic_ns": item["completed_at_monotonic_ns"],
                    "requests_completed": 0,
                    "successful_responses": 0,
                    "successful_response_times_ns": [],
                },
            )
            worker_progress["started_at_monotonic_ns"] = min(
                worker_progress["started_at_monotonic_ns"], item["started_at_monotonic_ns"]
            )
            worker_progress["finished_at_monotonic_ns"] = max(
                worker_progress["finished_at_monotonic_ns"], item["completed_at_monotonic_ns"]
            )
            worker_progress["requests_completed"] += 1
            if item["exit_code"] == 0:
                worker_progress["successful_responses"] += 1
                worker_progress["successful_response_times_ns"].append(
                    item["completed_at_monotonic_ns"]
                )
        progress_by_worker: dict[int, dict[str, int | float]] = {}
        for worker, window in sorted(progress_windows.items()):
            started_at_ns = window["started_at_monotonic_ns"]
            finished_at_ns = window["finished_at_monotonic_ns"]
            successful_times = sorted(window["successful_response_times_ns"])
            progress_points = [started_at_ns, *successful_times, finished_at_ns]
            max_progress_gap_ns = max(
                (right - left for left, right in zip(progress_points, progress_points[1:])),
                default=finished_at_ns - started_at_ns,
            )
            progress_by_worker[worker] = {
                "requests_completed": window["requests_completed"],
                "successful_responses": window["successful_responses"],
                "observed_run_duration_ms": round(
                    (finished_at_ns - started_at_ns) / 1_000_000.0, 3
                ),
                "max_success_progress_gap_ms": round(max_progress_gap_ns / 1_000_000.0, 3),
            }
        worker_successes = [value["successful_responses"] for value in progress_by_worker.values()]
        workload_started_ns = min(
            (window["started_at_monotonic_ns"] for window in progress_windows.values()),
            default=0,
        )
        workload_finished_ns = max(
            (window["finished_at_monotonic_ns"] for window in progress_windows.values()),
            default=workload_started_ns,
        )
        observed_duration_ms = round(
            (workload_finished_ns - workload_started_ns) / 1_000_000.0, 3
        )
        observed_starvation_gap_ms = max(
            (value["max_success_progress_gap_ms"] for value in progress_by_worker.values()),
            default=0.0,
        )
        workload_summary = {
            "workers": worker_count,
            "requests_per_worker": requests_per_worker,
            "requests_started": len(workload),
            "successful_responses": sum(item["exit_code"] == 0 for item in workload),
            "failed_or_unavailable_responses": sum(item["exit_code"] != 0 for item in workload),
            "failed_or_unavailable_response_breakdown": failed_response_breakdown(workload),
            "workers_with_responses": len(progress_by_worker),
            "workers_with_successful_responses": sum(value > 0 for value in worker_successes),
            "worker_progress": {str(worker): metrics for worker, metrics in progress_by_worker.items()},
            "observed_duration_ms": observed_duration_ms,
            "observed_max_success_progress_gap_ms": observed_starvation_gap_ms,
            "observed_starvation_workers_with_zero_progress": sum(
                value == 0 for value in worker_successes
            ),
            "min_successful_responses_per_observed_worker": min(worker_successes, default=0),
            "max_successful_responses_per_observed_worker": max(worker_successes, default=0),
            "workers_with_zero_successful_responses": sum(value == 0 for value in worker_successes),
            "max_active_cli_processes": max_active_client_processes[0],
            "active_cli_processes_at_sigterm": active_at_stop,
            "pending_request_intervals_at_sigterm": pending_at_stop,
            "successful_responses_before_sigterm": sum(
                item["exit_code"] == 0
                and item.get("completed_at_monotonic_ns", 0)
                <= (stop.get("signal_sent_monotonic_ns") or 0)
                for item in workload
            ),
            "queue_full_responses": sum(
                "queue is full" in (item.get("error") or {}).get("message", "").lower()
                for item in workload
            ),
            "queue_full_error_details": [
                item
                for item in workload_summary_errors
                if "queue is full" in item["message"].lower()
            ],
            "service_shutdown_summary": service_summary,
            "error_details": workload_summary_errors,
        }
        drain_and_readback_observed = (
            graceful_drain
            and active_at_stop > 0
            and restart_stop.get("exit_code") == 0
            and restart_stop.get("socket_removed") is True
            and original_operation_durable
            and original_work_durable
        )
        # A completed work.create plus process shutdown is useful bounded
        # evidence, but it does not stop or recover an owned attempt. Keep the
        # facts; the attempt path is unavailable until an enrolled Agent
        # fixture actually exercises it.
        status = "unavailable"
        return {
            "status": status,
            "drain_and_readback_observed": drain_and_readback_observed,
            "attempt_stop_recovery": {
                "status": "unavailable",
                "attempted": False,
                "authorized_agent": False,
                "actor_role": None,
                "attempt_id": None,
                "fence": None,
                "attempt_stop_observed": False,
                "restart_disposition_readback": False,
                "attempt_after_restart": None,
                "recovery_obligation": None,
                "resource_reservation": None,
                "stale_fence_response": None,
                "reason": "the environment owner has not supplied an authorized Agent credential; the harness does not create a substitute Agent identity",
            },
            "deadline_recovery": {
                "status": "unavailable",
                "attempted": False,
                "actor_id": None,
                "agent_authority_readback": None,
                "deadline_unix_ms": None,
                "service_restart_unix_ms": None,
                "attempt_id": None,
                "fence": None,
                "deadline_crossed_while_service_stopped": False,
                "service_restarted_after_deadline": False,
                "attempt_after_restart": None,
                "recovery_obligation": None,
                "resource_reservation": None,
                "stale_fence_response": None,
                "reason": "the environment owner has not supplied an authorized Agent credential; the harness does not create a substitute Agent identity",
            },
            "configuration": {
                "dispatch_workers": 4,
                "dispatch_capacity": 32,
                "configuration_source": "service defaults; no override flags passed",
            },
            "workload": workload_summary,
            "sigterm_drain": stop,
            "same_database_restart": restart_stop,
            "retry_after_restart": (
                {
                    "exit_code": retry["exit_code"],
                    "outcome": retry["envelope"].get("outcome"),
                    "error": retry["envelope"].get("error"),
                }
                if retry is not None
                else None
            ),
            "restart_readback_before_retry": {
                "operation_data": operation_readback_before_retry,
                "operation_error": operation_error_before_retry,
                "operation_durable": original_operation_durable,
                "operation_result_subject_match": original_operation_durable,
                "work_data": work_readback_before_retry["envelope"].get("data"),
                "work_error": work_readback_before_retry["envelope"].get("error"),
                "work_durable": original_work_durable,
                "work_readback_exact_id": original_work_durable,
            },
            "mutation_delivery": {
                "operation_id": operation_id,
                "work_id": work_id,
                "initial_exit_code": mutation["exit_code"],
                "initial_outcome": mutation["envelope"].get("outcome"),
                "initial_error": mutation_error or None,
                "typed_service_busy_observed": observed_busy,
                "durable_operation_readback": durable_operation,
                "original_operation_readback_before_retry": original_operation_durable,
                "operation_result_subject_match": original_operation_durable,
                "operation_readback": readback["envelope"].get("data"),
                "work_readback_succeeded": durable_work,
                "original_work_readback_before_retry": original_work_durable,
                "work_readback_exact_id": original_work_durable,
                "work_readback_error": work_readback["envelope"].get("error"),
                "work_readback": work_readback["envelope"].get("data"),
            },
            "acceptance_scope": "supplemental service drain and operation readback only; V10 stop/recovery requires an authorized Agent attempt and post-restart disposition proof",
            "limitations": [
                "The workload uses real separate bwrk client processes over the local service socket, but its bounded status/work-show mix is not a scale benchmark or soak.",
                "A typed service_busy result is counted only when the public CLI error code is exactly service_busy; protocol_mismatch is not reclassified.",
                "A SIGTERM process exit is called graceful only when exit code is zero and the Unix socket is removed.",
                "An unavailable mutation readback or missing work row remains incomplete evidence; it is never converted into a pass.",
            ],
        }
    finally:
        if service.poll() is None:
            stop_service(service, socket_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=ROOT / "target" / "debug" / "bwrk")
    parser.add_argument("--normal-requests", type=int, default=256)
    parser.add_argument(
        "--full-v10",
        action="store_true",
        help="run the bounded full-mode evidence set in addition to the dispatch smoke",
    )
    parser.add_argument(
        "--agent-input",
        type=Path,
        help="opt in to an owner-supplied private Agent descriptor for authenticated readback",
    )
    parser.add_argument(
        "--agent-cli-sha256",
        help="sha256:<hex> from an independent trusted build record; required with --agent-input",
    )
    parser.add_argument("--control-latency-budget-ms", type=float)
    parser.add_argument("--control-latency-budget-source")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.normal_requests < 32:
        parser.error("--normal-requests must be at least 32 to exercise the bounded queue")
    if (args.control_latency_budget_ms is None) != (args.control_latency_budget_source is None):
        parser.error("--control-latency-budget-ms and --control-latency-budget-source must be supplied together")
    if args.control_latency_budget_ms is not None and args.control_latency_budget_ms <= 0:
        parser.error("--control-latency-budget-ms must be positive")
    if args.output is None:
        filename = "forensic-v10.latest.json" if args.full_v10 else "dispatch-admission-smoke.latest.json"
        args.output = Path(__file__).resolve().parent / "results" / filename
    binary = args.bin.absolute()
    if not binary.exists():
        parser.error(f"binary does not exist: {binary}")
    if args.agent_input is not None and not args.full_v10:
        parser.error("--agent-input requires --full-v10")
    if (args.agent_input is None) != (args.agent_cli_sha256 is None):
        parser.error("--agent-input and --agent-cli-sha256 must be supplied together")

    # This opt-in gate runs before any synthetic or production workload probe.
    # A bad descriptor, credential, authority, session, claim, or resume
    # binding aborts before the harness starts service/load activity.
    agent_input_binding = (
        run_agent_input_preflight(
            binary,
            args.agent_input,
            trusted_binary_sha256=args.agent_cli_sha256,
        )
        if args.agent_input is not None
        else None
    )

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
        service_env = sanitized_environment()
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

        if args.full_v10:
            stop_recovery = run_stop_recovery_probe(
                binary,
                database,
                socket_path,
                "dispatch-smoke-project",
                root,
                service_env,
                "dispatch-smoke-validator",
                "dispatch-smoke-operator-session",
            )
            stop_recovery["agent_input_binding"] = agent_input_binding or {
                "status": "unavailable",
                "attempted": False,
                "authorized_agent": False,
                "reason": "no owner-supplied Agent input descriptor was provided",
            }
        else:
            stop_recovery = {
                "status": "not_run",
                "reason": "pass --full-v10 to run the stop/recovery workload",
            }

    identity = validation_identity(binary)
    typed_queue_busy_details = [
        item
        for item in saturation["dispatch_full_error_details"]
        if item["code"] == "service_busy"
        and "dispatch queue is full" in item["message"].lower()
    ]
    typed_busy_observed = bool(typed_queue_busy_details)
    budget_status = "not_approved"
    control_latency_ms = saturation["control"]["latency_ms"]
    budget_target_ms = args.control_latency_budget_ms
    control_within_candidate_target = (
        None
        if budget_target_ms is None
        else control_latency_ms <= budget_target_ms
    )
    typed_control_failed = (
        saturation["dispatch_full_responses"] == 0 or not typed_busy_observed
    )
    full_mode = args.full_v10
    deadline_evidence = stop_recovery.get("deadline_recovery") or {}
    attempt_recovery = stop_recovery.get("attempt_stop_recovery") or {}
    recovery_obligation = deadline_evidence.get("recovery_obligation")
    resource_reservation = deadline_evidence.get("resource_reservation")
    stale_fence_response = deadline_evidence.get("stale_fence_response")
    deadline_authority = deadline_evidence.get("agent_authority_readback")
    deadline_attempt_after = deadline_evidence.get("attempt_after_restart")
    deadline_proof_fields = {
        "actor_id": deadline_evidence.get("actor_id"),
        "agent_authority_readback": deadline_authority,
        "deadline_unix_ms": deadline_evidence.get("deadline_unix_ms"),
        "service_exited_at_unix_ms": deadline_evidence.get("service_exited_at_unix_ms"),
        "service_restart_unix_ms": deadline_evidence.get("service_restart_unix_ms"),
        "attempt_id": deadline_evidence.get("attempt_id"),
        "fence": deadline_evidence.get("fence"),
        "deadline_crossed_while_service_stopped": deadline_evidence.get(
            "deadline_crossed_while_service_stopped", False
        ),
        "service_restarted_after_deadline": deadline_evidence.get(
            "service_restarted_after_deadline", False
        ),
        "attempt_after_restart": deadline_attempt_after,
        "attempt_state_after_restart": (
            deadline_attempt_after.get("phase")
            if isinstance(deadline_attempt_after, dict)
            else None
        ),
        "recovery_obligation_readback": (
            isinstance(recovery_obligation, dict)
            and isinstance(recovery_obligation.get("obligation_id"), str)
            and bool(recovery_obligation.get("obligation_id"))
            and recovery_obligation.get("attempt_id") == deadline_evidence.get("attempt_id")
            and recovery_obligation.get("state") == "unresolved"
        ),
        "recovery_obligation": recovery_obligation,
        "resource_ownership_active_after_restart": (
            isinstance(resource_reservation, dict)
            and resource_reservation.get("attempt_id") == deadline_evidence.get("attempt_id")
            and resource_reservation.get("state") == "active"
        ),
        "resource_reservation": resource_reservation,
        "stale_fence_rejected": (
            isinstance(stale_fence_response, dict)
            and type(stale_fence_response.get("exit_code")) is int
            and stale_fence_response.get("exit_code", 0) != 0
            and (stale_fence_response.get("envelope") or {}).get("error", {}).get("code")
            == "stale_fence"
        ),
        "stale_fence_response": stale_fence_response,
    }
    deadline_complete = (
        isinstance(deadline_authority, dict)
        and isinstance(deadline_proof_fields["actor_id"], str)
        and bool(deadline_proof_fields["actor_id"])
        and deadline_authority.get("actor_id") == deadline_proof_fields["actor_id"]
        and deadline_authority.get("role") == "agent"
        and deadline_authority.get("authority_granted") is True
        and deadline_proof_fields["deadline_crossed_while_service_stopped"] is True
        and type(deadline_proof_fields["deadline_unix_ms"]) is int
        and type(deadline_proof_fields["service_exited_at_unix_ms"]) is int
        and deadline_proof_fields["service_exited_at_unix_ms"]
        < deadline_proof_fields["deadline_unix_ms"]
        and type(deadline_proof_fields["service_restart_unix_ms"]) is int
        and deadline_proof_fields["service_restart_unix_ms"]
        >= deadline_proof_fields["deadline_unix_ms"]
        and deadline_proof_fields["service_restarted_after_deadline"] is True
        and isinstance(deadline_attempt_after, dict)
        and deadline_attempt_after.get("attempt_id") == deadline_proof_fields["attempt_id"]
        and type(deadline_attempt_after.get("fence")) is int
        and deadline_attempt_after.get("fence") == deadline_proof_fields["fence"]
        and deadline_attempt_after.get("current") is True
        and deadline_proof_fields["attempt_state_after_restart"] == "expiry_pending"
        and deadline_proof_fields["recovery_obligation_readback"] is True
        and deadline_proof_fields["resource_ownership_active_after_restart"] is True
        and deadline_proof_fields["stale_fence_rejected"] is True
        and isinstance(deadline_proof_fields["attempt_id"], str)
        and bool(deadline_proof_fields["attempt_id"])
        and type(deadline_proof_fields["fence"]) is int
        and deadline_proof_fields["fence"] > 0
    )
    agent_input_binding = stop_recovery.get("agent_input_binding") or {}
    attempt_authority = attempt_recovery.get("agent_authority_readback")
    if (
        not isinstance(attempt_authority, dict)
        and agent_input_binding.get("status") == "read_only_preflight_pass"
    ):
        attempt_authority = {
            "actor_id": agent_input_binding.get("actor_id"),
            "role": "agent",
            "authority_granted": True,
        }
    attempt_actor_id = attempt_recovery.get("actor_id") or agent_input_binding.get("actor_id")
    attempt_after_restart = attempt_recovery.get("attempt_after_restart")
    attempt_deadline_unix_ms = attempt_recovery.get("deadline_unix_ms")
    attempt_restart_unix_ms = attempt_recovery.get("service_restart_unix_ms")
    attempt_id = attempt_recovery.get("attempt_id") or agent_input_binding.get("attempt_id")
    attempt_fence = attempt_recovery.get("fence") or agent_input_binding.get("fence")
    authorized_agent = (
        isinstance(attempt_actor_id, str)
        and bool(attempt_actor_id)
        and isinstance(attempt_authority, dict)
        and attempt_authority.get("actor_id") == attempt_actor_id
        and attempt_authority.get("role") == "agent"
        and attempt_authority.get("authority_granted") is True
    )
    attempt_after_due = (
        type(attempt_deadline_unix_ms) is int
        and type(attempt_restart_unix_ms) is int
        and type(attempt_recovery.get("service_exited_at_unix_ms")) is int
        and attempt_recovery.get("service_exited_at_unix_ms") < attempt_deadline_unix_ms
        and attempt_restart_unix_ms >= attempt_deadline_unix_ms
        and attempt_recovery.get("deadline_crossed_while_service_stopped") is True
        and attempt_recovery.get("service_restarted_after_deadline") is True
    )
    attempt_stop_proof_fields = {
        "authorized_agent": authorized_agent,
        "agent_authority_readback": attempt_authority,
        "actor_id": attempt_actor_id,
        "actor_role": attempt_authority.get("role") if isinstance(attempt_authority, dict) else None,
        "attempt_id": attempt_id,
        "fence": attempt_fence,
        "deadline_unix_ms": attempt_deadline_unix_ms,
        "service_exited_at_unix_ms": attempt_recovery.get("service_exited_at_unix_ms"),
        "service_restart_unix_ms": attempt_restart_unix_ms,
        "deadline_crossed_while_service_stopped": attempt_after_due,
        "restart_disposition_readback": attempt_after_restart,
        "attempt_state_after_restart": attempt_after_restart.get("phase")
        if isinstance(attempt_after_restart, dict)
        else None,
        "recovery_obligation": attempt_recovery.get("recovery_obligation"),
        "resource_reservation": attempt_recovery.get("resource_reservation"),
        "stale_fence_response": attempt_recovery.get("stale_fence_response"),
        "agent_input_binding": agent_input_binding,
    }
    attempt_stop_complete = (
        attempt_stop_proof_fields["authorized_agent"]
        and attempt_stop_proof_fields["actor_role"] == "agent"
        and isinstance(attempt_stop_proof_fields["attempt_id"], str)
        and bool(attempt_stop_proof_fields["attempt_id"])
        and type(attempt_stop_proof_fields["fence"]) is int
        and attempt_stop_proof_fields["fence"] > 0
        and attempt_after_due
        and isinstance(attempt_stop_proof_fields["restart_disposition_readback"], dict)
        and attempt_stop_proof_fields["restart_disposition_readback"].get("attempt_id")
        == attempt_stop_proof_fields["attempt_id"]
        and type(attempt_stop_proof_fields["restart_disposition_readback"].get("fence")) is int
        and attempt_stop_proof_fields["restart_disposition_readback"].get("fence")
        == attempt_stop_proof_fields["fence"]
        and attempt_stop_proof_fields["restart_disposition_readback"].get("phase")
        == "expiry_pending"
        and attempt_stop_proof_fields["restart_disposition_readback"].get("current") is True
        and isinstance(attempt_stop_proof_fields["recovery_obligation"], dict)
        and isinstance(attempt_stop_proof_fields["recovery_obligation"].get("obligation_id"), str)
        and attempt_stop_proof_fields["recovery_obligation"].get("attempt_id")
        == attempt_stop_proof_fields["attempt_id"]
        and attempt_stop_proof_fields["recovery_obligation"].get("state") == "unresolved"
        and isinstance(attempt_stop_proof_fields["resource_reservation"], dict)
        and attempt_stop_proof_fields["resource_reservation"].get("attempt_id")
        == attempt_stop_proof_fields["attempt_id"]
        and attempt_stop_proof_fields["resource_reservation"].get("state") == "active"
        and isinstance(attempt_stop_proof_fields["stale_fence_response"], dict)
        and type(attempt_stop_proof_fields["stale_fence_response"].get("exit_code")) is int
        and attempt_stop_proof_fields["stale_fence_response"].get("exit_code", 0) != 0
        and (attempt_stop_proof_fields["stale_fence_response"].get("envelope") or {})
        .get("error", {})
        .get("code")
        == "stale_fence"
    )
    first_sigterm = stop_recovery.get("sigterm_drain") or {}
    restarted_service_stop = stop_recovery.get("same_database_restart") or {}
    first_stop_pids = first_sigterm.get("active_client_process_pids_at_request")
    first_stop_snapshot_ns = first_sigterm.get("active_client_snapshot_monotonic_ns")
    first_stop_signal_ns = first_sigterm.get("signal_sent_monotonic_ns")
    first_stop_observed = (
        first_sigterm.get("signal") == "SIGTERM"
        and first_sigterm.get("exit_code") == 0
        and first_sigterm.get("socket_removed") is True
        and type(first_sigterm.get("active_client_processes_at_request")) is int
        and first_sigterm["active_client_processes_at_request"] > 0
        and isinstance(first_stop_pids, list)
        and len(first_stop_pids) == first_sigterm["active_client_processes_at_request"]
        and all(type(pid) is int and pid > 0 for pid in first_stop_pids)
        and type(first_stop_snapshot_ns) is int
        and type(first_stop_signal_ns) is int
        and 0 <= first_stop_signal_ns - first_stop_snapshot_ns <= 250_000_000
    )
    restart_stop_observed = (
        restarted_service_stop.get("exit_code") == 0
        and restarted_service_stop.get("socket_removed") is True
    )
    attempt_probe_attempted = attempt_recovery.get("attempted") is True
    attempt_unavailable = not attempt_probe_attempted and attempt_recovery.get("status") == "unavailable"
    attempt_status = (
        "pass"
        if attempt_stop_complete
        else "unavailable"
        if attempt_unavailable and full_mode
        else "fail"
        if full_mode
        else "not_run"
    )
    deadline_status = (
        "pass"
        if deadline_complete
        else "unavailable"
        if attempt_unavailable and full_mode
        else "fail"
        if full_mode
        else "not_run"
    )
    restart_readback = stop_recovery.get("restart_readback_before_retry") or {}
    typed_control_complete = False
    stop_component_complete = (
        attempt_stop_complete
        and first_stop_observed
        and restart_stop_observed
        and stop_recovery.get("drain_and_readback_observed") is True
    )
    stop_component_status = (
        "pass"
        if stop_component_complete
        else "unavailable"
        if attempt_unavailable and full_mode
        else "fail"
        if full_mode
        else "not_run"
    )
    components = {
        "durable_deadline": {
            "status": deadline_status,
            "complete": deadline_complete,
            "evidence_ref": "#/stop_recovery/deadline_recovery",
            **deadline_proof_fields,
            "fake_clock_projection_status": clock["status"],
            "reason": None
            if deadline_complete
            else "the Agent descriptor preflight is read-only; its project service was not stopped and restarted"
            if agent_input_binding.get("status") == "read_only_preflight_pass"
            else deadline_evidence.get("reason")
            if deadline_status == "unavailable"
            else "the authorized attempt path ran but did not jointly read back expiry_pending, its recovery obligation, active reservation, and stale-fence rejection after restart",
        },
        "full_load": {
            "status": "not_approved" if full_mode else "not_run",
            "complete": False,
            "evidence_ref": "#/stop_recovery/workload",
            "approved_profile": {
                "status": "not_approved" if full_mode else "not_run",
                "source": None,
                "path": None,
                "sha256": None,
                "profile_id": None,
                "worker_target": None,
                "dispatch_workers_target": None,
                "dispatch_capacity_target": None,
                "requests_per_worker_target": None,
                "minimum_duration_ms": None,
                "completion_target": None,
                "maximum_failed_or_unavailable_responses_target": None,
                "starvation_target": None,
            },
            "observed": stop_recovery.get("workload"),
            "observed_completion_approved": False,
            "observed_failure_breakdown": (stop_recovery.get("workload") or {}).get(
                "failed_or_unavailable_response_breakdown"
            ),
            "observed_profile": {
                "workers": (stop_recovery.get("workload") or {}).get("workers"),
                "requests_per_worker": (stop_recovery.get("workload") or {}).get(
                    "requests_per_worker"
                ),
                "dispatch_workers": stop_recovery.get("configuration", {}).get(
                    "dispatch_workers"
                ),
                "dispatch_capacity": stop_recovery.get("configuration", {}).get(
                    "dispatch_capacity"
                ),
                "requests_started": (stop_recovery.get("workload") or {}).get(
                    "requests_started"
                ),
                "observed_duration_ms": (stop_recovery.get("workload") or {}).get(
                    "observed_duration_ms"
                ),
                "successful_responses": (stop_recovery.get("workload") or {}).get(
                    "successful_responses"
                ),
                "successful_responses_before_sigterm": (
                    stop_recovery.get("workload") or {}
                ).get("successful_responses_before_sigterm"),
                "failed_or_unavailable_responses": (
                    stop_recovery.get("workload") or {}
                ).get("failed_or_unavailable_responses"),
                "workers_with_successful_responses": (
                    stop_recovery.get("workload") or {}
                ).get("workers_with_successful_responses"),
                "worker_progress": (stop_recovery.get("workload") or {}).get(
                    "worker_progress"
                ),
                "workers_with_zero_successful_responses": (
                    stop_recovery.get("workload") or {}
                ).get("workers_with_zero_successful_responses"),
                "observed_max_success_progress_gap_ms": (
                    stop_recovery.get("workload") or {}
                ).get("observed_max_success_progress_gap_ms"),
                "observed_starvation_workers_with_zero_progress": (
                    stop_recovery.get("workload") or {}
                ).get("observed_starvation_workers_with_zero_progress"),
                "min_successful_responses_per_observed_worker": (
                    stop_recovery.get("workload") or {}
                ).get("min_successful_responses_per_observed_worker"),
                "max_successful_responses_per_observed_worker": (
                    stop_recovery.get("workload") or {}
                ).get("max_successful_responses_per_observed_worker"),
            },
            "queue_observation": {
                "configured_dispatch_workers": stop_recovery.get("configuration", {}).get(
                    "dispatch_workers"
                ),
                "configured_dispatch_capacity": stop_recovery.get("configuration", {}).get(
                    "dispatch_capacity"
                ),
                "queue_full_responses": (stop_recovery.get("workload") or {}).get(
                    "queue_full_responses"
                ),
                "queue_full_error_details": (stop_recovery.get("workload") or {}).get(
                    "queue_full_error_details"
                ),
                "queue_depth_observed": False,
            },
            "reason": "no owner-approved full normal-load matrix or soak profile was supplied; bounded worker, queue, and progress observations remain recorded",
        },
        "typed_control": {
            "status": (
                "fail"
                if full_mode and typed_control_failed
                else "not_approved"
                if full_mode
                else "not_run"
            ),
            "complete": typed_control_complete,
            "evidence_ref": "#/queue_and_control",
            "typed_service_busy_observed": typed_busy_observed,
            "typed_service_busy_error_details": typed_queue_busy_details,
            "dispatch_queue_full_observed": saturation["dispatch_full_responses"] > 0,
            "dispatch_queue_full_error_details": saturation[
                "dispatch_full_error_details"
            ],
            "observed_error_codes": saturation["normal_error_codes"],
            "control_response": saturation["control"],
            "budget_status": budget_status,
            "latency_ms": control_latency_ms,
            "target_ms": budget_target_ms,
            "latency_within_target": control_within_candidate_target,
            "latency_target_status": "unverified_candidate"
            if budget_target_ms is not None
            else "not_supplied",
            "reason": (
                "no dispatch-queue-full response with exact service_busy type was observed"
                if typed_control_failed
                else "typed queue response was observed, but no independently approved control-latency budget is available"
            ),
        },
        "stop_recovery": {
            "status": stop_component_status,
            "complete": stop_component_complete,
            "evidence_ref": "#/stop_recovery",
            "graceful_drain_and_readback_observed": stop_recovery.get(
                "drain_and_readback_observed", False
            ),
            "sigterm_drain": {
                "signal": first_sigterm.get("signal"),
                "exit_code": first_sigterm.get("exit_code"),
                "socket_removed": first_sigterm.get("socket_removed"),
                "active_client_processes_at_request": first_sigterm.get(
                    "active_client_processes_at_request"
                ),
                "active_client_process_pids_at_request": first_stop_pids,
                "active_client_snapshot_monotonic_ns": first_stop_snapshot_ns,
                "signal_sent_monotonic_ns": first_stop_signal_ns,
                "service_exited_at_unix_ms": first_sigterm.get(
                    "service_exited_at_unix_ms"
                ),
            },
            "same_database_restart_stop": {
                "exit_code": restarted_service_stop.get("exit_code"),
                "socket_removed": restarted_service_stop.get("socket_removed"),
            },
            "restart_readback_before_retry": {
                "operation_data": restart_readback.get("operation_data"),
                "operation_error": restart_readback.get("operation_error"),
                "operation_result_subject_match": restart_readback.get(
                    "operation_result_subject_match", False
                ),
                "work_data": restart_readback.get("work_data"),
                "work_error": restart_readback.get("work_error"),
                "work_readback_exact_id": restart_readback.get(
                    "work_readback_exact_id", False
                ),
            },
            "attempt_stop_recovery": attempt_stop_proof_fields,
            "agent_input_binding": agent_input_binding,
            "reason": None
            if stop_component_complete
            else "the Agent descriptor preflight is read-only; the exact project attempt was not stopped/restarted"
            if agent_input_binding.get("status") == "read_only_preflight_pass"
            else attempt_recovery.get("reason")
            if attempt_status == "unavailable"
            else "the authorized Agent attempt path ran but did not prove stop/recovery and the required post-restart disposition",
        },
    }
    all_components_complete = all(
        component["complete"] and component["status"] == "pass"
        for component in components.values()
    ) and budget_status == "approved"
    v10_acceptance = {
        "mode": "full_v10" if args.full_v10 else "dispatch_smoke",
        "status": "pass" if all_components_complete else "not_established",
        "complete": all_components_complete,
        "components": components,
        "control_latency_budget": {
            "status": budget_status,
            "source": args.control_latency_budget_source,
            "target_ms": args.control_latency_budget_ms,
            "approval_artifact": {"path": None, "sha256": None},
        },
        "identity": identity,
        "report_path": str(args.output.resolve()),
    }
    dispatch_smoke_status = "pass" if saturation["assertions"]["passed"] else "fail"
    smoke_status = (
        "pass"
        if v10_acceptance["complete"]
        else "partial"
        if dispatch_smoke_status == "pass"
        else "fail"
    )
    result = {
        "result_version": "boreal.dispatch-admission-smoke/2",
        "mode": "full_v10" if args.full_v10 else "dispatch_smoke",
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
        "stop_recovery": stop_recovery,
        "dispatch_smoke_status": dispatch_smoke_status,
        "smoke_status": smoke_status,
        "v10_acceptance": v10_acceptance,
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
    report_sha256 = file_sha256(args.output)
    print(
        json.dumps(
            {
                "mode": result["mode"],
                "output": str(args.output.resolve()),
                "run_id": identity["run_id"],
                "report_sha256": report_sha256,
                "smoke_status": result["smoke_status"],
                "dispatch_smoke_status": result["dispatch_smoke_status"],
                "assertions": saturation["assertions"],
                "fake_clock_status": clock["status"],
                "stop_status": stop["status"],
                "stop_recovery_status": stop_recovery["status"],
                "v10_acceptance": result["v10_acceptance"]["status"],
            },
            sort_keys=True,
        )
    )
    if not saturation["assertions"]["passed"]:
        return 1
    if args.full_v10 and not v10_acceptance["complete"]:
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        message = str(error)
        lowered = message.lower()
        if (
            "operation not permitted" in lowered or "permission denied" in lowered
        ) and ("socket" in lowered or "unix" in lowered):
            unavailable_identity = {
                "run_id": f"{int(time.time() * 1000)}-{os.getpid()}-unavailable",
                "source": {
                    "commit": None,
                    "tree": None,
                    "dirty": None,
                    "diff_sha256": None,
                    "production_host_sha256": file_sha256(Path(__file__).resolve()),
                },
                "binary": {"path": None, "sha256": None, "version": None},
            }
            print(
                json.dumps(
                    {
                        "mode": "unavailable",
                        "output": None,
                        "run_id": unavailable_identity["run_id"],
                        "report_sha256": None,
                        "smoke_status": "unavailable",
                        "dispatch_smoke_status": "unavailable",
                        "assertions": None,
                        "fake_clock_status": "unavailable",
                        "stop_status": "not_run",
                        "v10_acceptance": {
                            "status": "not_established",
                            "complete": False,
                            "components": {
                                name: {
                                    "status": "unavailable",
                                    "complete": False,
                                    "evidence_ref": None,
                                }
                                for name in (
                                    "durable_deadline",
                                    "full_load",
                                    "typed_control",
                                    "stop_recovery",
                                )
                            },
                            "control_latency_budget": {
                                "status": "not_approved",
                                "source": None,
                                "target_ms": None,
                            },
                            "identity": unavailable_identity,
                        },
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
