#!/usr/bin/env python3
"""Build an exact, content-addressed identity for a Global TUI smoke run.

The deterministic JSON contract is ``boreal.global-tui-validation-identity/1``:

* ``source`` has the Git commit, a dirty flag, and a SHA-256 of tracked diff
  plus non-ignored untracked file contents (empty worktrees still have a
  stable digest).
* ``binary`` has the binary file name, byte size, and SHA-256.
* ``global_tui`` has the entrypoint name and SHA-256 plus a SHA-256 and count
  for every file in the compiled entrypoint directory.
* ``runtime.node_version`` records the Node version used by the PTY child.

Absolute workspace paths and timestamps are deliberately omitted so the
identity stays stable when the same candidate is checked out elsewhere.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any


SCHEMA = "boreal.global-tui-validation-identity/1"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_identity(directory: Path) -> dict[str, Any]:
    """Hash every file in a generated runtime tree, including its relative path."""
    root = directory.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"compiled Global TUI bundle is missing: {root}")
    entries = sorted(root.rglob("*"))
    symlinks = [path for path in entries if path.is_symlink()]
    if symlinks:
        raise ValueError(f"compiled Global TUI bundle contains a symlink: {symlinks[0]}")
    files = [path for path in entries if path.is_file()]
    if not files:
        raise ValueError(f"compiled Global TUI bundle contains no files: {root}")
    digest = hashlib.sha256()
    for path in files:
        try:
            resolved = path.resolve(strict=True)
            resolved.relative_to(root)
        except (OSError, ValueError) as error:
            raise ValueError(f"runtime bundle path escapes or is missing from its root: {path}") from error
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError as error:
            raise ValueError(f"runtime bundle path escapes its root: {path}") from error
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(b"file\0")
        digest.update(bytes.fromhex(sha256_file(resolved)))
    return {"file_count": len(files), "sha256": digest.hexdigest()}


def _git(root: Path, *arguments: str) -> subprocess.CompletedProcess[bytes] | None:
    try:
        return subprocess.run(
            ["git", "-C", str(root), *arguments],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def source_identity(root: Path) -> dict[str, Any]:
    """Identify HEAD plus tracked edits and non-ignored untracked file contents."""
    root = root.resolve()
    revision_result = _git(root, "rev-parse", "HEAD")
    if revision_result is None or revision_result.returncode != 0:
        raise RuntimeError(f"cannot obtain source commit identity with git rev-parse: {root}")
    revision = revision_result.stdout.decode("ascii", errors="strict").strip()
    if not revision:
        raise RuntimeError(f"Git returned an empty source commit identity: {root}")
    diff_result = _git(root, "diff", "--binary", "HEAD", "--")
    untracked_result = _git(root, "ls-files", "--others", "--exclude-standard", "-z")
    if diff_result is None or diff_result.returncode != 0:
        raise RuntimeError(f"cannot hash tracked source changes with git diff: {root}")
    if untracked_result is None or untracked_result.returncode != 0:
        raise RuntimeError(f"cannot enumerate untracked source changes with git ls-files: {root}")

    changes = hashlib.sha256()
    changes.update(b"tracked-diff\0")
    changes.update(diff_result.stdout)
    untracked = [Path(os.fsdecode(path)) for path in untracked_result.stdout.split(b"\0") if path]
    for relative in sorted(untracked, key=lambda path: path.as_posix()):
        path = root / relative
        changes.update(b"untracked\0")
        changes.update(relative.as_posix().encode("utf-8", errors="surrogateescape"))
        changes.update(b"\0")
        try:
            if path.is_symlink():
                changes.update(b"symlink\0")
                changes.update(os.fsencode(os.readlink(path)))
            elif path.is_file():
                changes.update(b"file\0")
                with path.open("rb") as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        changes.update(chunk)
            else:
                changes.update(b"missing\0")
        except OSError as error:
            raise RuntimeError(f"cannot hash untracked source input: {path}") from error

    changes_digest = changes.hexdigest()
    identity = hashlib.sha256()
    identity.update(revision.encode("ascii"))
    identity.update(b"\0")
    identity.update(bytes.fromhex(changes_digest))
    return {
        "commit": revision,
        "dirty": bool(diff_result.stdout or untracked),
        "dirty_sha256": changes_digest,
        "sha256": identity.hexdigest(),
    }


def node_identity() -> dict[str, Any]:
    executable = shutil.which("node")
    if executable is None:
        raise RuntimeError("Node.js is required to run the Global TUI PTY smoke")
    try:
        result = subprocess.run(
            [executable, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
            timeout=5,
        )
        version = result.stdout.strip() if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("cannot identify the Node.js runtime used by the Global TUI PTY smoke") from error
    if not version:
        raise RuntimeError("Node.js did not report a version for the Global TUI PTY smoke")
    return {"version": version}


def collect_identity(root: Path, binary: Path, tui_entry: Path) -> dict[str, Any]:
    """Collect required identities or raise; never return a partial record."""
    binary = binary.resolve()
    tui_entry = tui_entry.resolve()
    if not binary.is_file():
        raise FileNotFoundError(f"Boreal binary is missing: {binary}")
    if binary.stat().st_size == 0:
        raise ValueError(f"Boreal binary is empty: {binary}")
    if not tui_entry.is_file():
        raise FileNotFoundError(f"Global TUI entrypoint is missing: {tui_entry}")
    if tui_entry.stat().st_size == 0:
        raise ValueError(f"Global TUI entrypoint is empty: {tui_entry}")
    return {
        "schema": SCHEMA,
        "source": source_identity(root),
        "binary": {
            "file_name": binary.name,
            "size_bytes": binary.stat().st_size,
            "sha256": sha256_file(binary),
        },
        "global_tui": {
            "entrypoint": tui_entry.name,
            "entrypoint_sha256": sha256_file(tui_entry),
            "bundle": tree_identity(tui_entry.parent),
        },
        "runtime": {"node": node_identity()},
    }


def write_identity(path: Path, identity: dict[str, Any]) -> None:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(identity, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
