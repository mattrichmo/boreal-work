#!/usr/bin/env python3
"""Build a self-contained Boreal v2 CLI/TUI release archive.

The script deliberately owns staging and archive creation only.  The Rust
application remains the authority for project state, while this boundary
records the exact executable, TUI, toolchain, and contract identities shipped
to a user.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SEMVER = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
TARGET = re.compile(r"^[A-Za-z0-9_.-]+$")


class ReleaseBuildError(RuntimeError):
    """A release input or build step failed safely."""


def run(command: list[str], *, cwd: Path = ROOT, capture: bool = False) -> str:
    print("+", " ".join(command))
    result = subprocess.run(
        command,
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise ReleaseBuildError(
            f"command failed with exit {result.returncode}: {' '.join(command)}"
            + (f"\n{detail}" if detail else "")
        )
    return result.stdout or ""


def workspace_version(root: Path) -> str:
    text = (root / "Cargo.toml").read_text(encoding="utf-8")
    section = re.search(r"(?ms)^\[workspace\.package\]\s*(.*?)(?:^\[|\Z)", text)
    if not section:
        raise ReleaseBuildError("Cargo.toml is missing [workspace.package]")
    match = re.search(r'^version\s*=\s*["\']([^"\']+)["\']\s*$', section.group(1), re.M)
    if not match:
        raise ReleaseBuildError("Cargo.toml is missing workspace package version")
    version = match.group(1)
    if not SEMVER.fullmatch(version):
        raise ReleaseBuildError(f"workspace version is not semver: {version!r}")
    return version


def host_target() -> str:
    output = run(["rustc", "-vV"], capture=True)
    for line in output.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise ReleaseBuildError("rustc -vV did not report a host target")


def tool_version(command: list[str]) -> str:
    output = run(command, capture=True).strip()
    return output.splitlines()[0] if output else "unknown"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )


def asset_record(stage: Path, relative: str) -> dict[str, Any]:
    path = stage / relative
    if path.is_symlink() or not path.is_file():
        raise ReleaseBuildError(f"release asset is not a regular file: {relative}")
    return {
        "path": relative,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def collect_assets(stage: Path) -> list[dict[str, Any]]:
    paths = ["bin/bwrk", "share/boreal/LICENSE", "share/boreal/install.sh"]
    tui_root = stage / "lib/boreal/tui"
    if not (tui_root / "entrypoint.js").is_file():
        raise ReleaseBuildError("compiled TUI entrypoint is missing from the staged release")
    paths.extend(
        path.relative_to(stage).as_posix()
        for path in sorted(tui_root.rglob("*"))
        if path.is_file()
    )
    return [asset_record(stage, relative) for relative in sorted(paths)]


def contract_identity(root: Path, output: Path) -> dict[str, Any]:
    run(
        [
            sys.executable,
            str(root / "scripts/release/release_identity.py"),
            "manifest",
            "--root",
            str(root),
            "--output",
            str(output),
        ]
    )
    return json.loads(output.read_text(encoding="utf-8"))


def build(root: Path, target: str, skip_build: bool) -> None:
    if skip_build:
        print("Skipping compilation; using existing release binary and TUI dist")
        return
    cargo = [
        "cargo",
        "build",
        "--release",
        "--locked",
        "-p",
        "boreal-cli",
        "--bin",
        "bwrk",
    ]
    if target:
        cargo.extend(["--target", target])
    run(cargo, cwd=root)
    run(["npm", "--prefix", str(root / "apps/tui"), "run", "build"], cwd=root)


def binary_path(root: Path, target: str) -> Path:
    if target:
        return root / "target" / target / "release" / "bwrk"
    return root / "target" / "release" / "bwrk"


def write_release_manifest(
    stage: Path,
    *,
    version: str,
    target: str,
    contract: dict[str, Any],
    tui_node_range: str,
) -> Path:
    assets = collect_assets(stage)
    manifest: dict[str, Any] = {
        "manifest_version": "boreal.binary_release.v1",
        "package_id": "boreal-work",
        "version": version,
        "target": target,
        "binary": {"path": "bin/bwrk", "sha256": next(a["sha256"] for a in assets if a["path"] == "bin/bwrk")},
        "tui": {
            "runtime": "node",
            "node_range": tui_node_range,
            "api_version": contract["contract"]["api_version"],
            "envelope_schema": contract["components"]["protocol"]["schema"],
            "entrypoint": "lib/boreal/tui/entrypoint.js",
            "assets": [a for a in assets if a["path"].startswith("lib/boreal/tui/")],
        },
        "toolchain": {
            "rustc": tool_version(["rustc", "--version"]),
            "cargo": tool_version(["cargo", "--version"]),
            "node": tool_version(["node", "--version"]),
            "typescript": tool_version(["tsc", "--version"]),
        },
        "contracts": {
            "snapshot_identity": contract["snapshot_identity"],
            "asset_count": sum(
                len(component.get("assets", []))
                for component in contract.get("components", {}).values()
            ),
            "api_version": contract["contract"]["api_version"],
            "contract_revision": contract["contract"]["contract_revision"],
            "fixture_version": contract["contract"]["fixture_version"],
            "components": {
                name: {
                    "schema": component["schema"],
                    "version": component["version"],
                    "identity": component["identity"],
                }
                for name, component in sorted(contract["components"].items())
            },
        },
        "assets": assets,
    }
    manifest["artifact_identity"] = "sha256:" + hashlib.sha256(
        canonical_json({key: value for key, value in manifest.items() if key != "artifact_identity"})
    ).hexdigest()
    output = stage / "share/boreal/release.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(canonical_json(manifest))
    return output


def tui_node_range(root: Path) -> str:
    package = json.loads((root / "apps/tui/package.json").read_text(encoding="utf-8"))
    value = package.get("engines", {}).get("node")
    if not isinstance(value, str) or not value:
        raise ReleaseBuildError("apps/tui/package.json is missing a Node.js engine range")
    return value


def create_archive(stage: Path, archive: Path) -> None:
    # Normalize archive metadata so rebuilding the same staged payload does
    # not change the tarball because of checkout timestamps or local uid/gid.
    with archive.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as handle:
                paths = [stage, *sorted(stage.rglob("*"))]
                for path in paths:
                    relative = path.relative_to(stage)
                    arcname = stage.name if not relative.parts else f"{stage.name}/{relative.as_posix()}"
                    info = handle.gettarinfo(path, arcname=arcname)
                    info.mtime = 0
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    if info.isfile():
                        info.mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
                        with path.open("rb") as source:
                            handle.addfile(info, source)
                    else:
                        handle.addfile(info)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--version", help="release version; defaults to Cargo workspace version")
    parser.add_argument("--target", help="Rust target triple; defaults to the local host")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "release-artifacts",
        help="directory for the staged archive and checksums",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="package existing target/release/bwrk and apps/tui/dist output",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    version = args.version or workspace_version(root)
    if not SEMVER.fullmatch(version):
        raise ReleaseBuildError(f"release version is not semver: {version!r}")
    package_version = workspace_version(root)
    if version != package_version:
        raise ReleaseBuildError(
            f"release version {version} does not match Cargo workspace version {package_version}"
        )
    target = args.target or host_target()
    if not TARGET.fullmatch(target):
        raise ReleaseBuildError(f"unsafe target name: {target!r}")
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_base = f"bwrk-v{version}-{target}"
    stage = output_dir / archive_base
    archive = output_dir / f"{archive_base}.tar.gz"
    release_manifest = output_dir / f"{archive_base}.release.json"
    if stage.exists() or archive.exists() or release_manifest.exists():
        raise ReleaseBuildError(f"release output already exists: {output_dir}")

    build(root, args.target or "", args.skip_build)
    binary = binary_path(root, args.target or "")
    tui_dist = root / "apps/tui/dist"
    if not binary.is_file():
        raise ReleaseBuildError(f"release binary is missing: {binary}")
    if not tui_dist.is_dir():
        raise ReleaseBuildError(f"compiled TUI directory is missing: {tui_dist}")

    stage.mkdir(parents=True)
    (stage / "bin").mkdir()
    (stage / "lib/boreal/tui").mkdir(parents=True)
    (stage / "share/boreal").mkdir(parents=True)
    shutil.copy2(binary, stage / "bin/bwrk")
    (stage / "bin/bwrk").chmod(0o755)
    for source in sorted(tui_dist.rglob("*")):
        if source.is_symlink():
            raise ReleaseBuildError(f"TUI build contains a symlink: {source}")
        if source.is_file():
            destination = stage / "lib/boreal/tui" / source.relative_to(tui_dist)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    shutil.copy2(root / "LICENSE", stage / "share/boreal/LICENSE")
    shutil.copy2(root / "install.sh", stage / "share/boreal/install.sh")
    (stage / "share/boreal/install.sh").chmod(0o755)

    contract_file = output_dir / f"{archive_base}.contracts.json"
    try:
        contract = contract_identity(root, contract_file)
        write_release_manifest(
            stage,
            version=version,
            target=target,
            contract=contract,
            tui_node_range=tui_node_range(root),
        )
        create_archive(stage, archive)
        shutil.copy2(stage / "share/boreal/release.json", release_manifest)
        archive_digest = sha256_file(archive).removeprefix("sha256:")
        (output_dir / "SHA256SUMS").write_text(
            f"{archive_digest}  {archive.name}\n", encoding="utf-8"
        )
    finally:
        contract_file.unlink(missing_ok=True)

    print(json.dumps({
        "archive": str(archive),
        "release_manifest": str(release_manifest),
        "target": target,
        "version": version,
        "sha256": sha256_file(archive),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ReleaseBuildError, json.JSONDecodeError) as error:
        print(f"release build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
