#!/usr/bin/env python3
"""Run the offline, local pre-push checks and write a commit-bound receipt.

This entrypoint never publishes a release, pushes a ref, installs dependencies,
or opts in to online validation. Full release qualification stays incomplete
until the separately listed platform and approval-gated checks are run.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
UNRUN_REQUIRED = [
    {
        "name": "macOS arm64 release build and install qualification",
        "status": "not_run",
        "reason": "This local entrypoint does not build or claim the macOS release matrix.",
    },
    {
        "name": "macOS x86_64 release build and install qualification",
        "status": "not_run",
        "reason": "This local entrypoint does not build or claim the macOS release matrix.",
    },
    {
        "name": "owner-approved online or hosted production oracles",
        "status": "not_run",
        "reason": "Requires separate approval and an authorized execution environment.",
    },
]


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def source_status() -> list[str]:
    return [
        line
        for line in git("status", "--porcelain", "--untracked-files=all").splitlines()
        if line
    ]


def is_outside_repository(path: Path) -> bool:
    resolved = path.resolve()
    root = ROOT.resolve()
    return resolved != root and root not in resolved.parents


def remove_scratch(environment: dict[str, str]) -> None:
    scratch = Path(environment.get("TMPDIR", ""))
    if str(scratch) and is_outside_repository(scratch):
        shutil.rmtree(scratch, ignore_errors=True)


def clean_environment() -> dict[str, str]:
    env = os.environ.copy()
    for name in tuple(env):
        upper = name.upper()
        lower = name.lower()
        if (
            upper.startswith(("AWS_", "AZURE_", "GCP_", "GOOGLE_", "GH_", "GITHUB_"))
            or any(part in upper for part in ("_TOKEN", "_SECRET", "_PASSWORD", "_CREDENTIAL", "_API_KEY"))
            or lower.endswith("_proxy")
            or lower in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}
        ):
            env.pop(name, None)
    env.pop("BOREAL_CREDENTIAL", None)
    build_revision = git("rev-parse", "--verify", "HEAD")
    scratch_base = next(
        (
            candidate.resolve()
            for candidate in (Path(tempfile.gettempdir()), Path("/tmp"))
            if candidate.is_dir() and is_outside_repository(candidate)
        ),
        None,
    )
    if scratch_base is None:
        raise RuntimeError("no writable temporary root resolves outside the checkout")
    scratch = next(
        candidate
        for candidate in (
            # Keep the path compact: Rust and Node create Unix-domain sockets
            # inside this directory, and sockaddr_un has a short path limit.
            scratch_base / f"b{os.getpid()}-{suffix}"
            for suffix in range(100)
        )
        if not candidate.exists() and is_outside_repository(candidate)
    )
    scratch.mkdir(parents=True)
    env.update(
        {
            "BOREAL_OFFLINE_VALIDATION": "1",
            "BOREAL_BUILD_REVISION": build_revision,
            "CARGO_NET_OFFLINE": "true",
            "CARGO_INCREMENTAL": "0",
            "CARGO_TARGET_DIR": os.environ.get(
                "LOCAL_VALIDATION_TARGET_DIR", str(ROOT / "target")
            ),
            "npm_config_offline": "true",
            "npm_config_cache": str(scratch / "npm-cache"),
            "npm_config_update_notifier": "false",
            "npm_config_audit": "false",
            "npm_config_fund": "false",
            "TMPDIR": str(scratch),
            "NO_COLOR": "1",
        }
    )
    return env


def tail(value: str | bytes | None, limit: int = 4000) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return value[-limit:]


def run_check(name: str, command: list[str], timeout_seconds: int) -> dict:
    started = time.monotonic()
    environment = None
    try:
        environment = clean_environment()
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_seconds,
            check=False,
        )
        return {
            "name": name,
            "status": "pass" if result.returncode == 0 else "fail",
            "command": command,
            "exit_code": result.returncode,
            "duration_seconds": round(time.monotonic() - started, 3),
            "stdout_tail": tail(result.stdout),
            "stderr_tail": tail(result.stderr),
        }
    except FileNotFoundError as error:
        return {
            "name": name,
            "status": "fail",
            "command": command,
            "exit_code": None,
            "duration_seconds": round(time.monotonic() - started, 3),
            "stdout_tail": "",
            "stderr_tail": str(error),
        }
    except RuntimeError as error:
        return {
            "name": name,
            "status": "fail",
            "command": command,
            "exit_code": None,
            "duration_seconds": round(time.monotonic() - started, 3),
            "stdout_tail": "",
            "stderr_tail": str(error),
        }
    except subprocess.TimeoutExpired as error:
        return {
            "name": name,
            "status": "fail",
            "command": command,
            "exit_code": None,
            "duration_seconds": round(time.monotonic() - started, 3),
            "stdout_tail": tail(error.stdout),
            "stderr_tail": tail(error.stderr) or f"timed out after {timeout_seconds}s",
        }
    finally:
        if environment is not None:
            remove_scratch(environment)


def run_workspace_tests(timeout_seconds: int) -> dict:
    """Supply the repository's generated source-bound fixture to Cargo tests."""
    started = time.monotonic()
    generator = [
        sys.executable,
        "crates/domain/tests/generate_production_oracle_manifest.py",
        "--output",
    ]
    cargo = ["cargo", "test", "--workspace", "--locked", "--offline"]
    environment = None
    try:
        environment = clean_environment()
        with tempfile.TemporaryDirectory(
            prefix="oracle-", dir=environment["TMPDIR"]
        ) as temporary:
            manifest = Path(temporary) / "production-oracle-manifest.txt"
            setup_command = [*generator, str(manifest)]
            if not is_outside_repository(manifest):
                return {
                    "name": "rust tests (offline; generated source-bound fixture)",
                    "status": "fail",
                    "command": cargo,
                    "setup_command": setup_command,
                    "setup_exit_code": None,
                    "oracle_manifest_sha256": None,
                    "exit_code": None,
                    "duration_seconds": round(time.monotonic() - started, 3),
                    "stdout_tail": "",
                    "stderr_tail": "generated manifest path resolves inside the checkout",
                }
            setup = subprocess.run(
                setup_command,
                cwd=ROOT,
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout_seconds,
                check=False,
            )
            if setup.returncode != 0 or not manifest.is_file():
                return {
                    "name": "rust tests (offline; generated source-bound fixture)",
                    "status": "fail",
                    "command": cargo,
                    "setup_command": setup_command,
                    "setup_exit_code": setup.returncode,
                    "oracle_manifest_sha256": None,
                    "exit_code": setup.returncode if setup.returncode != 0 else None,
                    "duration_seconds": round(time.monotonic() - started, 3),
                    "stdout_tail": tail(setup.stdout),
                    "stderr_tail": tail(setup.stderr)
                    or "manifest generator did not create its output",
                }
            manifest_sha256 = hashlib.sha256(manifest.read_bytes()).hexdigest()
            environment["BOREAL_PRODUCTION_ORACLE_MANIFEST"] = str(manifest)
            result = subprocess.run(
                cargo,
                cwd=ROOT,
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout_seconds,
                check=False,
            )
            return {
                "name": "rust tests (offline; generated source-bound fixture)",
                "status": "pass" if result.returncode == 0 else "fail",
                "command": cargo,
                "setup_command": setup_command,
                "setup_exit_code": setup.returncode,
                "oracle_manifest_sha256": "sha256:" + manifest_sha256,
                "exit_code": result.returncode,
                "duration_seconds": round(time.monotonic() - started, 3),
                "stdout_tail": tail(result.stdout),
                "stderr_tail": tail(result.stderr),
            }
    except (FileNotFoundError, RuntimeError) as error:
        return {
            "name": "rust tests (offline; generated source-bound fixture)",
            "status": "fail",
            "command": cargo,
            "setup_command": generator,
            "setup_exit_code": None,
            "oracle_manifest_sha256": None,
            "exit_code": None,
            "duration_seconds": round(time.monotonic() - started, 3),
            "stdout_tail": "",
            "stderr_tail": str(error),
        }
    except subprocess.TimeoutExpired as error:
        return {
            "name": "rust tests (offline; generated source-bound fixture)",
            "status": "fail",
            "command": cargo,
            "setup_command": generator,
            "setup_exit_code": None,
            "oracle_manifest_sha256": None,
            "exit_code": None,
            "duration_seconds": round(time.monotonic() - started, 3),
            "stdout_tail": tail(error.stdout),
            "stderr_tail": tail(error.stderr)
            or f"timed out after {timeout_seconds}s",
        }
    finally:
        if environment is not None:
            remove_scratch(environment)


def write_receipt(path: Path, receipt: dict) -> str:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    canonical = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode("utf-8")
    receipt["receipt_sha256"] = "sha256:" + hashlib.sha256(canonical).hexdigest()
    data = (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode("utf-8")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(data)
    try:
        os.link(temporary, path)
    except FileExistsError:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"receipt already exists; choose a new path: {path}")
    finally:
        temporary.unlink(missing_ok=True)
    return "sha256:" + hashlib.sha256(data).hexdigest()


def checks_pass(results: list[dict]) -> bool:
    return all(result["status"] in {"pass", "not_applicable"} for result in results)


def execute_checks(checks: list[tuple[str, list[str], int]], source_is_clean: bool) -> list[dict]:
    if not source_is_clean:
        return [
            {
                "name": name,
                "status": "not_run",
                "command": command,
                "exit_code": None,
                "reason": "working tree is not clean; receipt must describe a committed tree",
            }
            for name, command, _ in checks
        ]

    results = []
    for name, command, timeout in checks:
        if name == "rust tests (offline; generated source-bound fixture)":
            results.append(run_workspace_tests(timeout))
        elif name == "V10 harness unit tests" and not any(
            (ROOT / "scripts/validation").glob("test_production_host_*.py")
        ):
            results.append(
                {
                    "name": name,
                    "status": "not_applicable",
                    "command": command,
                    "exit_code": None,
                    "reason": "no V10 harness test modules are present in this source tree",
                }
            )
        else:
            results.append(run_check(name, command, timeout))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--receipt-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "boreal-local-validation-receipts",
        help="directory for a new immutable receipt (default: system temp directory)",
    )
    parser.add_argument(
        "--receipt",
        type=Path,
        help="write to this new path; an existing receipt is never overwritten",
    )
    args = parser.parse_args()
    if args.receipt and args.receipt_dir != parser.get_default("receipt_dir"):
        parser.error("use either --receipt or --receipt-dir")

    started_at = datetime.now(timezone.utc).isoformat()
    try:
        commit_sha = git("rev-parse", "--verify", "HEAD")
        tree_sha = git("rev-parse", "--verify", "HEAD^{tree}")
        branch = git("branch", "--show-current") or None
        dirty_before = source_status()
    except RuntimeError as error:
        print(f"local pre-push: {error}", file=sys.stderr)
        return 2

    python = sys.executable
    cargo = "cargo"
    npm = "npm"
    checks = [
        ("contracts", [python, "project/spec/validate_contracts.py"], 300),
        ("rustfmt", [cargo, "fmt", "--all", "--", "--check"], 300),
        (
            "rust tests (offline; generated source-bound fixture)",
            [cargo, "test", "--workspace", "--locked", "--offline"],
            1800,
        ),
        (
            "clippy (offline)",
            [cargo, "clippy", "--workspace", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"],
            1800,
        ),
        (
            "TUI typecheck (local dependencies only)",
            [npm, "run", "typecheck", "--prefix", "apps/tui"],
            600,
        ),
        ("TUI tests (local dependencies only)", [npm, "test", "--prefix", "apps/tui"], 900),
        (
            "release identity unit tests",
            [python, "scripts/release/test_release_identity.py"],
            300,
        ),
        (
            "pre-push runner unit tests",
            [python, "-m", "unittest", "discover", "-s", "scripts/release", "-p", "test_local_pre_push.py"],
            300,
        ),
        (
            "validation runner unit tests",
            [python, "-m", "unittest", "discover", "-s", "scripts/validation", "-p", "test_run_full_suite.py"],
            300,
        ),
        (
            "forensic audit unit tests",
            [python, "-m", "unittest", "discover", "-s", "scripts/validation", "-p", "test_forensic_audit.py"],
            600,
        ),
        (
            "V10 harness unit tests",
            [python, "-m", "unittest", "discover", "-s", "scripts/validation", "-p", "test_production_host_*.py"],
            900,
        ),
        ("local package/install smoke", ["sh", "scripts/release/package-smoke.sh"], 1800),
    ]
    results = execute_checks(checks, source_is_clean=not dirty_before)

    try:
        commit_after = git("rev-parse", "--verify", "HEAD")
        tree_after = git("rev-parse", "--verify", "HEAD^{tree}")
        dirty_after = source_status()
    except RuntimeError as error:
        commit_after = None
        tree_after = None
        dirty_after = [str(error)]
    source_unchanged = (
        not dirty_before
        and not dirty_after
        and commit_after == commit_sha
        and tree_after == tree_sha
    )
    local_pass = source_unchanged and checks_pass(results)
    finished_at = datetime.now(timezone.utc).isoformat()
    receipt = {
        "schema": "boreal.local_pre_push_receipt/v1",
        "started_at": started_at,
        "finished_at": finished_at,
        "source": {
            "repository_root": str(ROOT),
            "branch": branch,
            "commit_sha": commit_sha,
            "tree_sha": tree_sha,
            "commit_after_checks": commit_after,
            "tree_after_checks": tree_after,
            "dirty_before": dirty_before,
            "dirty_after": dirty_after,
            "unchanged": source_unchanged,
        },
        "host": {
            "system": platform.system(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "local_checks": {"status": "pass" if local_pass else "fail", "checks": results},
        "release_qualification": {
            "status": "incomplete",
            "reason": "local checks do not replace Mac platform coverage or approval-gated production oracles",
            "unrun_required": UNRUN_REQUIRED,
        },
        "automation_disablement": {
            "status": "unverified",
            "required_settings": ["CI workflow automatic execution", "Release workflow automatic execution"],
            "reason": "Repository YAML removal is recorded in the candidate; account-level Actions settings need an independent supported readback.",
        },
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    receipt_path = args.receipt or (args.receipt_dir / f"local-pre-push-{commit_sha}-{stamp}-{os.getpid()}.json")
    try:
        file_sha256 = write_receipt(receipt_path, receipt)
    except (OSError, RuntimeError) as error:
        print(f"local pre-push receipt failed: {error}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            {
                "receipt": str(receipt_path.expanduser().resolve()),
                "receipt_file_sha256": file_sha256,
                "receipt_sha256": receipt["receipt_sha256"],
                "commit_sha": commit_sha,
                "tree_sha": tree_sha,
                "local_checks": receipt["local_checks"]["status"],
                "release_qualification": "incomplete",
                "automation_disablement": "unverified",
            },
            sort_keys=True,
        )
    )
    return 0 if local_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
