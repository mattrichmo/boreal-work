#!/usr/bin/env python3
"""Executable dependency-free tests for the P4-05 release identity checker."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
CHECKER = HERE / "release_identity.py"
FIXTURE = HERE / "fixtures" / "snapshot"
INSTALLER = HERE.parents[1] / "install.sh"


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
        assert set(value["versions"]) == {"protocol", "schema", "memory", "directive", "workflow", "skill"}
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


def test_download_checksum_lookup_is_locale_stable_and_unambiguous() -> None:
    machine = platform.machine().lower()
    if platform.system() == "Darwin" and machine in {"arm64", "aarch64"}:
        target = "aarch64-apple-darwin"
    elif platform.system() == "Darwin" and machine in {"x86_64", "amd64"}:
        target = "x86_64-apple-darwin"
    elif platform.system() == "Linux" and machine in {"x86_64", "amd64"}:
        target = "x86_64-unknown-linux-gnu"
    else:
        raise AssertionError(f"unsupported release-checksum test host: {platform.system()} {machine}")

    version = "0.2.1"
    archive_name = f"bwrk-v{version}-{target}.tar.gz"
    archive_bytes = b"not a tar archive; checksum validation must pass first\n"
    digest = hashlib.sha256(archive_bytes).hexdigest()
    with tempfile.TemporaryDirectory(prefix="boreal-download-checksum-") as directory:
        scratch = Path(directory)
        assets = scratch / "assets"
        bin_dir = scratch / "bin"
        assets.mkdir()
        bin_dir.mkdir()
        (assets / archive_name).write_bytes(archive_bytes)
        sums_path = assets / "SHA256SUMS"
        curl = bin_dir / "curl"
        curl.write_text(
            "#!/usr/bin/env python3\n"
            "import os, shutil, sys\n"
            "from pathlib import Path\n"
            "args = sys.argv[1:]\n"
            "destination = None\n"
            "url = None\n"
            "i = 0\n"
            "while i < len(args):\n"
            "    if args[i] == '-o' and i + 1 < len(args):\n"
            "        destination = args[i + 1]; i += 2; continue\n"
            "    if args[i].startswith('-'):\n"
            "        i += 1; continue\n"
            "    url = args[i]; i += 1\n"
            "if destination is None or url is None:\n"
            "    raise SystemExit('unsupported fixture curl arguments')\n"
            "name = url.rsplit('/', 1)[-1]\n"
            "source = Path(os.environ['BOREAL_FIXTURE_ASSETS']) / name\n"
            "if not source.is_file() or source.is_symlink():\n"
            "    raise SystemExit('missing fixture release asset: ' + name)\n"
            "shutil.copyfile(source, destination)\n",
            encoding="utf-8",
        )
        curl.chmod(0o755)

        env = os.environ.copy()
        home = scratch / "home"
        home.mkdir()
        env.update(
            {
                "PATH": f"{bin_dir}:{env.get('PATH', '')}",
                "HOME": str(home),
                "TMPDIR": str(scratch),
                "BOREAL_INSTALL_UI": "plain",
                "BOREAL_INSTALL_TUI": "0",
                "BOREAL_VERIFY_INSTALL": "1",
                "BOREAL_ALLOW_SOURCE_FALLBACK": "0",
                "BOREAL_REPOSITORY": "mattrichmo/boreal-work",
                "BOREAL_FIXTURE_ASSETS": str(assets),
                # This locale is unsupported by the macOS Perl shasum on some
                # hosts; the installer must pin checksum tools to the C locale.
                "LC_ALL": "C.UTF-8",
                "LANG": "C.UTF-8",
            }
        )
        command = [
            "sh",
            str(INSTALLER),
            "--version",
            version,
            "--prefix",
            str(scratch / "prefix"),
            "--yes",
            "--no-dashboard",
        ]

        sums_path.write_text(
            f"{digest}  {archive_name}\n{digest.upper()}  another-target.tar.gz\n",
            encoding="ascii",
        )
        valid = subprocess.run(command, cwd=INSTALLER.parent, env=env, capture_output=True, text=True)
        assert valid.returncode != 0
        assert "cannot read release archive" in valid.stderr, valid.stderr
        assert "checksum verification failed" not in valid.stderr, valid.stderr

        sums_path.write_text(
            f"{digest}  {archive_name}\n{digest}  {archive_name}\n",
            encoding="ascii",
        )
        duplicate = subprocess.run(command, cwd=INSTALLER.parent, env=env, capture_output=True, text=True)
        assert duplicate.returncode != 0
        assert "exactly once as a valid SHA-256 entry" in duplicate.stderr, duplicate.stderr
        assert "checksum verification failed" not in duplicate.stderr, duplicate.stderr


def main() -> int:
    tests = [
        test_manifest_is_reproducible,
        test_check_detects_asset_drift,
        test_check_rejects_manifest_path_escape,
        test_simulation_is_temp_only_and_rolls_back,
        test_simulation_refuses_non_temp_target,
        test_download_checksum_lookup_is_locale_stable_and_unambiguous,
    ]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"PASS: {len(tests)} release identity tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
