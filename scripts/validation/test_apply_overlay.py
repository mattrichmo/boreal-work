#!/usr/bin/env python3
"""Focused tests for the manifest-backed source overlay tool."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from hashlib import sha256
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "apply_overlay.py"


def archive(path: Path, files: dict[str, bytes], source_commit: str | None = None) -> None:
    manifest_files = []
    for relative_path, data in sorted(files.items()):
        manifest_files.append(
            {
                "path": relative_path,
                "bytes": len(data),
                "mode": 0o644,
                "sha256": sha256(data).hexdigest(),
            }
        )
    manifest = {
        "schema_version": "boreal.archive-manifest.v1",
        "archive_id": "fixture",
        "archive_directory": "boreal-v2",
        "generated_at": "2026-09-21T00:00:00Z",
        "source_commit": source_commit,
        "source_branch": "fixture",
        "source_dirty": False,
        "file_count": len(manifest_files),
        "files": manifest_files,
        "metadata_files": ["REFERENCE_INDEX.md", "ARCHIVE_MANIFEST.json"],
        "deletions": [],
        "protected_paths": [".git", ".boreal", "memory", "target", "node_modules", "test-project"],
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as handle:
        handle.writestr("boreal-v2/REFERENCE_INDEX.md", "# fixture\n")
        handle.writestr("boreal-v2/ARCHIVE_MANIFEST.json", json.dumps(manifest))
        for relative_path, data in files.items():
            handle.writestr(f"boreal-v2/{relative_path}", data)


def legacy_archive(path: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as handle:
        for relative_path, data in files.items():
            handle.writestr(f"boreal-v2/{relative_path}", data)


def run_overlay(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


class ApplyOverlayTests(unittest.TestCase):
    def test_three_way_check_allows_safe_replace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.mkdir()
            (target / "crates").mkdir()
            (target / "crates" / "value.txt").write_bytes(b"base")
            base = root / "base.zip"
            incoming = root / "incoming.zip"
            archive(base, {"crates/value.txt": b"base"})
            archive(incoming, {"crates/value.txt": b"incoming"})

            result = run_overlay(str(incoming), "--target", str(target), "--base", str(base), "--check")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("safe_replace: 1", result.stdout)

    def test_three_way_check_blocks_local_and_incoming_conflict(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.mkdir()
            (target / "crates").mkdir()
            (target / "crates" / "value.txt").write_bytes(b"local")
            base = root / "base.zip"
            incoming = root / "incoming.zip"
            archive(base, {"crates/value.txt": b"base"})
            archive(incoming, {"crates/value.txt": b"incoming"})

            result = run_overlay(
                str(incoming), "--target", str(target), "--base", str(base), "--check", "--json"
            )

            self.assertEqual(result.returncode, 1)
            report = json.loads(result.stdout)
            self.assertTrue(report["blocking"])
            self.assertEqual(report["summary"]["conflict"], 1)
            self.assertEqual((target / "crates" / "value.txt").read_bytes(), b"local")

    def test_apply_requires_backup_and_preserves_original(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.mkdir()
            (target / "crates").mkdir()
            (target / "crates" / "value.txt").write_bytes(b"base")
            base = root / "base.zip"
            incoming = root / "incoming.zip"
            backup = root / "backup"
            archive(base, {"crates/value.txt": b"base"})
            archive(incoming, {"crates/value.txt": b"incoming"})

            result = run_overlay(
                str(incoming),
                "--target",
                str(target),
                "--base",
                str(base),
                "--apply",
                "--backup",
                str(backup),
                "--json",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((target / "crates" / "value.txt").read_bytes(), b"incoming")
            self.assertEqual((backup / "crates" / "value.txt").read_bytes(), b"base")
            journal = json.loads((backup / "OVERLAY_JOURNAL.json").read_text())
            self.assertEqual(journal["state"], "complete")

    def test_protected_path_blocks_apply(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.mkdir()
            incoming = root / "incoming.zip"
            archive(incoming, {".boreal/project.json": b"foreign"})

            result = run_overlay(str(incoming), "--target", str(target), "--check", "--json")

            self.assertEqual(result.returncode, 1)
            report = json.loads(result.stdout)
            self.assertEqual(report["summary"]["protected"], 1)

    def test_legacy_archive_requires_conservative_mode_and_blocks_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.mkdir()
            (target / "value.txt").write_bytes(b"local")
            incoming = root / "incoming.zip"
            legacy_archive(incoming, {"value.txt": b"incoming"})

            rejected = run_overlay(str(incoming), "--target", str(target), "--check")
            self.assertEqual(rejected.returncode, 2)
            self.assertIn("no ARCHIVE_MANIFEST.json", rejected.stderr)

            conservative = run_overlay(
                str(incoming), "--target", str(target), "--allow-legacy", "--check"
            )
            self.assertEqual(conservative.returncode, 1)
            self.assertIn("conflict: 1", conservative.stdout)


if __name__ == "__main__":
    unittest.main()
