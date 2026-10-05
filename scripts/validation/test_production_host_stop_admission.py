from __future__ import annotations

import subprocess
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock


sys.path.insert(0, str(Path(__file__).parent / "concurrency"))
import production_host as host  # noqa: E402


class StopAdmissionTests(unittest.TestCase):
    def test_shutdown_waits_for_spawn_then_snapshots_in_flight_client(self) -> None:
        stopped = threading.Event()
        spawn_entered = threading.Event()
        allow_spawn_to_finish = threading.Event()
        response_ready = threading.Event()
        shutdown_waiting = threading.Event()
        shutdown_finished = threading.Event()
        registry: dict[int, subprocess.Popen[str]] = {}
        registry_lock = threading.Lock()
        snapshots: list[list[int]] = []
        responses: list[dict] = []
        errors: list[BaseException] = []

        class FakeProcess:
            pid = 73
            returncode: int | None = None
            finished = False

            def communicate(self, timeout: float | None = None) -> tuple[str, str]:
                if not response_ready.wait(timeout):
                    raise subprocess.TimeoutExpired("fixture", timeout)
                self.returncode = 0
                self.finished = True
                return '{"outcome":"success","data":{"marker":"preserved"}}\n', ""

            def poll(self) -> int | None:
                return self.returncode if self.finished else None

        process = FakeProcess()

        def spawn(*_args: object, **_kwargs: object) -> FakeProcess:
            spawn_entered.set()
            if not allow_spawn_to_finish.wait(timeout=2):
                raise RuntimeError("test did not release the admitted process")
            return process

        def run_client() -> None:
            try:
                result = host.client(
                    Path("bwrk"),
                    Path("/tmp/service.sock"),
                    "fixture-project",
                    ["status", "--limit", "8", "--offset", "0"],
                    cwd=Path("/tmp"),
                    active_processes=registry,
                    active_process_lock=registry_lock,
                    admission_stopped=stopped,
                )
                if result is not None:
                    responses.append(result)
            except BaseException as error:  # surfaced in the main test thread
                errors.append(error)

        def begin_shutdown() -> None:
            shutdown_waiting.set()
            with registry_lock:
                stopped.set()
                snapshots.append(
                    sorted(
                        pid
                        for pid, active_process in registry.items()
                        if active_process.poll() is None
                    )
                )
            shutdown_finished.set()

        client_thread = threading.Thread(target=run_client)
        shutdown_thread = threading.Thread(target=begin_shutdown)
        try:
            with mock.patch.object(host.subprocess, "Popen", side_effect=spawn) as popen:
                client_thread.start()
                self.assertTrue(spawn_entered.wait(timeout=2))
                shutdown_thread.start()
                self.assertTrue(shutdown_waiting.wait(timeout=2))
                self.assertFalse(shutdown_finished.wait(timeout=0.05))
                allow_spawn_to_finish.set()
                self.assertTrue(shutdown_finished.wait(timeout=2))
                self.assertEqual(snapshots, [[73]])

                response_ready.set()
                client_thread.join(timeout=2)
                self.assertFalse(client_thread.is_alive())
                self.assertEqual(len(responses), 1)
                self.assertEqual(
                    responses[0]["envelope"]["data"]["marker"], "preserved"
                )

                rejected = host.client(
                    Path("bwrk"),
                    Path("/tmp/service.sock"),
                    "fixture-project",
                    ["status", "--limit", "8", "--offset", "0"],
                    cwd=Path("/tmp"),
                    active_processes=registry,
                    active_process_lock=registry_lock,
                    admission_stopped=stopped,
                )
                self.assertIsNone(rejected)
                popen.assert_called_once()
        finally:
            allow_spawn_to_finish.set()
            response_ready.set()
            client_thread.join(timeout=2)
            shutdown_thread.join(timeout=2)

        self.assertEqual(errors, [])

    def test_timeout_output_is_retained_in_bounded_error_details(self) -> None:
        error = subprocess.TimeoutExpired(
            "bwrk status", 15, output=b"partial stdout", stderr=b"partial stderr"
        )

        details = host.client_error_details(error)

        self.assertEqual(details["stdout_tail"], "partial stdout")
        self.assertEqual(details["stderr_tail"], "partial stderr")
        self.assertIn("timed out", details["message"])


if __name__ == "__main__":
    unittest.main()
