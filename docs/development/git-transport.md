# Git transport in managed execution environments

This repository uses the ordinary HTTPS Git remote. Some execution contexts
route HTTPS through a managed proxy. The default sandbox may be unable to reach
that proxy even when the approved network-enabled execution path can reach
GitHub using the existing managed transport.

## Diagnose before changing authentication

Run a read-only check against the exact branch before pushing:

```sh
python3 scripts/release/git_transport_preflight.py \
  --remote origin \
  --branch <branch-name>
```

The preflight suppresses raw Git errors and remote URLs so it cannot echo an
embedded credential. It reports one of these outcomes:

- `REMOTE_REF_OK`: HTTPS reached the remote and the branch SHA is known.
- `NETWORK_BLOCKED_BEFORE_GITHUB`: Git could not connect to the configured
  proxy. This does not test GitHub credentials and must not be reported as a
  token or credential failure.
- `AUTH_RESPONSE_UNATTRIBUTED`: an authentication-style response occurred,
  but this check cannot establish whether it came from the proxy or GitHub.
- `TRANSPORT_FAILURE_UNCLASSIFIED`: the failure does not support an auth
  diagnosis.

When the default sandbox reports `NETWORK_BLOCKED_BEFORE_GITHUB`, repeat the
same read-only preflight through the approved execution tool with
`sandbox_permissions: "require_escalated"`. That is the supported network path;
do not disable the proxy, change persistent network settings, run
`gh auth login`, or replace credentials based only on a proxy connection
failure. An invalid `GH_TOKEN` reported by the GitHub CLI is not proof that the
managed Git transport failed authentication; Git and the connected GitHub API
can use separate auth paths.

## Publish safely

After `REMOTE_REF_OK`, fetch the reported ref and compare the actual remote SHA
with the local history. Inspect raw author and committer identities for the
commits being published. Use a normal non-force Git push only when the remote
head is an ancestor of the local commit. If histories diverge, do not overwrite
the remote branch or infer identity from matching trees; use a separate
reconciliation branch or stop for an owner decision. Keep the HTTPS remote
credential-free and preserve the repository's configured author and committer.
