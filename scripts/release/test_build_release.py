#!/usr/bin/env python3
"""Focused regression tests for release archives and Homebrew formulas."""

from __future__ import annotations

import hashlib
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BUILDER_PATH = ROOT / "scripts/release/build_release.py"
RENDERER_PATH = ROOT / "scripts/release/render_homebrew_formula.py"
SPEC = importlib.util.spec_from_file_location("boreal_build_release", BUILDER_PATH)
assert SPEC and SPEC.loader
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)


class BuildReleaseTests(unittest.TestCase):
    def test_sha256sums_keeps_each_target_sorted_and_reproducible(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            older_archive = output / "bwrk-v0.2.0-aarch64-apple-darwin.tar.gz"
            older_archive.write_bytes(b"older release archive fixture")
            archives = [
                output / "bwrk-v0.2.1-x86_64-unknown-linux-gnu.tar.gz",
                output / "bwrk-v0.2.1-aarch64-apple-darwin.tar.gz",
            ]
            archives[0].write_bytes(b"linux archive fixture")
            BUILDER.write_sha256sums(output, "0.2.1")
            first_entry = (
                f"{hashlib.sha256(archives[0].read_bytes()).hexdigest()}  {archives[0].name}\n"
            )
            sums_path = output / "SHA256SUMS"
            self.assertEqual(sums_path.read_text(encoding="utf-8"), first_entry)

            archives[1].write_bytes(b"macOS arm64 archive fixture")
            BUILDER.write_sha256sums(output, "0.2.1")
            expected_entries = [
                f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}"
                for archive in sorted(archives)
            ]
            expected = "\n".join(expected_entries) + "\n"
            self.assertEqual(sums_path.read_text(encoding="utf-8"), expected)
            self.assertIn(first_entry.rstrip("\n"), expected_entries)
            self.assertNotIn(older_archive.name, expected)

            before_repeat = sums_path.read_bytes()
            BUILDER.write_sha256sums(output, "0.2.1")
            self.assertEqual(sums_path.read_bytes(), before_repeat)

    def test_rendered_formula_installs_and_checks_global_tui(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            archive_args: list[str] = []
            archive_hashes: dict[str, str] = {}
            for target in (
                "aarch64-apple-darwin",
                "x86_64-apple-darwin",
                "x86_64-unknown-linux-gnu",
            ):
                archive = output / f"{target}.tar.gz"
                archive_bytes = f"fixture for {target}".encode("utf-8")
                archive.write_bytes(archive_bytes)
                archive_hashes[target] = hashlib.sha256(archive_bytes).hexdigest()
                archive_args.extend(["--archive", f"{target}={archive}"])

            formula = output / "boreal.rb"
            subprocess.run(
                [
                    sys.executable,
                    str(RENDERER_PATH),
                    "--version",
                    "0.2.1",
                    "--output",
                    str(formula),
                    *archive_args,
                ],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            rendered = formula.read_text(encoding="utf-8")
            self.assertNotIn("{{", rendered)
            formula_lines = rendered.splitlines()
            for target, digest in archive_hashes.items():
                archive_line = next(
                    index
                    for index, line in enumerate(formula_lines)
                    if f"bwrk-v0.2.1-{target}.tar.gz" in line
                )
                self.assertEqual(
                    formula_lines[archive_line + 1].strip(), f'sha256 "{digest}"'
                )
            self.assertIn(
                '(lib/"boreal").install "lib/boreal/global-tui"', rendered
            )
            self.assertIn(
                'assert_predicate lib/"boreal/global-tui/entrypoint.js", :exist?',
                rendered,
            )


if __name__ == "__main__":
    unittest.main()
