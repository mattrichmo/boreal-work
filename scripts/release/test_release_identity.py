#!/usr/bin/env python3
"""Executable dependency-free tests for the P4-05 release identity checker."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
CHECKER = HERE / "release_identity.py"
FIXTURE = HERE / "fixtures" / "snapshot"


def run(*args: str, expected: int = 0) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["python3", str(CHECKER), *args],
        cwd=HERE.parents[2],
        capture_output=True,
        text=True,
    )
    if result.returncode != expected:
        raise AssertionError(
            f"unexpected exit {result.returncode} (expected {expected})\nstdout={result.stdout}\nstderr={result.stderr}"
        )
    return result


def copy_fixture(parent: Path) -> Path:
    target = parent / "snapshot"
    shutil.copytree(FIXTURE, target)
    return target


def test_manifest_is_reproducible() -> None:
    with tempfile.TemporaryDirectory() as directory:
        output_a = Path(directory) / "a.json"
        output_b = Path(directory) / "b.json"
        run("manifest", "--root", str(FIXTURE), "--output", str(output_a))
        run("manifest", "--root", str(FIXTURE), "--output", str(output_b))
        assert output_a.read_bytes() == output_b.read_bytes()
        value = json.loads(output_a.read_text(encoding="utf-8"))
        assert value["manifest_version"] == "boreal.release_manifest.v1"
        assert set(value["versions"]) == {"protocol", "schema", "memory", "directive", "workflow"}
        assert value["snapshot_identity"].startswith("sha256:")
        assert sum(len(component["assets"]) for component in value["components"].values()) >= 8


def test_check_detects_asset_drift() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = copy_fixture(Path(directory))
        manifest = Path(directory) / "release.json"
        run("manifest", "--root", str(root), "--output", str(manifest))
        run("check", "--root", str(root), "--manifest", str(manifest))
        schema = root / "project/spec/schema-v2.sql"
        schema.write_text(schema.read_text(encoding="utf-8") + "-- drift\n", encoding="utf-8")
        failed = run("check", "--root", str(root), "--manifest", str(manifest), expected=1)
        assert "manifest mismatch" in failed.stderr


def test_check_rejects_manifest_path_escape() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = copy_fixture(Path(directory))
        manifest = Path(directory) / "release.json"
        run("manifest", "--root", str(root), "--output", str(manifest))
        value = json.loads(manifest.read_text(encoding="utf-8"))
        value["components"]["schema"]["assets"][0]["path"] = "../outside"
        manifest.write_text(json.dumps(value), encoding="utf-8")
        failed = run("check", "--root", str(root), "--manifest", str(manifest), expected=1)
        assert "manifest mismatch" in failed.stderr or "unsafe" in failed.stderr


def test_simulation_is_temp_only_and_rolls_back() -> None:
    with tempfile.TemporaryDirectory() as directory:
        base = Path(directory)
        root = copy_fixture(base)
        manifest = base / "release.json"
        staging = base / "staging"
        staging.mkdir()
        before = hashlib.sha256((root / "Cargo.toml").read_bytes()).hexdigest()
        run("manifest", "--root", str(root), "--output", str(manifest))
        result = run(
            "simulate",
            "--root",
            str(root),
            "--manifest",
            str(manifest),
            "--staging-dir",
            str(staging),
        )
        value = json.loads(result.stdout)
        assert value["install_verified"] is True
        assert value["rollback_verified"] is True
        assert hashlib.sha256((root / "Cargo.toml").read_bytes()).hexdigest() == before
        transaction = Path(value["transaction_directory"])
        assert (transaction / "simulated-live/previous-install.marker").is_file()
        assert (transaction / "rolled-back-install/project/spec/schema-v2.sql").is_file()


def test_simulation_refuses_non_temp_target() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = copy_fixture(Path(directory))
        manifest = Path(directory) / "release.json"
        run("manifest", "--root", str(root), "--output", str(manifest))
        failed = run(
            "simulate",
            "--root",
            str(root),
            "--manifest",
            str(manifest),
            "--staging-dir",
            str(HERE),
            expected=1,
        )
        assert "system temp directory" in failed.stderr


def main() -> int:
    tests = [
        test_manifest_is_reproducible,
        test_check_detects_asset_drift,
        test_check_rejects_manifest_path_escape,
        test_simulation_is_temp_only_and_rolls_back,
        test_simulation_refuses_non_temp_target,
    ]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"PASS: {len(tests)} release identity tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
