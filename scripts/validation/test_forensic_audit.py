#!/usr/bin/env python3
"""Unit tests for the forensic audit matrix's conservative gate semantics."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER_PATH = ROOT / "scripts/validation/forensic_audit.py"
SPEC = importlib.util.spec_from_file_location("boreal_forensic_audit", RUNNER_PATH)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNNER
SPEC.loader.exec_module(RUNNER)


class ForensicAuditTests(unittest.TestCase):
    def test_tui_forensic_reports_are_written_under_ignored_results_directory(self) -> None:
        fixture = (ROOT / "scripts/validation/tui/forensic_closeout.mjs").read_text()
        self.assertIn(
            'const REPORT_DIR = join(ROOT, "scripts/validation/tui/results");',
            fixture,
        )
        self.assertIn(
            'const REPORT_JSON = join(REPORT_DIR, "forensic-closeout.latest.json");',
            fixture,
        )
        self.assertIn(
            'const REPORT_MD = join(REPORT_DIR, "forensic-closeout.latest.md");',
            fixture,
        )
        ignored_report = subprocess.run(
            [
                "git",
                "check-ignore",
                "--quiet",
                "--",
                "scripts/validation/tui/results/forensic-closeout.latest.json",
            ],
            cwd=ROOT,
            check=False,
        )
        self.assertEqual(ignored_report.returncode, 0)

    def test_matrix_contains_each_blocking_scenario_once(self) -> None:
        matrix = RUNNER.scenarios(online=False)
        self.assertEqual([item.scenario_id for item in matrix], [f"V{index:02d}" for index in range(1, 13)])
        self.assertTrue(all(item.complete_gate for item in matrix))

    def test_partial_checks_cannot_be_classified_as_a_pass(self) -> None:
        matrix = RUNNER.scenarios(online=False)
        self.assertTrue(all(item.complete_gate for item in matrix))
        # The runner's complete flag is deliberately external to the partial
        # command list; a passing unit test is not the production gate.
        self.assertFalse(any(getattr(item, "complete", False) for item in matrix))

    def test_environment_skip_is_distinct_from_failure(self) -> None:
        status, reason = RUNNER.classify_output("BOREAL_VALIDATION_SKIP: no Unix socket", "", 1, timed_out=False)
        self.assertEqual(status, "skip")
        self.assertEqual(reason, "no Unix socket")

    def test_nonzero_without_skip_is_a_failure(self) -> None:
        status, reason = RUNNER.classify_output("", "assertion failed", 1, timed_out=False)
        self.assertEqual(status, "fail")
        self.assertEqual(reason, "exit 1")

    def test_v10_component_status_flags_alone_cannot_pass(self) -> None:
        shallow_pass = {"status": "pass", "complete": True}
        for component in (
            "durable_deadline",
            "full_load",
            "typed_control",
            "stop_recovery",
        ):
            with self.subTest(component=component):
                self.assertFalse(
                    RUNNER.v10_component_evidence_complete(
                        component,
                        shallow_pass,
                        report={},
                        budget={"status": "approved", "source": "owner", "target_ms": 20},
                        budget_document=None,
                        profile_document=None,
                    )
                )

    def test_approved_contract_is_bound_to_artifact_bytes_and_schema(self) -> None:
        document = {
            "schema": "boreal.v10-control-latency-budget/v1",
            "status": "approved",
            "decision_id": "decision-1",
            "approved_by": "owner",
            "approved_at": "2026-10-03T00:00:00Z",
            "contract_version": "1",
            "source": "measured-control-budget",
            "target_ms": 20,
        }
        payload = (json.dumps(document, sort_keys=True) + "\n").encode()
        with tempfile.NamedTemporaryFile(dir=ROOT, suffix=".json", delete=False) as artifact:
            artifact.write(payload)
            artifact_path = Path(artifact.name)
        try:
            reference = {
                "path": artifact_path.relative_to(ROOT).as_posix(),
                "sha256": "sha256:" + hashlib.sha256(payload).hexdigest(),
            }
            self.assertEqual(
                RUNNER.approved_json_contract(
                    reference,
                    schema="boreal.v10-control-latency-budget/v1",
                ),
                document,
            )
            reference["sha256"] = "sha256:" + "0" * 64
            self.assertIsNone(
                RUNNER.approved_json_contract(
                    reference,
                    schema="boreal.v10-control-latency-budget/v1",
                )
            )
        finally:
            artifact_path.unlink(missing_ok=True)

    def test_deadline_pass_requires_a_nonempty_readback_agent_identity(self) -> None:
        component = {
            "status": "pass",
            "complete": True,
            "actor_id": None,
            "attempt_id": "attempt-1",
            "fence": 1,
            "agent_authority_readback": {
                "actor_id": None,
                "role": "agent",
                "authority_granted": True,
            },
            "deadline_crossed_while_service_stopped": True,
            "service_restarted_after_deadline": True,
            "deadline_unix_ms": 10,
            "service_restart_unix_ms": 11,
            "attempt_after_restart": {
                "attempt_id": "attempt-1",
                "fence": True,
                "current": True,
            },
            "attempt_state_after_restart": "expiry_pending",
            "recovery_obligation_readback": True,
            "recovery_obligation": {
                "obligation_id": "obligation-1",
                "attempt_id": "attempt-1",
                "state": "unresolved",
            },
            "resource_ownership_active_after_restart": True,
            "resource_reservation": {"attempt_id": "attempt-1", "state": "active"},
            "stale_fence_rejected": True,
            "stale_fence_response": {
                "exit_code": 2,
                "envelope": {"error": {"code": "stale_fence"}},
            },
        }
        common = {
            "report": {},
            "budget": None,
            "budget_document": None,
            "profile_document": None,
        }
        self.assertFalse(
            RUNNER.v10_component_evidence_complete("durable_deadline", component, **common)
        )
        component["actor_id"] = "agent-1"
        component["agent_authority_readback"]["actor_id"] = "agent-1"
        self.assertFalse(
            RUNNER.v10_component_evidence_complete("durable_deadline", component, **common)
        )
        component["attempt_after_restart"]["fence"] = 1
        self.assertTrue(
            RUNNER.v10_component_evidence_complete("durable_deadline", component, **common)
        )

    def test_full_load_requires_integer_and_reconciled_worker_counts(self) -> None:
        profile_document = {
            "source": "approved-profile",
            "profile_id": "profile-1",
            "worker_target": 2,
            "dispatch_workers_target": 1,
            "dispatch_capacity_target": 2,
            "requests_per_worker_target": 2,
            "minimum_duration_ms": 1,
            "completion_target": 2,
            "starvation_target": 10,
        }
        component = {
            "status": "pass",
            "complete": True,
            "approved_profile": {
                "status": "approved",
                "source": "approved-profile",
                "profile_id": "profile-1",
                **{key: value for key, value in profile_document.items() if key.endswith("target") or key == "minimum_duration_ms"},
            },
            "observed_profile": {
                "workers": 2,
                "dispatch_workers": 1,
                "dispatch_capacity": 2,
                "requests_per_worker": 2,
                "observed_duration_ms": 2.5,
                "successful_responses": 2,
                "requests_started": 4,
                "failed_or_unavailable_responses": 2,
                "workers_with_successful_responses": 2,
                "workers_with_zero_successful_responses": 0,
                "observed_max_success_progress_gap_ms": 5.0,
                "observed_starvation_workers_with_zero_progress": 0,
                "worker_progress": {
                    "0": {"requests_completed": 2, "successful_responses": 1, "max_success_progress_gap_ms": 4.0},
                    "1": {"requests_completed": 2, "successful_responses": 1, "max_success_progress_gap_ms": 5.0},
                },
            },
        }
        common = {
            "report": {},
            "budget": None,
            "budget_document": None,
            "profile_document": profile_document,
        }
        self.assertTrue(RUNNER.v10_component_evidence_complete("full_load", component, **common))
        component["observed_profile"]["dispatch_capacity"] = 1.5
        self.assertFalse(RUNNER.v10_component_evidence_complete("full_load", component, **common))
        component["observed_profile"]["dispatch_capacity"] = 2
        component["observed_profile"]["successful_responses"] = 3
        self.assertFalse(RUNNER.v10_component_evidence_complete("full_load", component, **common))

        component["observed_profile"]["successful_responses"] = 4
        component["observed_profile"]["failed_or_unavailable_responses"] = 0
        component["observed_profile"]["worker_progress"]["0"]["successful_responses"] = 3
        self.assertFalse(RUNNER.v10_component_evidence_complete("full_load", component, **common))


if __name__ == "__main__":
    unittest.main()
