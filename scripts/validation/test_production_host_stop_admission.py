from __future__ import annotations

import sys
import threading
import unittest
from pathlib import Path
from unittest import mock


sys.path.insert(0, str(Path(__file__).parent / "concurrency"))
import production_host as host  # noqa: E402


class StopAdmissionTests(unittest.TestCase):
    def test_client_does_not_spawn_after_stop_admission_boundary(self) -> None:
        stopped = threading.Event()
        stopped.set()

        with mock.patch.object(host.subprocess, "Popen") as popen:
            result = host.client(
                Path("bwrk"),
                Path("/tmp/service.sock"),
                "fixture-project",
                ["status", "--limit", "8", "--offset", "0"],
                cwd=Path("/tmp"),
                active_processes={},
                active_process_lock=threading.Lock(),
                admission_stopped=stopped,
            )

        self.assertIsNone(result)
        popen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
