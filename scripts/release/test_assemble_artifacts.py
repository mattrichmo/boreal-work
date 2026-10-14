#!/usr/bin/env python3
"""Focused fixtures for strict multi-target release assembly."""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

from assemble_artifacts import AssemblyError, TARGETS, assemble, canonical_json


def manifest(target: str, *, source_revision: str = "a" * 40) -> dict[str, object]:
    basis: dict[str, object] = {
        "manifest_version": "boreal.binary_release.v1",
        "version": "0.2.2",
        "source_revision": source_revision,
        "target": target,
        "source_id": "sha256:" + "1" * 64,
        "contracts": {"snapshot_identity": "sha256:" + "2" * 64},
        "tui": {"source_id": "sha256:" + "3" * 64},
        "global_tui": {"source_id": "sha256:" + "4" * 64},
    }
    basis["artifact_identity"] = "sha256:" + hashlib.sha256(canonical_json(basis)).hexdigest()
    return basis


def fixture(directory: Path) -> None:
    for target in sorted(TARGETS):
        name = f"bwrk-v0.2.2-{target}"
        (directory / f"{name}.tar.gz").write_bytes(f"archive:{target}\n".encode())
        (directory / f"{name}.release.json").write_bytes(
            canonical_json(manifest(target))
        )


def rejected(label: str, action) -> None:
    try:
        action()
    except AssemblyError:
        return
    raise AssertionError(f"assembler accepted invalid fixture: {label}")


def test_complete_flat_layout() -> None:
    with tempfile.TemporaryDirectory(prefix="boreal-assembly-") as temporary:
        root = Path(temporary)
        source = root / "input"
        output = root / "output"
        source.mkdir()
        fixture(source)
        assemble(source, output)

        expected_archives = {f"bwrk-v0.2.2-{target}.tar.gz" for target in TARGETS}
        if {path.name for path in output.glob("*.tar.gz")} != expected_archives:
            raise AssertionError("assembled archive set does not match the supported target matrix")
        if len((output / "release-bundle.json").read_text(encoding="utf-8")) == 0:
            raise AssertionError("release bundle identity was not written")
        entries = (output / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
        if len(entries) != len(TARGETS):
            raise AssertionError("combined checksum file does not cover each target archive")
        if {entry.split()[1] for entry in entries} != expected_archives:
            raise AssertionError("checksum entries do not use exact flat archive basenames")


def test_rejects_source_drift_and_missing_archive() -> None:
    with tempfile.TemporaryDirectory(prefix="boreal-assembly-drift-") as temporary:
        root = Path(temporary)
        source = root / "input"
        source.mkdir()
        fixture(source)
        target = sorted(TARGETS)[-1]
        name = f"bwrk-v0.2.2-{target}"
        (source / f"{name}.release.json").write_bytes(
            canonical_json(manifest(target, source_revision="b" * 40))
        )
        rejected("platform source revision drift", lambda: assemble(source, root / "drift-output"))

        (source / f"{name}.release.json").write_bytes(canonical_json(manifest(target)))
        (source / f"{name}.tar.gz").unlink()
        rejected("missing target archive", lambda: assemble(source, root / "missing-output"))


if __name__ == "__main__":
    test_complete_flat_layout()
    test_rejects_source_drift_and_missing_archive()
    print("release assembly fixtures: PASS (complete matrix, exact checksum layout, failure cases)")
