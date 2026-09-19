#!/usr/bin/env python3
"""Run the complete Boreal validation stack and retain one aggregate report."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_check(
    label: str,
    command: list[str],
    log_dir: Path,
    *,
    timeout_seconds: float = 900.0,
) -> dict[str, Any]:
    started = time.perf_counter()
    timed_out = False
    try:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        timed_out = True
        completed = subprocess.CompletedProcess(
            command,
            124,
            error.stdout or "",
            error.stderr or "",
        )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    stdout_path = log_dir / f"{label}.stdout.log"
    stderr_path = log_dir / f"{label}.stderr.log"
    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    stdout_path.write_text(stdout, encoding="utf-8")
    stderr_path.write_text(stderr, encoding="utf-8")
    combined_lower = f"{stdout}\n{stderr}".lower()
    socket_denied = (
        completed.returncode != 0
        and not timed_out
        and ("eperm" in combined_lower or "operation not permitted" in combined_lower)
        and any(token in combined_lower for token in ("sock", "listen", "service_unavailable"))
    )
    explicit_skip = "boreal_validation_skip:" in combined_lower
    sqlite_floor_failure = (
        label == "release-performance"
        and "below the required 3.51.3 release floor" in combined_lower
    )
    offline_lockfile = (
        label == "concurrency"
        and completed.returncode != 0
        and "needs to be updated but --locked" in combined_lower
        and "--offline" in combined_lower
    )
    environment_skip = socket_denied or offline_lockfile or explicit_skip
    reason = (
        "sandbox denied Unix socket creation"
        if socket_denied
        else "standalone concurrency probe lockfile is not buildable from the offline cache"
        if offline_lockfile
        else "linked SQLite runtime is below the required 3.51.3 release floor"
        if sqlite_floor_failure
        else "child check reported an environment skip"
        if explicit_skip
        else None
    )
    return {
        "label": label,
        "command": command,
        "exit_code": completed.returncode,
        "status": "skip" if environment_skip else "pass" if completed.returncode == 0 else "fail",
        "reason": "timed out after {timeout_seconds:g}s".format(timeout_seconds=timeout_seconds)
        if timed_out
        else reason,
        "duration_ms": elapsed_ms,
        "timeout_seconds": timeout_seconds,
        "stdout_log": str(stdout_path),
        "stderr_log": str(stderr_path),
    }


def markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Boreal full validation suite",
        "",
        f"Profile: **{report['profile']}**  ",
        f"Binary: `{report['binary']}`  ",
        f"Pass: **{report['counts']['pass']}**, skip: **{report['counts']['skip']}**, fail: **{report['counts']['fail']}**",
        "",
        "| Check | Status | Exit | Duration (ms) | Reason |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    for check in report["checks"]:
        reason = (check.get("reason") or "").replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| `{check['label']}` | **{check['status']}** | {check['exit_code']} | "
            f"{check['duration_ms']} | {reason} |"
        )
    lines.extend(["", f"Logs: `{report['log_dir']}`", ""])
    return "\n".join(lines)


def binary_freshness(binary: Path) -> dict[str, Any]:
    """Reject black-box evidence from a binary older than its source inputs."""
    if not binary.exists():
        return {
            "label": "binary-freshness",
            "command": [],
            "exit_code": 2,
            "status": "fail",
            "reason": f"validation binary is missing: {binary}",
            "duration_ms": 0.0,
            "timeout_seconds": None,
            "stdout_log": None,
            "stderr_log": None,
        }
    source_paths = [ROOT / "Cargo.toml", ROOT / "Cargo.lock"]
    source_paths.extend((ROOT / "crates").glob("**/*.rs"))
    source_paths.extend((ROOT / "apps/tui/src").glob("**/*.ts"))
    newest = max((path.stat().st_mtime for path in source_paths if path.exists()), default=0.0)
    if binary.stat().st_mtime < newest:
        return {
            "label": "binary-freshness",
            "command": [],
            "exit_code": 2,
            "status": "fail",
            "reason": "validation binary is older than current Rust/TypeScript source; rebuild before black-box checks",
            "duration_ms": 0.0,
            "timeout_seconds": None,
            "stdout_log": None,
            "stderr_log": None,
        }
    return {
        "label": "binary-freshness",
        "command": [],
        "exit_code": 0,
        "status": "pass",
        "reason": None,
        "duration_ms": 0.0,
        "timeout_seconds": None,
        "stdout_log": None,
        "stderr_log": None,
    }


def binary_runtime_check(
    binary: Path, log_dir: Path, *, require_sqlite_floor: bool
) -> dict[str, Any]:
    """Prove the selected executable's actual SQLite runtime, not a test crate's."""
    result = run_check(
        "binary-runtime",
        [str(binary), "version", "--json"],
        log_dir,
    )
    result["binary_sha256"] = (
        hashlib.sha256(binary.read_bytes()).hexdigest() if binary.exists() else None
    )
    if result["status"] != "pass":
        return result
    try:
        lines = [
            line for line in (log_dir / "binary-runtime.stdout.log")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        envelope = json.loads(lines[-1])
        runtime = envelope["data"]["sqlite_runtime"]
        libversion = str(runtime["libversion"])
        version = tuple(int(part) for part in libversion.split(".")[:3])
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        result["status"] = "fail"
        result["exit_code"] = 2
        result["reason"] = f"selected binary did not report a parseable SQLite runtime: {error}"
        return result
    meets_floor = version >= (3, 51, 3)
    result["sqlite_runtime"] = {
        "libversion": libversion,
        "source_id": runtime.get("source_id"),
        "meets_floor": meets_floor,
        "required_floor": "3.51.3",
    }
    if require_sqlite_floor and not meets_floor:
        result["status"] = "fail"
        result["exit_code"] = 2
        result["reason"] = (
            f"selected binary links SQLite {libversion}, below the required 3.51.3 release floor"
        )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=("smoke", "full"), default="smoke")
    parser.add_argument("--bin", type=Path, help="Boreal v2 binary for the black-box suite")
    parser.add_argument("--output", type=Path, default=ROOT / "scripts/validation/results/full-suite.latest.json")
    parser.add_argument("--report", type=Path, help="Markdown report path; defaults beside --output")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="release-style gate: require the current binary, benchmark, SQLite floor, and no skips",
    )
    parser.add_argument(
        "--require-no-skips",
        action="store_true",
        help="return failure when any check is classified as an environment skip",
    )
    parser.add_argument(
        "--allow-skips",
        action="store_true",
        help="exploratory override; keep skips visible but allow a zero exit",
    )
    parser.add_argument(
        "--require-current-binary",
        action="store_true",
        help="use and require target/debug/bwrk for black-box validation",
    )
    parser.add_argument(
        "--require-sqlite-floor",
        action="store_true",
        help="require the release-performance SQLite runtime floor",
    )
    parser.add_argument(
        "--require-benchmark",
        action="store_true",
        help="run the release status-scale benchmark instead of skipping it",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=900.0,
        help="maximum runtime for each child check (default: 900)",
    )
    parser.add_argument(
        "--online",
        action="store_true",
        help="allow Cargo child checks to resolve dependencies from the network",
    )
    parser.add_argument(
        "--soak-rounds",
        type=int,
        default=10,
        help="number of process-race rounds in the full-profile soak check (default: 10)",
    )
    args = parser.parse_args()
    if args.timeout_seconds <= 0:
        parser.error("--timeout-seconds must be positive")
    if args.soak_rounds <= 0:
        parser.error("--soak-rounds must be positive")
    if args.strict:
        if args.profile != "full":
            parser.error("--strict requires --profile full")
        args.require_no_skips = True
        args.require_current_binary = True
        args.require_sqlite_floor = True
        args.require_benchmark = True
    output = args.output.resolve()
    log_dir = output.parent / f"full-suite-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    log_dir.mkdir(parents=True, exist_ok=True)
    started_at = now_iso()
    current_binary = ROOT / "target/debug/bwrk"
    packaged_binary = ROOT / "test-project/.boreal/bin/bwrk-v2"
    binary = args.bin or (current_binary if current_binary.exists() else packaged_binary)
    if args.require_current_binary:
        binary = args.bin or current_binary

    checks: list[dict[str, Any]] = []
    cargo_network_args = [] if args.online else ["--offline"]
    checks.append(
        run_check(
            "cargo-workspace",
            ["cargo", "test", "--workspace", "--locked", *cargo_network_args],
            log_dir,
            timeout_seconds=args.timeout_seconds,
        )
    )
    if args.require_current_binary:
        # `cargo test --workspace` does not guarantee that the bwrk binary
        # target is rebuilt. Build it explicitly after the test pass so the
        # executable used by every black-box gate is current and inherits the
        # caller's release-link configuration (including RUSTFLAGS for the
        # declared SQLite floor).
        checks.append(
            run_check(
                "binary-build",
                ["cargo", "build", "--bin", "bwrk", "--locked", *cargo_network_args],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        binary_path_ok = binary.resolve() == current_binary.resolve() and binary.exists()
        checks.append(
            {
                "label": "binary-identity",
                "command": [],
                "exit_code": 0 if binary_path_ok else 2,
                "status": "pass" if binary_path_ok else "fail",
                "reason": None if binary_path_ok else f"strict validation requires {current_binary}",
                "duration_ms": 0.0,
                "timeout_seconds": None,
                "stdout_log": None,
                "stderr_log": None,
            }
        )
    checks.append(binary_freshness(binary))
    if args.require_sqlite_floor:
        checks.append(
            binary_runtime_check(
                binary,
                log_dir,
                require_sqlite_floor=True,
            )
        )
    checks.append(
        run_check(
            "tui",
            ["npm", "--prefix", "apps/tui", "test"],
            log_dir,
            timeout_seconds=args.timeout_seconds,
        )
    )
    if args.profile == "full":
        checks.append(
            run_check(
                "tui-pty",
                [
                    "python3",
                    "scripts/validation/tui/pty_smoke.py",
                    "--bin",
                    str(binary),
                ],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
    creation_command = [
        "python3",
        "scripts/validation/creation/run_suite.py",
        "--bin",
        str(binary),
        "--chain-length",
        "100" if args.profile == "full" else "16",
        "--output",
        str(log_dir / "creation.json"),
        "--report",
        str(log_dir / "creation.md"),
    ]
    checks.append(run_check("creation", creation_command, log_dir, timeout_seconds=args.timeout_seconds))

    if args.profile == "full":
        spec_conformance_command = [
            "python3",
            "scripts/validation/spec_conformance.py",
            *(["--online"] if args.online else []),
        ]
        checks.append(
            run_check(
                "forensic-audit",
                [
                    "python3",
                    "scripts/validation/forensic_audit.py",
                    "--output",
                    str(log_dir / "forensic-audit.json"),
                    "--report",
                    str(log_dir / "forensic-audit.md"),
                    *( ["--online"] if args.online else []),
                ],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "spec-conformance",
                spec_conformance_command,
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "mutation-contracts",
                [
                    "python3",
                    "scripts/validation/mutation/run_matrix.py",
                    "--output",
                    str(log_dir / "mutation.json"),
                ],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "service-transport",
                [
                    "cargo",
                    "test",
                    "-p",
                    "boreal-service",
                    "--test",
                    "transport_smoke",
                    "--locked",
                    *cargo_network_args,
                    "--",
                    "--nocapture",
                ],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "process-claim-race",
                [
                    "python3",
                    "scripts/validation/process/claim_race.py",
                    "--bin",
                    str(binary),
                    "--workers",
                    "16",
                ],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "process-soak",
                [
                    "python3",
                    "scripts/validation/soak/run.py",
                    "--bin",
                    str(binary),
                    "--rounds",
                    str(args.soak_rounds),
                    "--workers",
                    "16",
                    "--output",
                    str(log_dir / "soak.json"),
                ],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "fault-clock-reorder",
                [
                    "python3",
                    "scripts/validation/fault/run_matrix.py",
                    "--results",
                    str(log_dir / "fault.json"),
                    "--report",
                    str(log_dir / "fault.md"),
                    *(["--online"] if args.online else []),
                ],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "concurrency",
                [
                    "python3",
                    "scripts/validation/concurrency/run_matrix.py",
                    "--iterations",
                    "5",
                    "--output",
                    str(log_dir / "concurrency.json"),
                    *(["--online"] if args.online else []),
                ],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "security",
                ["bash", "scripts/validation/security/probe.sh", *(["--online"] if args.online else [])],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        release_command = [
            "python3",
            "scripts/validation/release_performance.py",
            "--output",
            str(log_dir / "release.json"),
        ]
        if not args.require_benchmark:
            release_command.append("--skip-benchmark")
        if args.require_sqlite_floor:
            release_command.append("--require-sqlite-floor")
        if args.online:
            release_command.append("--online")
        checks.append(
            run_check(
                "release-performance",
                release_command,
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "release-package",
                ["sh", "scripts/release/package-smoke.sh"],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )
        checks.append(
            run_check(
                "guided-closeout",
                ["bash", "scripts/guided-closeout-smoke.sh"],
                log_dir,
                timeout_seconds=args.timeout_seconds,
            )
        )

    policy_failures: list[str] = []
    if args.require_no_skips or not args.allow_skips:
        policy_failures.extend(
            check["label"] for check in checks if check["status"] == "skip"
        )

    report = {
        "result_version": "boreal.full-suite/1",
        "started_at": started_at,
        "finished_at": now_iso(),
        "profile": args.profile,
        "strict": args.strict,
        "policy": {
            "require_no_skips": args.require_no_skips,
            "allow_skips": args.allow_skips,
            "require_current_binary": args.require_current_binary,
            "require_sqlite_floor": args.require_sqlite_floor,
            "require_benchmark": args.require_benchmark,
            "timeout_seconds": args.timeout_seconds,
            "soak_rounds": args.soak_rounds,
        },
        "binary": str(binary.resolve()),
        "host": {"system": platform.system(), "release": platform.release(), "machine": platform.machine()},
        "checks": checks,
        "counts": {
            "pass": sum(check["status"] == "pass" for check in checks),
            "fail": sum(check["status"] == "fail" for check in checks),
            "skip": sum(check["status"] == "skip" for check in checks),
        },
        "policy_failures": policy_failures,
        "log_dir": str(log_dir),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    report_path = (args.report or output.with_suffix(".md")).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(markdown(report), encoding="utf-8")
    print(json.dumps({"output": str(output), "report": str(report_path), "log_dir": str(log_dir), "counts": report["counts"]}, indent=2))
    return 1 if report["counts"]["fail"] or policy_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
