from contextlib import redirect_stdout
from io import StringIO
import subprocess
import unittest
from unittest.mock import patch

from git_transport_preflight import (
    _remote_is_plain_https_github,
    classify_failure,
    run_preflight,
)


class GitTransportPreflightTests(unittest.TestCase):
    def test_proxy_connection_failure_is_not_labeled_as_auth_failure(self):
        stderr = (
            "fatal: unable to access 'https://github.com/org/repo.git/': "
            "Failed to connect to proxy port 8080 after 0 ms: Could not connect to server"
        )
        self.assertEqual(classify_failure(stderr), "network_blocked_before_github")

    def test_auth_style_response_is_not_attributed_to_github(self):
        self.assertEqual(
            classify_failure("fatal: Authentication failed for 'https://github.com/org/repo.git'"),
            "auth_response_unattributed",
        )

    def test_unknown_failure_does_not_trigger_credential_diagnosis(self):
        self.assertEqual(
            classify_failure("fatal: unable to access remote: unexpected EOF"),
            "transport_failure_unclassified",
        )

    def test_proxy_failure_takes_precedence_over_auth_text(self):
        stderr = "Authentication failed; could not connect to proxy port 8080"
        self.assertEqual(classify_failure(stderr), "network_blocked_before_github")

    def test_only_plain_github_https_remote_is_accepted(self):
        self.assertTrue(_remote_is_plain_https_github("https://github.com/org/repo.git"))
        self.assertFalse(_remote_is_plain_https_github("https://token@github.com/org/repo.git"))
        self.assertFalse(_remote_is_plain_https_github("https://example.com/org/repo.git"))

    def test_absent_branch_is_not_reported_as_an_auth_failure(self):
        results = [
            subprocess.CompletedProcess([], 0, "", ""),
            subprocess.CompletedProcess([], 0, "https://github.com/org/repo.git\n", ""),
            subprocess.CompletedProcess([], 2, "", ""),
        ]
        output = StringIO()
        with patch("git_transport_preflight.subprocess.run", side_effect=results):
            with redirect_stdout(output):
                status = run_preflight("origin", "reconciliation")
        self.assertEqual(status, 3)
        self.assertIn("REMOTE_REF_NOT_FOUND", output.getvalue())
        self.assertNotIn("credential failure", output.getvalue().lower())

    def test_preflight_routes_proxy_block_to_escalated_transport(self):
        results = [
            subprocess.CompletedProcess([], 0, "", ""),
            subprocess.CompletedProcess([], 0, "https://github.com/org/repo.git\n", ""),
            subprocess.CompletedProcess(
                [],
                128,
                "",
                "fatal: unable to access remote: Failed to connect to proxy port 8080",
            ),
        ]
        output = StringIO()
        with patch("git_transport_preflight.subprocess.run", side_effect=results):
            with redirect_stdout(output):
                status = run_preflight("origin", "reconciliation")
        self.assertEqual(status, 4)
        self.assertIn("NETWORK_BLOCKED_BEFORE_GITHUB", output.getvalue())
        self.assertIn('sandbox_permissions: "require_escalated"', output.getvalue())
        self.assertIn("not evidence of a GitHub credential failure", output.getvalue())
        self.assertNotIn("invalid token", output.getvalue().lower())


if __name__ == "__main__":
    unittest.main()
