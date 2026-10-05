from __future__ import annotations

import hashlib
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


sys.path.insert(0, str(Path(__file__).parent / "concurrency"))
import production_host as host  # noqa: E402


class AgentInputFixtures(unittest.TestCase):
    def setUp(self) -> None:
        self._verify_agent_cli = host.verify_agent_cli
        verify_cli = mock.patch.object(
            host,
            "verify_agent_cli",
            return_value=(
                Path("fixture-bwrk"),
                {"build_revision": "fixture-revision", "sha256": "fixture-sha256"},
            ),
        )
        verify_cli.start()
        self.addCleanup(verify_cli.stop)
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.project_root = self.root / "project"
        credentials_dir = self.project_root / ".boreal" / "credentials"
        credentials_dir.mkdir(parents=True)
        os.chmod(self.project_root / ".boreal", 0o700)
        os.chmod(credentials_dir, 0o700)
        self.actor_id = "fixture-agent"
        self.project_id = "fixture-project"
        self.secret = "bwrk1_fixture_secret_do_not_report"
        self.credential_path = credentials_dir / (
            "sha256-" + hashlib.sha256(self.actor_id.encode()).hexdigest() + ".json"
        )
        self._write_private_json(
            self.credential_path,
            {
                "schema_version": "boreal.local-credential.v1",
                "project_id": self.project_id,
                "actor_id": self.actor_id,
                "credential": self.secret,
            },
        )
        self.descriptor_path = self.root / "agent-input.json"
        self.descriptor = {
            "schema_version": host.AGENT_INPUT_SCHEMA,
            "project_id": self.project_id,
            "actor_id": self.actor_id,
            "project_root": str(self.project_root),
            "work_id": "work-fixture",
            "source_version_id": "sha256:source-fixture",
            "config_identity": "sha256:config-fixture",
            "session_id": "session-fixture",
            "harness_id": "harness-fixture",
            "attempt_id": "attempt-existing-fixture",
            "fence": 7,
        }
        self.write_descriptor()

    def tearDown(self) -> None:
        self.directory.cleanup()

    def _write_private_json(self, path: Path, value: dict) -> None:
        path.write_text(json.dumps(value), encoding="utf-8")
        os.chmod(path, 0o600)

    def write_descriptor(self) -> None:
        self._write_private_json(self.descriptor_path, self.descriptor)

    def response(self, data: dict, *, exit_code: int = 0, error: dict | None = None) -> dict:
        return {"exit_code": exit_code, "envelope": {"data": data, "error": error}}

    def successful_fake_invoker(self, *, override: dict | None = None):
        calls: list[list[str]] = []
        credentials: list[str] = []

        def invoke(_binary: Path, args: list[str], *, cwd: Path, credential: str) -> dict:
            self.assertEqual(cwd, self.project_root)
            self.assertNotIn(self.secret, args)
            credentials.append(credential)
            calls.append(args)
            command = args[:2]
            if command == ["auth", "show"]:
                data = {"project_id": self.project_id, "actor_id": self.actor_id, "role": "agent"}
            elif command == ["session", "show"]:
                data = {
                    "project_id": self.project_id,
                    "session_id": "session-fixture",
                    "actor_id": self.actor_id,
                    "harness_id": "harness-fixture",
                    "state": "active",
                }
            elif command == ["work", "show"]:
                data = {"project_id": self.project_id, "work_id": "work-fixture", "kind": "task", "lifecycle": "open"}
            elif command == ["agent", "resume"]:
                data = {
                    "context": {
                        "mode": "resume",
                        "project_id": self.project_id,
                        "actor_id": self.actor_id,
                        "harness_id": "harness-fixture",
                        "session_id": "session-fixture",
                    },
                    "status": {
                        "work_id": "work-fixture",
                        "attempt_id": "attempt-existing-fixture",
                        "fence": 7,
                    },
                    "provenance": {
                        "source_snapshot_hash": "sha256:source-fixture",
                        "config_identity": "sha256:config-fixture",
                    },
                }
            else:
                self.fail(f"unexpected mutating or unsupported command: {args!r}")
            if override:
                data.update(override)
            return self.response(data)

        return invoke, calls, credentials


class SecureAgentInputTests(AgentInputFixtures):
    def test_agent_cli_must_be_private_and_match_current_source_revision(self) -> None:
        binary = self.root / "target" / "debug" / "bwrk"
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b"fixture executable")
        os.chmod(binary, 0o700)
        snapshot_directory = self.root / "snapshot"
        snapshot_directory.mkdir()
        trusted_digest = host.file_sha256(binary)
        outputs = [
            mock.Mock(returncode=0, stdout="revision-1\n", stderr=""),
            mock.Mock(returncode=0, stdout="", stderr=""),
            mock.Mock(returncode=0, stdout="", stderr=""),
            mock.Mock(
                returncode=0,
                stdout=json.dumps(
                    {"data": {"build_revision": "revision-1", "build_source_id": "sha256:fixture"}}
                ),
                stderr="",
            ),
        ]
        with (
            mock.patch.object(host, "ROOT", self.root),
            mock.patch.object(host, "current_cli_source_id", return_value="sha256:fixture"),
            mock.patch.object(host.subprocess, "run", side_effect=outputs),
        ):
            _snapshot, identity = self._verify_agent_cli(
                binary,
                trusted_sha256=trusted_digest,
                snapshot_directory=snapshot_directory,
            )
        self.assertNotEqual(_snapshot, binary)
        self.assertEqual(host.file_sha256(_snapshot), trusted_digest)
        self.assertEqual(stat.S_IMODE(_snapshot.stat().st_mode), 0o500)
        self.assertEqual(identity["build_revision"], "revision-1")
        self.assertEqual(identity["build_source_id"], "sha256:fixture")

        with mock.patch.object(host, "ROOT", self.root), self.assertRaisesRegex(
            RuntimeError, "digest does not match"
        ):
            self._verify_agent_cli(
                binary,
                trusted_sha256="sha256:" + "0" * 64,
                snapshot_directory=snapshot_directory,
            )

        outputs[-1] = mock.Mock(
            returncode=0,
            stdout=json.dumps(
                {"data": {"build_revision": "stale-revision", "build_source_id": "sha256:fixture"}}
            ),
            stderr="",
        )
        with (
            mock.patch.object(host, "ROOT", self.root),
            mock.patch.object(host, "current_cli_source_id", return_value="sha256:fixture"),
            mock.patch.object(host.subprocess, "run", side_effect=outputs),
            self.assertRaisesRegex(RuntimeError, "does not match"),
        ):
            self._verify_agent_cli(
                binary,
                trusted_sha256=trusted_digest,
                snapshot_directory=snapshot_directory,
            )

        os.chmod(binary, 0o722)
        with (
            mock.patch.object(host, "ROOT", self.root),
            self.assertRaisesRegex(RuntimeError, "private executable"),
        ):
            self._verify_agent_cli(
                binary,
                trusted_sha256=trusted_digest,
                snapshot_directory=snapshot_directory,
            )

    def test_agent_cli_rejects_untracked_build_inputs(self) -> None:
        binary = self.root / "target" / "debug" / "bwrk"
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b"fixture executable")
        os.chmod(binary, 0o700)
        snapshot_directory = self.root / "snapshot"
        snapshot_directory.mkdir()
        outputs = [
            mock.Mock(returncode=0, stdout="revision-1\n", stderr=""),
            mock.Mock(returncode=0, stdout="", stderr=""),
            mock.Mock(returncode=0, stdout="crates/cli/src/untracked.rs\n", stderr=""),
        ]
        with (
            mock.patch.object(host, "ROOT", self.root),
            mock.patch.object(host.subprocess, "run", side_effect=outputs),
            self.assertRaisesRegex(RuntimeError, "untracked CLI source inputs"),
        ):
            self._verify_agent_cli(
                binary,
                trusted_sha256=host.file_sha256(binary),
                snapshot_directory=snapshot_directory,
            )

    def test_loads_existing_private_credential_from_only_standard_path(self) -> None:
        agent = host.load_agent_input(self.descriptor_path)
        self.assertEqual(agent.project_id, self.project_id)
        self.assertEqual(agent.actor_id, self.actor_id)
        self.assertEqual(agent.attempt_id, "attempt-existing-fixture")
        self.assertEqual(agent.fence, 7)
        self.assertNotIn(self.secret, repr(agent))

    def test_descriptor_rejects_wrong_schema_fields_and_missing_attempt_fence(self) -> None:
        for mutate in (
            lambda value: value.update(schema_version="wrong"),
            lambda value: value.update(unexpected_secret="should-not-be-accepted"),
            lambda value: value.pop("attempt_id"),
            lambda value: value.update(fence=True),
        ):
            with self.subTest(mutate=mutate):
                value = self.descriptor.copy()
                mutate(value)
                self._write_private_json(self.descriptor_path, value)
                with self.assertRaises(RuntimeError):
                    host.load_agent_input(self.descriptor_path)
        self.write_descriptor()

    def test_descriptor_rejects_symlink_insecure_permissions_and_oversize(self) -> None:
        original = self.descriptor_path.read_bytes()
        self.descriptor_path.unlink()
        target = self.root / "target.json"
        target.write_bytes(original)
        os.chmod(target, 0o600)
        self.descriptor_path.symlink_to(target)
        with self.assertRaises(RuntimeError):
            host.load_agent_input(self.descriptor_path)

        self.descriptor_path.unlink()
        self.descriptor_path.write_bytes(original)
        os.chmod(self.descriptor_path, 0o644)
        with self.assertRaises(RuntimeError):
            host.load_agent_input(self.descriptor_path)

        self.descriptor_path.write_bytes(b" " * (host.MAX_AGENT_INPUT_BYTES + 1))
        os.chmod(self.descriptor_path, 0o600)
        with self.assertRaises(RuntimeError):
            host.load_agent_input(self.descriptor_path)

    def test_credential_rejects_symlink_insecure_permissions_wrong_binding_and_oversize(self) -> None:
        credential = self.credential_path.read_bytes()
        target = self.root / "credential-target.json"
        target.write_bytes(credential)
        os.chmod(target, 0o600)
        self.credential_path.unlink()
        self.credential_path.symlink_to(target)
        with self.assertRaises(RuntimeError):
            host.load_agent_input(self.descriptor_path)

        self.credential_path.unlink()
        self.credential_path.write_bytes(credential)
        os.chmod(self.credential_path, 0o644)
        with self.assertRaises(RuntimeError):
            host.load_agent_input(self.descriptor_path)

        self._write_private_json(
            self.credential_path,
            {
                "schema_version": "boreal.local-credential.v1",
                "project_id": "wrong-project",
                "actor_id": self.actor_id,
                "credential": self.secret,
            },
        )
        with self.assertRaises(RuntimeError):
            host.load_agent_input(self.descriptor_path)

        self.credential_path.write_bytes(b" " * (host.MAX_CREDENTIAL_BYTES + 1))
        os.chmod(self.credential_path, 0o600)
        with self.assertRaises(RuntimeError):
            host.load_agent_input(self.descriptor_path)

    def test_credential_directories_must_be_private_and_owned(self) -> None:
        credentials_dir = self.credential_path.parent
        os.chmod(credentials_dir, 0o755)
        with self.assertRaises(RuntimeError):
            host.load_agent_input(self.descriptor_path)
        os.chmod(credentials_dir, 0o700)
        with mock.patch.object(host.os, "geteuid", return_value=os.geteuid() + 1):
            with self.assertRaises(RuntimeError):
                host.load_agent_input(self.descriptor_path)

    def test_preflight_readbacks_exact_existing_attempt_without_claim_mutation(self) -> None:
        invoke, calls, credentials = self.successful_fake_invoker()
        result = host.run_agent_input_preflight(
            Path("fake-bwrk"),
            self.descriptor_path,
            trusted_binary_sha256="sha256:fixture",
            invoke_fn=invoke,
        )
        self.assertEqual(
            [call[:2] for call in calls],
            [["auth", "show"], ["session", "show"], ["work", "show"], ["agent", "resume"]],
        )
        self.assertTrue(all(value == self.secret for value in credentials))
        self.assertEqual(result["attempt_id"], "attempt-existing-fixture")
        self.assertEqual(result["fence"], 7)
        self.assertEqual(result["claim_readback"]["work_id"], "work-fixture")
        self.assertFalse(result["attempted"])
        self.assertFalse(result["credential_exposed"])
        self.assertNotIn(self.secret, json.dumps(result))

    def test_revoked_or_wrong_role_authority_fails_before_session_and_probe(self) -> None:
        for result in (
            self.response({}, exit_code=1, error={"code": "permission_denied", "message": self.secret}),
            self.response({"project_id": self.project_id, "actor_id": self.actor_id, "role": "operator"}),
        ):
            calls: list[list[str]] = []

            def invoke(_binary: Path, args: list[str], **_kwargs) -> dict:
                calls.append(args)
                return result

            with self.assertRaises(RuntimeError) as raised:
                host.run_agent_input_preflight(
                    Path("fake-bwrk"),
                    self.descriptor_path,
                    trusted_binary_sha256="sha256:fixture",
                    invoke_fn=invoke,
                )
            self.assertNotIn(self.secret, str(raised.exception))
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][:2], ["auth", "show"])

    def test_session_mismatch_fails_before_work_or_resume(self) -> None:
        invoke, calls, _ = self.successful_fake_invoker()
        original = invoke

        def mismatched_session(binary: Path, args: list[str], **kwargs) -> dict:
            result = original(binary, args, **kwargs)
            if args[:2] == ["session", "show"]:
                result["envelope"]["data"]["actor_id"] = "other-agent"
            return result

        with self.assertRaises(RuntimeError):
            host.run_agent_input_preflight(
                Path("fake-bwrk"),
                self.descriptor_path,
                trusted_binary_sha256="sha256:fixture",
                invoke_fn=mismatched_session,
            )
        self.assertEqual([call[:2] for call in calls], [["auth", "show"], ["session", "show"]])

    def test_resume_attempt_or_fence_mismatch_fails_closed(self) -> None:
        for key, value in (
            ("attempt_id", "different-attempt"),
            ("fence", 8),
            ("fence", True),
            ("work_id", "different-work"),
        ):
            invoke, calls, _ = self.successful_fake_invoker()
            original = invoke

            def mismatched_resume(binary: Path, args: list[str], **kwargs) -> dict:
                result = original(binary, args, **kwargs)
                if args[:2] == ["agent", "resume"]:
                    result["envelope"]["data"]["status"][key] = value
                return result

            with self.subTest(key=key), self.assertRaises(RuntimeError):
                host.run_agent_input_preflight(
                    Path("fake-bwrk"),
                    self.descriptor_path,
                    trusted_binary_sha256="sha256:fixture",
                    invoke_fn=mismatched_resume,
                )
            self.assertEqual([call[:2] for call in calls][-1], ["agent", "resume"])
            self.assertFalse(any(call[:2] == ["work", "claim"] for call in calls))

    def test_invalid_input_aborts_before_temporary_workload_setup(self) -> None:
        binary = self.root / "bwrk"
        binary.write_text("fake", encoding="utf-8")
        args = [
            "production_host.py",
            "--full-v10",
            "--agent-input",
            str(self.descriptor_path),
            "--agent-cli-sha256",
            "sha256:" + "0" * 64,
            "--bin",
            str(binary),
            "--output",
            str(self.root / "report.json"),
        ]
        with (
            mock.patch.object(sys, "argv", args),
            mock.patch.object(host, "run_agent_input_preflight", side_effect=RuntimeError("invalid fake fixture")),
            mock.patch.object(host.tempfile, "TemporaryDirectory", side_effect=AssertionError("workload started")) as tempdir,
        ):
            with self.assertRaisesRegex(RuntimeError, "invalid fake fixture"):
                host.main()
            tempdir.assert_not_called()

    def test_credential_is_child_only_and_invalid_output_is_not_echoed(self) -> None:
        completed = mock.Mock(returncode=0, stdout=self.secret, stderr=self.secret)
        with mock.patch.dict(
            os.environ,
            {
                "BOREAL_CREDENTIAL": "ambient-secret",
                "LD_LIBRARY_PATH": "/tmp/untrusted-libs",
                "LD_PRELOAD": "/tmp/untrusted.so",
                "LD_AUDIT": "/tmp/audit.so",
                "DYLD_INSERT_LIBRARIES": "/tmp/inject.dylib",
                "DYLD_LIBRARY_PATH": "/tmp/untrusted-dyld",
                "DYLD_FRAMEWORK_PATH": "/tmp/untrusted-frameworks",
            },
        ), mock.patch.object(host.subprocess, "run", return_value=completed) as run:
            with self.assertRaises(RuntimeError) as raised:
                host.invoke_with_credential(
                    Path("fake-bwrk"), ["auth", "show"], cwd=self.project_root, credential=self.secret
                )
        self.assertNotIn(self.secret, str(raised.exception))
        child_env = run.call_args.kwargs["env"]
        self.assertEqual(child_env["BOREAL_CREDENTIAL"], self.secret)
        self.assertNotIn("ambient-secret", child_env.values())
        self.assertNotIn("LD_LIBRARY_PATH", child_env)
        self.assertNotIn("LD_PRELOAD", child_env)
        self.assertNotIn("LD_AUDIT", child_env)
        self.assertNotIn("DYLD_INSERT_LIBRARIES", child_env)
        self.assertNotIn("DYLD_LIBRARY_PATH", child_env)
        self.assertNotIn("DYLD_FRAMEWORK_PATH", child_env)
        self.assertNotIn(self.secret, run.call_args.args[0])

    def test_invalid_argument_read_only_failures_are_unexpected_and_unapproved(self) -> None:
        summary = host.failed_response_breakdown(
            [
                {"request_kind": "status", "exit_code": 2, "error": {"code": "invalid_argument"}},
                {"request_kind": "work_show", "exit_code": 2, "error": {"code": "invalid_argument"}},
                {"request_kind": "status", "exit_code": 0, "error": None},
            ]
        )
        self.assertEqual(summary["unexpected_invalid_argument_responses"], 2)
        self.assertEqual(summary["by_error_code"], {"invalid_argument": 2})
        self.assertEqual(summary["by_request_kind"], {"status": 1, "work_show": 1})
        self.assertFalse(summary["owner_approved"])
        self.assertIsNone(summary["owner_approved_maximum"])

    def test_stop_result_records_observed_process_exit_unix_time(self) -> None:
        class FakeProcess:
            returncode = 0

            def poll(self):
                return None

            def send_signal(self, _signal) -> None:
                pass

            def communicate(self, timeout: int):
                return ("", "")

        with mock.patch.object(host.time, "time_ns", return_value=1_234_000_000):
            result = host.stop_service(FakeProcess(), self.root / "service.sock")
        self.assertEqual(result["service_exited_at_unix_ms"], 1234)
        self.assertEqual(result["status"], "pass")


if __name__ == "__main__":
    unittest.main()
