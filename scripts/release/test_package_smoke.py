#!/usr/bin/env python3
"""Exercise the installer's release-download/checksum path without a network."""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "install.sh"
VERSION_RE = re.compile(
    r"^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
REPOSITORY = "mattrichmo/boreal-work"


def fail(message: str) -> None:
    raise SystemExit(f"package release fixture: {message}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def host_target() -> str:
    machine = platform.machine().lower()
    if platform.system() == "Linux" and machine in {"x86_64", "amd64"}:
        return "x86_64-unknown-linux-gnu"
    if platform.system() == "Darwin" and machine in {"arm64", "aarch64"}:
        return "aarch64-apple-darwin"
    if platform.system() == "Darwin" and machine in {"x86_64", "amd64"}:
        return "x86_64-apple-darwin"
    fail(f"unsupported installer host for release fixture: {platform.system()} {machine}")


def parse_archive(path: Path) -> tuple[str, str]:
    if path.is_symlink() or not path.is_file():
        fail(f"archive must be a regular file: {path}")
    target = host_target()
    suffix = f"-{target}.tar.gz"
    if not path.name.startswith("bwrk-v") or not path.name.endswith(suffix):
        fail(f"archive basename is not this host's versioned publication asset: {path.name}")
    version = path.name[len("bwrk-v") : -len(suffix)]
    if not VERSION_RE.fullmatch(version):
        fail(f"archive basename has an invalid release version: {path.name}")
    return version, path.name


def write_checksums(directory: Path, archive_name: str, digest: str, *, name: str | None = None) -> None:
    # GitHub release assets use sha256sum's two-space separator and basename.
    entry_name = name or archive_name
    (directory / "SHA256SUMS").write_text(f"{digest}  {entry_name}\n", encoding="ascii")


def write_curl_shim(path: Path) -> None:
    path.write_text(
        "#!/usr/bin/env python3\n"
        "import os, shutil, sys\n"
        "from pathlib import Path\n"
        "args = sys.argv[1:]\n"
        "destination = None\n"
        "url = None\n"
        "i = 0\n"
        "while i < len(args):\n"
        "    arg = args[i]\n"
        "    if arg == '-o' and i + 1 < len(args):\n"
        "        destination = args[i + 1]; i += 2; continue\n"
        "    if arg == '-w' and i + 1 < len(args):\n"
        "        i += 2; continue\n"
        "    if arg.startswith('-'):\n"
        "        i += 1; continue\n"
        "    url = arg; i += 1\n"
        "if destination is None or url is None:\n"
        "    raise SystemExit('fixture curl received unsupported arguments: ' + repr(args))\n"
        "log = Path(os.environ['BOREAL_FIXTURE_CURL_LOG'])\n"
        "with log.open('a', encoding='utf-8') as output: output.write(url + '\\n')\n"
        "base = os.environ['BOREAL_FIXTURE_RELEASE_URL'] + '/'\n"
        "if not url.startswith(base):\n"
        "    raise SystemExit('fixture curl refused URL outside the local release fixture')\n"
        "name = url[len(base):]\n"
        "if not name or '/' in name or name in {'.', '..'}:\n"
        "    raise SystemExit('fixture curl refused a non-basename asset path')\n"
        "source = Path(os.environ['BOREAL_FIXTURE_ASSETS']) / name\n"
        "if not source.is_file() or source.is_symlink():\n"
        "    raise SystemExit('fixture curl has no regular asset named ' + name)\n"
        "if destination == '/dev/null':\n"
        "    raise SystemExit('fixture curl does not serve preflight-only requests')\n"
        "target = Path(destination)\n"
        "target.parent.mkdir(parents=True, exist_ok=True)\n"
        "shutil.copyfile(source, target)\n",
        encoding="utf-8",
    )
    path.chmod(0o755)


def make_modified_manifest_archive(source: Path, destination: Path) -> None:
    """Alter source identity and recompute artifact identity, preserving the tar layout."""
    with tarfile.open(source, "r:gz") as original, tarfile.open(
        destination, "w:gz", format=tarfile.PAX_FORMAT
    ) as changed:
        for member in original.getmembers():
            contents = original.extractfile(member) if member.isfile() else None
            if member.name.endswith("/share/boreal/release.json"):
                assert contents is not None
                manifest = json.loads(contents.read().decode("utf-8"))
                manifest["source_id"] = "sha256:" + "0" * 64
                identity_input = {key: value for key, value in manifest.items() if key != "artifact_identity"}
                manifest["artifact_identity"] = "sha256:" + hashlib.sha256(
                    canonical_json(identity_input)
                ).hexdigest()
                encoded = canonical_json(manifest)
                member = copy.copy(member)
                member.size = len(encoded)
                changed.addfile(member, io.BytesIO(encoded))
            else:
                changed.addfile(member, contents)


def make_unsafe_archive(destination: Path, root_name: str, *, traversal: bool) -> None:
    """Make the smallest archive that must be rejected before extraction."""
    with tarfile.open(destination, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        if traversal:
            member = tarfile.TarInfo(f"{root_name}/../escaped")
            payload = b"must not be extracted\n"
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))
        else:
            member = tarfile.TarInfo(f"{root_name}/unsafe-link")
            member.type = tarfile.SYMTYPE
            member.linkname = "../../outside"
            archive.addfile(member)


def run_installer(
    *,
    installer: Path,
    version: str,
    assets: Path,
    scratch: Path,
    label: str,
) -> subprocess.CompletedProcess[str]:
    prefix = scratch / f"prefix-{label}"
    home = scratch / f"home-{label}"
    global_root = scratch / f"global-{label}"
    temp_root = scratch / f"tmp-{label}"
    for path in (home, global_root, temp_root):
        path.mkdir(parents=True, exist_ok=True)
    curl_log = scratch / f"curl-{label}.log"
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{scratch / 'bin'}:{env.get('PATH', '')}",
            "HOME": str(home),
            "TMPDIR": str(temp_root),
            "BOREAL_GLOBAL_ROOT": str(global_root),
            "BOREAL_INSTALL_UI": "plain",
            "BOREAL_INSTALL_TUI": "0",
            "BOREAL_VERIFY_INSTALL": "1",
            "BOREAL_ALLOW_SOURCE_FALLBACK": "0",
            "BOREAL_REPOSITORY": REPOSITORY,
            "BOREAL_FIXTURE_ASSETS": str(assets),
            "BOREAL_FIXTURE_RELEASE_URL": f"https://github.com/{REPOSITORY}/releases/download/v{version}",
            "BOREAL_FIXTURE_CURL_LOG": str(curl_log),
        }
    )
    env.pop("BOREAL_VERSION", None)
    env.pop("BOREAL_PREFIX", None)
    result = subprocess.run(
        ["sh", str(installer), "--version", version, "--prefix", str(prefix), "--yes", "--no-dashboard"],
        cwd=installer.parent,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    result.fixture_prefix = prefix  # type: ignore[attr-defined]
    result.fixture_curl_log = curl_log  # type: ignore[attr-defined]
    result.fixture_global_root = global_root  # type: ignore[attr-defined]
    return result


def expect_rejected(result: subprocess.CompletedProcess[str], label: str) -> None:
    if result.returncode == 0:
        fail(f"installer accepted invalid release fixture: {label}")
    if not result.fixture_curl_log.is_file() or len(result.fixture_curl_log.read_text().splitlines()) != 2:
        fail(f"installer did not fetch exactly the archive and SHA256SUMS for {label}")
    if (result.fixture_prefix / "bin/bwrk").exists():
        fail(f"failed installer published a binary for {label}")
    if result.fixture_global_root.exists() and any(result.fixture_global_root.iterdir()):
        fail(f"failed installer changed Global state for {label}")


def test_release_fixture(archive: Path, installer: Path = INSTALLER) -> None:
    if installer.is_symlink() or not installer.is_file():
        fail(f"installer must be a regular file: {installer}")
    version, archive_name = parse_archive(archive)
    if not installer.exists():
        fail(f"installer is missing: {installer}")

    with tempfile.TemporaryDirectory(prefix="boreal-release-fixture-") as temporary:
        scratch = Path(temporary)
        shim_dir = scratch / "bin"
        shim_dir.mkdir()
        write_curl_shim(shim_dir / "curl")

        # This is the flat publication layout: a versioned release asset and
        # SHA256SUMS naming that exact basename with sha256sum's separator.
        valid_assets = scratch / "valid-assets"
        valid_assets.mkdir()
        shutil.copyfile(archive, valid_assets / archive_name)
        digest = sha256(valid_assets / archive_name)
        write_checksums(valid_assets, archive_name, digest)

        success = run_installer(
            installer=installer,
            version=version,
            assets=valid_assets,
            scratch=scratch,
            label="valid",
        )
        if success.returncode != 0:
            fail(f"valid release-layout install failed\nstdout={success.stdout}\nstderr={success.stderr}")
        expected_calls = [
            f"https://github.com/{REPOSITORY}/releases/download/v{version}/{archive_name}",
            f"https://github.com/{REPOSITORY}/releases/download/v{version}/SHA256SUMS",
        ]
        if success.fixture_curl_log.read_text(encoding="utf-8").splitlines() != expected_calls:
            fail("installer did not request the expected release archive and publication manifest")
        installed_version = subprocess.run(
            [str(success.fixture_prefix / "bin/bwrk"), "--version"],
            check=False,
            capture_output=True,
            text=True,
        )
        if installed_version.returncode or f"bwrk {version} " not in installed_version.stdout:
            fail("release-layout fixture did not install the expected versioned CLI")
        if not (success.fixture_global_root / "global.sqlite").is_file():
            fail("release-layout fixture did not keep Global provisioning inside its scratch root")

        # A correct digest attached to the wrong filename must not satisfy the
        # installer's exact basename lookup.
        wrong_name = scratch / "wrong-name-assets"
        wrong_name.mkdir()
        shutil.copyfile(valid_assets / archive_name, wrong_name / archive_name)
        write_checksums(wrong_name, archive_name, digest, name="bwrk-vwrong-target.tar.gz")
        expect_rejected(
            run_installer(installer=installer, version=version, assets=wrong_name, scratch=scratch, label="wrong-name"),
            "SHA256SUMS basename mismatch",
        )

        wrong_hash = scratch / "wrong-hash-assets"
        wrong_hash.mkdir()
        shutil.copyfile(valid_assets / archive_name, wrong_hash / archive_name)
        write_checksums(wrong_hash, archive_name, "0" * 64 if digest != "0" * 64 else "1" * 64)
        result = run_installer(installer=installer, version=version, assets=wrong_hash, scratch=scratch, label="wrong-hash")
        expect_rejected(result, "SHA256SUMS digest mismatch")
        if "checksum verification failed" not in result.stderr:
            fail("wrong release digest was rejected for an unexpected reason")

        # Recompute the outer archive checksum so this reaches the staged
        # manifest-to-binary identity check rather than failing checksum lookup.
        bad_manifest = scratch / "bad-manifest.tar.gz"
        make_modified_manifest_archive(valid_assets / archive_name, bad_manifest)
        manifest_assets = scratch / "bad-manifest-assets"
        manifest_assets.mkdir()
        shutil.copyfile(bad_manifest, manifest_assets / archive_name)
        write_checksums(manifest_assets, archive_name, sha256(manifest_assets / archive_name))
        result = run_installer(installer=installer, version=version, assets=manifest_assets, scratch=scratch, label="bad-manifest")
        expect_rejected(result, "manifest source identity mismatch")
        if "source identity" not in result.stderr and "capability validation failed" not in result.stderr:
            fail("wrong manifest identity was rejected for an unexpected reason")

        # Unsafe archive members are hashed correctly too, so rejection proves
        # the installer's archive-path and member-type checks ran after checksum.
        for label, traversal in (("traversal", True), ("symlink", False)):
            unsafe_archive = scratch / f"{label}.tar.gz"
            make_unsafe_archive(unsafe_archive, archive_name.removesuffix(".tar.gz"), traversal=traversal)
            unsafe_assets = scratch / f"{label}-assets"
            unsafe_assets.mkdir()
            shutil.copyfile(unsafe_archive, unsafe_assets / archive_name)
            write_checksums(unsafe_assets, archive_name, sha256(unsafe_assets / archive_name))
            result = run_installer(installer=installer, version=version, assets=unsafe_assets, scratch=scratch, label=label)
            expect_rejected(result, f"archive {label}")
            expected_error = "path traversal" if traversal else "no links or special files"
            if expected_error not in result.stderr:
                fail(f"unsafe {label} archive was rejected for an unexpected reason")

    print(f"package release fixture: PASS ({archive_name}; exact download/checksum path, fail-closed cases)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path, help="versioned archive produced by build_release.py")
    parser.add_argument("--installer", type=Path, default=INSTALLER)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    try:
        test_release_fixture(args.archive.absolute(), args.installer.absolute())
    except (OSError, tarfile.TarError, json.JSONDecodeError) as error:
        fail(str(error))
