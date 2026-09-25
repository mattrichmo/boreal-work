#!/usr/bin/env python3
"""Generate the external identity input for the production domain oracle.

The manifest is deliberately not a tracked artifact.  It records the Git
revision and the bytes supplied to the compiled test target immediately before
the test runs, so a commit cannot contain its own expected commit hash.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import stat
import subprocess
from pathlib import Path


ARTIFACTS = (
    "project/spec/production/contract-manifest.json",
    "project/spec/production/status-and-actions.md",
    "project/spec/transition-table.md",
    "project/spec/production/reason-registry.json",
    "project/validation/production/domain/PF-S03-T08-ORACLE.md",
    "project/validation/production/domain/PF-S03-T10-ORACLE.md",
    "project/validation/production/domain/PF-S03-T08-ORACLE-SOURCE.md",
    "project/validation/production/domain/PF-S03-T10-ORACLE-SOURCE.md",
    "crates/domain/src/lib.rs",
    "crates/domain/src/status_evaluator.rs",
    "crates/domain/src/actions.rs",
    "crates/domain/src/decision_inputs.rs",
    "crates/domain/src/dependencies.rs",
    "crates/domain/src/time_policy.rs",
    "crates/domain/tests/production_properties.rs",
    "crates/domain/tests/production_t10_oracle.rs",
)


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(("git", "-C", str(root), *args), text=True).strip()


def digest(root: Path, relative_path: str) -> str:
    return hashlib.sha256((root / relative_path).read_bytes()).hexdigest()


def source_tree(root: Path) -> tuple[str, int]:
    """Hash every tracked and non-ignored untracked worktree file.

    The previous fixed artifact list could miss a newly added Rust module or
    a dirty source file used by the test binary. Path and payload lengths are
    framed to keep the aggregate unambiguous; symlinks bind their link target.
    """
    raw_paths = subprocess.check_output(
        ("git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    )
    paths = sorted({entry for entry in raw_paths.split(b"\0") if entry})
    aggregate = hashlib.sha256()
    file_count = 0
    for encoded_path in paths:
        relative_path = os.fsdecode(encoded_path)
        if relative_path.startswith(("target/", "apps/tui/node-compile-cache/")):
            # Build output and Node's runtime compile cache are not source
            # inputs and can change merely because validation ran.
            continue
        path = root / relative_path
        try:
            metadata = path.lstat()
        except FileNotFoundError as error:
            raise RuntimeError(f"source input disappeared while hashing: {relative_path}") from error
        if stat.S_ISDIR(metadata.st_mode):
            # Git reports an untracked directory as a path as well as listing
            # its children; the children are hashed individually below.
            continue
        if stat.S_ISLNK(metadata.st_mode):
            kind = b"symlink"
            payload = os.fsencode(os.readlink(path))
        elif stat.S_ISREG(metadata.st_mode):
            kind = b"file"
            payload = path.read_bytes()
        else:
            raise RuntimeError(f"unsupported source input type: {relative_path}")

        aggregate.update(len(kind).to_bytes(8, "big"))
        aggregate.update(kind)
        aggregate.update(len(encoded_path).to_bytes(8, "big"))
        aggregate.update(encoded_path)
        aggregate.update(len(payload).to_bytes(8, "big"))
        aggregate.update(payload)
        file_count += 1
    if not file_count:
        raise RuntimeError("source tree contains no files to bind")
    return aggregate.hexdigest(), file_count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[3]
    dirty = bool(git(root, "status", "--porcelain", "--untracked-files=all"))
    tree_digest, file_count = source_tree(root)
    lines = [
        "schema: `boreal.production-oracle-source-manifest/2`",
        f"source_revision: `{git(root, 'rev-parse', 'HEAD')}`",
        f"worktree_state: `{'dirty' if dirty else 'clean'}`",
        f"source_tree_sha256: `{tree_digest}`",
        f"source_file_count: `{file_count}`",
        "binding: `external-generated-git-and-worktree-snapshot`",
    ]
    lines.extend(
        f"artifact::{relative_path} = `{digest(root, relative_path)}`"
        for relative_path in ARTIFACTS
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
