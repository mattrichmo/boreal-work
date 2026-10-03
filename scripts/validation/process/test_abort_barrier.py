#!/usr/bin/env python3
"""Focused tests for the V02 SIGABRT barrier cleanup paths."""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from forensic_service import AbortBarrier


class AbortBarrierTests(unittest.TestCase):
    def setUp(self) -> None:
        if shutil.which("cc") is None:
            self.skipTest("a C compiler is required to build the signal handler")
        self.temporary = tempfile.TemporaryDirectory(prefix="boreal-abort-barrier-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def run_abort_child(self, label: str, *, close_release_fifo: bool) -> None:
        barrier = AbortBarrier.create(self.root / label)
        environment = barrier.service_environment()
        process = subprocess.Popen(
            [sys.executable, "-c", "import os; os.abort()"],
            env={**os.environ, **environment},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            barrier.wait_until_held(process, process)
            if close_release_fifo:
                # EOF means the harness disappeared; the handler must return
                # so libc's pending abort can terminate the child.
                barrier.close()
            else:
                barrier.release()
            self.assertEqual(process.wait(timeout=3), -signal.SIGABRT)
        finally:
            barrier.release()
            if process.poll() is None:
                process.kill()
                process.wait(timeout=3)
            if not close_release_fifo:
                barrier.close()

    def test_normal_release_resumes_real_sigabrt(self) -> None:
        self.run_abort_child("normal-release", close_release_fifo=False)

    def test_fifo_eof_resumes_real_sigabrt(self) -> None:
        self.run_abort_child("fifo-eof", close_release_fifo=True)


if __name__ == "__main__":
    unittest.main()
