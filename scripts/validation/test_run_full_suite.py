#!/usr/bin/env python3
"""Unit tests for the aggregate validation runner's gate classification."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER_PATH = ROOT / "scripts/validation/run_full_suite.py"
SPEC = importlib.util.spec_from_file_location("boreal_run_full_suite", RUNNER_PATH)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class RunCheckTests(unittest.TestCase):
    def test_pass_writes_stdout_and_stderr_logs(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-runner-test-") as directory:
            log_dir = Path(directory)
            result = RUNNER.run_check(
                "passing-check",
                [
                    sys.executable,
                    "-c",
                    "import sys; print('stdout'); print('stderr', file=sys.stderr)",
                ],
                log_dir,
            )

            self.assertEqual(result["status"], "pass")
            self.assertEqual(result["exit_code"], 0)
            self.assertEqual(
                (log_dir / "passing-check.stdout.log").read_text(encoding="utf-8").strip(),
                "stdout",
            )
            self.assertEqual(
                (log_dir / "passing-check.stderr.log").read_text(encoding="utf-8").strip(),
                "stderr",
            )

    def test_socket_denial_is_detected_in_stdout_or_stderr(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-runner-test-") as directory:
            result = RUNNER.run_check(
                "socket-check",
                [sys.executable, "-c", "import sys; print('listen EPERM: socket'); sys.exit(1)"],
                Path(directory),
            )

            self.assertEqual(result["status"], "skip")
            self.assertEqual(result["reason"], "sandbox denied Unix socket creation")

    def test_timeout_is_a_failure_with_a_bounded_reason(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-runner-test-") as directory:
            result = RUNNER.run_check(
                "hung-check",
                [sys.executable, "-c", "import time; time.sleep(1)"],
                Path(directory),
                timeout_seconds=0.01,
            )

            self.assertEqual(result["status"], "fail")
            self.assertEqual(result["exit_code"], 124)
            self.assertEqual(result["reason"], "timed out after 0.01s")

    def test_explicit_child_skip_is_visible_to_strict_policy(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-runner-test-") as directory:
            result = RUNNER.run_check(
                "explicit-skip",
                [sys.executable, "-c", "print('BOREAL_VALIDATION_SKIP: no socket')"],
                Path(directory),
            )

            self.assertEqual(result["status"], "skip")
            self.assertEqual(result["reason"], "child check reported an environment skip")

    def test_sqlite_floor_failure_is_named_in_the_aggregate_report(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-runner-test-") as directory:
            result = RUNNER.run_check(
                "release-performance",
                [
                    sys.executable,
                    "-c",
                    "import sys; print('linked SQLite is below the required 3.51.3 release floor', file=sys.stderr); sys.exit(2)",
                ],
                Path(directory),
            )

            self.assertEqual(result["status"], "fail")
            self.assertEqual(
                result["reason"],
                "linked SQLite runtime is below the required 3.51.3 release floor",
            )

    def test_missing_binary_cannot_supply_black_box_evidence(self) -> None:
        result = RUNNER.binary_freshness(Path("/tmp/boreal-validation-binary-that-does-not-exist"))
        self.assertEqual(result["status"], "fail")
        self.assertIn("binary is missing", result["reason"])


if __name__ == "__main__":
    unittest.main()
