#!/usr/bin/env python3
"""Generate the external identity input for the production domain oracle.

The manifest is deliberately not a tracked artifact.  It records the Git
revision and the bytes supplied to the compiled test target immediately before
the test runs, so a commit cannot contain its own expected commit hash.
"""

from __future__ import annotations

import argparse
import hashlib
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[3]
    tracked_dirty = bool(git(root, "status", "--porcelain", "--untracked-files=no"))
    lines = [
        "schema: `boreal.production-oracle-source-manifest/1`",
        f"source_revision: `{git(root, 'rev-parse', 'HEAD')}`",
        f"worktree_state: `{'dirty' if tracked_dirty else 'clean'}`",
        "binding: `external-generated-validation-input`",
    ]
    lines.extend(
        f"artifact::{relative_path} = `{digest(root, relative_path)}`"
        for relative_path in ARTIFACTS
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
