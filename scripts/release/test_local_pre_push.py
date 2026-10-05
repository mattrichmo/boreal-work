"""Tests for the offline local pre-push runner's receipt boundaries."""

from __future__ import annotations

import importlib.util
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
RUNNER_PATH = ROOT / "scripts/release/local_pre_push.py"
SPEC = importlib.util.spec_from_file_location("boreal_local_pre_push", RUNNER_PATH)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNNER
SPEC.loader.exec_module(RUNNER)


class LocalPrePushTests(unittest.TestCase):
    def test_temp_root_symlink_into_checkout_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(dir=ROOT) as temporary:
            alias = Path(temporary) / "tmp-alias"
            alias.symlink_to(ROOT / "scripts", target_is_directory=True)
            with patch.object(RUNNER.tempfile, "gettempdir", return_value=str(alias)):
                environment = RUNNER.clean_environment()

        scratch = Path(environment["TMPDIR"])
        try:
            self.assertTrue(RUNNER.is_outside_repository(scratch))
            self.assertNotEqual(scratch.resolve(), (ROOT / "scripts").resolve())
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    def test_missing_manifest_after_successful_generator_has_no_exit_code(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            scratch = Path(temporary) / "scratch"
            scratch.mkdir()
            environment = {
                "TMPDIR": str(scratch),
                "CARGO_NET_OFFLINE": "true",
            }
            with patch.object(RUNNER, "clean_environment", return_value=environment), patch.object(
                RUNNER.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=0, stdout="", stderr=""),
            ):
                result = RUNNER.run_workspace_tests(timeout_seconds=1)

        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["setup_exit_code"], 0)
        self.assertIsNone(result["exit_code"])
        self.assertIn("did not create", result["stderr_tail"])

    def test_check_removes_its_temporary_parent_directory(self) -> None:
        created: dict[str, str] = {}
        real_clean_environment = RUNNER.clean_environment

        def capture_environment() -> dict[str, str]:
            environment = real_clean_environment()
            created["scratch"] = environment["TMPDIR"]
            return environment

        with patch.object(RUNNER, "git", return_value="a" * 40), patch.object(
            RUNNER, "clean_environment", side_effect=capture_environment
        ), patch.object(
            RUNNER.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0, stdout="ok", stderr=""),
        ):
            result = RUNNER.run_check("fixture", ["local-command"], timeout_seconds=1)

        self.assertEqual(result["status"], "pass")
        self.assertFalse(Path(created["scratch"]).exists())

    def test_receipt_order_matches_execution_order(self) -> None:
        checks = [
            ("first", ["first"], 1),
            ("rust tests (offline; generated source-bound fixture)", ["cargo"], 2),
            ("last", ["last"], 3),
        ]
        events: list[str] = []

        def fake_check(name: str, _command: list[str], _timeout: int) -> dict:
            events.append(name)
            return {"name": name, "status": "pass"}

        def fake_workspace(_timeout: int) -> dict:
            events.append("rust tests (offline; generated source-bound fixture)")
            return {"name": events[-1], "status": "pass"}

        with patch.object(RUNNER, "run_check", side_effect=fake_check), patch.object(
            RUNNER, "run_workspace_tests", side_effect=fake_workspace
        ):
            results = RUNNER.execute_checks(checks, source_is_clean=True)

        self.assertEqual(events, ["first", "rust tests (offline; generated source-bound fixture)", "last"])
        self.assertEqual([result["name"] for result in results], events)

    def test_absent_v10_harness_is_explicitly_not_applicable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts/validation").mkdir(parents=True)
            with patch.object(RUNNER, "ROOT", root):
                result = RUNNER.execute_checks(
                    [("V10 harness unit tests", ["python", "-m", "unittest"], 1)],
                    source_is_clean=True,
                )

        self.assertEqual(result[0]["status"], "not_applicable")
        self.assertIn("no V10 harness", result[0]["reason"])
        self.assertTrue(RUNNER.checks_pass(result))
        self.assertFalse(RUNNER.checks_pass([{"status": "fail"}]))


if __name__ == "__main__":
    unittest.main()
