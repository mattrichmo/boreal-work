#!/usr/bin/env python3
"""Unit tests for the forensic audit matrix's conservative gate semantics."""

from __future__ import annotations

import importlib.util
import sys
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


if __name__ == "__main__":
    unittest.main()
