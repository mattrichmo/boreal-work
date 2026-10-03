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
import hashlib
import json
import math
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


def finite_json_number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def json_at(value: Any, *path: str) -> Any:
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def approved_json_contract(reference: Any, *, schema: str) -> dict[str, Any] | None:
    if not isinstance(reference, dict):
        return None
    path_value = reference.get("path")
    digest = reference.get("sha256")
    if not isinstance(path_value, str) or not path_value:
        return None
    if Path(path_value).is_absolute() or not isinstance(digest, str):
        return None
    path = (ROOT / path_value).resolve()
    try:
        path.relative_to(ROOT.resolve())
        payload = path.read_bytes()
        document = json.loads(payload)
    except (OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    actual_digest = "sha256:" + hashlib.sha256(payload).hexdigest()
    if actual_digest != digest or not isinstance(document, dict):
        return None
    if (
        document.get("schema") != schema
        or document.get("status") != "approved"
        or not isinstance(document.get("decision_id"), str)
        or not document.get("decision_id")
        or not isinstance(document.get("approved_by"), str)
        or not document.get("approved_by")
        or not isinstance(document.get("approved_at"), str)
        or not document.get("approved_at")
        or not isinstance(document.get("contract_version"), str)
        or not document.get("contract_version")
    ):
        return None
    return document


def v10_component_evidence_complete(
    name: str,
    component: Any,
    *,
    report: dict[str, Any],
    budget: Any,
    budget_document: dict[str, Any] | None,
    profile_document: dict[str, Any] | None,
) -> bool:
    if not isinstance(component, dict):
        return False
    if component.get("status") != "pass" or component.get("complete") is not True:
        return False
    if name == "durable_deadline":
        authority = component.get("agent_authority_readback")
        attempt = component.get("attempt_after_restart")
        obligation = component.get("recovery_obligation")
        reservation = component.get("resource_reservation")
        stale = component.get("stale_fence_response")
        attempt_id = component.get("attempt_id")
        fence = component.get("fence")
        actor_id = component.get("actor_id")
        return (
            isinstance(attempt_id, str)
            and bool(attempt_id)
            and isinstance(actor_id, str)
            and bool(actor_id)
            and type(fence) is int
            and fence > 0
            and isinstance(authority, dict)
            and authority.get("actor_id") == actor_id
            and authority.get("role") == "agent"
            and authority.get("authority_granted") is True
            and component.get("deadline_crossed_while_service_stopped") is True
            and component.get("service_restarted_after_deadline") is True
            and type(component.get("deadline_unix_ms")) is int
            and type(component.get("service_restart_unix_ms")) is int
            and component["service_restart_unix_ms"] >= component["deadline_unix_ms"]
            and isinstance(attempt, dict)
            and attempt.get("attempt_id") == attempt_id
            and type(attempt.get("fence")) is int
            and attempt.get("fence") == fence
            and attempt.get("current") is True
            and component.get("attempt_state_after_restart") == "expiry_pending"
            and component.get("recovery_obligation_readback") is True
            and isinstance(obligation, dict)
            and isinstance(obligation.get("obligation_id"), str)
            and bool(obligation.get("obligation_id"))
            and obligation.get("attempt_id") == attempt_id
            and obligation.get("state") == "unresolved"
            and component.get("resource_ownership_active_after_restart") is True
            and isinstance(reservation, dict)
            and reservation.get("attempt_id") == attempt_id
            and reservation.get("state") == "active"
            and component.get("stale_fence_rejected") is True
            and isinstance(stale, dict)
            and type(stale.get("exit_code")) is int
            and stale.get("exit_code") != 0
            and json_at(stale, "envelope", "error", "code") == "stale_fence"
        )
    if name == "full_load":
        if profile_document is None:
            return False
        profile = component.get("approved_profile")
        measured = component.get("observed_profile")
        if not isinstance(profile, dict) or not isinstance(measured, dict):
            return False
        thresholds = {
            "worker_target": "workers",
            "dispatch_workers_target": "dispatch_workers",
            "dispatch_capacity_target": "dispatch_capacity",
            "requests_per_worker_target": "requests_per_worker",
            "minimum_duration_ms": "observed_duration_ms",
            "completion_target": "successful_responses",
            "starvation_target": "observed_max_success_progress_gap_ms",
        }
        if (
            profile.get("status") != "approved"
            or not isinstance(profile.get("profile_id"), str)
            or profile.get("profile_id") != profile_document.get("profile_id")
            or not isinstance(profile_document.get("source"), str)
            or not profile_document.get("source")
            or profile.get("source") != profile_document.get("source")
            or any(type(profile_document.get(key)) is not int for key in thresholds)
            or any(profile_document[key] < 1 for key in thresholds)
            or any(
                type(profile.get(key)) is not int
                or profile.get(key) != profile_document.get(key)
                for key in thresholds
            )
        ):
            return False
        if any(not finite_json_number(measured.get(field)) for field in thresholds.values()):
            return False
        integer_metrics = (
            "workers",
            "dispatch_workers",
            "dispatch_capacity",
            "requests_per_worker",
            "successful_responses",
            "requests_started",
            "failed_or_unavailable_responses",
            "workers_with_successful_responses",
            "workers_with_zero_successful_responses",
            "observed_starvation_workers_with_zero_progress",
        )
        if any(type(measured.get(key)) is not int for key in integer_metrics):
            return False
        worker_progress = measured.get("worker_progress")
        if (
            type(measured.get("workers")) is not int
            or not isinstance(worker_progress, dict)
            or len(worker_progress) != measured["workers"]
        ):
            return False
        if any(
            not isinstance(progress, dict)
            or type(progress.get("successful_responses")) is not int
            or progress["successful_responses"] <= 0
            or type(progress.get("requests_completed")) is not int
            or progress["successful_responses"] > progress["requests_completed"]
            or progress["requests_completed"] < profile_document["requests_per_worker_target"]
            or not finite_json_number(progress.get("max_success_progress_gap_ms"))
            or progress["max_success_progress_gap_ms"] > profile_document["starvation_target"]
            for progress in worker_progress.values()
        ):
            return False
        progress_successes = sum(
            progress["successful_responses"]
            for progress in worker_progress.values()
        )
        progress_requests = sum(
            progress["requests_completed"]
            for progress in worker_progress.values()
        )
        if (
            progress_successes != measured["successful_responses"]
            or progress_requests != measured["requests_started"]
            or measured["failed_or_unavailable_responses"]
            != measured["requests_started"] - measured["successful_responses"]
            or measured["workers_with_successful_responses"] != measured["workers"]
        ):
            return False
        return all(
            measured[field] >= profile_document[threshold]
            for threshold, field in thresholds.items()
            if threshold != "starvation_target"
        ) and (
            measured["observed_max_success_progress_gap_ms"]
            <= profile_document["starvation_target"]
            and type(measured.get("requests_started")) is int
            and measured["requests_started"]
            == measured["workers"] * measured["requests_per_worker"]
            and type(measured.get("observed_starvation_workers_with_zero_progress")) is int
            and measured.get("observed_starvation_workers_with_zero_progress") == 0
            and type(measured.get("workers_with_zero_successful_responses")) is int
            and measured.get("workers_with_zero_successful_responses") == 0
        )
    if name == "typed_control":
        if budget_document is None or not isinstance(budget, dict):
            return False
        latency = component.get("latency_ms")
        target = budget.get("target_ms")
        queue_error = component.get("typed_service_busy_error_details")
        control_response = component.get("control_response")
        return (
            component.get("dispatch_queue_full_observed") is True
            and component.get("typed_service_busy_observed") is True
            and isinstance(queue_error, list)
            and any(
                isinstance(item, dict)
                and item.get("code") == "service_busy"
                and "dispatch queue is full" in str(item.get("message", "")).lower()
                for item in queue_error
            )
            and isinstance(control_response, dict)
            and control_response.get("response_received") is True
            and finite_json_number(latency)
            and finite_json_number(control_response.get("latency_ms"))
            and latency == control_response.get("latency_ms")
            and finite_json_number(target)
            and budget.get("status") == "approved"
            and budget.get("source") == budget_document.get("source")
            and budget_document.get("target_ms") == target
            and component.get("target_ms") == target
            and target > 0
            and component.get("latency_within_target") is (latency <= target)
            and latency <= target
        )
    if name == "stop_recovery":
        attempt = component.get("attempt_stop_recovery")
        first_stop = component.get("sigterm_drain")
        restart_stop = component.get("same_database_restart_stop")
        readback = component.get("restart_readback_before_retry")
        stop_report = report.get("stop_recovery")
        if not isinstance(stop_report, dict):
            return False
        workload = stop_report.get("workload")
        mutation = stop_report.get("mutation_delivery")
        if not all(isinstance(value, dict) for value in (attempt, first_stop, restart_stop, readback, workload)):
            return False
        if not isinstance(mutation, dict):
            return False
        disposition = attempt.get("restart_disposition_readback")
        actor_id = attempt.get("actor_id")
        authority = attempt.get("agent_authority_readback")
        deadline_ms = attempt.get("deadline_unix_ms")
        restart_ms = attempt.get("service_restart_unix_ms")
        obligation = attempt.get("recovery_obligation")
        reservation = attempt.get("resource_reservation")
        stale = attempt.get("stale_fence_response")
        operation_data = readback.get("operation_data")
        operation = operation_data.get("operation") if isinstance(operation_data, dict) else None
        work_data = readback.get("work_data")
        if not isinstance(operation, dict) or not isinstance(work_data, dict):
            return False
        operation_id = mutation.get("operation_id")
        work_id = mutation.get("work_id")
        return (
            attempt.get("authorized_agent") is True
            and attempt.get("actor_role") == "agent"
            and isinstance(actor_id, str)
            and bool(actor_id)
            and isinstance(authority, dict)
            and authority.get("actor_id") == actor_id
            and authority.get("role") == "agent"
            and authority.get("authority_granted") is True
            and isinstance(attempt.get("attempt_id"), str)
            and bool(attempt.get("attempt_id"))
            and type(attempt.get("fence")) is int
            and attempt["fence"] > 0
            and type(deadline_ms) is int
            and type(restart_ms) is int
            and restart_ms >= deadline_ms
            and attempt.get("deadline_crossed_while_service_stopped") is True
            and isinstance(disposition, dict)
            and disposition.get("attempt_id") == attempt.get("attempt_id")
            and type(disposition.get("fence")) is int
            and disposition.get("fence") == attempt.get("fence")
            and disposition.get("phase") == "expiry_pending"
            and disposition.get("current") is True
            and isinstance(obligation, dict)
            and isinstance(obligation.get("obligation_id"), str)
            and bool(obligation.get("obligation_id"))
            and obligation.get("attempt_id") == attempt.get("attempt_id")
            and obligation.get("state") == "unresolved"
            and isinstance(reservation, dict)
            and reservation.get("attempt_id") == attempt.get("attempt_id")
            and reservation.get("state") == "active"
            and isinstance(stale, dict)
            and type(stale.get("exit_code")) is int
            and stale.get("exit_code") != 0
            and json_at(stale, "envelope", "error", "code") == "stale_fence"
            and first_stop.get("signal") == "SIGTERM"
            and type(first_stop.get("exit_code")) is int
            and first_stop.get("exit_code") == 0
            and first_stop.get("socket_removed") is True
            and type(first_stop.get("active_client_processes_at_request")) is int
            and first_stop["active_client_processes_at_request"] > 0
            and isinstance(first_stop.get("active_client_process_pids_at_request"), list)
            and len(first_stop["active_client_process_pids_at_request"])
            == first_stop["active_client_processes_at_request"]
            and all(
                type(pid) is int and pid > 0
                for pid in first_stop["active_client_process_pids_at_request"]
            )
            and type(first_stop.get("active_client_snapshot_monotonic_ns")) is int
            and type(first_stop.get("signal_sent_monotonic_ns")) is int
            and 0
            <= first_stop["signal_sent_monotonic_ns"]
            - first_stop["active_client_snapshot_monotonic_ns"]
            <= 250_000_000
            and type(restart_stop.get("exit_code")) is int
            and restart_stop.get("exit_code") == 0
            and restart_stop.get("socket_removed") is True
            and readback.get("operation_result_subject_match") is True
            and readback.get("work_readback_exact_id") is True
            and readback.get("operation_error") is None
            and readback.get("work_error") is None
            and isinstance(operation_id, str)
            and bool(operation_id)
            and isinstance(work_id, str)
            and bool(work_id)
            and isinstance(operation.get("project_id"), str)
            and bool(operation.get("project_id"))
            and operation.get("operation_id") == operation_id
            and operation.get("command") in {"work.create", "work_create"}
            and json_at(operation, "result", "work_id") == work_id
            and find_json_field(operation_data, "project_id") == operation.get("project_id")
            and find_json_field(work_data, "work_id") == work_id
            and find_json_field(work_data, "project_id") == operation.get("project_id")
            and type(workload.get("successful_responses_before_sigterm")) is int
            and workload.get("successful_responses_before_sigterm") > 0
        )
    return False


def find_json_field(value: Any, name: str) -> Any:
    if isinstance(value, dict):
        if name in value:
            return value[name]
        for child in value.values():
            found = find_json_field(child, name)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_json_field(child, name)
            if found is not None:
                return found
    return None


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
                Check(
                    "bounded read-only dispatch-admission smoke",
                    production_gate("scripts/validation/concurrency/production_host.py"),
                ),
                Check(
                    "full V10 production acceptance",
                    production_gate("scripts/validation/concurrency/production_host.py", "--full-v10"),
                ),
            ),
            "V10 passes only with source- and binary-bound evidence for durable deadline reconciliation after restart, full normal-load worker/queue coverage, typed service_busy and control progress against a preapproved budget, and stop/recovery under workload.",
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
    result = {
        "label": check.label,
        "command": command,
        "status": status,
        "reason": reason,
        "exit_code": completed.returncode,
        "duration_ms": duration_ms,
        "stdout_log": str(log_dir / f"{stem}.stdout.log"),
        "stderr_log": str(log_dir / f"{stem}.stderr.log"),
    }
    if check.label in {
        "bounded read-only dispatch-admission smoke",
        "full V10 production acceptance",
    }:
        try:
            summary = json.loads(next(line for line in reversed(stdout.splitlines()) if line.strip()))
        except (StopIteration, json.JSONDecodeError):
            summary = None
        if isinstance(summary, dict):
            if check.label == "bounded read-only dispatch-admission smoke":
                result["smoke_subresult"] = summary
            else:
                result["v10_gate_subresult"] = summary
                report_path = summary.get("output")
                report: dict[str, Any] | None = None
                report_digest: str | None = None
                report_error: str | None = None
                if not isinstance(report_path, str) or not report_path.strip():
                    report_error = "full V10 gate did not identify its JSON evidence report"
                else:
                    evidence_path = Path(report_path)
                    if not evidence_path.is_absolute():
                        evidence_path = ROOT / evidence_path
                    try:
                        payload = evidence_path.read_bytes()
                        report_digest = "sha256:" + hashlib.sha256(payload).hexdigest()
                        decoded = json.loads(payload)
                        if isinstance(decoded, dict):
                            report = decoded
                        else:
                            report_error = "full V10 evidence report is not a JSON object"
                    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
                        report_error = f"cannot read full V10 evidence report: {error}"

                acceptance = report.get("v10_acceptance") if report else None
                identity = (
                    acceptance.get("identity")
                    if isinstance(acceptance, dict)
                    else None
                )
                if identity is None and report:
                    identity = report.get("identity")
                components = acceptance.get("components") if isinstance(acceptance, dict) else None
                budget = acceptance.get("control_latency_budget") if isinstance(acceptance, dict) else None
                required_components = (
                    "durable_deadline",
                    "full_load",
                    "typed_control",
                    "stop_recovery",
                )
                budget_document = approved_json_contract(
                    budget.get("approval_artifact") if isinstance(budget, dict) else None,
                    schema="boreal.v10-control-latency-budget/v1",
                )
                profile_reference = (
                    components.get("full_load", {}).get("approved_profile")
                    if isinstance(components, dict)
                    and isinstance(components.get("full_load"), dict)
                    else None
                )
                profile_document = approved_json_contract(
                    profile_reference,
                    schema="boreal.v10-load-profile/v1",
                )
                component_evidence = {
                    name: v10_component_evidence_complete(
                        name,
                        components.get(name) if isinstance(components, dict) else None,
                        report=report or {},
                        budget=budget,
                        budget_document=budget_document,
                        profile_document=profile_document,
                    )
                    for name in required_components
                }
                evidence_errors = [
                    f"{name} is marked pass without complete raw evidence"
                    for name in required_components
                    if isinstance(components, dict)
                    and isinstance(components.get(name), dict)
                    and components[name].get("status") == "pass"
                    and not component_evidence[name]
                ]
                if (
                    isinstance(budget, dict)
                    and budget.get("status") == "approved"
                    and (
                        budget_document is None
                        or budget.get("source") != budget_document.get("source")
                        or budget.get("target_ms") != budget_document.get("target_ms")
                    )
                ):
                    evidence_errors.append(
                        "control latency budget is marked approved without a matching approved artifact"
                    )
                components_complete = (
                    isinstance(components, dict)
                    and all(component_evidence.values())
                )
                budget_approved = (
                    isinstance(budget, dict)
                    and budget.get("status") == "approved"
                    and isinstance(budget.get("source"), str)
                    and bool(budget.get("source"))
                    and finite_json_number(budget.get("target_ms"))
                    and budget.get("target_ms") > 0
                    and budget_document is not None
                    and budget_document.get("source") == budget.get("source")
                    and budget_document.get("target_ms") == budget.get("target_ms")
                )
                identity_complete = (
                    isinstance(identity, dict)
                    and isinstance(identity.get("source"), dict)
                    and isinstance(identity["source"].get("commit"), str)
                    and isinstance(identity["source"].get("tree"), str)
                    and identity["source"].get("dirty") is False
                    and isinstance(identity["source"].get("diff_sha256"), str)
                    and isinstance(identity["source"].get("production_host_sha256"), str)
                    and isinstance(identity.get("binary"), dict)
                    and isinstance(identity["binary"].get("sha256"), str)
                    and isinstance(identity["binary"].get("version"), str)
                    and isinstance(identity.get("run_id"), str)
                    and bool(identity.get("run_id"))
                )
                identity_errors: list[str] = []
                if report is not None:
                    if report.get("mode") != "full_v10":
                        identity_errors.append("evidence report is not from full V10 mode")
                    if summary.get("mode") != "full_v10":
                        identity_errors.append("command summary is not from full V10 mode")
                    report_run_id = identity.get("run_id") if isinstance(identity, dict) else None
                    if summary.get("run_id") != report_run_id:
                        identity_errors.append("command summary run ID does not match evidence report")
                    if summary.get("report_sha256") != report_digest:
                        identity_errors.append("command summary digest does not match evidence report bytes")
                    report_acceptance_status = (
                        acceptance.get("status") if isinstance(acceptance, dict) else None
                    )
                    if summary.get("v10_acceptance") != report_acceptance_status:
                        identity_errors.append("command summary acceptance does not match evidence report")
                incomplete_exit = (
                    result["exit_code"] == 1
                    and isinstance(acceptance, dict)
                    and acceptance.get("status") != "pass"
                    and not identity_errors
                )
                if incomplete_exit:
                    result["status"] = "unavailable"
                    result["reason"] = "full V10 gate produced incomplete acceptance evidence"
                elif result["status"] != "pass":
                    identity_errors.append("full V10 command did not complete successfully")
                if identity_complete:
                    source_identity = identity["source"]
                    binary_identity = identity["binary"]
                    try:
                        current_commit = subprocess.run(
                            ["git", "rev-parse", "HEAD"],
                            cwd=ROOT,
                            text=True,
                            capture_output=True,
                            check=True,
                        ).stdout.strip()
                        current_tree = subprocess.run(
                            ["git", "rev-parse", "HEAD^{tree}"],
                            cwd=ROOT,
                            text=True,
                            capture_output=True,
                            check=True,
                        ).stdout.strip()
                        current_status = subprocess.run(
                            ["git", "status", "--porcelain"],
                            cwd=ROOT,
                            text=True,
                            capture_output=True,
                            check=True,
                        ).stdout
                        current_diff = subprocess.run(
                            ["git", "diff", "--binary", "HEAD"],
                            cwd=ROOT,
                            capture_output=True,
                            check=True,
                        ).stdout
                        if source_identity.get("commit") != current_commit:
                            identity_errors.append("source commit does not match the audited checkout")
                        if source_identity.get("tree") != current_tree:
                            identity_errors.append("source tree does not match the audited checkout")
                        if source_identity.get("dirty") is not False:
                            identity_errors.append("evidence source checkout was dirty")
                        if source_identity.get("diff_sha256") != "sha256:" + hashlib.sha256(b"").hexdigest():
                            identity_errors.append("evidence source diff is not empty")
                        if current_status:
                            identity_errors.append("audited checkout is dirty")
                        if source_identity.get("diff_sha256") != "sha256:" + hashlib.sha256(current_diff).hexdigest():
                            identity_errors.append("source diff does not match the audited checkout")
                        production_host_path = ROOT / "scripts/validation/concurrency/production_host.py"
                        production_host_digest = "sha256:" + hashlib.sha256(
                            production_host_path.read_bytes()
                        ).hexdigest()
                        if source_identity.get("production_host_sha256") != production_host_digest:
                            identity_errors.append("production host script digest does not match the audited checkout")
                        expected_binary = (ROOT / "target/debug/bwrk").resolve()
                        reported_binary = Path(str(binary_identity.get("path", ""))).resolve()
                        if reported_binary != expected_binary:
                            identity_errors.append("binary path does not match the freshly built audit binary")
                        if not expected_binary.is_file():
                            identity_errors.append("freshly built audit binary is missing")
                        else:
                            binary_digest = "sha256:" + hashlib.sha256(expected_binary.read_bytes()).hexdigest()
                            if binary_identity.get("sha256") != binary_digest:
                                identity_errors.append("binary digest does not match the freshly built audit binary")
                    except (OSError, subprocess.SubprocessError) as error:
                        identity_errors.append(f"cannot verify source/binary identity: {error}")
                if report_error:
                    if result["status"] not in {"skip", "unavailable"}:
                        result["status"] = "fail"
                    result["reason"] = report_error
                elif not isinstance(acceptance, dict):
                    result["status"] = "unavailable"
                    result["reason"] = "full V10 evidence report has no acceptance record"
                elif any(
                    isinstance(components, dict)
                    and isinstance(components.get(name), dict)
                    and components[name].get("status") == "fail"
                    for name in required_components
                ):
                    result["status"] = "fail"
                    result["reason"] = "one or more V10 acceptance components failed"
                elif evidence_errors or (
                    isinstance(acceptance, dict)
                    and acceptance.get("status") == "pass"
                    and not (components_complete and budget_approved)
                ):
                    result["status"] = "fail"
                    result["reason"] = "; ".join(evidence_errors) or (
                        "V10 acceptance claims pass without all approved component evidence"
                    )
                elif identity_errors:
                    result["status"] = "fail"
                    result["reason"] = "; ".join(identity_errors)
                elif (
                    result["status"] == "pass"
                    and not identity_errors
                    and acceptance.get("status") == "pass"
                    and acceptance.get("complete") is True
                    and components_complete
                    and budget_approved
                    and identity_complete
                ):
                    result["status"] = "pass"
                    result["reason"] = None
                else:
                    result["status"] = "unavailable"
                    result["reason"] = (
                        acceptance.get("reason")
                        or "full V10 acceptance is incomplete or its control budget is not approved"
                    )
                result["v10_evidence"] = {
                    "path": report_path,
                    "sha256": report_digest,
                    "acceptance": acceptance,
                    "identity": identity,
                    "identity_errors": identity_errors,
                    "component_evidence": component_evidence,
                    "evidence_errors": evidence_errors,
                    "report_error": report_error,
                }
        elif check.label == "full V10 production acceptance":
            if result["status"] not in {"skip", "unavailable"}:
                result["status"] = "fail"
            result["reason"] = "full V10 gate returned no machine-readable report summary"
    return result


def markdown(result: dict[str, Any]) -> str:
    lines = [
        "# Forensic audit blocking validation",
        "",
        f"Overall: **{result['status']}**; pass **{result['counts']['pass']}**, skip **{result['counts']['skip']}**, unavailable **{result['counts']['unavailable']}**, fail **{result['counts']['fail']}**.",
        "",
        "A scenario is green only when its exact production-composition gate is implemented and every listed check passes. Partial checks are retained as evidence and cannot establish a pass by themselves.",
        "The V10 dispatch-admission smoke is partial evidence. V10 passes only when a separately reported full gate proves all four required components and an owner-approved control budget against the exact source and binary.",
        "",
        "| Scenario | Status | Acceptance | Findings | Checks | Missing complete gate |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for scenario in result["scenarios"]:
        checks = ", ".join(f"{item['label']}={item['status']}" for item in scenario["checks"])
        acceptance = scenario.get("acceptance", {}).get("status", "")
        lines.append(
            f"| `{scenario['id']}` | **{scenario['status']}** | {acceptance} | {', '.join(scenario['findings'])} | {checks} | {scenario['complete_gate']} |"
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
            has_full_v10_gate = any(
                item["label"] == "full V10 production acceptance"
                and item["status"] == "pass"
                for item in checks
            )
            status = "pass" if has_production_gate or (scenario.scenario_id == "V10" and has_full_v10_gate) else "unavailable"
        record = {
            "id": scenario.scenario_id,
            "title": scenario.title,
            "findings": list(scenario.findings),
            "status": status,
            "checks": checks,
            "complete_gate": scenario.complete_gate,
            "complete": status == "pass",
        }
        if scenario.scenario_id == "V10":
            smoke_check = next(
                (item for item in checks if item["label"] == "bounded read-only dispatch-admission smoke"),
                None,
            )
            smoke_summary = (smoke_check or {}).get("smoke_subresult") or {}
            full_check = next(
                (item for item in checks if item["label"] == "full V10 production acceptance"),
                None,
            )
            full_evidence = (full_check or {}).get("v10_evidence") or {}
            full_acceptance = full_evidence.get("acceptance") or {}
            record["acceptance"] = {
                "status": "pass" if status == "pass" else status,
                "complete": status == "pass",
                "separate_full_acceptance_evidence": full_evidence.get("path", "not_supplied"),
                "evidence_sha256": full_evidence.get("sha256"),
                "components": full_acceptance.get("components"),
                "control_latency_budget": full_acceptance.get("control_latency_budget"),
                "identity": full_evidence.get("identity"),
                "reason": (full_check or {}).get("reason") or full_acceptance.get("reason"),
            }
            record["subresults"] = {
                "read_only_dispatch_admission_smoke": {
                    "status": smoke_summary.get("smoke_status", (smoke_check or {}).get("status", "unavailable")),
                    "report": smoke_summary.get("output"),
                    "assertions": smoke_summary.get("assertions"),
                    "fake_clock_status": smoke_summary.get("fake_clock_status"),
                    "stop_status": smoke_summary.get("stop_status"),
                    "v10_acceptance": "not_established",
                },
                "full_acceptance": {
                    "status": (full_check or {}).get("status", "unavailable"),
                    "report": full_evidence.get("path"),
                    "report_sha256": full_evidence.get("sha256"),
                    "components": full_acceptance.get("components"),
                    "control_latency_budget": full_acceptance.get("control_latency_budget"),
                    "identity": full_evidence.get("identity"),
                },
            }
        records.append(record)
    counts = {status: sum(item["status"] == status for item in records) for status in ("pass", "skip", "unavailable", "fail")}
    overall = "pass" if counts["fail"] == 0 and counts["skip"] == 0 and counts["unavailable"] == 0 else "incomplete"
    result = {
        "result_version": "boreal.forensic-audit/2",
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
            "V10 cannot pass on the bounded smoke alone; the full acceptance record must show four complete components and an approved control budget tied to the exact run identity.",
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
