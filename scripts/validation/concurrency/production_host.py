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
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import math
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
V10_CONTROL_BUDGET_SCHEMA = "boreal.v10-control-latency-budget/v1"
V10_LOAD_PROFILE_SCHEMA = "boreal.v10-load-profile/v1"
V10_DISPOSABLE_AGENT_SCHEMA = "boreal.v10-disposable-agent-authorization/v1"
DISPOSABLE_AGENT_ID = "v10-recovery-agent"
DISPOSABLE_AGENT_SESSION_ID = "v10-recovery-session"
DISPOSABLE_AGENT_HARNESS_ID = "v10-recovery-harness"
DISPOSABLE_AGENT_WORK_ID = "dispatch-smoke-agent-recovery"


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


def captured_output_tail(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        output = value.decode("utf-8", errors="replace")
    else:
        output = str(value)
    return output[-1000:]


def client_error_details(error: BaseException) -> dict[str, str]:
    details = {"message": str(error)}
    stdout = getattr(error, "stdout", None) or getattr(error, "output", None)
    for field, value in (
        ("stdout_tail", stdout),
        ("stderr_tail", getattr(error, "stderr", None)),
    ):
        tail = captured_output_tail(value)
        if tail is not None:
            details[field] = tail
    return details


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def load_approved_artifact(path: Path, *, schema: str) -> tuple[dict, dict]:
    """Read an owner decision artifact from the repository and bind its bytes."""
    supplied_path = path.expanduser()
    if not supplied_path.is_absolute():
        supplied_path = ROOT / supplied_path
    try:
        metadata = supplied_path.lstat()
        artifact_path = supplied_path.resolve(strict=True)
        relative_path = artifact_path.relative_to(ROOT.resolve()).as_posix()
    except (OSError, ValueError) as error:
        raise RuntimeError("approval artifacts must be readable files inside the repository") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError("approval artifact must be a regular non-symlink file")
    payload = artifact_path.read_bytes()
    try:
        document = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("approval artifact is not valid UTF-8 JSON") from error
    if not isinstance(document, dict):
        raise RuntimeError("approval artifact must be a JSON object")
    for field_name in ("decision_id", "approved_by", "approved_at", "contract_version"):
        if not isinstance(document.get(field_name), str) or not document[field_name].strip():
            raise RuntimeError(f"approval artifact requires {field_name}")
    if document.get("schema") != schema or document.get("status") != "approved":
        raise RuntimeError(f"approval artifact must be owner-approved with schema {schema}")
    return document, {
        "path": relative_path,
        "sha256": f"sha256:{hashlib.sha256(payload).hexdigest()}",
    }


def validate_control_budget(document: dict) -> None:
    """Reject incomplete or ambiguous multi-sample control decisions."""
    if (
        not isinstance(document.get("source"), str)
        or not document["source"].strip()
        or type(document.get("target_ms")) not in (int, float)
        or not math.isfinite(document["target_ms"])
        or document["target_ms"] <= 0
        or type(document.get("max_sample_ms")) not in (int, float)
        or not math.isfinite(document["max_sample_ms"])
        or document["max_sample_ms"] <= 0
        or type(document.get("sample_count")) is not int
        or not 1 <= document["sample_count"] <= 100
        or type(document.get("interval_ms")) is not int
        or document["interval_ms"] <= 0
        or document.get("statistic") != "p95"
    ):
        raise RuntimeError("approved control budget must specify p95, sample cadence/count, and latency limits")


def validate_disposable_agent_authorization(document: dict) -> None:
    """Require a narrow approval for one temporary Agent in the smoke project."""
    if (
        document.get("project_id") != "dispatch-smoke-project"
        or document.get("actor_id") != DISPOSABLE_AGENT_ID
        or document.get("role") != "agent"
        or document.get("scope") != "temporary_project_only"
        or document.get("credential_persistence") != "temporary_project"
        or document.get("revoke_before_cleanup") is not True
        or document.get("allow_credential_create") is not True
        or document.get("allow_project_grant") is not True
        or document.get("allow_attempt_claim_and_readback") is not True
        or type(document.get("lease_ttl_ms")) is not int
        or not 1000 <= document["lease_ttl_ms"] <= 30000
        or type(document.get("time_limit_ms")) is not int
        or not document["lease_ttl_ms"] < document["time_limit_ms"] <= 300000
    ):
        raise RuntimeError("disposable Agent authorization exceeds or does not match the temporary-project scope")


def envelope_data(response: dict, *, command: str) -> dict:
    envelope = response.get("envelope") if isinstance(response, dict) else None
    error = envelope.get("error") if isinstance(envelope, dict) else None
    data = envelope.get("data") if isinstance(envelope, dict) else None
    if (
        not isinstance(envelope, dict)
        or response.get("exit_code") != 0
        or error is not None
        or not isinstance(data, dict)
    ):
        code = error.get("code") if isinstance(error, dict) else None
        raise RuntimeError(f"disposable Agent {command} did not succeed (error={code or 'unknown'})")
    return data


def project_revision(response: dict, *, command: str) -> int:
    data = envelope_data(response, command=command)
    envelope = response["envelope"]
    revision = data.get("revision", envelope.get("revision"))
    if type(revision) is not int or revision < 0:
        raise RuntimeError(f"disposable Agent {command} omitted the project revision")
    return revision


def unix_ms_from_stamp(value: object) -> int | None:
    if type(value) is int:
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def find_object(value: object, predicate) -> dict | None:
    if isinstance(value, dict):
        if predicate(value):
            return value
        for child in value.values():
            found = find_object(child, predicate)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_object(child, predicate)
            if found is not None:
                return found
    return None


def stale_fence_request_matches_claim(
    request: object,
    *,
    project_id: object,
    work_id: object,
    actor_id: object,
    attempt_id: object,
    fence: object,
) -> bool:
    if not isinstance(request, dict):
        return False
    claim = request.get("claim_readback")
    current = request.get("current_attempt_readback")
    stale_attempt_id = request.get("attempt_id")
    stale_fence = request.get("fence")
    expected_argv = [
        "agent", "release", work_id, "--project", project_id,
        "--attempt", stale_attempt_id, "--fence", str(stale_fence),
    ]
    return (
        request.get("command") == "agent release"
        and isinstance(request.get("invocation_id"), str)
        and bool(request.get("invocation_id"))
        and request.get("argv") == expected_argv
        and request.get("project_id") == project_id
        and request.get("work_id") == work_id
        and request.get("actor_id") == actor_id
        and isinstance(stale_attempt_id, str)
        and bool(stale_attempt_id)
        and type(stale_fence) is int
        and stale_fence > 0
        and stale_attempt_id != attempt_id
        and type(fence) is int
        and fence > stale_fence
        and request.get("previously_issued_by_claim") is True
        and isinstance(claim, dict)
        and claim.get("attempt_id") == stale_attempt_id
        and type(claim.get("fence")) is int
        and claim.get("fence") == stale_fence
        and isinstance(current, dict)
        and current.get("attempt_id") == attempt_id
        and type(current.get("fence")) is int
        and current.get("fence") == fence
    )


def stale_fence_response_matches_request(response: object, request: object) -> bool:
    return (
        isinstance(response, dict)
        and isinstance(request, dict)
        and isinstance(request.get("invocation_id"), str)
        and bool(request.get("invocation_id"))
        and response.get("invocation_id") == request.get("invocation_id")
        and response.get("argv") == request.get("argv")
        and type(response.get("exit_code")) is int
        and response.get("exit_code", 0) != 0
        and (response.get("envelope") or {}).get("error", {}).get("code") == "stale_fence"
    )


def provision_disposable_agent_work(
    binary: Path,
    database: Path,
    socket_path: Path,
    root: Path,
    *,
    operator_actor: str,
    operator_session: str,
    invoke_fn=None,
    client_fn=None,
) -> tuple[str, str]:
    """Register one temporary source and task through supported CLI routes."""
    invoke_fn = invoke_fn or invoke
    client_fn = client_fn or client
    source_file = root / "v10-agent-fixture.txt"
    source_file.write_text("Disposable V10 Agent fixture source v1.\n", encoding="utf-8")
    before_source = client_fn(
        binary, socket_path, "dispatch-smoke-project", ["status"], cwd=root
    )
    revision = project_revision(before_source or {}, command="pre-source status")
    source_response = invoke_fn(
        binary,
        [
            "source", "add", "dispatch-smoke-project",
            "--input", str(source_file),
            "--origin", "test://v10-disposable-agent-fixture",
            "--media-type", "text/plain",
            "--actor", operator_actor,
            "--session", operator_session,
            "--expected-revision", str(revision),
            "--socket", str(socket_path), "--db", str(database),
            "--operation-id", "op_v10_disposable_source", "--json",
        ],
        cwd=root,
    )
    source_data = envelope_data(source_response, command="temporary Agent source add")
    source = source_data.get("source")
    source_version_id = source.get("source_version_id") if isinstance(source, dict) else None
    if not isinstance(source_version_id, str) or not source_version_id.startswith("sv_"):
        raise RuntimeError("temporary Agent source registration omitted its canonical source version")

    before_work = client_fn(
        binary, socket_path, "dispatch-smoke-project", ["status"], cwd=root
    )
    revision = project_revision(before_work or {}, command="pre-work status")
    work_response = invoke_fn(
        binary,
        [
            "work", "create", "dispatch-smoke-project", DISPOSABLE_AGENT_WORK_ID,
            "Disposable V10 Agent recovery fixture",
            "--kind", "task", "--actor", operator_actor,
            "--session", operator_session,
            "--expected-revision", str(revision),
            "--socket", str(socket_path), "--db", str(database),
            "--operation-id", "op_v10_disposable_work", "--json",
        ],
        cwd=root,
    )
    envelope_data(work_response, command="temporary Agent work create")
    config_identity = "sha256:" + hashlib.sha256(
        b"boreal.v10.disposable-agent-config/v1"
    ).hexdigest()
    return source_version_id, config_identity


def setup_disposable_agent_fixture(
    binary: Path,
    database: Path,
    root: Path,
    authorization: dict,
    authorization_ref: dict,
    *,
    source_version_id: str,
    config_identity: str,
    invoke_fn=None,
) -> dict:
    """Create and grant one short-lived Agent only inside the disposable project."""
    invoke_fn = invoke_fn or invoke
    validate_disposable_agent_authorization(authorization)
    key = invoke_fn(
        binary,
        [
            "auth", "key", "--project", "dispatch-smoke-project",
            "--actor", DISPOSABLE_AGENT_ID, "--actor-role", "agent",
            "--db", str(database), "--json",
        ],
        cwd=root,
    )
    key_data = envelope_data(key, command="auth key")
    enrollment_value = key_data.get("enrollment_path")
    if not isinstance(enrollment_value, str) or not enrollment_value:
        raise RuntimeError("disposable Agent auth key omitted its enrollment path")
    enrollment_path = Path(enrollment_value)
    if not enrollment_path.is_absolute():
        enrollment_path = root / enrollment_path
    try:
        enrollment_metadata = enrollment_path.lstat()
    except OSError as error:
        raise RuntimeError("disposable Agent enrollment is unavailable") from error
    if (
        stat.S_ISLNK(enrollment_metadata.st_mode)
        or not stat.S_ISREG(enrollment_metadata.st_mode)
        or enrollment_metadata.st_uid != os.geteuid()
        or enrollment_metadata.st_mode & 0o077
    ):
        raise RuntimeError("disposable Agent enrollment must be a private regular file owned by this user")
    enrollment_path = enrollment_path.resolve(strict=True)
    credentials_root = (root / ".boreal" / "credentials").resolve(strict=True)
    try:
        enrollment_path.relative_to(credentials_root)
    except ValueError as error:
        raise RuntimeError("disposable Agent enrollment escaped the temporary project") from error
    if not isinstance(source_version_id, str) or not source_version_id.startswith("sv_"):
        raise RuntimeError("disposable Agent fixture requires the registered temporary source version")
    if not isinstance(config_identity, str) or not config_identity.startswith("sha256:"):
        raise RuntimeError("disposable Agent fixture requires a deterministic configuration identity")

    before = invoke_fn(
        binary,
        ["status", "dispatch-smoke-project", "--db", str(database), "--json"],
        cwd=root,
    )
    revision = project_revision(before, command="pre-grant status")
    granted = invoke_fn(
        binary,
        [
            "auth", "grant", "--project", "dispatch-smoke-project",
            "--input", str(enrollment_path), "--actor", "dispatch-smoke-validator",
            "--expected-revision", str(revision),
            "--reason", "Owner-approved disposable V10 recovery fixture", "--yes",
            "--db", str(database), "--operation-id", f"op_v10_agent_grant_{uuid.uuid4().hex}", "--json",
        ],
        cwd=root,
    )
    granted_data = envelope_data(granted, command="auth grant")
    after_grant = invoke_fn(
        binary,
        ["status", "dispatch-smoke-project", "--db", str(database), "--json"],
        cwd=root,
    )
    revision = project_revision(after_grant, command="post-grant status")
    session = invoke_fn(
        binary,
        [
            "session", "start", "--project", "dispatch-smoke-project",
            "--session", DISPOSABLE_AGENT_SESSION_ID,
            "--harness", DISPOSABLE_AGENT_HARNESS_ID,
            "--actor", DISPOSABLE_AGENT_ID,
            "--expected-revision", str(revision), "--db", str(database),
            "--operation-id", f"op_v10_agent_session_{uuid.uuid4().hex}", "--json",
        ],
        cwd=root,
    )
    session_data = envelope_data(session, command="Agent session start")
    authority = invoke_fn(
        binary,
        [
            "auth", "show", "--project", "dispatch-smoke-project",
            "--actor", DISPOSABLE_AGENT_ID, "--db", str(database), "--json",
        ],
        cwd=root,
    )
    authority_data = envelope_data(authority, command="Agent authority readback")
    if (
        authority_data.get("actor_id") != DISPOSABLE_AGENT_ID
        or authority_data.get("role") != "agent"
        or authority_data.get("project_id") != "dispatch-smoke-project"
    ):
        raise RuntimeError("disposable Agent authority readback does not match the approved scope")
    session_readback = invoke_fn(
        binary,
        [
            "session", "show", "--project", "dispatch-smoke-project",
            "--session", DISPOSABLE_AGENT_SESSION_ID,
            "--actor", DISPOSABLE_AGENT_ID, "--db", str(database), "--json",
        ],
        cwd=root,
    )
    session_data = envelope_data(session_readback, command="Agent session readback")
    if (
        session_data.get("actor_id") != DISPOSABLE_AGENT_ID
        or session_data.get("session_id") != DISPOSABLE_AGENT_SESSION_ID
        or session_data.get("harness_id") != DISPOSABLE_AGENT_HARNESS_ID
        or session_data.get("state") != "active"
    ):
        raise RuntimeError("disposable Agent session readback does not match the approved scope")
    return {
        "status": "ready",
        "project_id": "dispatch-smoke-project",
        "actor_id": DISPOSABLE_AGENT_ID,
        "role": "agent",
        "session_id": DISPOSABLE_AGENT_SESSION_ID,
        "harness_id": DISPOSABLE_AGENT_HARNESS_ID,
        "work_id": DISPOSABLE_AGENT_WORK_ID,
        "source_version_id": source_version_id,
        "config_identity": config_identity,
        "lease_ttl_ms": authorization["lease_ttl_ms"],
        "time_limit_ms": authorization["time_limit_ms"],
        "enrollment_path": str(enrollment_path),
        "grant_operation_id": granted_data.get("operation_id"),
        "authorization_artifact": authorization_ref,
        "credential_exposed": False,
        "granted": True,
    }


def revoke_disposable_agent_fixture(
    binary: Path,
    database: Path,
    root: Path,
    fixture: dict,
    *,
    invoke_fn=None,
) -> dict:
    """Revoke the temporary Agent grant before the enclosing project is removed."""
    invoke_fn = invoke_fn or invoke
    if fixture.get("granted") is not True:
        return {"status": "not_needed", "revoked": False}
    current = invoke_fn(
        binary,
        ["status", "dispatch-smoke-project", "--db", str(database), "--json"],
        cwd=root,
    )
    revision = project_revision(current, command="pre-revoke status")
    revoked = invoke_fn(
        binary,
        [
            "auth", "revoke", DISPOSABLE_AGENT_ID,
            "--project", "dispatch-smoke-project", "--actor", "dispatch-smoke-validator",
            "--expected-revision", str(revision),
            "--reason", "End owner-approved disposable V10 recovery fixture", "--yes",
            "--db", str(database), "--operation-id", f"op_v10_agent_revoke_{uuid.uuid4().hex}", "--json",
        ],
        cwd=root,
    )
    envelope_data(revoked, command="auth revoke")
    actor_hash = hashlib.sha256(DISPOSABLE_AGENT_ID.encode("utf-8")).hexdigest()
    credentials_directory = root / ".boreal" / "credentials"
    removed = []
    for filename in (f"sha256-{actor_hash}.json", f"sha256-{actor_hash}.enrollment.json"):
        path = credentials_directory / filename
        if path.exists() and not path.is_symlink() and path.is_file():
            path.unlink()
            removed.append(filename)
    fixture["granted"] = False
    return {
        "status": "pass",
        "revoked": True,
        "project_id": "dispatch-smoke-project",
        "actor_id": DISPOSABLE_AGENT_ID,
        "removed_local_files": removed,
        "secure_erasure_claimed": False,
    }


def claim_disposable_agent_attempt(
    binary: Path,
    socket_path: Path,
    root: Path,
    fixture: dict,
    *,
    client_fn=None,
) -> dict:
    client_fn = client_fn or client
    if fixture.get("granted") is not True:
        raise RuntimeError("disposable Agent claim requires a granted test-only identity")
    credential = _read_standard_credential(
        root, fixture["project_id"], fixture["actor_id"]
    )
    claim = client_fn(
        binary,
        socket_path,
        fixture["project_id"],
        [
            "work", "claim", fixture["work_id"],
            "--actor", fixture["actor_id"],
            "--harness", fixture["harness_id"],
            "--session", fixture["session_id"],
            "--source-version", fixture["source_version_id"],
            "--config-identity", fixture["config_identity"],
            "--lease-ttl", f"{fixture['lease_ttl_ms']}ms",
            "--time-limit", f"{fixture['time_limit_ms']}ms",
            "--operation-id", f"op_v10_agent_claim_{uuid.uuid4().hex}",
        ],
        cwd=root,
        timeout=20.0,
        credential=credential,
    )
    data = envelope_data(claim or {}, command="Agent work claim")
    attempt = find_object(
        data,
        lambda item: isinstance(item.get("attempt_id"), str)
        and type(item.get("fence")) is int,
    )
    if attempt is None:
        attempt = data
    attempt_id = attempt.get("attempt_id")
    fence = attempt.get("fence")
    deadline_ms = unix_ms_from_stamp(attempt.get("lease_deadline"))
    if (
        not isinstance(attempt_id, str)
        or not attempt_id
        or type(fence) is not int
        or fence <= 0
        or deadline_ms is None
    ):
        raise RuntimeError("disposable Agent claim omitted its exact attempt, fence, or lease deadline")
    return {
        "attempt_id": attempt_id,
        "fence": fence,
        "lease_deadline": attempt.get("lease_deadline"),
        "deadline_unix_ms": deadline_ms,
        "claim_readback": {key: attempt.get(key) for key in ("attempt_id", "fence", "phase", "lease_deadline", "hard_deadline")},
        "operation_id": (data.get("operation_id") if isinstance(data, dict) else None),
    }


def read_disposable_agent_recovery(
    binary: Path,
    socket_path: Path,
    database: Path,
    root: Path,
    fixture: dict,
    claim: dict,
    *,
    service_exited_at_unix_ms: int,
    service_restart_unix_ms: int,
    invoke_fn=None,
    client_fn=None,
) -> dict:
    """Collect read-only post-restart state for the exact disposable Agent claim."""
    invoke_fn = invoke_fn or invoke
    client_fn = client_fn or client
    project = fixture["project_id"]
    actor = fixture["actor_id"]
    attempt_id = claim["attempt_id"]
    fence = claim["fence"]
    credential = _read_standard_credential(root, project, actor)
    resume_response = client_fn(
        binary,
        socket_path,
        project,
        [
            "agent", "resume", "--project", project, "--actor", actor,
            "--harness", fixture["harness_id"], "--session", fixture["session_id"],
            "--attempt", attempt_id,
        ],
        cwd=root,
        credential=credential,
    )
    resume = envelope_data(resume_response or {}, command="post-restart Agent resume")
    resume_context = resume.get("context")
    resume_status = resume.get("status")
    resume_bound = (
        isinstance(resume_context, dict)
        and resume_context.get("mode") == "resume"
        and resume_context.get("project_id") == project
        and resume_context.get("actor_id") == actor
        and resume_context.get("harness_id") == fixture["harness_id"]
        and resume_context.get("session_id") == fixture["session_id"]
        and isinstance(resume_status, dict)
        and resume_status.get("work_id") == fixture["work_id"]
        and resume_status.get("attempt_id") == attempt_id
        and type(resume_status.get("fence")) is int
        and resume_status.get("fence") == fence
    )
    authority = {
        "project_id": project,
        "actor_id": actor if resume_bound else None,
        "role": "agent" if resume_bound else None,
        "authority_granted": resume_bound,
        "readback_command": "agent resume",
        "authenticated": resume_bound,
    }
    status_response = client_fn(
        binary,
        socket_path,
        project,
        ["status", "--actor", actor, "--session", fixture["session_id"], "--limit", "100"],
        cwd=root,
        credential=credential,
    )
    status_data = envelope_data(status_response or {}, command="post-restart Agent status")
    work = client_fn(
        binary,
        socket_path,
        project,
        ["work", "show", fixture["work_id"]],
        cwd=root,
        credential=credential,
    )
    work_data = envelope_data(work or {}, command="post-restart work show")
    attempt_predicate = lambda item: item.get("attempt_id") == attempt_id
    status_attempt = find_object(status_data, attempt_predicate)
    work_attempt = find_object(work_data, attempt_predicate)
    observed_attempt = status_attempt or work_attempt
    if status_attempt is not None and work_attempt is not None:
        if (
            status_attempt.get("fence") != work_attempt.get("fence")
            or status_attempt.get("attempt_id") != work_attempt.get("attempt_id")
        ):
            observed_attempt = None
    attempt_after_restart = None
    if isinstance(observed_attempt, dict):
        attempt_after_restart = {
            "attempt_id": observed_attempt.get("attempt_id"),
            "fence": observed_attempt.get("fence"),
            "phase": observed_attempt.get("phase"),
            # Successful agent resume is the canonical current-attempt route;
            # status supplies the phase, which does not include a current flag.
            "current": resume_bound,
            "currentness_readback": {
                "command": "agent resume",
                "work_id": resume_status.get("work_id") if isinstance(resume_status, dict) else None,
                "attempt_id": resume_status.get("attempt_id") if isinstance(resume_status, dict) else None,
                "fence": resume_status.get("fence") if isinstance(resume_status, dict) else None,
                "context": resume_context,
            },
        }

    recovery_response = invoke_with_credential(
        binary,
        ["recovery", "list", "--project", project, "--limit", "100", "--socket", str(socket_path), "--json"],
        cwd=root,
        credential=credential,
    )
    recovery_data = envelope_data(recovery_response, command="recovery list")
    obligations = recovery_data.get("items", recovery_data.get("obligations", []))
    obligation = find_object(
        obligations,
        lambda item: item.get("attempt_id") == attempt_id and item.get("state") == "unresolved",
    )

    reservation_response = invoke_with_credential(
        binary,
        [
            "reservation", "list", "--project", project, "--owner", actor,
            "--work", fixture["work_id"], "--status", "active", "--limit", "100",
            "--socket", str(socket_path), "--json",
        ],
        cwd=root,
        credential=credential,
    )
    reservation_data = envelope_data(reservation_response, command="reservation list")
    reservations = reservation_data.get("items", reservation_data.get("reservations", []))
    reservation = find_object(
        reservations,
        lambda item: item.get("attempt_id") == attempt_id and item.get("state") == "active",
    )

    # The temporary authorization permits claim and readback only. A same-fence
    # release could succeed and mutate a current attempt, so this harness does
    # not issue a mutating request to manufacture a stale-fence response.
    stale_fence_response = None
    deadline_ms = claim.get("deadline_unix_ms")
    deadline_crossed = (
        type(service_exited_at_unix_ms) is int
        and type(deadline_ms) is int
        and type(service_restart_unix_ms) is int
        and service_exited_at_unix_ms < deadline_ms <= service_restart_unix_ms
    )
    authority_readback = {
        "actor_id": authority.get("actor_id"),
        "role": authority.get("role"),
        "authority_granted": authority.get("role") == "agent",
        "readback_command": authority.get("readback_command"),
        "authenticated": authority.get("authenticated") is True,
    }
    attempt_match = (
        isinstance(attempt_after_restart, dict)
        and attempt_after_restart.get("attempt_id") == attempt_id
        and attempt_after_restart.get("fence") == fence
        and attempt_after_restart.get("current") is True
    )
    recovery_obligation = obligation
    resource_reservation = reservation
    stale_fence_rejected = False
    assertions = {
        "agent_authority_readback": authority_readback,
        "deadline_crossed_while_service_stopped": deadline_crossed,
        "service_restarted_after_deadline": deadline_crossed,
        "same_attempt_and_fence_current_after_restart": attempt_match,
        "attempt_expiry_pending_after_restart": (
            isinstance(attempt_after_restart, dict)
            and attempt_after_restart.get("phase") == "expiry_pending"
        ),
        "unresolved_recovery_obligation_readback": (
            isinstance(recovery_obligation, dict)
            and recovery_obligation.get("attempt_id") == attempt_id
            and recovery_obligation.get("state") == "unresolved"
        ),
        "active_resource_reservation_readback": (
            isinstance(resource_reservation, dict)
            and resource_reservation.get("attempt_id") == attempt_id
            and resource_reservation.get("state") == "active"
        ),
        "stale_fence_rejected": stale_fence_rejected,
    }
    complete = all(
        (value.get("role") == "agent" and value.get("authority_granted") is True)
        if key == "agent_authority_readback"
        else value
        for key, value in assertions.items()
    )
    return {
        "status": "pass" if complete else "fail",
        "attempted": True,
        "authorized_agent": authority_readback.get("authority_granted") is True,
        "actor_role": authority_readback.get("role"),
        "project_id": project,
        "work_id": fixture["work_id"],
        "session_id": fixture["session_id"],
        "harness_id": fixture["harness_id"],
        "actor_id": actor,
        "agent_authority_readback": authority_readback,
        "attempt_id": attempt_id,
        "fence": fence,
        "deadline_unix_ms": deadline_ms,
        "service_exited_at_unix_ms": service_exited_at_unix_ms,
        "service_restart_unix_ms": service_restart_unix_ms,
        "deadline_crossed_while_service_stopped": deadline_crossed,
        "service_restarted_after_deadline": deadline_crossed,
        "attempt_after_restart": attempt_after_restart,
        "attempt_state_after_restart": attempt_after_restart.get("phase") if attempt_after_restart else None,
        "restart_disposition_readback": attempt_after_restart,
        "recovery_obligation_readback": assertions["unresolved_recovery_obligation_readback"],
        "recovery_obligation": recovery_obligation,
        "resource_ownership_active_after_restart": assertions["active_resource_reservation_readback"],
        "resource_reservation": resource_reservation,
        "stale_fence_rejected": stale_fence_rejected,
        "stale_fence_response": stale_fence_response,
        "stale_fence_request": None,
        "assertions": assertions,
        "stale_fence_probe": "not_run; authorization permits claim/readback only",
        "reason": None if complete else "post-restart readbacks did not prove every V10 recovery requirement; no mutating stale-fence request was authorized",
    }


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
    credential: str | None = None,
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
    elif args[:2] == ["agent", "resume"]:
        command = list(args)
    else:
        raise ValueError(f"unsupported production-client command shape: {args!r}")
    args = [*command, "--socket", str(socket_path), "--json"]
    if active_processes is None:
        if credential is not None:
            return invoke_with_credential(
                binary, args, cwd=cwd, credential=credential, timeout=timeout
            )
        return invoke(binary, args, cwd=cwd, timeout=timeout)
    if active_process_lock is None:
        raise ValueError("tracked clients require their registry lock")

    argv = [str(binary), *args]
    with active_process_lock:
        # The stop/recovery probe shares this lock with its SIGTERM admission
        # boundary. A client either starts before the boundary and its outcome
        # is collected, or is not started. Only clients still running at the
        # later shutdown snapshot appear in its active-process count.
        if admission_stopped is not None and admission_stopped.is_set():
            return None
        child_environment = sanitized_environment()
        if credential is not None:
            child_environment["BOREAL_CREDENTIAL"] = credential
        process = subprocess.Popen(
            argv,
            cwd=cwd,
            env=child_environment,
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
    try:
        envelope = parse_envelope(completed)
    except RuntimeError:
        if credential is not None:
            raise RuntimeError("credentialed service client returned an invalid response") from None
        raise
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
    operating_system = platform.system()
    if operating_system == "Darwin":
        output = root / "libboreal_fake_clock.dylib"
        flags = ["-dynamiclib", "-fPIC", "-O2"]
        libraries = []
    elif operating_system == "Linux":
        output = root / "libboreal_fake_clock.so"
        flags = ["-shared", "-fPIC", "-O2"]
        libraries = ["-ldl"]
    else:
        return None, f"fake realtime clock interposition is unsupported on {operating_system}"
    cc = os.environ.get("CC", "cc")
    completed = subprocess.run(
        [cc, *flags, str(SHIM_SOURCE), "-o", str(output), *libraries],
        env=sanitized_environment(),
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        return None, f"could not compile fake clock shim: {completed.stderr.strip()}"
    return output, None


def configure_clock_environment(environment: dict[str, str], shim: Path | None) -> str | None:
    """Enable the process-local clock shim for the service only."""
    if shim is None:
        return None
    variable = {
        "Darwin": "DYLD_INSERT_LIBRARIES",
        "Linux": "LD_PRELOAD",
    }.get(platform.system())
    if variable is None:
        return None
    environment[variable] = str(shim)
    return variable


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


def aggregate_control_samples(samples: list[dict], budget: dict) -> dict:
    """Aggregate a bounded set of approved control samples without hiding gaps."""
    sample_count = budget.get("sample_count")
    interval_ms = budget.get("interval_ms")
    target_ms = budget.get("target_ms")
    max_sample_ms = budget.get("max_sample_ms")
    statistic = budget.get("statistic")
    valid_budget = (
        type(sample_count) is int
        and sample_count > 0
        and type(interval_ms) is int
        and interval_ms > 0
        and type(target_ms) in (int, float)
        and math.isfinite(target_ms)
        and target_ms > 0
        and type(max_sample_ms) in (int, float)
        and math.isfinite(max_sample_ms)
        and max_sample_ms > 0
        and statistic == "p95"
    )
    latencies = [
        sample.get("latency_ms")
        for sample in samples
        if isinstance(sample, dict)
        and type(sample.get("latency_ms")) in (int, float)
        and math.isfinite(sample["latency_ms"])
    ]
    ordered = sorted(latencies)
    p95 = ordered[max(0, math.ceil(0.95 * len(ordered)) - 1)] if ordered else None
    maximum = max(ordered) if ordered else None
    cadence_tolerance_ms = min(50.0, interval_ms * 0.05) if valid_budget else None

    def cadence_matches(index: int, sample: dict) -> bool:
        started_ns = sample.get("started_at_monotonic_ns")
        window_ns = sample.get("sample_window_started_monotonic_ns")
        scheduled_ns = sample.get("scheduled_at_monotonic_ns")
        lag_ms = sample.get("cadence_lag_ms")
        expected_scheduled_ns = (
            window_ns + index * interval_ms * 1_000_000
            if type(window_ns) is int and valid_budget
            else None
        )
        if (
            type(started_ns) is not int
            or type(window_ns) is not int
            or scheduled_ns != expected_scheduled_ns
            or type(lag_ms) not in (int, float)
            or not math.isfinite(lag_ms)
            or abs(lag_ms - (started_ns - scheduled_ns) / 1_000_000.0) > 0.001
            or abs(lag_ms) > cadence_tolerance_ms
            or sample.get("cadence_tolerance_ms") != cadence_tolerance_ms
            or sample.get("cadence_within_tolerance") is not True
        ):
            return False
        if index == 0:
            return sample.get("actual_interval_ms") is None
        previous = samples[index - 1]
        previous_ns = previous.get("started_at_monotonic_ns") if isinstance(previous, dict) else None
        actual_interval_ms = sample.get("actual_interval_ms")
        expected_interval_ms = (
            (started_ns - previous_ns) / 1_000_000.0
            if type(previous_ns) is int
            else None
        )
        return (
            type(actual_interval_ms) in (int, float)
            and math.isfinite(actual_interval_ms)
            and expected_interval_ms is not None
            and abs(actual_interval_ms - expected_interval_ms) <= 0.001
            and abs(actual_interval_ms - interval_ms) <= cadence_tolerance_ms
        )

    sample_contract_complete = (
        valid_budget
        and len(samples) == sample_count
        and len(latencies) == sample_count
        and all(
            sample.get("index") == index
            and sample.get("scheduled_after_window_start_ms") == index * interval_ms
            and type(sample.get("started_at_monotonic_ns")) is int
            and sample["started_at_monotonic_ns"] > 0
            and cadence_matches(index, sample)
            and sample.get("response_received") is True
            and type(sample.get("normal_clients_active_at_request_start")) is int
            and sample["normal_clients_active_at_request_start"] > 0
            and type(sample.get("normal_clients_active_at_response")) is int
            and sample["normal_clients_active_at_response"] > 0
            for index, sample in enumerate(samples)
        )
    )
    return {
        "status": "pass"
        if sample_contract_complete and p95 <= target_ms and maximum <= max_sample_ms
        else "fail",
        "sample_count": len(samples),
        "sample_count_target": sample_count,
        "interval_ms": interval_ms,
        "cadence_tolerance_ms": cadence_tolerance_ms,
        "statistic": statistic,
        "latency_ms": p95,
        "max_latency_ms": maximum,
        "target_ms": target_ms,
        "max_sample_ms": max_sample_ms,
        "latency_within_target": p95 is not None and p95 <= target_ms,
        "samples_complete": sample_contract_complete,
        "samples": samples,
    }


def run_multi_sample_control_probe(
    binary: Path,
    socket_path: Path,
    project: str,
    root: Path,
    *,
    worker_count: int,
    budget: dict,
) -> dict:
    """Sample control progress while real read-only clients keep saturating the service."""
    sample_count = budget.get("sample_count")
    interval_ms = budget.get("interval_ms")
    if type(worker_count) is not int or worker_count <= 0 or worker_count > 64:
        raise ValueError("approved control worker_count must be between 1 and 64")
    if type(sample_count) is not int or sample_count <= 0 or sample_count > 100:
        raise ValueError("approved control sample_count must be between 1 and 100")
    if type(interval_ms) is not int or interval_ms <= 0:
        raise ValueError("approved control interval_ms must be positive")

    stop_workers = threading.Event()
    state_lock = threading.Lock()
    active_processes: dict[int, subprocess.Popen[str]] = {}
    active_process_max = [0]
    workload_results: list[dict] = []
    worker_iterations = [0 for _ in range(worker_count)]

    def worker(index: int) -> None:
        while not stop_workers.is_set():
            iteration = worker_iterations[index]
            worker_iterations[index] += 1
            request_started = time.perf_counter()
            request_args = (
                ["status", "--limit", "8", "--offset", "0"]
                if iteration % 2 == 0
                else ["work", "show", "dispatch-smoke-seed"]
            )
            try:
                response = client(
                    binary,
                    socket_path,
                    project,
                    request_args,
                    cwd=root,
                    timeout=15.0,
                    active_processes=active_processes,
                    active_process_lock=state_lock,
                    active_process_max=active_process_max,
                )
            except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                response = {
                    "exit_code": None,
                    "envelope": {"error": client_error_details(error)},
                    "client_process_started_at": request_started,
                    "client_process_completed_at": time.perf_counter(),
                }
            if response is None:
                break
            with state_lock:
                workload_results.append(
                    {
                        "worker": index,
                        "request_kind": request_args[0]
                        if request_args[0] == "status"
                        else "work_show",
                        "started_at": response.get("client_process_started_at", request_started),
                        "completed_at": response.get("client_process_completed_at", time.perf_counter()),
                        "exit_code": response.get("exit_code"),
                        "error": (response.get("envelope") or {}).get("error"),
                    }
                )
            stop_workers.wait(0.005)

    def current_active_processes() -> int:
        with state_lock:
            return sum(process.poll() is None for process in active_processes.values())

    samples: list[dict] = []
    saw_typed_busy = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as pool:
        futures = [pool.submit(worker, index) for index in range(worker_count)]
        try:
            startup_deadline = time.perf_counter() + 5.0
            while time.perf_counter() < startup_deadline:
                with state_lock:
                    saw_typed_busy = saw_typed_busy or any(
                        (item.get("error") or {}).get("code") == "service_busy"
                        and "dispatch queue is full"
                        in str((item.get("error") or {}).get("message", "")).lower()
                        for item in workload_results
                    )
                if saw_typed_busy and current_active_processes() > 0:
                    break
                time.sleep(0.005)

            sample_window_started_ns = time.monotonic_ns()
            sample_window_started = sample_window_started_ns / 1_000_000_000.0
            cadence_tolerance_ms = min(50.0, interval_ms * 0.05)
            cadence_tolerance_ns = int(cadence_tolerance_ms * 1_000_000)
            interval_ns = interval_ms * 1_000_000
            previous_started_ns = None
            for index in range(sample_count):
                scheduled_ns = sample_window_started_ns + index * interval_ns
                while time.monotonic_ns() < scheduled_ns:
                    remaining = (scheduled_ns - time.monotonic_ns()) / 1_000_000_000.0
                    time.sleep(min(0.001, max(0.0, remaining)))
                now_ns = time.monotonic_ns()
                if now_ns > scheduled_ns + cadence_tolerance_ns:
                    with state_lock:
                        active_at_missed_sample = sum(
                            process.poll() is None for process in active_processes.values()
                        )
                        full_before = sum(
                            (item.get("error") or {}).get("code") == "service_busy"
                            and "dispatch queue is full"
                            in str((item.get("error") or {}).get("message", "")).lower()
                            and item["completed_at"] <= time.perf_counter()
                            for item in workload_results
                        )
                    samples.append(
                        {
                            "index": index,
                            "scheduled_after_window_start_ms": index * interval_ms,
                            "sample_window_started_monotonic_ns": sample_window_started_ns,
                            "scheduled_at_monotonic_ns": scheduled_ns,
                            "started_at_monotonic_ns": None,
                            "cadence_lag_ms": round((now_ns - scheduled_ns) / 1_000_000.0, 3),
                            "actual_interval_ms": None,
                            "cadence_tolerance_ms": cadence_tolerance_ms,
                            "cadence_within_tolerance": False,
                            "latency_ms": None,
                            "response_received": False,
                            "error": {"code": "missed_approved_sample_cadence"},
                            "normal_clients_active_at_request_start": active_at_missed_sample,
                            "normal_clients_active_at_response": active_at_missed_sample,
                            "dispatch_full_responses_before_request": full_before,
                            "overlapped_normal_clients": active_at_missed_sample > 0,
                        }
                    )
                    continue
                with state_lock:
                    full_before = sum(
                        (item.get("error") or {}).get("code") == "service_busy"
                        and "dispatch queue is full"
                        in str((item.get("error") or {}).get("message", "")).lower()
                        and item["completed_at"] <= time.perf_counter()
                        for item in workload_results
                    )
                active_at_start = current_active_processes()
                control = client(
                    binary,
                    socket_path,
                    project,
                    ["status", "--limit", "1", "--offset", "0"],
                    cwd=root,
                    timeout=30.0,
                    active_processes=active_processes,
                    active_process_lock=state_lock,
                    active_process_max=active_process_max,
                )
                control_started_ns = (control or {}).get("client_process_started_monotonic_ns")
                control_completed_ns = (control or {}).get("client_process_completed_monotonic_ns")
                raw_error = (control or {}).get("envelope", {}).get("error")
                error = raw_error or {}
                active_at_response = current_active_processes()
                latency_ms = (
                    (control_completed_ns - control_started_ns) / 1_000_000.0
                    if type(control_started_ns) is int and type(control_completed_ns) is int
                    else None
                )
                cadence_lag_ms = (
                    (control_started_ns - scheduled_ns) / 1_000_000.0
                    if type(control_started_ns) is int
                    else None
                )
                actual_interval_ms = (
                    (control_started_ns - previous_started_ns) / 1_000_000.0
                    if type(control_started_ns) is int and type(previous_started_ns) is int
                    else None
                )
                cadence_within_tolerance = (
                    cadence_lag_ms is not None
                    and abs(cadence_lag_ms) <= cadence_tolerance_ms
                    and (
                        previous_started_ns is None
                        or (
                            actual_interval_ms is not None
                            and abs(actual_interval_ms - interval_ms) <= cadence_tolerance_ms
                        )
                    )
                )
                if type(control_started_ns) is int:
                    previous_started_ns = control_started_ns
                samples.append(
                    {
                        "index": index,
                        "scheduled_after_window_start_ms": index * interval_ms,
                        "sample_window_started_monotonic_ns": sample_window_started_ns,
                        "scheduled_at_monotonic_ns": scheduled_ns,
                        "started_at_monotonic_ns": control_started_ns,
                        "cadence_lag_ms": round(cadence_lag_ms, 3)
                        if cadence_lag_ms is not None
                        else None,
                        "actual_interval_ms": round(actual_interval_ms, 3)
                        if actual_interval_ms is not None
                        else None,
                        "cadence_tolerance_ms": cadence_tolerance_ms,
                        "cadence_within_tolerance": cadence_within_tolerance,
                        "latency_ms": round(latency_ms, 3) if latency_ms is not None else None,
                        "response_received": bool(
                            control
                            and control.get("exit_code") == 0
                            and raw_error is None
                        ),
                        "error": error or None,
                        "normal_clients_active_at_request_start": active_at_start,
                        "normal_clients_active_at_response": active_at_response,
                        "dispatch_full_responses_before_request": full_before,
                        "overlapped_normal_clients": active_at_start > 0
                        or active_at_response > 0,
                    }
                )
            end = time.perf_counter()
        finally:
            stop_workers.set()
        for future in futures:
            future.result(timeout=30.0)

    errors: dict[tuple[str | None, str], int] = {}
    for item in workload_results:
        error = item.get("error") or {}
        if error:
            key = (error.get("code"), str(error.get("message", "")))
            errors[key] = errors.get(key, 0) + 1
    error_details = [
        {"code": code, "message": message, "count": count}
        for (code, message), count in sorted(errors.items(), key=lambda item: (item[0][0] or "", item[0][1]))
    ]
    saw_typed_busy = any(
        item["code"] == "service_busy"
        and "dispatch queue is full" in item["message"].lower()
        for item in error_details
    )
    aggregate = aggregate_control_samples(samples, budget)
    return {
        **aggregate,
        "control_response": {
            "response_received": aggregate["samples_complete"],
            "latency_ms": aggregate["latency_ms"],
            "response_count": aggregate["sample_count"],
        },
        "worker_count": worker_count,
        "normal_requests": len(workload_results),
        "normal_elapsed_ms": round((end - sample_window_started) * 1000.0, 3),
        "normal_max_in_flight_client_processes": active_process_max[0],
        "typed_service_busy_observed": saw_typed_busy,
        "typed_service_busy_error_details": [
            item for item in error_details if item["code"] == "service_busy"
        ],
        "normal_error_details": error_details,
        "production_boundary": "separate bwrk clients over the Unix service socket",
        "saturation_scope": "approved mixed status/work-show pump; queue depth is not directly observed",
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
            "reason": "the runner's supported realtime clock shim was not available",
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
    agent_fixture: dict | None = None,
    clock_file: Path | None = None,
    fake_clock_supported: bool = False,
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
    agent_claim = None
    clock_offset_ms = 0
    attempt_recovery = {
        "status": "unavailable",
        "attempted": False,
        "authorized_agent": False,
        "actor_id": None,
        "agent_authority_readback": None,
        "reason": "no owner-approved disposable Agent fixture was supplied",
    }

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
                "error": client_error_details(error),
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
        if agent_fixture is not None:
            if not fake_clock_supported or clock_file is None:
                attempt_recovery["reason"] = (
                    "the authorized Agent fixture requires the supported process-local realtime clock shim"
                )
            else:
                agent_claim = claim_disposable_agent_attempt(
                    binary,
                    socket_path,
                    root,
                    agent_fixture,
                )
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
            # lock that registers subprocesses. stop_service later snapshots
            # clients still running then; worker futures retain outcomes for
            # clients that finish before that snapshot.
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
        if agent_claim is not None and clock_file is not None and fake_clock_supported:
            stopped_at = stop.get("service_exited_at_unix_ms")
            deadline = agent_claim.get("deadline_unix_ms")
            if type(stopped_at) is int and type(deadline) is int and stopped_at < deadline:
                clock_offset_ms = max(0, deadline - time.time_ns() // 1_000_000 + 1000)
                clock_file.write_text(f"{clock_offset_ms}\n", encoding="ascii")
        restarted = start_service(binary, database, socket_path, root, env)
        try:
            wait_for_socket(socket_path, restarted)
            ready_status(binary, socket_path, project, root)
            if agent_claim is not None and agent_fixture is not None:
                restart_at = time.time_ns() // 1_000_000 + clock_offset_ms
                attempt_recovery = read_disposable_agent_recovery(
                    binary,
                    socket_path,
                    database,
                    root,
                    agent_fixture,
                    agent_claim,
                    service_exited_at_unix_ms=stop.get("service_exited_at_unix_ms"),
                    service_restart_unix_ms=restart_at,
                )
                attempt_recovery["claim_readback"] = agent_claim.get("claim_readback")
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
            if clock_file is not None and fake_clock_supported:
                clock_file.write_text("0\n", encoding="ascii")
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
        captured_client_outputs = [
            {
                "worker": item["worker"],
                "iteration": item["iteration"],
                "request_kind": item["request_kind"],
                **{
                    field: item["error"][field]
                    for field in ("stdout_tail", "stderr_tail")
                    if field in item.get("error", {})
                },
            }
            for item in workload
            if isinstance(item.get("error"), dict)
            and ("stdout_tail" in item["error"] or "stderr_tail" in item["error"])
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
            "captured_client_outputs": captured_client_outputs,
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
                **attempt_recovery,
                "actor_role": attempt_recovery.get("actor_role"),
                "attempt_stop_observed": False,
            },
            "deadline_recovery": attempt_recovery,
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


SATURATION_ASSERTION_FIELDS = (
    "dispatch_full_response_observed_before_control",
    "normal_client_active_when_control_started",
    "control_response_received",
    "normal_client_active_when_control_responded",
    "control_overlapped_normal_client_interval",
)
SATURATION_OUTCOME_FIELDS = ("changed", "unchanged", "rejected", "failed", "unknown")


def _finite_number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def normalize_saturation_report(value: object) -> dict:
    """Make incomplete saturation data reportable while forcing a failed gate."""
    control_defaults = {
        "outcome": None,
        "exit_code": None,
        "error": None,
        "request_started_after_smoke_start_ms": None,
        "response_completed_after_smoke_start_ms": None,
        "latency_ms": None,
        "normal_clients_active_at_request_start": 0,
        "normal_clients_active_at_response": 0,
        "overlapping_normal_client_count": 0,
        "overlapped_normal_clients": False,
        "dispatch_full_responses_before_request": 0,
        "response_received": False,
    }
    assertion_defaults = {name: False for name in SATURATION_ASSERTION_FIELDS}
    assertion_defaults["passed"] = False
    defaults = {
        "normal_requests": 0,
        "normal_client_concurrency_limit": 0,
        "normal_max_in_flight_client_processes": 0,
        "normal_elapsed_ms": 0.0,
        "normal_outcomes": {},
        "normal_error_codes": [],
        "dispatch_full_responses": 0,
        "dispatch_full_error_details": [],
        "dispatch_full_responses_before_control": 0,
        "control": control_defaults,
        "assertions": assertion_defaults,
        "production_boundary": "unavailable",
        "saturation_scope": "unavailable",
    }
    issues: list[str] = []
    raw = value if isinstance(value, dict) else {}
    if not isinstance(value, dict):
        issues.append("saturation_result_missing_or_not_an_object")
    required_fields = (
        "normal_requests",
        "normal_client_concurrency_limit",
        "normal_max_in_flight_client_processes",
        "normal_elapsed_ms",
        "normal_outcomes",
        "normal_error_codes",
        "dispatch_full_responses",
        "dispatch_full_error_details",
        "dispatch_full_responses_before_control",
        "control",
        "assertions",
    )
    issues.extend(f"{name}_missing" for name in required_fields if name not in raw)
    result = {**defaults, **raw}

    for key in (
        "normal_requests",
        "normal_client_concurrency_limit",
        "normal_max_in_flight_client_processes",
        "dispatch_full_responses",
        "dispatch_full_responses_before_control",
    ):
        number = result.get(key)
        if type(number) is not int or number < 0:
            issues.append(f"{key}_missing_or_invalid")
            result[key] = defaults[key]
    elapsed = result.get("normal_elapsed_ms")
    if not _finite_number(elapsed) or elapsed < 0:
        issues.append("normal_elapsed_ms_missing_or_invalid")
        result["normal_elapsed_ms"] = 0.0
    raw_outcomes = result.get("normal_outcomes")
    if not isinstance(raw_outcomes, dict):
        issues.append("normal_outcomes_missing_or_invalid")
        raw_outcomes = {}
    outcomes: dict[str, int] = {}
    if set(raw_outcomes) != set(SATURATION_OUTCOME_FIELDS):
        issues.append("normal_outcomes_fields_missing_or_invalid")
    for name in SATURATION_OUTCOME_FIELDS:
        number = raw_outcomes.get(name)
        if type(number) is not int or number < 0:
            issues.append(f"normal_outcome_{name}_missing_or_invalid")
            number = 0
        outcomes[name] = number
    result["normal_outcomes"] = outcomes
    if sum(outcomes.values()) != result["normal_requests"]:
        issues.append("normal_outcome_counts_conflict_with_request_count")
    error_codes = result.get("normal_error_codes")
    if not isinstance(error_codes, list) or any(not isinstance(code, str) for code in error_codes):
        issues.append("normal_error_codes_missing_or_invalid")
        result["normal_error_codes"] = []
    elif len(error_codes) > result["normal_requests"]:
        issues.append("normal_error_codes_exceed_request_count")
    if (
        result["normal_client_concurrency_limit"] < 1
        or result["normal_client_concurrency_limit"] > result["normal_requests"]
    ):
        issues.append("normal_client_concurrency_limit_conflicts_with_request_count")
    if (
        result["normal_max_in_flight_client_processes"]
        > result["normal_client_concurrency_limit"] + 1
    ):
        issues.append("normal_max_in_flight_exceeds_concurrency_plus_control")

    raw_details = result.get("dispatch_full_error_details")
    if not isinstance(raw_details, list):
        issues.append("dispatch_full_error_details_missing_or_invalid")
        details = []
    else:
        details = []
        for item in raw_details:
            if (
                not isinstance(item, dict)
                or (
                    item.get("code") is not None
                    and (
                        not isinstance(item.get("code"), str)
                        or not item.get("code")
                    )
                )
                or not isinstance(item.get("message"), str)
                or "dispatch queue is full" not in item.get("message", "").lower()
                or type(item.get("count")) is not int
                or item.get("count", 0) < 1
            ):
                issues.append("dispatch_full_error_detail_entry_missing_or_invalid")
                continue
            details.append(item)
    result["dispatch_full_error_details"] = details
    error_code_counts = Counter(result["normal_error_codes"])
    detail_code_counts: Counter[str] = Counter()
    for item in details:
        if item["code"] is not None:
            detail_code_counts[item["code"]] += item["count"]
    if any(count > error_code_counts[code] for code, count in detail_code_counts.items()):
        issues.append("dispatch_full_error_codes_exceed_normal_error_codes")
    detail_count = sum(item["count"] for item in details)
    if detail_count != result["dispatch_full_responses"]:
        issues.append("dispatch_full_error_details_count_conflicts_with_total")
    if result["dispatch_full_responses_before_control"] > result["dispatch_full_responses"]:
        issues.append("dispatch_full_responses_before_control_exceeds_total")
    if result["dispatch_full_responses"] > result["normal_requests"]:
        issues.append("dispatch_full_responses_exceeds_normal_requests")

    raw_control = result.get("control")
    if not isinstance(raw_control, dict):
        issues.append("control_result_missing_or_invalid")
        raw_control = {}
    for name in control_defaults:
        if name not in raw_control:
            issues.append(f"control_{name}_missing")
    control = {**control_defaults, **raw_control}
    if control["outcome"] is not None and not isinstance(control["outcome"], str):
        issues.append("control_outcome_invalid")
        control["outcome"] = None
    if type(control["exit_code"]) is not int:
        issues.append("control_exit_code_missing_or_invalid")
        control["exit_code"] = None
    if control["error"] is not None and not isinstance(control["error"], dict):
        issues.append("control_error_invalid")
        control["error"] = None
    for name in (
        "request_started_after_smoke_start_ms",
        "response_completed_after_smoke_start_ms",
    ):
        number = control[name]
        if not _finite_number(number) or number < 0:
            issues.append(f"control_{name}_missing_or_invalid")
            control[name] = None
    latency = control.get("latency_ms")
    if not _finite_number(latency) or latency < 0:
        issues.append("control_latency_ms_missing_or_invalid")
        control["latency_ms"] = None
    for name in (
        "normal_clients_active_at_request_start",
        "normal_clients_active_at_response",
        "overlapping_normal_client_count",
        "dispatch_full_responses_before_request",
    ):
        number = control[name]
        if type(number) is not int or number < 0:
            issues.append(f"control_{name}_missing_or_invalid")
            control[name] = 0
    if (
        control["normal_clients_active_at_request_start"]
        > result["normal_client_concurrency_limit"]
    ):
        issues.append("control_active_at_request_start_exceeds_concurrency_limit")
    if (
        control["normal_clients_active_at_request_start"]
        > result["normal_max_in_flight_client_processes"]
    ):
        issues.append("control_active_at_request_start_exceeds_recorded_maximum")
    if (
        control["normal_clients_active_at_response"]
        > result["normal_client_concurrency_limit"]
    ):
        issues.append("control_active_at_response_exceeds_concurrency_limit")
    if (
        control["normal_clients_active_at_response"]
        > result["normal_max_in_flight_client_processes"]
    ):
        issues.append("control_active_at_response_exceeds_recorded_maximum")
    if control["overlapping_normal_client_count"] > result["normal_requests"]:
        issues.append("control_overlap_count_exceeds_request_count")
    for name in ("overlapped_normal_clients", "response_received"):
        if type(control[name]) is not bool:
            issues.append(f"control_{name}_missing_or_invalid")
            control[name] = False
    if (
        control["request_started_after_smoke_start_ms"] is not None
        and control["response_completed_after_smoke_start_ms"] is not None
        and control["latency_ms"] is not None
    ):
        elapsed = (
            control["response_completed_after_smoke_start_ms"]
            - control["request_started_after_smoke_start_ms"]
        )
        # All three values are rounded to three decimal places by the producer.
        if elapsed < 0 or abs(elapsed - control["latency_ms"]) > 0.002:
            issues.append("control_timing_fields_conflict")
        if (
            control["response_completed_after_smoke_start_ms"]
            - result["normal_elapsed_ms"]
            > 0.002
        ):
            issues.append("control_response_completes_after_normal_workload")
    if control["overlapped_normal_clients"] != (control["overlapping_normal_client_count"] > 0):
        issues.append("control_overlap_fields_conflict")
    if control["response_received"] != (
        control["exit_code"] == 0 and control["error"] is None
    ):
        issues.append("control_response_fields_conflict")
    if (
        control["dispatch_full_responses_before_request"]
        != result["dispatch_full_responses_before_control"]
    ):
        issues.append("control_dispatch_full_responses_conflict_with_top_level")
    result["control"] = control

    raw_assertions = result.get("assertions")
    if not isinstance(raw_assertions, dict):
        issues.append("saturation_assertions_missing_or_invalid")
        raw_assertions = {}
    assertions = {**assertion_defaults, **raw_assertions}
    for name in (*SATURATION_ASSERTION_FIELDS, "passed"):
        if name not in raw_assertions:
            issues.append(f"saturation_assertion_{name}_missing")
        if type(assertions.get(name)) is not bool:
            issues.append(f"saturation_assertion_{name}_missing_or_invalid")
            assertions[name] = False
    if assertions["passed"] and not all(assertions[name] for name in SATURATION_ASSERTION_FIELDS):
        issues.append("saturation_pass_flag_conflicts_with_failed_assertion")
        assertions["passed"] = False
    control_assertion_values = {
        "dispatch_full_response_observed_before_control": (
            control["dispatch_full_responses_before_request"] > 0
        ),
        "normal_client_active_when_control_started": (
            control["normal_clients_active_at_request_start"] > 0
        ),
        "control_response_received": control["response_received"],
        "normal_client_active_when_control_responded": (
            control["normal_clients_active_at_response"] > 0
        ),
        "control_overlapped_normal_client_interval": control["overlapped_normal_clients"],
    }
    for name, observed in control_assertion_values.items():
        if assertions.get(name) != observed:
            issues.append(f"saturation_assertion_{name}_conflicts_with_control")
            assertions[name] = False
    if issues:
        assertions["passed"] = False
    result["assertions"] = assertions
    result["report_integrity"] = {
        "status": "pass" if not issues else "fail",
        "issues": issues,
    }
    return result


def _typed_dispatch_busy_details(items: object) -> list[dict]:
    if not isinstance(items, list):
        return []
    return [
        item
        for item in items
        if isinstance(item, dict)
        and item.get("code") == "service_busy"
        and isinstance(item.get("message"), str)
        and "dispatch queue is full" in item["message"].lower()
    ]


def _within_target(measured: object, target: object) -> bool | None:
    if not _finite_number(measured) or not _finite_number(target):
        return None
    return measured <= target


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
    parser.add_argument(
        "--disposable-agent-authorization",
        type=Path,
        help="owner-approved repository JSON artifact allowing one temporary Agent fixture",
    )
    parser.add_argument(
        "--control-budget",
        type=Path,
        help="owner-approved repository JSON artifact for multi-sample typed control latency",
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
    if args.disposable_agent_authorization is not None and not args.full_v10:
        parser.error("--disposable-agent-authorization requires --full-v10")
    if args.control_budget is not None and not args.full_v10:
        parser.error("--control-budget requires --full-v10")
    if args.agent_input is not None and args.disposable_agent_authorization is not None:
        parser.error("--agent-input and --disposable-agent-authorization select different Agent fixtures")
    if (args.agent_input is None) != (args.agent_cli_sha256 is None):
        parser.error("--agent-input and --agent-cli-sha256 must be supplied together")

    control_budget_document = None
    control_budget_ref = {"path": None, "sha256": None}
    control_budget = None
    if args.control_budget is not None:
        control_budget_document, control_budget_ref = load_approved_artifact(
            args.control_budget,
            schema=V10_CONTROL_BUDGET_SCHEMA,
        )
        validate_control_budget(control_budget_document)
        control_budget = {**control_budget_document, "status": "approved"}

    disposable_agent_authorization = None
    disposable_agent_authorization_ref = {"path": None, "sha256": None}
    if args.disposable_agent_authorization is not None:
        disposable_agent_authorization, disposable_agent_authorization_ref = load_approved_artifact(
            args.disposable_agent_authorization,
            schema=V10_DISPOSABLE_AGENT_SCHEMA,
        )
        validate_disposable_agent_authorization(disposable_agent_authorization)

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

    control_samples = None
    control_probe = None
    disposable_agent_fixture = None
    disposable_agent_setup = None
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
            configure_clock_environment(service_env, shim)
        service = start_service(
            binary,
            database,
            socket_path,
            root,
            service_env,
            # Deliberately use the small 1/2 configuration for this
            # admission smoke. It does not model default or full-load
            # production capacity.
            dispatch_workers=SMOKE_DISPATCH_WORKERS,
            dispatch_capacity=SMOKE_DISPATCH_CAPACITY,
        )
        setup_service_stop = None
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
            if control_budget is not None:
                control_probe = run_multi_sample_control_probe(
                    binary,
                    socket_path,
                    "dispatch-smoke-project",
                    root,
                    worker_count=32,
                    budget=control_budget,
                )
                control_samples = control_probe.get("samples")
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
                    clock_file.write_text("0\n", encoding="ascii")

            if disposable_agent_authorization is not None:
                if shim is None:
                    disposable_agent_setup = {
                        "status": "unavailable",
                        "attempted": False,
                        "reason": "the supported process-local realtime clock shim is unavailable; no Agent credential was created",
                        "authorization_artifact": disposable_agent_authorization_ref,
                    }
                else:
                    source_version_id, config_identity = provision_disposable_agent_work(
                        binary,
                        database,
                        socket_path,
                        root,
                        operator_actor="dispatch-smoke-validator",
                        operator_session="dispatch-smoke-operator-session",
                    )
                    # auth key/grant/show and the project auth database access
                    # are direct-mode commands. Stop the service cleanly before
                    # they use SQLite's owner lock, then restart for the normal
                    # service-backed smoke and readbacks.
                    setup_service_stop = stop_service(service, socket_path)
                    if setup_service_stop.get("status") != "pass":
                        raise RuntimeError(
                            "service did not stop cleanly before disposable Agent enrollment"
                        )
                    service = None
                    try:
                        disposable_agent_fixture = setup_disposable_agent_fixture(
                            binary,
                            database,
                            root,
                            disposable_agent_authorization,
                            disposable_agent_authorization_ref,
                            source_version_id=source_version_id,
                            config_identity=config_identity,
                        )
                    except Exception:
                        # If setup failed after a grant committed, make a
                        # best-effort revision-bound revocation before the
                        # temporary project directory is removed.
                        try:
                            revoke_disposable_agent_fixture(
                                binary, database, root, {"granted": True}
                            )
                        except (OSError, RuntimeError, subprocess.SubprocessError):
                            pass
                        raise
                    service = start_service(
                        binary,
                        database,
                        socket_path,
                        root,
                        service_env,
                        dispatch_workers=SMOKE_DISPATCH_WORKERS,
                        dispatch_capacity=SMOKE_DISPATCH_CAPACITY,
                    )
                    wait_for_socket(socket_path, service)
                    ready_status(binary, socket_path, "dispatch-smoke-project", root)
                    disposable_agent_setup = {
                        "status": "ready",
                        "attempted": False,
                        "project_id": disposable_agent_fixture["project_id"],
                        "actor_id": disposable_agent_fixture["actor_id"],
                        "role": disposable_agent_fixture["role"],
                        "session_id": disposable_agent_fixture["session_id"],
                        "harness_id": disposable_agent_fixture["harness_id"],
                        "work_id": disposable_agent_fixture["work_id"],
                        "source_version_id": source_version_id,
                        "authorization_artifact": disposable_agent_authorization_ref,
                        "credential_exposed": False,
                    }
        finally:
            if service is not None:
                stop = stop_service(service, socket_path)
            else:
                stop = setup_service_stop or {
                    "status": "unavailable",
                    "reason": "the smoke service was not running when closeout began",
                    "exit_code": None,
                    "socket_removed": not socket_path.exists(),
                }

        if args.full_v10:
            stop_recovery = {}
            try:
                stop_recovery = run_stop_recovery_probe(
                    binary,
                    database,
                    socket_path,
                    "dispatch-smoke-project",
                    root,
                    service_env,
                    "dispatch-smoke-validator",
                    "dispatch-smoke-operator-session",
                    agent_fixture=disposable_agent_fixture,
                    clock_file=clock_file,
                    fake_clock_supported=shim is not None,
                )
            finally:
                if disposable_agent_fixture is not None and disposable_agent_fixture.get("granted"):
                    cleanup = revoke_disposable_agent_fixture(
                        binary, database, root, disposable_agent_fixture
                    )
                    if stop_recovery:
                        stop_recovery["disposable_agent_cleanup"] = cleanup
            stop_recovery["agent_input_binding"] = agent_input_binding or {
                "status": "unavailable",
                "attempted": False,
                "authorized_agent": False,
                "reason": "no owner-supplied Agent input descriptor was provided",
            }
            stop_recovery["disposable_agent_setup"] = disposable_agent_setup or {
                "status": "unavailable",
                "attempted": False,
                "reason": "no owner-approved disposable Agent authorization was supplied; no credential was created",
            }
        else:
            stop_recovery = {
                "status": "not_run",
                "reason": "pass --full-v10 to run the stop/recovery workload",
            }

    identity = validation_identity(binary)
    saturation = normalize_saturation_report(saturation)
    typed_queue_busy_details = _typed_dispatch_busy_details(
        saturation["dispatch_full_error_details"]
    )
    if control_probe is not None:
        typed_queue_busy_details.extend(
            _typed_dispatch_busy_details(
                control_probe.get("typed_service_busy_error_details")
            )
        )
    typed_busy_observed = bool(typed_queue_busy_details)
    budget_status = "approved" if control_budget_document is not None else "not_approved"
    control_latency_ms = (
        control_probe.get("latency_ms")
        if control_probe is not None
        else saturation["control"]["latency_ms"]
    )
    budget_target_ms = (
        control_budget_document.get("target_ms")
        if control_budget_document is not None
        else args.control_latency_budget_ms
    )
    max_latency_ms = control_probe.get("max_latency_ms") if control_probe is not None else None
    max_sample_target_ms = control_budget_document.get("max_sample_ms") if control_budget_document else None
    control_within_candidate_target = _within_target(
        control_latency_ms, budget_target_ms
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
        "project_id": deadline_evidence.get("project_id"),
        "work_id": deadline_evidence.get("work_id"),
        "session_id": deadline_evidence.get("session_id"),
        "harness_id": deadline_evidence.get("harness_id"),
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
            stale_fence_request_matches_claim(
                deadline_evidence.get("stale_fence_request"),
                project_id=deadline_evidence.get("project_id"),
                work_id=deadline_evidence.get("work_id"),
                actor_id=deadline_evidence.get("actor_id"),
                attempt_id=deadline_evidence.get("attempt_id"),
                fence=deadline_evidence.get("fence"),
            )
            and stale_fence_response_matches_request(
                stale_fence_response, deadline_evidence.get("stale_fence_request")
            )
        ),
        "stale_fence_response": stale_fence_response,
        "stale_fence_request": deadline_evidence.get("stale_fence_request"),
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
        "project_id": attempt_recovery.get("project_id"),
        "work_id": attempt_recovery.get("work_id"),
        "session_id": attempt_recovery.get("session_id"),
        "harness_id": attempt_recovery.get("harness_id"),
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
        "stale_fence_request": attempt_recovery.get("stale_fence_request"),
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
        and stale_fence_request_matches_claim(
            attempt_stop_proof_fields["stale_fence_request"],
            project_id=attempt_stop_proof_fields["project_id"],
            work_id=attempt_stop_proof_fields["work_id"],
            actor_id=attempt_stop_proof_fields["actor_id"],
            attempt_id=attempt_stop_proof_fields["attempt_id"],
            fence=attempt_stop_proof_fields["fence"],
        )
        and stale_fence_response_matches_request(
            attempt_stop_proof_fields["stale_fence_response"],
            attempt_stop_proof_fields["stale_fence_request"],
        )
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
    typed_control_complete = (
        control_budget_document is not None
        and control_probe is not None
        and control_probe.get("status") == "pass"
        and saturation["dispatch_full_responses"] > 0
        and typed_busy_observed
    )
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
                else "pass"
                if full_mode and typed_control_complete
                else "fail"
                if full_mode and control_budget_document is not None
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
            "control_response": (
                control_probe["control_response"]
                if control_probe is not None
                else saturation["control"]
            ),
            "control_samples": control_samples,
            "budget_status": budget_status,
            "latency_ms": control_latency_ms,
            "target_ms": budget_target_ms,
            "max_latency_ms": max_latency_ms,
            "max_sample_ms": max_sample_target_ms,
            "latency_within_target": control_within_candidate_target,
            "max_latency_within_target": _within_target(
                max_latency_ms, max_sample_target_ms
            ),
            "approved_budget": control_budget_document,
            "approval_artifact": control_budget_ref,
            "latency_target_status": "unverified_candidate"
            if budget_target_ms is not None and control_budget_document is None
            else "approved"
            if control_budget_document is not None
            else "not_supplied",
            "reason": (
                "no dispatch-queue-full response with exact service_busy type was observed"
                if typed_control_failed
                else None
                if typed_control_complete
                else "approved control samples did not satisfy the typed queue and latency acceptance checks"
                if control_budget_document is not None
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
            "source": control_budget_document.get("source") if control_budget_document else args.control_latency_budget_source,
            "target_ms": budget_target_ms,
            "sample_count": control_budget_document.get("sample_count") if control_budget_document else None,
            "interval_ms": control_budget_document.get("interval_ms") if control_budget_document else None,
            "statistic": control_budget_document.get("statistic") if control_budget_document else None,
            "max_sample_ms": max_sample_target_ms,
            "approval_artifact": control_budget_ref,
        },
        "identity": identity,
        "report_path": str(args.output.resolve()),
    }
    dispatch_smoke_status = (
        "pass"
        if saturation["report_integrity"]["status"] == "pass"
        and saturation["assertions"]["passed"]
        else "fail"
    )
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
        "queue_and_control": {
            **saturation,
            "approved_control_probe": control_probe,
        },
        "saturation_report_integrity": saturation["report_integrity"],
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
                "saturation_report_integrity": saturation["report_integrity"]["status"],
                "assertions": saturation["assertions"],
                "fake_clock_status": clock["status"],
                "stop_status": stop["status"],
                "stop_recovery_status": stop_recovery["status"],
                "v10_acceptance": result["v10_acceptance"]["status"],
            },
            sort_keys=True,
        )
    )
    if (
        saturation["report_integrity"]["status"] != "pass"
        or not saturation["assertions"]["passed"]
    ):
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
