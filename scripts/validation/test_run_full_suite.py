#!/usr/bin/env python3
"""Unit tests for the aggregate validation runner's gate classification."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch


ROOT = Path(__file__).resolve().parents[2]
RUNNER_PATH = ROOT / "scripts/validation/run_full_suite.py"
SPEC = importlib.util.spec_from_file_location("boreal_run_full_suite", RUNNER_PATH)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)
PTY_SMOKE_PATH = ROOT / "scripts/validation/global-tui/pty_smoke.py"
PTY_SPEC = importlib.util.spec_from_file_location("boreal_global_tui_pty_smoke", PTY_SMOKE_PATH)
assert PTY_SPEC and PTY_SPEC.loader
PTY_SMOKE = importlib.util.module_from_spec(PTY_SPEC)
PTY_SPEC.loader.exec_module(PTY_SMOKE)


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

    def test_oracle_manifest_is_external_and_scoped_to_workspace_cargo(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-runner-test-") as directory:
            log_dir = Path(directory)
            manifest_paths: list[Path] = []
            seen_environments: list[tuple[str, dict[str, str]]] = []

            def fake_run(
                command: list[str], **kwargs: dict[str, object]
            ) -> subprocess.CompletedProcess[str]:
                environment = kwargs["env"]
                assert isinstance(environment, dict)
                if command[0] == sys.executable:
                    manifest = Path(command[-1])
                    manifest_paths.append(manifest)
                    seen_environments.append(("generator", environment))
                    manifest.write_text("generated oracle manifest\n", encoding="utf-8")
                    return subprocess.CompletedProcess(command, 0, "", "")

                if command[0] == "cargo":
                    seen_environments.append(("cargo", environment))
                    manifest = Path(environment[RUNNER.ORACLE_MANIFEST_ENV])
                    self.assertTrue(manifest.is_file())
                    self.assertNotEqual(manifest, RUNNER.ROOT)
                    self.assertNotIn(RUNNER.ROOT.resolve(), manifest.resolve().parents)
                    return subprocess.CompletedProcess(command, 0, "workspace tests passed\n", "")

                seen_environments.append(("unrelated", environment))
                self.assertNotIn(RUNNER.ORACLE_MANIFEST_ENV, environment)
                return subprocess.CompletedProcess(command, 0, "unrelated check passed\n", "")

            with (
                patch.dict(os.environ, {RUNNER.ORACLE_MANIFEST_ENV: "ambient-stale-manifest"}),
                patch.object(RUNNER.subprocess, "run", side_effect=fake_run),
            ):
                result = RUNNER.run_workspace_check(
                    ["cargo", "test", "--workspace", "--locked"],
                    log_dir,
                    timeout_seconds=10,
                )
                unrelated = RUNNER.run_check("unrelated-check", ["example"], log_dir)

            self.assertEqual(result["status"], "pass")
            self.assertTrue(result["oracle_manifest_external"])
            self.assertEqual(unrelated["status"], "pass")
            self.assertEqual([name for name, _ in seen_environments], ["generator", "cargo", "unrelated"])
            self.assertNotIn(RUNNER.ORACLE_MANIFEST_ENV, seen_environments[0][1])
            self.assertNotIn(RUNNER.ORACLE_MANIFEST_ENV, seen_environments[2][1])
            self.assertEqual(
                seen_environments[1][1][RUNNER.ORACLE_MANIFEST_ENV],
                str(manifest_paths[0].resolve()),
            )
            self.assertFalse(
                manifest_paths[0].exists(),
                "temporary manifest should be removed after the test",
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

    def test_global_tui_sources_participate_in_binary_freshness(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-runner-freshness-") as directory:
            root = Path(directory)
            (root / "Cargo.toml").write_text("", encoding="utf-8")
            (root / "Cargo.lock").write_text("", encoding="utf-8")
            source = root / "apps/global-tui/src/entrypoint.ts"
            source.parent.mkdir(parents=True)
            source.write_text("// global tui source\n", encoding="utf-8")
            binary = root / "bwrk"
            binary.write_bytes(b"validation binary")
            old = 100.0
            newest = old + 10.0
            os.utime(binary, (old, old))
            os.utime(source, (newest, newest))

            with patch.object(RUNNER, "ROOT", root):
                result = RUNNER.binary_freshness(binary)

        self.assertEqual(result["status"], "fail")
        self.assertIn("older than current Rust/TypeScript source", result["reason"])

    def test_global_tui_gates_run_in_smoke_and_pty_is_full_only(self) -> None:
        binary = Path("/tmp/bwrk")
        smoke = RUNNER.global_tui_check_specs("smoke", binary)
        full = RUNNER.global_tui_check_specs("full", binary)

        self.assertEqual(
            [label for label, _ in smoke],
            ["global-tui-typecheck", "global-tui-tests"],
        )
        self.assertEqual(
            [label for label, _ in full],
            ["global-tui-typecheck", "global-tui-tests", "global-tui-pty"],
        )
        self.assertIn("scripts/validation/global-tui/pty_smoke.py", full[-1][1])
        self.assertNotIn("/private/tmp", " ".join(full[-1][1]))

    def test_non_posix_import_and_platform_skip_do_not_load_pty_modules(self) -> None:
        real_import = __import__

        def without_posix_pty(name: str, *args: object, **kwargs: object) -> object:
            if name.split(".", 1)[0] in {"fcntl", "pty", "termios"}:
                raise AssertionError(f"platform-only module imported before POSIX check: {name}")
            return real_import(name, *args, **kwargs)

        portable_spec = importlib.util.spec_from_file_location(
            "boreal_global_tui_pty_smoke_portable", PTY_SMOKE_PATH
        )
        assert portable_spec and portable_spec.loader
        portable_module = importlib.util.module_from_spec(portable_spec)
        with patch("builtins.__import__", side_effect=without_posix_pty):
            portable_spec.loader.exec_module(portable_module)

        output = io.StringIO()
        with (
            patch.object(portable_module.os, "name", "nt"),
            patch.object(portable_module.sys, "argv", ["pty_smoke.py"]),
            contextlib.redirect_stdout(output),
        ):
            self.assertEqual(portable_module.main(), 0)
        self.assertIn("requires POSIX", output.getvalue())

    def test_child_waits_are_nonblocking_and_capped(self) -> None:
        monotonic = iter((0.0, 0.1, 0.4, 0.8, 1.01))
        with patch.object(PTY_SMOKE.os, "waitpid", return_value=(0, 0)) as waitpid, patch.object(
            PTY_SMOKE.time, "monotonic", side_effect=lambda: next(monotonic)
        ), patch.object(PTY_SMOKE.time, "sleep"):
            self.assertFalse(PTY_SMOKE.wait_for_child(41, 1.0))

        self.assertEqual(waitpid.call_count, 4)
        self.assertEqual(
            waitpid.call_args_list,
            [call(41, PTY_SMOKE.os.WNOHANG)] * 4,
        )

    def test_child_cleanup_escalates_without_unbounded_waitpid(self) -> None:
        with patch.object(PTY_SMOKE.os, "kill") as kill, patch.object(
            PTY_SMOKE, "wait_for_child", side_effect=(False, True)
        ) as wait_for_child:
            PTY_SMOKE.stop_child(42)

        self.assertEqual(
            kill.call_args_list,
            [call(42, PTY_SMOKE.signal.SIGTERM), call(42, PTY_SMOKE.signal.SIGKILL)],
        )
        self.assertEqual(wait_for_child.call_args_list, [call(42, 0.75), call(42, 0.75)])

    def test_cleanup_continues_after_child_stop_failure(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-pty-cleanup-") as directory:
            socket_path = Path(directory) / "service.sock"
            socket_path.touch()
            service = object()

            with (
                patch.object(PTY_SMOKE, "stop_child", side_effect=RuntimeError("child stuck")),
                patch.object(PTY_SMOKE.os, "close") as close,
                patch.object(PTY_SMOKE, "stop_service") as stop_service,
                self.assertRaisesRegex(RuntimeError, "child stuck"),
            ):
                PTY_SMOKE.cleanup_resources(43, 17, service, socket_path)  # type: ignore[arg-type]

            close.assert_called_once_with(17)
            stop_service.assert_called_once_with(service)
            self.assertFalse(socket_path.exists())


if __name__ == "__main__":
    unittest.main()
