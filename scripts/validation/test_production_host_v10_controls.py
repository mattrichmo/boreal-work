#!/usr/bin/env python3
"""Synthetic tests for V10 approval gates and evidence collection helpers."""

from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
HOST_PATH = ROOT / "scripts/validation/concurrency/production_host.py"
SPEC = importlib.util.spec_from_file_location("boreal_production_host_v10", HOST_PATH)
assert SPEC and SPEC.loader
HOST = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HOST
SPEC.loader.exec_module(HOST)


class V10ControlHarnessTests(unittest.TestCase):
    def valid_saturation_result(self, **changes: object) -> dict:
        assertions = {name: True for name in HOST.SATURATION_ASSERTION_FIELDS}
        assertions["passed"] = True
        result = {
            "normal_requests": 4,
            "normal_client_concurrency_limit": 4,
            "normal_max_in_flight_client_processes": 4,
            "normal_elapsed_ms": 18.0,
            "normal_outcomes": {
                "changed": 0,
                "unchanged": 0,
                "rejected": 0,
                "failed": 4,
                "unknown": 0,
            },
            "normal_error_codes": ["service_busy"] * 4,
            "dispatch_full_responses": 4,
            "dispatch_full_error_details": [
                {"code": "service_busy", "message": "dispatch queue is full", "count": 4}
            ],
            "dispatch_full_responses_before_control": 4,
            "control": {
                "outcome": "unchanged",
                "exit_code": 0,
                "error": None,
                "request_started_after_smoke_start_ms": 5.0,
                "response_completed_after_smoke_start_ms": 6.0,
                "latency_ms": 1.0,
                "normal_clients_active_at_request_start": 1,
                "normal_clients_active_at_response": 1,
                "overlapping_normal_client_count": 1,
                "overlapped_normal_clients": True,
                "dispatch_full_responses_before_request": 4,
                "response_received": True,
            },
            "assertions": assertions,
            "production_boundary": "synthetic separate CLI clients",
            "saturation_scope": "synthetic fixture",
        }
        result.update(changes)
        return result

    def test_null_saturation_result_is_reported_as_a_fail_closed_result(self) -> None:
        result = HOST.normalize_saturation_report(None)

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn("saturation_result_missing_or_not_an_object", result["report_integrity"]["issues"])
        self.assertFalse(result["assertions"]["passed"])
        self.assertEqual(result["dispatch_full_responses"], 0)
        self.assertEqual(result["dispatch_full_error_details"], [])
        self.assertEqual(HOST._typed_dispatch_busy_details(None), [])
        self.assertIsNone(HOST._within_target(None, 20.0))
        report = {
            "queue_and_control": {**result},
            "control_response": result["control"],
            "observed_error_codes": result["normal_error_codes"],
            "assertions": result["assertions"],
        }
        json.dumps(report)

    def test_null_dispatch_full_error_details_become_an_explicit_failed_report(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(dispatch_full_error_details=None)
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "dispatch_full_error_details_missing_or_invalid",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])
        self.assertEqual(result["dispatch_full_error_details"], [])
        self.assertEqual(HOST._typed_dispatch_busy_details(result["dispatch_full_error_details"]), [])
        json.dumps({"queue_and_control": {**result}})

    def test_null_error_details_and_entries_cannot_crash_or_pass_the_report(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(
                dispatch_full_error_details=[
                    None,
                    {"code": "service_busy", "message": None, "count": 1},
                    {"code": "service_busy", "message": "dispatch queue is full", "count": 2},
                ],
                control={"latency_ms": None, "response_received": False},
            )
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertFalse(result["assertions"]["passed"])
        self.assertEqual(len(result["dispatch_full_error_details"]), 1)
        self.assertEqual(
            HOST._typed_dispatch_busy_details(result["dispatch_full_error_details"]),
            result["dispatch_full_error_details"],
        )
        self.assertIsNone(HOST._within_target(result["control"]["latency_ms"], 20.0))
        json.dumps(result)

    def test_valid_saturation_report_keeps_its_observed_pass(self) -> None:
        result = HOST.normalize_saturation_report(self.valid_saturation_result())

        self.assertEqual(result["report_integrity"]["status"], "pass")
        self.assertTrue(result["assertions"]["passed"])
        self.assertEqual(len(HOST._typed_dispatch_busy_details(result["dispatch_full_error_details"])), 1)

    def test_missing_nested_control_fields_fail_closed_even_if_assertions_claim_pass(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(control={})
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn("control_response_received_missing", result["report_integrity"]["issues"])
        self.assertFalse(result["assertions"]["passed"])
        self.assertFalse(result["assertions"]["control_response_received"])

    def test_null_nested_control_field_fails_closed(self) -> None:
        control = self.valid_saturation_result()["control"]
        control["response_received"] = None
        result = HOST.normalize_saturation_report(self.valid_saturation_result(control=control))

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn("control_response_received_missing_or_invalid", result["report_integrity"]["issues"])
        self.assertFalse(result["assertions"]["passed"])

    def test_control_metrics_cannot_contradict_assertion_flags(self) -> None:
        control = self.valid_saturation_result()["control"]
        control["response_received"] = False
        control["exit_code"] = 1
        result = HOST.normalize_saturation_report(self.valid_saturation_result(control=control))

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "saturation_assertion_control_response_received_conflicts_with_control",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])
        self.assertFalse(result["assertions"]["control_response_received"])

    def test_nested_and_top_level_dispatch_control_counts_must_match(self) -> None:
        control = self.valid_saturation_result()["control"]
        control["dispatch_full_responses_before_request"] = 3
        result = HOST.normalize_saturation_report(self.valid_saturation_result(control=control))

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "control_dispatch_full_responses_conflict_with_top_level",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def test_dispatch_detail_counts_must_match_the_total(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(
                dispatch_full_responses=5,
                dispatch_full_responses_before_control=4,
            )
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "dispatch_full_error_details_count_conflicts_with_total",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def test_dispatch_error_detail_messages_must_describe_queue_full(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(
                dispatch_full_error_details=[
                    {"code": "service_busy", "message": "unrelated error", "count": 4}
                ]
            )
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "dispatch_full_error_detail_entry_missing_or_invalid",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def test_dispatch_error_code_counts_must_exist_in_normal_error_codes(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(normal_error_codes=["service_busy"])
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "dispatch_full_error_codes_exceed_normal_error_codes",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def test_before_control_count_cannot_exceed_total_dispatch_count(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(
                dispatch_full_responses=3,
                dispatch_full_responses_before_control=4,
            )
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "dispatch_full_responses_before_control_exceeds_total",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def test_dispatch_count_cannot_exceed_normal_request_count(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(normal_requests=3)
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "dispatch_full_responses_exceeds_normal_requests",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def test_normal_outcome_counts_must_cover_every_request(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(
                normal_outcomes={
                    "changed": 0,
                    "unchanged": 0,
                    "rejected": 0,
                    "failed": 3,
                    "unknown": 0,
                }
            )
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "normal_outcome_counts_conflict_with_request_count",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def test_normal_client_concurrency_measurements_must_be_bounded(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(
                normal_client_concurrency_limit=2,
                control={
                    **self.valid_saturation_result()["control"],
                    "normal_clients_active_at_request_start": 3,
                },
            )
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "control_active_at_request_start_exceeds_concurrency_limit",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def test_recorded_maximum_allows_the_single_control_client(self) -> None:
        control = self.valid_saturation_result()["control"]
        control.update(
            {
                "normal_clients_active_at_request_start": 64,
                "normal_clients_active_at_response": 64,
                "overlapping_normal_client_count": 64,
            }
        )
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(
                normal_requests=64,
                normal_client_concurrency_limit=64,
                normal_max_in_flight_client_processes=65,
                normal_outcomes={
                    "changed": 0,
                    "unchanged": 0,
                    "rejected": 0,
                    "failed": 64,
                    "unknown": 0,
                },
                control=control,
            )
        )

        self.assertEqual(result["report_integrity"]["status"], "pass")
        self.assertTrue(result["assertions"]["passed"])

    def test_control_active_snapshots_cannot_exceed_recorded_maximum(self) -> None:
        control = self.valid_saturation_result()["control"]
        control["normal_clients_active_at_request_start"] = 3
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(
                normal_max_in_flight_client_processes=2,
                control=control,
            )
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "control_active_at_request_start_exceeds_recorded_maximum",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def test_control_response_must_complete_before_normal_workload_ends(self) -> None:
        result = HOST.normalize_saturation_report(
            self.valid_saturation_result(
                normal_elapsed_ms=5.0,
                control={
                    **self.valid_saturation_result()["control"],
                    "request_started_after_smoke_start_ms": 4.0,
                    "response_completed_after_smoke_start_ms": 6.0,
                    "latency_ms": 2.0,
                },
            )
        )

        self.assertEqual(result["report_integrity"]["status"], "fail")
        self.assertIn(
            "control_response_completes_after_normal_workload",
            result["report_integrity"]["issues"],
        )
        self.assertFalse(result["assertions"]["passed"])

    def budget(self, **changes: object) -> dict:
        return {
            "source": "synthetic-owner-budget",
            "target_ms": 20.0,
            "max_sample_ms": 100.0,
            "sample_count": 4,
            "interval_ms": 500,
            "statistic": "p95",
            **changes,
        }

    def samples(self) -> list[dict]:
        return [
            {
                "index": index,
                "scheduled_after_window_start_ms": index * 500,
                "started_at_monotonic_ns": 1_000_000 + index * 500_000_000,
                "sample_window_started_monotonic_ns": 1_000_000,
                "scheduled_at_monotonic_ns": 1_000_000 + index * 500_000_000,
                "cadence_lag_ms": 0.0,
                "actual_interval_ms": None if index == 0 else 500.0,
                "cadence_tolerance_ms": 25.0,
                "cadence_within_tolerance": True,
                "latency_ms": latency,
                "response_received": True,
                "normal_clients_active_at_request_start": 3,
                "normal_clients_active_at_response": 2,
            }
            for index, latency in enumerate((5.0, 7.0, 10.0, 15.0))
        ]

    def test_p95_uses_all_samples_and_nearest_rank(self) -> None:
        result = HOST.aggregate_control_samples(self.samples(), self.budget())
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["latency_ms"], 15.0)
        self.assertEqual(result["max_latency_ms"], 15.0)
        self.assertTrue(result["samples_complete"])

    def test_aggregation_rejects_missing_or_inactive_samples_and_nonfinite_budget(self) -> None:
        samples = self.samples()
        self.assertEqual(HOST.aggregate_control_samples(samples[:-1], self.budget())["status"], "fail")
        samples[2]["normal_clients_active_at_response"] = 0
        self.assertEqual(HOST.aggregate_control_samples(samples, self.budget())["status"], "fail")
        self.assertEqual(HOST.aggregate_control_samples(self.samples(), self.budget(target_ms=math.inf))["status"], "fail")
        self.assertEqual(HOST.aggregate_control_samples(self.samples(), self.budget(interval_ms=True))["status"], "fail")

    def test_aggregation_rejects_samples_bunched_outside_approved_cadence(self) -> None:
        samples = self.samples()
        samples[2]["started_at_monotonic_ns"] += 40_000_000
        samples[2]["cadence_lag_ms"] = 40.0
        samples[2]["actual_interval_ms"] = 540.0
        samples[3]["started_at_monotonic_ns"] += 40_000_000
        samples[3]["cadence_lag_ms"] = 40.0
        samples[3]["actual_interval_ms"] = 500.0
        self.assertEqual(HOST.aggregate_control_samples(samples, self.budget())["status"], "fail")

    def test_control_budget_requires_owner_values_with_finite_limits(self) -> None:
        HOST.validate_control_budget(self.budget())
        for invalid in (
            self.budget(target_ms=math.inf),
            self.budget(max_sample_ms=0),
            self.budget(sample_count=True),
            self.budget(interval_ms=0),
            self.budget(statistic="mean"),
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(RuntimeError):
                    HOST.validate_control_budget(invalid)

    def test_approval_loader_binds_bytes_and_rejects_symlink_artifact(self) -> None:
        document = {
            "schema": HOST.V10_CONTROL_BUDGET_SCHEMA,
            "status": "approved",
            "decision_id": "synthetic-decision",
            "approved_by": "synthetic-owner",
            "approved_at": "2026-10-04T00:00:00Z",
            "contract_version": "1",
            **self.budget(),
        }
        with tempfile.TemporaryDirectory(dir=ROOT) as directory:
            directory_path = Path(directory)
            artifact = directory_path / "budget.json"
            artifact.write_text(json.dumps(document), encoding="utf-8")
            loaded, ref = HOST.load_approved_artifact(
                artifact.relative_to(ROOT), schema=HOST.V10_CONTROL_BUDGET_SCHEMA
            )
            self.assertEqual(loaded, document)
            self.assertEqual(ref["path"], artifact.relative_to(ROOT).as_posix())
            symlink = directory_path / "budget-link.json"
            symlink.symlink_to(artifact)
            with self.assertRaises(RuntimeError):
                HOST.load_approved_artifact(
                    symlink.relative_to(ROOT), schema=HOST.V10_CONTROL_BUDGET_SCHEMA
                )

    def test_linux_and_macos_clock_shim_flags_are_selected_without_real_compile(self) -> None:
        for operating_system, expected_suffix, expected_library in (
            ("Linux", ".so", "-ldl"),
            ("Darwin", ".dylib", None),
        ):
            with tempfile.TemporaryDirectory() as directory:
                with patch.object(HOST.platform, "system", return_value=operating_system), patch.object(
                    HOST.subprocess, "run", return_value=type("Result", (), {"returncode": 0, "stderr": ""})()
                ) as run:
                    shim, reason = HOST.compile_clock_shim(Path(directory))
                self.assertIsNone(reason)
                self.assertEqual(shim.suffix, expected_suffix)
                argv = run.call_args.args[0]
                self.assertIn("-shared" if operating_system == "Linux" else "-dynamiclib", argv)
                if expected_library:
                    self.assertLess(argv.index(str(HOST.SHIM_SOURCE)), argv.index(expected_library))

    def test_multi_sample_probe_uses_mock_clients_and_records_real_overlap_fields(self) -> None:
        registry_lock = threading.Lock()
        sequence = [100]

        class Process:
            def poll(self):
                return None

        def fake_client(binary, socket_path, project, args, *, active_processes=None,
                        active_process_lock=None, active_process_max=None, **kwargs):
            with registry_lock:
                sequence[0] += 1
                pid = sequence[0]
                if active_processes is not None:
                    active_processes[pid] = Process()
                    if active_process_max is not None:
                        active_process_max[0] = max(active_process_max[0], len(active_processes))
            started_ns = time.monotonic_ns()
            is_control = args == ["status", "--limit", "1", "--offset", "0"]
            time.sleep(0.03 + (pid % 4) * 0.004)
            completed_ns = time.monotonic_ns()
            with registry_lock:
                if active_processes is not None:
                    active_processes.pop(pid, None)
            error = None if is_control else {"code": "service_busy", "message": "dispatch queue is full"}
            return {
                "exit_code": 0 if is_control else 2,
                "envelope": {"error": error},
                "client_process_started_at": time.perf_counter(),
                "client_process_started_monotonic_ns": started_ns,
                "client_process_completed_at": time.perf_counter(),
                "client_process_completed_monotonic_ns": completed_ns,
            }

        with patch.object(HOST, "client", side_effect=fake_client):
            result = HOST.run_multi_sample_control_probe(
                Path("bwrk"),
                Path("service.sock"),
                "project",
                Path("."),
                worker_count=4,
                budget=self.budget(sample_count=3, interval_ms=200),
            )
        self.assertEqual(result["sample_count"], 3)
        self.assertTrue(result["typed_service_busy_observed"])
        self.assertTrue(all(sample["response_received"] for sample in result["samples"]))
        active_at_start = [sample["normal_clients_active_at_request_start"] for sample in result["samples"]]
        self.assertTrue(all(type(count) is int and count >= 0 for count in active_at_start))
        self.assertGreater(max(active_at_start), 0)

    def test_post_restart_readback_never_sends_a_mutating_stale_fence_probe(self) -> None:
        calls = []
        fixture = {
            "project_id": "dispatch-smoke-project",
            "actor_id": HOST.DISPOSABLE_AGENT_ID,
            "harness_id": HOST.DISPOSABLE_AGENT_HARNESS_ID,
            "session_id": HOST.DISPOSABLE_AGENT_SESSION_ID,
            "work_id": HOST.DISPOSABLE_AGENT_WORK_ID,
        }
        attempt = {"attempt_id": "attempt-1", "fence": 1, "phase": "running"}

        def response(data):
            return {"exit_code": 0, "envelope": {"data": data, "error": None}}

        def credentialed_invoke(binary, args, *, cwd, credential):
            calls.append(tuple(args))
            if args[:2] == ["recovery", "list"]:
                return response({"items": []})
            if args[:2] == ["reservation", "list"]:
                return response({"items": [{"attempt_id": "attempt-1", "state": "active"}]})
            raise AssertionError(f"unexpected command: {args}")

        def read_credential(root, project_id, actor_id):
            self.assertEqual((project_id, actor_id), (fixture["project_id"], fixture["actor_id"]))
            return "synthetic-fixture-credential"

        def client_fn(binary, socket_path, project, args, *, cwd, credential=None):
            calls.append(tuple(args))
            self.assertEqual(credential, "synthetic-fixture-credential")
            if args[:2] == ["agent", "resume"]:
                return response({
                    "context": {
                        "mode": "resume", "project_id": fixture["project_id"],
                        "actor_id": fixture["actor_id"], "harness_id": fixture["harness_id"],
                        "session_id": fixture["session_id"],
                    },
                    "status": {
                        "work_id": fixture["work_id"], "attempt_id": "attempt-1", "fence": 1,
                    },
                })
            if args[0] == "status":
                return response({"items": [{"work_id": fixture["work_id"], "attempt": attempt}]})
            if args[:2] == ["work", "show"]:
                return response({"work_id": fixture["work_id"]})
            raise AssertionError(f"unexpected service command: {args}")

        with patch.object(HOST, "_read_standard_credential", side_effect=read_credential), patch.object(
            HOST, "invoke_with_credential", side_effect=credentialed_invoke
        ):
            result = HOST.read_disposable_agent_recovery(
                Path("bwrk"), Path("socket.sock"), Path("boreal.sqlite"), Path("."), fixture,
                {"attempt_id": "attempt-1", "fence": 1, "deadline_unix_ms": 2000},
                service_exited_at_unix_ms=1000,
                service_restart_unix_ms=3000,
                client_fn=client_fn,
            )
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["attempt_state_after_restart"], "running")
        self.assertTrue(result["attempt_after_restart"]["current"])
        self.assertEqual(result["agent_authority_readback"]["readback_command"], "agent resume")
        self.assertIsNone(result["stale_fence_response"])
        self.assertIn("authorization permits claim/readback only", result["stale_fence_probe"])
        self.assertFalse(any(command[:2] == ("agent", "release") for command in calls))


if __name__ == "__main__":
    unittest.main()
