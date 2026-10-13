#!/usr/bin/env python3
"""Validate native archives from one source and assemble release checksums."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any


TARGETS = {
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-unknown-linux-gnu",
}
SEMVER = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)


class AssemblyError(ValueError):
    """The archive set is incomplete, unsafe, or internally inconsistent."""


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def valid_digest(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


def read_manifest(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise AssemblyError(f"release manifest is not a regular file: {path}")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise AssemblyError(f"invalid release manifest {path.name}: {error}") from error
    if not isinstance(manifest, dict) or manifest.get("manifest_version") != "boreal.binary_release.v1":
        raise AssemblyError(f"unsupported release manifest: {path.name}")
    identity = manifest.get("artifact_identity")
    expected = "sha256:" + hashlib.sha256(
        canonical_json({key: value for key, value in manifest.items() if key != "artifact_identity"})
    ).hexdigest()
    if identity != expected:
        raise AssemblyError(f"release manifest identity is invalid: {path.name}")
    for field in ("version", "source_revision", "target"):
        if not isinstance(manifest.get(field), str) or not manifest[field].strip():
            raise AssemblyError(f"release manifest {path.name} has no {field}")
    if not SEMVER.fullmatch(manifest["version"]):
        raise AssemblyError(f"release manifest {path.name} has an invalid version")
    if not valid_digest(manifest.get("source_id")):
        raise AssemblyError(f"release manifest {path.name} has an invalid source identity")
    if not valid_digest(manifest.get("tui", {}).get("source_id")):
        raise AssemblyError(f"release manifest {path.name} has an invalid TUI source identity")
    if not valid_digest(manifest.get("global_tui", {}).get("source_id")):
        raise AssemblyError(f"release manifest {path.name} has an invalid Global TUI source identity")
    return manifest


def assemble(input_dir: Path, output_dir: Path) -> Path:
    if input_dir.is_symlink() or not input_dir.is_dir():
        raise AssemblyError("input directory must be a real directory")
    manifests = sorted(input_dir.glob("*.release.json"))
    if len(manifests) != len(TARGETS):
        raise AssemblyError(f"expected {len(TARGETS)} platform manifests, found {len(manifests)}")

    records: list[dict[str, str]] = []
    identities: list[dict[str, Any]] = []
    common: tuple[str, str, str, str, str, str] | None = None
    seen_targets: set[str] = set()
    for manifest_path in manifests:
        manifest = read_manifest(manifest_path)
        target = manifest["target"]
        if target not in TARGETS or target in seen_targets:
            raise AssemblyError(f"unexpected or duplicate release target: {target}")
        seen_targets.add(target)
        version = manifest["version"]
        source_id = manifest["source_id"]
        source_revision = manifest["source_revision"]
        contract_identity = manifest.get("contracts", {}).get("snapshot_identity")
        if not isinstance(contract_identity, str) or not contract_identity:
            raise AssemblyError(f"release manifest {manifest_path.name} has no contract identity")
        observed = (
            version,
            source_id,
            source_revision,
            contract_identity,
            manifest["tui"]["source_id"],
            manifest["global_tui"]["source_id"],
        )
        if common is None:
            common = observed
        elif common != observed:
            raise AssemblyError("platform manifests do not describe the same version and source snapshot")

        archive_name = f"bwrk-v{version}-{target}.tar.gz"
        archive = input_dir / archive_name
        if archive.is_symlink() or not archive.is_file():
            raise AssemblyError(f"platform archive is missing or unsafe: {archive_name}")
        if manifest_path.name != f"bwrk-v{version}-{target}.release.json":
            raise AssemblyError(f"manifest filename does not match its identity: {manifest_path.name}")
        archive_digest = sha256_file(archive)
        manifest_digest = sha256_file(manifest_path)
        records.append({"target": target, "archive": archive_name, "sha256": archive_digest.removeprefix("sha256:")})
        identities.append(
            {
                "target": target,
                "archive": archive_name,
                "archive_sha256": archive_digest,
                "manifest": manifest_path.name,
                "manifest_sha256": manifest_digest,
                "artifact_identity": manifest["artifact_identity"],
            }
        )

    if seen_targets != TARGETS:
        raise AssemblyError("platform manifest set does not match the supported target matrix")
    version, source_id, source_revision, contract_identity, tui_source_id, global_tui_source_id = common or ("", "", "", "", "", "")
    identities.sort(key=lambda item: item["target"])
    release_basis = {
        "format": "boreal.release_bundle.v1",
        "version": version,
        "source_id": source_id,
        "source_revision": source_revision,
        "contract_identity": contract_identity,
        "tui_source_id": tui_source_id,
        "global_tui_source_id": global_tui_source_id,
        "artifacts": identities,
    }
    release_basis["release_identity"] = "sha256:" + hashlib.sha256(canonical_json(release_basis)).hexdigest()

    output_dir.mkdir(parents=True, exist_ok=True)
    if any(output_dir.iterdir()):
        raise AssemblyError(f"output directory is not empty: {output_dir}")
    for item in identities:
        shutil.copyfile(input_dir / item["archive"], output_dir / item["archive"])
        shutil.copyfile(input_dir / item["manifest"], output_dir / item["manifest"])
    records.sort(key=lambda item: item["archive"])
    (output_dir / "SHA256SUMS").write_text(
        "".join(f"{item['sha256']}  {item['archive']}\n" for item in records),
        encoding="utf-8",
    )
    (output_dir / "release-bundle.json").write_bytes(canonical_json(release_basis))
    return output_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    result = assemble(args.input_dir.resolve(), args.output_dir.resolve())
    print(result)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, AssemblyError) as error:
        raise SystemExit(f"release assembly failed: {error}") from error
