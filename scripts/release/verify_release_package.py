#!/usr/bin/env python3
"""Validate the installer-facing package manifest and all declared file digests."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath


def fail(message: str) -> None:
    raise SystemExit(f"release package validation failed: {message}")


def main() -> int:
    if len(sys.argv) != 3:
        fail("usage: verify_release_package.py PACKAGE_ROOT MANIFEST")
    root, manifest_path = map(Path, sys.argv[1:])
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        fail(f"invalid manifest: {error}")
    if manifest.get("manifest_version") != "boreal.binary_release.v1":
        fail("unsupported binary release manifest version")
    source_id = manifest.get("source_id")
    digest_pattern = re.compile(r"^sha256:[0-9a-f]{64}$")
    if not isinstance(source_id, str) or not digest_pattern.fullmatch(source_id):
        fail("manifest has no valid build source identity")
    if not isinstance(manifest.get("source_revision"), str) or not manifest["source_revision"].strip():
        fail("manifest has no source revision")
    if not isinstance(manifest.get("target"), str) or not manifest["target"].strip():
        fail("manifest has no target identity")
    artifact_identity = manifest.get("artifact_identity")
    identity_input = {key: value for key, value in manifest.items() if key != "artifact_identity"}
    expected_identity = "sha256:" + hashlib.sha256(
        (json.dumps(identity_input, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    ).hexdigest()
    if artifact_identity != expected_identity:
        fail("manifest artifact identity does not match its contents")
    for component_name in ("tui", "global_tui"):
        component = manifest.get(component_name)
        component_source_id = component.get("source_id") if isinstance(component, dict) else None
        if not isinstance(component_source_id, str) or not digest_pattern.fullmatch(component_source_id):
            fail(f"manifest has no valid {component_name} source identity")
    contracts = manifest.get("contracts")
    components = contracts.get("components") if isinstance(contracts, dict) else None
    if not isinstance(components, dict):
        fail("manifest has no contract component identities")
    for name in ("workflow", "skill"):
        component = components.get(name)
        if not isinstance(component, dict) or not all(
            isinstance(component.get(key), str) and component[key].strip()
            for key in ("version", "schema", "identity")
        ):
            fail(f"manifest does not identify packaged {name} capability")
    assets = manifest.get("assets")
    if not isinstance(assets, list) or not assets:
        fail("manifest has no packaged assets")
    seen: set[str] = set()
    for asset in assets:
        if not isinstance(asset, dict):
            fail("invalid asset record")
        relative, expected = asset.get("path"), asset.get("sha256")
        if not isinstance(relative, str) or not isinstance(expected, str):
            fail("asset record is missing path or digest")
        parsed = PurePosixPath(relative)
        if parsed.is_absolute() or ".." in parsed.parts or "\\" in relative:
            fail(f"unsafe asset path: {relative}")
        if relative in seen:
            fail(f"duplicate asset path: {relative}")
        seen.add(relative)
        path = root.joinpath(*parsed.parts)
        if path.is_symlink() or not path.is_file():
            fail(f"asset is missing or not a regular file: {relative}")
        if parsed.parts[0] == "apps" or "node_modules" in parsed.parts or "__pycache__" in parsed.parts:
            fail(f"release package includes build/source cache material: {relative}")
        actual_bytes = path.stat().st_size
        if "bytes" in asset and asset.get("bytes") != actual_bytes:
            fail(f"asset byte count mismatch: {relative}")
        actual = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            fail(f"asset digest mismatch: {relative}")
    if "bin/bwrk" not in seen or "lib/boreal/tui/entrypoint.js" not in seen:
        fail("manifest omits required CLI or dashboard asset")
    if "lib/boreal/global-tui/entrypoint.js" not in seen:
        fail("manifest omits global dashboard asset")
    binary = manifest.get("binary")
    if not isinstance(binary, dict) or binary.get("path") != "bin/bwrk":
        fail("manifest has no canonical CLI binary path")
    binary_asset = next(asset for asset in assets if asset.get("path") == "bin/bwrk")
    if binary.get("sha256") != binary_asset.get("sha256"):
        fail("binary identity differs from the packaged CLI asset")
    print("release package manifest and workflow/skill capability identities verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
