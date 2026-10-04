import unittest

from git_transport_preflight import classify_failure, _remote_is_plain_https_github


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


if __name__ == "__main__":
    unittest.main()
