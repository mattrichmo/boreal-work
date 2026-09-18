#!/usr/bin/env python3
"""Run the blocking V01-V12 forensic audit matrix without false green results.

The audit deliberately asks for production-composition scenarios.  Existing
unit, application, and TUI checks are useful partial evidence, but they are
not silently promoted to a complete V01-V12 pass.  A scenario is ``pass``
only when all of its commands pass *and* the declared complete gate exists;
    otherwise it is ``unavailable`` (or ``skip`` when the environment prevents a
    check from running).  The default exit status is non-zero for either state.
"""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Check:
    label: str
    command: tuple[str, ...]


@dataclass(frozen=True)
class Scenario:
    scenario_id: str
    title: str
    findings: tuple[str, ...]
    checks: tuple[Check, ...]
    complete_gate: str


def cargo_args(*parts: str, online: bool) -> tuple[str, ...]:
    network_args = () if online else ("--offline",)
    return ("cargo", "test", "--locked", *network_args, *parts)


def production_gate(script: str, *args: str) -> tuple[str, ...]:
    return ("python3", script, "--bin", str(ROOT / "target" / "debug" / "bwrk"), *args)


def tui_production_gate() -> tuple[str, ...]:
    return ("node", "scripts/validation/tui/forensic_closeout.mjs")


def scenarios(*, online: bool) -> tuple[Scenario, ...]:
    return (
        Scenario(
            "V01",
            "same-operation replay through a running host and after restart",
            ("BW-01",),
            (
                Check(
                    "store operation replay",
                    cargo_args("-p", "boreal-store", "--test", "store_contracts", "atomic_claim_has_one_winner_and_replays_by_operation_id", online=online),
                ),
                Check(
                    "public CLI create replay",
                    cargo_args("-p", "boreal-cli", "--test", "hierarchy_public", "public_cli_replays_identical_work_create_as_unchanged", online=online),
                ),
                Check("production gate V01", production_gate("scripts/validation/process/forensic_service.py", "--only", "V01")),
            ),
            "A real bwrk service host must replay the same ID across restart and reject a changed payload with one durable effect.",
        ),
        Scenario(
            "V02",
            "completed evidence readback for every durable execution state",
            ("BW-02",),
            (
                Check(
                    "completed evidence replay",
                    cargo_args("-p", "boreal-cli", "--test", "evidence_executor_regressions", "completed_evidence_operation_replays_without_relaunching_or_reading_policy", online=online),
                ),
                Check(
                    "restart evidence readback",
                    cargo_args("-p", "boreal-cli", "--test", "service_signal_recovery", "recovered_evidence_retry_returns_unknown_readback_instead_of_duplicate_protocol_error", online=online),
                ),
                Check("production gate V02", production_gate("scripts/validation/process/forensic_service.py", "--only", "V02")),
            ),
            "A matrix must cover admitted, running, exited, receipt_committed, and unknown rows through service readback.",
        ),
        Scenario(
            "V03",
            "connection loss before admission, after payload, after commit, and mid-response",
            ("BW-03", "BW-12"),
            (
                Check(
                    "typed unknown outcome contract",
                    cargo_args("-p", "boreal-cli", "--test", "outcome_exit", "socket_busy_and_unknown_outcomes_have_documented_exits", online=online),
                ),
                Check(
                    "TUI unknown-operation handling",
                    ("npm", "test", "--prefix", "apps/tui"),
                ),
                Check("production gate V03", production_gate("scripts/validation/fault/socket_boundaries.py")),
            ),
            "A faulting socket harness must drop at four delivery boundaries and prove no fresh-ID retry is offered.",
        ),
        Scenario(
            "V04",
            "service status DTOs rendered by the production TypeScript client",
            ("BW-05", "BW-23", "BW-30"),
            (
                Check("TUI protocol/status tests", ("npm", "test", "--prefix", "apps/tui")),
                Check(
                    "CLI bounded status acceptance",
                    cargo_args("-p", "boreal-cli", "--test", "release_acceptance", "doctor_reports_schema_runtime_and_bounded_status_payload", online=online),
                ),
                Check("production gate V04", tui_production_gate()),
            ),
            "The live socket DTO fixture suite must cover every derived state, kind, gate, timestamp, and recovery field.",
        ),
        Scenario(
            "V05",
            "evidence import ownership and attestation boundaries",
            ("BW-06",),
            (
                Check(
                    "proof ownership checks",
                    cargo_args("-p", "boreal-application", "--test", "proof_boundary", "imported_receipts_require_current_subject_and_context", online=online),
                ),
                Check(
                    "witness/import distinction",
                    cargo_args("-p", "boreal-application", "--test", "proof_boundary", "imported_witness_label_is_rejected_but_failed_evidence_is_retained", online=online),
                ),
                Check("production gate V05", production_gate("scripts/validation/process/forensic_service.py", "--only", "V05")),
            ),
            "The service route must prove same-session success and wrong-session failure with the actual request adapter.",
        ),
        Scenario(
            "V06",
            "faulted proof-gated finish workflow and replayable parent readback",
            ("BW-10", "BW-11", "BW-18", "BW-19"),
            (
                Check(
                    "durable application closeout",
                    cargo_args("-p", "boreal-application", "--test", "sqlite_lifecycle", "accepted_receipts_drive_durable_proof_gated_closeout", online=online),
                ),
                Check(
                    "durable close intent",
                    cargo_args("-p", "boreal-store", "--test", "store_contracts", "close_intent_is_idempotent_readable_and_rejects_then_finalizes_with_audit", online=online),
                ),
                Check("mounted TUI workflow tests", ("npm", "test", "--prefix", "apps/tui")),
                Check("production gate V06", tui_production_gate()),
            ),
            "The real CLI and full-screen path must fault between every stage, restart, read the parent operation, and complete with a typed summary.",
        ),
        Scenario(
            "V07",
            "committed mutation remains visible when the following refresh fails",
            ("BW-13",),
            (
                Check("TUI mutation/error tests", ("npm", "test", "--prefix", "apps/tui")),
                Check(
                    "operation readback contract",
                    cargo_args("-p", "boreal-cli", "--test", "operation_readback_contract", "operation_show_reads_completed_create_operation", online=online),
                ),
                Check("production gate V07", tui_production_gate()),
            ),
            "A production controller fault test must separate committed action receipts from stale-view refresh errors.",
        ),
        Scenario(
            "V08",
            "verifier descendant drain, cancellation, and signal cleanup",
            ("BW-07",),
            (
                Check(
                    "descendant timeout cleanup",
                    cargo_args("-p", "boreal-cli", "--test", "evidence_executor_regressions", "timeout_kills_descendants_in_the_declared_process_group", online=online),
                ),
                Check(
                    "service signal cleanup",
                    cargo_args("-p", "boreal-cli", "--test", "service_signal_recovery", "service_run_handles_sigterm_and_removes_socket", online=online),
                ),
                Check("production gate V08", production_gate("scripts/validation/process/forensic_service.py", "--only", "V08")),
            ),
            "A parent-exit/inherited-pipe fixture must prove bounded completion and zero owned descendants across cancellation and SIGTERM.",
        ),
        Scenario(
            "V09",
            "service ownership versus direct and alternate CLI paths",
            ("BW-04",),
            (
                Check(
                    "live endpoint ownership",
                    cargo_args("-p", "boreal-cli", "--test", "service_signal_recovery", "service_run_recovers_a_stale_socket_after_sigkill_without_breaking_live_service", online=online),
                ),
                Check("command registry availability", cargo_args("-p", "boreal-cli", "--test", "command_registry", "commands_reports_source_routes_as_direct_only", online=online)),
                Check("production gate V09", production_gate("scripts/validation/process/forensic_service.py", "--only", "V09")),
            ),
            "Every direct mutation must reject or explicitly enter an approved offline mode while an elected host owns the project.",
        ),
        Scenario(
            "V10",
            "deadline reconciliation and control progress under full normal load",
            ("BW-08", "BW-09"),
            (
                Check("service runtime unit tests", cargo_args("-p", "boreal-service", "--lib", online=online)),
                Check("guided lifecycle clock tests", cargo_args("-p", "boreal-application", "--test", "p2_guided_flow", "p2_guided_flow_claims_three_harnesses_and_fences_recovery", online=online)),
                Check("production gate V10", production_gate("scripts/validation/concurrency/production_host.py")),
            ),
            "A production host test must use a fake clock, saturate workers and the normal queue, and measure typed control latency and stop proof.",
        ),
        Scenario(
            "V11",
            "large-project page reachability, exact lookup, and bounded status work",
            ("BW-21", "BW-22", "BW-33"),
            (
                Check("exact lookup without page limits", cargo_args("-p", "boreal-store", "--test", "storage_remediation", "exact_work_and_session_lookups_do_not_depend_on_page_limits", online=online)),
                Check("status pagination projection", cargo_args("-p", "boreal-application", "--test", "status_projection", "pagination_does_not_change_rollup_counts", online=online)),
                Check(
                    "status scale benchmark",
                    cargo_args("-p", "boreal-store", "--test", "release_acceptance", "--", "--ignored", "--nocapture", "status_read_release_benchmark_10k_100k", online=online),
                ),
                Check("production gate V11", production_gate("scripts/validation/status/production_client.py")),
            ),
            "A complete gate must reach eligible item 1001 and exact work 101/1001 through the production client with query-count evidence.",
        ),
        Scenario(
            "V12",
            "full envelope byte limits and post-commit sidecar failure recovery",
            ("BW-17", "BW-36"),
            (
                Check("bounded evidence capture", cargo_args("-p", "boreal-cli", "--test", "evidence_runner_hardening", "evidence_run_caps_capture_before_an_unbounded_file_can_grow", online=online)),
                Check("TUI framing and payload tests", ("npm", "test", "--prefix", "apps/tui")),
                Check("production gate V12", ("python3", "scripts/validation/security/v12_envelope.py")),
            ),
            "A byte-accurate 65535/65536/65537 envelope matrix must include Unicode expansion and a sidecar-export failure after receipt commit.",
        ),
    )


def classify_output(stdout: str, stderr: str, exit_code: int, *, timed_out: bool) -> tuple[str, str | None]:
    combined = f"{stdout}\n{stderr}"
    lowered = combined.lower()
    if timed_out:
        return "fail", "timed out"
    if "boreal_validation_skip:" in lowered:
        marker = next((line.strip() for line in combined.splitlines() if "BOREAL_VALIDATION_SKIP:" in line.upper()), "environment reported a skip")
        return "skip", marker.split(":", 1)[-1].strip()
    if exit_code != 0 and ("eperm" in lowered or "operation not permitted" in lowered) and any(token in lowered for token in ("socket", "listen", "unix")):
        return "skip", "environment denied Unix socket/process capability"
    if exit_code == 0:
        return "pass", None
    return "fail", f"exit {exit_code}"


def run_command(check: Check, *, log_dir: Path, online: bool) -> dict[str, Any]:
    command = list(check.command)
    if command and shutil.which(command[0]) is None:
        return {
            "label": check.label,
            "command": command,
            "status": "unavailable",
            "reason": f"required executable is unavailable: {command[0]}",
            "exit_code": None,
            "duration_ms": 0.0,
        }
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
            timeout=900,
        )
        stdout, stderr = completed.stdout or "", completed.stderr or ""
        status, reason = classify_output(stdout, stderr, completed.returncode, timed_out=False)
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout or ""
        stderr = error.stderr or ""
        completed = subprocess.CompletedProcess(command, 124, stdout, stderr)
        status, reason = classify_output(stdout, stderr, 124, timed_out=True)
    except OSError as error:
        stdout, stderr = "", str(error)
        completed = subprocess.CompletedProcess(command, 127, stdout, stderr)
        status, reason = "unavailable", str(error)
    duration_ms = round((time.perf_counter() - started) * 1000, 3)
    stem = check.label.replace(" ", "-").replace("/", "-")
    (log_dir / f"{stem}.stdout.log").write_text(stdout, encoding="utf-8")
    (log_dir / f"{stem}.stderr.log").write_text(stderr, encoding="utf-8")
    return {
        "label": check.label,
        "command": command,
        "status": status,
        "reason": reason,
        "exit_code": completed.returncode,
        "duration_ms": duration_ms,
        "stdout_log": str(log_dir / f"{stem}.stdout.log"),
        "stderr_log": str(log_dir / f"{stem}.stderr.log"),
    }


def markdown(result: dict[str, Any]) -> str:
    lines = [
        "# Forensic audit blocking validation",
        "",
        f"Overall: **{result['status']}**; pass **{result['counts']['pass']}**, skip **{result['counts']['skip']}**, unavailable **{result['counts']['unavailable']}**, fail **{result['counts']['fail']}**.",
        "",
        "A scenario is green only when its exact production-composition gate is implemented and every listed check passes. Partial checks are retained as evidence and cannot establish a pass by themselves.",
        "",
        "| Scenario | Status | Findings | Checks | Missing complete gate |",
        "| --- | --- | --- | --- | --- |",
    ]
    for scenario in result["scenarios"]:
        checks = ", ".join(f"{item['label']}={item['status']}" for item in scenario["checks"])
        lines.append(
            f"| `{scenario['id']}` | **{scenario['status']}** | {', '.join(scenario['findings'])} | {checks} | {scenario['complete_gate']} |"
        )
    lines.extend(["", f"Logs: `{result['log_dir']}`", ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--online", action="store_true", help="allow Cargo to resolve dependencies from the network")
    parser.add_argument("--scenario", action="append", choices=[f"V{number:02d}" for number in range(1, 13)], help="run only a selected scenario; repeatable")
    parser.add_argument("--output", type=Path, default=ROOT / "scripts/validation/results/forensic-audit.latest.json")
    parser.add_argument("--report", type=Path, help="Markdown report path; defaults beside --output")
    parser.add_argument("--allow-unavailable", action="store_true", help="write incomplete evidence but return zero; report remains incomplete")
    args = parser.parse_args()
    selected = set(args.scenario or [])
    all_scenarios = scenarios(online=args.online)
    selected_scenarios = tuple(item for item in all_scenarios if not selected or item.scenario_id in selected)
    output = args.output.resolve()
    log_dir = output.parent / f"forensic-audit-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    log_dir.mkdir(parents=True, exist_ok=True)
    cache: dict[tuple[str, ...], dict[str, Any]] = {}
    records: list[dict[str, Any]] = []
    for scenario in selected_scenarios:
        checks: list[dict[str, Any]] = []
        for check in scenario.checks:
            if check.command not in cache:
                cache[check.command] = run_command(check, log_dir=log_dir, online=args.online)
            observed = dict(cache[check.command])
            # A shared command (notably the live TUI gate) may serve several
            # scenarios. Keep its execution cache, but preserve the scenario
            # label in each report so V04/V06/V07 cannot be misattributed to
            # whichever scenario happened to run it first.
            observed["label"] = check.label
            checks.append(observed)
        check_statuses = {item["status"] for item in checks}
        if "fail" in check_statuses:
            status = "fail"
        elif "skip" in check_statuses:
            status = "skip"
        elif "unavailable" in check_statuses:
            status = "unavailable"
        else:
            has_production_gate = any(
                item["label"].startswith("production gate") for item in checks
            )
            status = "pass" if has_production_gate else "unavailable"
        records.append(
            {
                "id": scenario.scenario_id,
                "title": scenario.title,
                "findings": list(scenario.findings),
                "status": status,
                "checks": checks,
                "complete_gate": scenario.complete_gate,
                "complete": status == "pass",
            }
        )
    counts = {status: sum(item["status"] == status for item in records) for status in ("pass", "skip", "unavailable", "fail")}
    overall = "pass" if counts["fail"] == 0 and counts["skip"] == 0 and counts["unavailable"] == 0 else "incomplete"
    result = {
        "result_version": "boreal.forensic-audit/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": overall,
        "profile": "online" if args.online else "offline",
        "host": {"system": platform.system(), "release": platform.release(), "machine": platform.machine(), "python": platform.python_version()},
        "counts": counts,
        "scenarios": records,
        "log_dir": str(log_dir),
        "limitations": [
            "A V01-V12 pass requires the named production gate in addition to its partial unit/application/TUI checks.",
            "A complete scenario requires a test through the actual bwrk service composition and its declared fault/scale boundary.",
            "Environment skips remain visible and are release-blocking unless an explicit non-release exploratory override is used.",
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    report = (args.report or output.with_suffix(".md")).resolve()
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(markdown(result), encoding="utf-8")
    print(json.dumps({"status": overall, "counts": counts, "output": str(output), "report": str(report)}, sort_keys=True))
    if overall == "pass" or args.allow_unavailable:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
