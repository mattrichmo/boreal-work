#!/usr/bin/env python3
"""Focused tests for exact Global TUI validation identity records."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from identity import collect_identity, sha256_file, source_identity, tree_identity, write_identity


class IdentityTests(unittest.TestCase):
    def test_file_and_runtime_tree_digests_cover_contents_and_paths(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-identity-") as temporary:
            root = Path(temporary)
            first = root / "dist/entrypoint.js"
            second = root / "dist/client.js"
            first.parent.mkdir()
            first.write_bytes(b"console.log('entry')\n")
            second.write_bytes(b"export {};\n")

            initial = tree_identity(first.parent)
            self.assertEqual(sha256_file(first), hashlib.sha256(first.read_bytes()).hexdigest())
            self.assertEqual(initial["file_count"], 2)

            second.write_bytes(b"export const changed = true;\n")
            self.assertNotEqual(initial["sha256"], tree_identity(first.parent)["sha256"])

    def test_source_identity_changes_for_tracked_and_untracked_edits(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-source-identity-") as temporary:
            root = Path(temporary)
            tracked = root / "source.rs"
            tracked.write_text("fn original() {}\n", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Validation"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "validation@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "source.rs"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "baseline"], check=True)

            clean = source_identity(root)
            self.assertFalse(clean["dirty"])
            tracked.write_text("fn changed() {}\n", encoding="utf-8")
            changed = source_identity(root)
            self.assertTrue(changed["dirty"])
            self.assertNotEqual(clean["sha256"], changed["sha256"])

            (root / "untracked.rs").write_text("fn extra() {}\n", encoding="utf-8")
            untracked = source_identity(root)
            self.assertNotEqual(changed["sha256"], untracked["sha256"])

    def test_build_identity_records_binary_bundle_and_writes_json(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-run-identity-") as temporary:
            root = Path(temporary)
            (root / "Cargo.toml").write_text("[workspace]\n", encoding="utf-8")
            (root / "Cargo.lock").write_text("version = 4\n", encoding="utf-8")
            (root / ".gitignore").write_text("/bwrk\n/apps/global-tui/dist/\n", encoding="utf-8")
            source = root / "apps/global-tui/src/entrypoint.ts"
            source.parent.mkdir(parents=True)
            source.write_text("console.log('source')\n", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Validation"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "validation@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", ".gitignore", "Cargo.toml", "Cargo.lock", "apps/global-tui/src/entrypoint.ts"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "candidate"], check=True)
            dist = root / "apps/global-tui/dist"
            dist.mkdir()
            entry = dist / "entrypoint.js"
            entry.write_text("console.log('bundle')\n", encoding="utf-8")
            binary = root / "bwrk"
            binary.write_bytes(b"compiled binary")

            identity = collect_identity(root, binary, entry)
            self.assertEqual(identity["source"]["commit"], subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
            ).stdout.strip())
            self.assertFalse(identity["source"]["dirty"])
            self.assertEqual(identity["binary"]["sha256"], sha256_file(binary))
            self.assertEqual(identity["binary"]["file_name"], "bwrk")
            self.assertEqual(identity["global_tui"]["bundle"]["file_count"], 1)
            self.assertEqual(identity["global_tui"]["entrypoint_sha256"], sha256_file(entry))
            self.assertIn("sha256", identity["source"])
            self.assertEqual(identity, collect_identity(root, binary, entry))

            output = root / "results/identity.json"
            write_identity(output, identity)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), identity)
            self.assertFalse(output.with_name("identity.json.tmp").exists())

    def test_missing_binary_fails_instead_of_returning_partial_identity(self) -> None:
        with tempfile.TemporaryDirectory(prefix="boreal-missing-identity-") as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(FileNotFoundError, "Boreal binary is missing"):
                collect_identity(root, root / "missing-bwrk", root / "missing-entrypoint.js")


if __name__ == "__main__":
    unittest.main()
