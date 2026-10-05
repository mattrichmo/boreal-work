#!/usr/bin/env python3
"""Read-only GitHub HTTPS preflight; never changes credentials or Git config."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from urllib.parse import urlsplit


_PROXY_FAILURES = (
    "could not connect to proxy",
    "failed to connect to proxy",
    "could not resolve proxy",
    "proxy connect aborted",
)
_AUTH_RESPONSES = (
    "authentication failed",
    "http basic: access denied",
)


def classify_failure(stderr: str) -> str:
    """Classify only what Git's stderr proves; never infer credentials from transport loss."""
    lowered = stderr.lower()
    if any(marker in lowered for marker in _PROXY_FAILURES):
        return "network_blocked_before_github"
    if any(marker in lowered for marker in _AUTH_RESPONSES):
        return "auth_response_unattributed"
    return "transport_failure_unclassified"


def _remote_is_plain_https_github(remote_url: str) -> bool:
    parsed = urlsplit(remote_url)
    return (
        parsed.scheme == "https"
        and parsed.hostname == "github.com"
        and parsed.username is None
        and parsed.password is None
        and not parsed.query
        and not parsed.fragment
    )


def _valid_branch_ref(branch: str) -> bool:
    result = subprocess.run(
        ["git", "check-ref-format", f"refs/heads/{branch}"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def run_preflight(remote: str, branch: str) -> int:
    if not _valid_branch_ref(branch):
        print("INVALID_BRANCH_REF: supply a valid branch name; no network request made.")
        return 2

    configured_remote = subprocess.run(
        ["git", "remote", "get-url", remote],
        check=False,
        capture_output=True,
        text=True,
    )
    if configured_remote.returncode != 0:
        print("REMOTE_LOOKUP_FAILED: remote configuration was not read; details suppressed.")
        return 2
    remote_url = configured_remote.stdout.strip()
    if not _remote_is_plain_https_github(remote_url):
        print(
            "UNSUPPORTED_REMOTE: expected credential-free HTTPS to github.com; "
            "configured URL suppressed. No network request made."
        )
        return 2

    ref = f"refs/heads/{branch}"
    result = subprocess.run(
        ["git", "ls-remote", "--exit-code", remote, ref],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            sha, separator, found_ref = line.partition("\t")
            if separator and found_ref == ref and re.fullmatch(r"[0-9a-fA-F]{40,64}", sha):
                print(f"REMOTE_REF_OK remote={remote} ref={ref} sha={sha}")
                return 0
        print("REMOTE_REF_NOT_FOUND: command succeeded without the requested ref; no auth conclusion.")
        return 3
    if result.returncode == 2 and not result.stdout.strip() and not result.stderr.strip():
        print("REMOTE_REF_NOT_FOUND: no matching branch; no auth conclusion.")
        return 3

    category = classify_failure(result.stderr)
    if category == "network_blocked_before_github":
        print("NETWORK_BLOCKED_BEFORE_GITHUB: Git could not connect to the configured proxy.")
        print("This is not evidence of a GitHub credential failure.")
        print(
            "Repeat this read-only preflight via the approved execution tool with "
            'sandbox_permissions: "require_escalated".'
        )
    elif category == "auth_response_unattributed":
        print("AUTH_RESPONSE_UNATTRIBUTED: an authentication-style response was received.")
        print("This check cannot attribute it to GitHub or the managed proxy; do not infer token state.")
    else:
        print("TRANSPORT_FAILURE_UNCLASSIFIED: details suppressed; no credential diagnosis is supported.")
    return 4


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--branch", required=True)
    args = parser.parse_args(argv)
    return run_preflight(args.remote, args.branch)


if __name__ == "__main__":
    sys.exit(main())
