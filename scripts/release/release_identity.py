#!/usr/bin/env python3
"""Build and verify a deterministic Boreal v2 release identity.

The checker intentionally uses only the Python standard library.  It hashes a
small, explicit set of checked-in contract and workflow assets; it does not
build binaries or mutate a live Boreal project.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


MANIFEST_VERSION = "boreal.release_manifest.v1"
PACKAGE_ID = "boreal-work-v2"
DEFAULT_ROOT = Path(__file__).resolve().parents[2]


class ReleaseError(ValueError):
    """A user-correctable release identity or safety error."""


COMPONENTS: dict[str, dict[str, Any]] = {
    "protocol": {
        "version_file": "project/spec/protocol/protocol-manifest.json",
        "version_field": ("protocol_version",),
        "schema_field": ("schemas", "envelope"),
        "asset_roots": ("project/spec/protocol",),
    },
    "schema": {
        "version_file": "project/spec/manifest.json",
        "version_field": ("schema_version",),
        "schema_field": ("schema_version",),
        "asset_paths": (
            "project/spec/manifest.json",
            "project/spec/schema-v2.sql",
        ),
    },
    "memory": {
        "version_file": "project/spec/memory-manifest.json",
        "version_field": ("schema_version",),
        "schema_field": ("schema_version",),
        "asset_paths": ("project/spec/memory-manifest.json",),
    },
    "directive": {
        "version_file": "project/spec/guidance/directive-registry.json",
        "version_field": ("registry_version",),
        "schema_field": ("schema_version",),
        "asset_roots": ("project/spec/guidance",),
    },
    "workflow": {
        "version_file": "project/spec/workflows/package.json",
        "version_field": ("package_version",),
        "schema_field": ("schema_version",),
        "asset_roots": ("project/spec/workflows",),
    },
}


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )


def sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ReleaseError(f"cannot read asset {path}: {exc}") from exc
    return "sha256:" + digest.hexdigest()


def ensure_relative(path: str) -> PurePosixPath:
    # PurePosixPath makes the manifest format independent of the host OS.
    candidate = PurePosixPath(path)
    if candidate.is_absolute() or ".." in candidate.parts or not path:
        raise ReleaseError(f"unsafe manifest path: {path!r}")
    if "\\" in path:
        raise ReleaseError(f"manifest paths must use '/': {path!r}")
    return candidate


def read_json(root: Path, relative: str) -> dict[str, Any]:
    path = root / relative
    if path.is_symlink() or not path.is_file():
        raise ReleaseError(f"required JSON asset is missing or not a regular file: {relative}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReleaseError(f"invalid JSON in {relative}: {exc}") from exc
    if not isinstance(value, dict):
        raise ReleaseError(f"JSON root must be an object: {relative}")
    return value


def field(value: dict[str, Any], path: tuple[str, ...], source: str) -> str:
    current: Any = value
    for part in path:
        if not isinstance(current, dict) or part not in current:
            raise ReleaseError(f"{source}: missing version field {'.'.join(path)}")
        current = current[part]
    if not isinstance(current, (str, int)):
        raise ReleaseError(f"{source}: version field {'.'.join(path)} must be text or integer")
    return str(current)


def package_version(root: Path) -> str:
    path = root / "Cargo.toml"
    if path.is_symlink() or not path.is_file():
        raise ReleaseError("Cargo.toml is required to identify the package version")
    text = path.read_text(encoding="utf-8")
    match = re.search(r"(?ms)^\[workspace\.package\]\s*(.*?)(?:^\[|\Z)", text)
    if not match:
        raise ReleaseError("Cargo.toml: [workspace.package] section is required")
    version = re.search(r'^version\s*=\s*["\']([^"\']+)["\']\s*$', match.group(1), re.M)
    if not version:
        raise ReleaseError("Cargo.toml: workspace package version is required")
    return version.group(1)


def regular_files(root: Path, relative: str) -> Iterable[tuple[str, Path]]:
    base = root / relative
    if base.is_symlink():
        raise ReleaseError(f"asset root cannot be a symlink: {relative}")
    if base.is_file():
        yield relative, base
        return
    if not base.is_dir():
        raise ReleaseError(f"required asset path is missing: {relative}")
    for path in sorted(base.rglob("*")):
        if path.is_symlink():
            raise ReleaseError(f"symlink is not a reproducible asset: {path.relative_to(root)}")
        if path.is_dir():
            continue
        if path.name == "__pycache__" or path.suffix in {".pyc", ".pyo"}:
            continue
        yield path.relative_to(root).as_posix(), path


def asset_paths(root: Path, spec: dict[str, Any]) -> list[tuple[str, Path]]:
    found: dict[str, Path] = {}
    for relative in spec.get("asset_paths", ()):
        for path, file_path in regular_files(root, relative):
            found[path] = file_path
    for relative in spec.get("asset_roots", ()):
        for path, file_path in regular_files(root, relative):
            found[path] = file_path
    return sorted(found.items())


def component_identity(assets: list[dict[str, Any]]) -> str:
    lines = "".join(
        f"{asset['path']}\t{asset['sha256']}\t{asset['bytes']}\n" for asset in assets
    )
    return sha256_bytes(lines.encode("utf-8"))


def snapshot_identity(manifest: dict[str, Any]) -> str:
    identity_input = {
        key: manifest[key]
        for key in (
            "manifest_version",
            "package_id",
            "package_version",
            "contract",
            "versions",
            "components",
        )
    }
    return sha256_bytes(canonical_json(identity_input))


def build_manifest(root: Path) -> dict[str, Any]:
    root = root.resolve()
    if not root.is_dir():
        raise ReleaseError(f"package root is not a directory: {root}")

    contract = read_json(root, "project/spec/manifest.json")
    protocol = read_json(root, "project/spec/protocol/protocol-manifest.json")
    memory = read_json(root, "project/spec/memory-manifest.json")
    directives = read_json(root, "project/spec/guidance/directive-registry.json")
    workflows = read_json(root, "project/spec/workflows/package.json")

    versions = {
        "protocol": {
            "version": field(protocol, COMPONENTS["protocol"]["version_field"], "protocol manifest"),
            "schema": field(protocol, COMPONENTS["protocol"]["schema_field"], "protocol manifest"),
        },
        "schema": {
            "version": field(contract, COMPONENTS["schema"]["version_field"], "spec manifest"),
            "schema": field(contract, COMPONENTS["schema"]["schema_field"], "spec manifest"),
        },
        "memory": {
            "version": field(memory, COMPONENTS["memory"]["version_field"], "memory manifest"),
            "schema": field(memory, COMPONENTS["memory"]["schema_field"], "memory manifest"),
        },
        "directive": {
            "version": field(directives, COMPONENTS["directive"]["version_field"], "directive registry"),
            "schema": field(directives, COMPONENTS["directive"]["schema_field"], "directive registry"),
        },
        "workflow": {
            "version": field(workflows, COMPONENTS["workflow"]["version_field"], "workflow package"),
            "schema": field(workflows, COMPONENTS["workflow"]["schema_field"], "workflow package"),
        },
    }

    components: dict[str, Any] = {}
    for name, spec in COMPONENTS.items():
        assets = []
        for relative, path in asset_paths(root, spec):
            ensure_relative(relative)
            try:
                size = path.stat().st_size
            except OSError as exc:
                raise ReleaseError(f"cannot stat asset {relative}: {exc}") from exc
            assets.append({"path": relative, "bytes": size, "sha256": sha256_file(path)})
        if not assets:
            raise ReleaseError(f"component {name} has no assets")
        components[name] = {
            "version": versions[name]["version"],
            "schema": versions[name]["schema"],
            "identity": component_identity(assets),
            "assets": assets,
        }

    manifest: dict[str, Any] = {
        "manifest_version": MANIFEST_VERSION,
        "package_id": PACKAGE_ID,
        "package_version": package_version(root),
        "contract": {
            "fixture_version": field(contract, ("fixture_version",), "spec manifest"),
            "contract_revision": field(contract, ("contract_revision",), "spec manifest"),
            "api_version": field(contract, ("api_version",), "spec manifest"),
        },
        "versions": versions,
        "components": components,
    }
    manifest["snapshot_identity"] = snapshot_identity(manifest)
    return manifest


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReleaseError(f"invalid release manifest {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ReleaseError("release manifest root must be an object")
    return value


def validate_manifest(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    expected = build_manifest(root)
    for key in (
        "manifest_version",
        "package_id",
        "package_version",
        "contract",
        "versions",
        "components",
    ):
        if manifest.get(key) != expected[key]:
            raise ReleaseError(f"manifest mismatch in {key}; regenerate the manifest from this snapshot")
    if manifest.get("snapshot_identity") != expected["snapshot_identity"]:
        raise ReleaseError("manifest snapshot_identity does not match its contents")
    return expected


def write_json(path: Path, value: dict[str, Any]) -> None:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_bytes(canonical_json(value))
        os.replace(temporary, path)
    except OSError as exc:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise ReleaseError(f"cannot write {path}: {exc}") from exc


def command_manifest(args: argparse.Namespace) -> int:
    value = build_manifest(Path(args.root))
    if args.output:
        write_json(Path(args.output), value)
        print(json.dumps({"ok": True, "manifest": str(Path(args.output).resolve()), "snapshot_identity": value["snapshot_identity"]}, sort_keys=True))
    else:
        print(json.dumps(value, indent=2, sort_keys=True))
    return 0


def command_check(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest)
    value = validate_manifest(Path(args.root), load_manifest(manifest_path))
    asset_count = sum(len(component["assets"]) for component in value["components"].values())
    print(json.dumps({"ok": True, "asset_count": asset_count, "snapshot_identity": value["snapshot_identity"]}, sort_keys=True))
    return 0


def safe_staging_dir(path: Path, source_root: Path) -> Path:
    try:
        staging = path.resolve()
        source = source_root.resolve()
        temporary_root = Path(tempfile.gettempdir()).resolve()
    except OSError as exc:
        raise ReleaseError(f"cannot resolve simulation paths: {exc}") from exc
    if staging == temporary_root or temporary_root not in staging.parents:
        raise ReleaseError(f"staging directory must be inside the system temp directory: {temporary_root}")
    if source == staging or source in staging.parents or staging in source.parents:
        raise ReleaseError("staging directory must not overlap the package root")
    if not path.exists():
        raise ReleaseError("staging directory must already exist; create it with mktemp -d")
    if not path.is_dir():
        raise ReleaseError("staging path is not a directory")
    return staging


def copy_assets(source_root: Path, payload: Path, manifest: dict[str, Any]) -> None:
    payload.mkdir(parents=True)
    copied: set[str] = set()
    for component in manifest["components"].values():
        for asset in component["assets"]:
            relative = ensure_relative(asset["path"]).as_posix()
            if relative in copied:
                continue
            source = source_root / relative
            target = payload / relative
            if source.is_symlink() or not source.is_file():
                raise ReleaseError(f"source asset disappeared or became a symlink: {relative}")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied.add(relative)
    # The package version is part of the identity and is needed to validate a
    # staged payload, but it is not itself a shipped contract asset.
    shutil.copy2(source_root / "Cargo.toml", payload / "Cargo.toml")


def command_simulate(args: argparse.Namespace) -> int:
    source_root = Path(args.root).resolve()
    manifest = load_manifest(Path(args.manifest))
    expected = validate_manifest(source_root, manifest)
    staging = safe_staging_dir(Path(args.staging_dir), source_root)
    transaction = staging / "boreal-release-simulation-v1"
    if transaction.exists():
        raise ReleaseError(f"simulation directory already exists; refusing to overwrite: {transaction}")

    payload = transaction / "payload"
    live = transaction / "simulated-live"
    backup = transaction / "rollback-backup"
    removed_install = transaction / "rolled-back-install"
    transaction.mkdir()
    copy_assets(source_root, payload, manifest)
    validate_manifest(payload, manifest)

    live.mkdir()
    marker = live / "previous-install.marker"
    marker_contents = "preserved by rollback simulation\n"
    marker.write_text(marker_contents, encoding="utf-8")
    # Move the previous synthetic install out of the way before promoting the
    # staged directory.  This models an atomic directory swap and works on
    # filesystems that reject replacing a non-empty directory.
    os.replace(live, backup)
    os.replace(payload, live)
    install_verified = (live / "project/spec/schema-v2.sql").is_file()
    if not install_verified:
        raise ReleaseError("staged install did not contain the schema asset")

    os.replace(live, removed_install)
    os.replace(backup, live)
    rollback_verified = (live / "previous-install.marker").read_text(encoding="utf-8") == marker_contents
    if not rollback_verified:
        raise ReleaseError("rollback did not restore the pre-install marker")
    result = {
        "ok": True,
        "mode": "temp-install-rollback-simulation",
        "snapshot_identity": expected["snapshot_identity"],
        "install_verified": install_verified,
        "rollback_verified": rollback_verified,
        "source_root_unchanged_by_contract": True,
        "transaction_directory": str(transaction),
    }
    write_json(transaction / "simulation-result.json", result)
    print(json.dumps(result, sort_keys=True))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    subparsers = root.add_subparsers(dest="command", required=True)

    manifest = subparsers.add_parser("manifest", help="generate a deterministic release manifest")
    manifest.add_argument("--root", default=str(DEFAULT_ROOT), help="v2 package root")
    manifest.add_argument("--output", help="write JSON to this path; stdout otherwise")
    manifest.set_defaults(handler=command_manifest)

    check = subparsers.add_parser("check", help="validate asset bytes and release identity")
    check.add_argument("--root", required=True, help="package snapshot root")
    check.add_argument("--manifest", required=True, help="release manifest JSON")
    check.set_defaults(handler=command_check)

    simulate = subparsers.add_parser("simulate", help="stage, install, and roll back inside a temp directory")
    simulate.add_argument("--root", required=True, help="package snapshot root")
    simulate.add_argument("--manifest", required=True, help="release manifest JSON")
    simulate.add_argument("--staging-dir", required=True, help="existing directory created under the system temp directory")
    simulate.set_defaults(handler=command_simulate)
    return root


def main(argv: list[str] | None = None) -> int:
    try:
        args = parser().parse_args(argv)
        return args.handler(args)
    except ReleaseError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
