# R-RELEASE-ID — scripts/release/release_identity.py

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/release/release_identity.py:L1–L260`  
**File SHA-256:** `7a7e1b33b3862ad46d5ca846272474f980e1b552a29bc90dd979297debef654c`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Binary/TUI/protocol/schema/workflow/toolchain manifest identity.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'scripts/release/release_identity.py'
```

## Exact baseline excerpt

````text
    1 | #!/usr/bin/env python3
    2 | """Build and verify a deterministic Boreal v2 release identity.
    3 | 
    4 | The checker intentionally uses only the Python standard library.  It hashes a
    5 | small, explicit set of checked-in contract, workflow, and skill assets; it does not
    6 | build binaries or mutate a live Boreal project.
    7 | """
    8 | 
    9 | from __future__ import annotations
   10 | 
   11 | import argparse
   12 | import hashlib
   13 | import json
   14 | import os
   15 | import re
   16 | import shutil
   17 | import sys
   18 | import tempfile
   19 | from pathlib import Path, PurePosixPath
   20 | from typing import Any, Iterable
   21 | 
   22 | 
   23 | MANIFEST_VERSION = "boreal.release_manifest.v1"
   24 | PACKAGE_ID = "boreal-work-v2"
   25 | DEFAULT_ROOT = Path(__file__).resolve().parents[2]
   26 | 
   27 | 
   28 | class ReleaseError(ValueError):
   29 |     """A user-correctable release identity or safety error."""
   30 | 
   31 | 
   32 | COMPONENTS: dict[str, dict[str, Any]] = {
   33 |     "protocol": {
   34 |         "version_file": "project/spec/protocol/protocol-manifest.json",
   35 |         "version_field": ("protocol_version",),
   36 |         "schema_field": ("schemas", "envelope"),
   37 |         "asset_roots": ("project/spec/protocol",),
   38 |     },
   39 |     "schema": {
   40 |         "version_file": "project/spec/manifest.json",
   41 |         "version_field": ("schema_version",),
   42 |         "schema_field": ("schema_version",),
   43 |         "asset_paths": (
   44 |             "project/spec/manifest.json",
   45 |             "project/spec/schema-v2.sql",
   46 |         ),
   47 |     },
   48 |     "memory": {
   49 |         "version_file": "project/spec/memory-manifest.json",
   50 |         "version_field": ("schema_version",),
   51 |         "schema_field": ("schema_version",),
   52 |         "asset_paths": ("project/spec/memory-manifest.json",),
   53 |     },
   54 |     "directive": {
   55 |         "version_file": "project/spec/guidance/directive-registry.json",
   56 |         "version_field": ("registry_version",),
   57 |         "schema_field": ("schema_version",),
   58 |         "asset_roots": ("project/spec/guidance",),
   59 |     },
   60 |     "workflow": {
   61 |         "version_file": "project/spec/workflows/package.json",
   62 |         "version_field": ("package_version",),
   63 |         "schema_field": ("schema_version",),
   64 |         "asset_roots": ("project/spec/workflows",),
   65 |     },
   66 |     "skill": {
   67 |         "version_file": "skills/manifest.json",
   68 |         "version_field": ("package_version",),
   69 |         "schema_field": ("schema_version",),
   70 |         "asset_roots": ("skills",),
   71 |     },
   72 | }
   73 | 
   74 | 
   75 | def canonical_json(value: Any) -> bytes:
   76 |     return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode(
   77 |         "utf-8"
   78 |     )
   79 | 
   80 | 
   81 | def sha256_bytes(value: bytes) -> str:
   82 |     return "sha256:" + hashlib.sha256(value).hexdigest()
   83 | 
   84 | 
   85 | def sha256_file(path: Path) -> str:
   86 |     digest = hashlib.sha256()
   87 |     try:
   88 |         with path.open("rb") as handle:
   89 |             for chunk in iter(lambda: handle.read(1024 * 1024), b""):
   90 |                 digest.update(chunk)
   91 |     except OSError as exc:
   92 |         raise ReleaseError(f"cannot read asset {path}: {exc}") from exc
   93 |     return "sha256:" + digest.hexdigest()
   94 | 
   95 | 
   96 | def ensure_relative(path: str) -> PurePosixPath:
   97 |     # PurePosixPath makes the manifest format independent of the host OS.
   98 |     candidate = PurePosixPath(path)
   99 |     if candidate.is_absolute() or ".." in candidate.parts or not path:
  100 |         raise ReleaseError(f"unsafe manifest path: {path!r}")
  101 |     if "\\" in path:
  102 |         raise ReleaseError(f"manifest paths must use '/': {path!r}")
  103 |     return candidate
  104 | 
  105 | 
  106 | def read_json(root: Path, relative: str) -> dict[str, Any]:
  107 |     path = root / relative
  108 |     if path.is_symlink() or not path.is_file():
  109 |         raise ReleaseError(f"required JSON asset is missing or not a regular file: {relative}")
  110 |     try:
  111 |         value = json.loads(path.read_text(encoding="utf-8"))
  112 |     except (OSError, UnicodeError, json.JSONDecodeError) as exc:
  113 |         raise ReleaseError(f"invalid JSON in {relative}: {exc}") from exc
  114 |     if not isinstance(value, dict):
  115 |         raise ReleaseError(f"JSON root must be an object: {relative}")
  116 |     return value
  117 | 
  118 | 
  119 | def field(value: dict[str, Any], path: tuple[str, ...], source: str) -> str:
  120 |     current: Any = value
  121 |     for part in path:
  122 |         if not isinstance(current, dict) or part not in current:
  123 |             raise ReleaseError(f"{source}: missing version field {'.'.join(path)}")
  124 |         current = current[part]
  125 |     if not isinstance(current, (str, int)):
  126 |         raise ReleaseError(f"{source}: version field {'.'.join(path)} must be text or integer")
  127 |     return str(current)
  128 | 
  129 | 
  130 | def package_version(root: Path) -> str:
  131 |     path = root / "Cargo.toml"
  132 |     if path.is_symlink() or not path.is_file():
  133 |         raise ReleaseError("Cargo.toml is required to identify the package version")
  134 |     text = path.read_text(encoding="utf-8")
  135 |     match = re.search(r"(?ms)^\[workspace\.package\]\s*(.*?)(?:^\[|\Z)", text)
  136 |     if not match:
  137 |         raise ReleaseError("Cargo.toml: [workspace.package] section is required")
  138 |     version = re.search(r'^version\s*=\s*["\']([^"\']+)["\']\s*$', match.group(1), re.M)
  139 |     if not version:
  140 |         raise ReleaseError("Cargo.toml: workspace package version is required")
  141 |     return version.group(1)
  142 | 
  143 | 
  144 | def regular_files(root: Path, relative: str) -> Iterable[tuple[str, Path]]:
  145 |     base = root / relative
  146 |     if base.is_symlink():
  147 |         raise ReleaseError(f"asset root cannot be a symlink: {relative}")
  148 |     if base.is_file():
  149 |         yield relative, base
  150 |         return
  151 |     if not base.is_dir():
  152 |         raise ReleaseError(f"required asset path is missing: {relative}")
  153 |     for path in sorted(base.rglob("*")):
  154 |         if path.is_symlink():
  155 |             raise ReleaseError(f"symlink is not a reproducible asset: {path.relative_to(root)}")
  156 |         if path.is_dir():
  157 |             continue
  158 |         if path.name == "__pycache__" or path.suffix in {".pyc", ".pyo"}:
  159 |             continue
  160 |         yield path.relative_to(root).as_posix(), path
  161 | 
  162 | 
  163 | def asset_paths(root: Path, spec: dict[str, Any]) -> list[tuple[str, Path]]:
  164 |     found: dict[str, Path] = {}
  165 |     for relative in spec.get("asset_paths", ()):
  166 |         for path, file_path in regular_files(root, relative):
  167 |             found[path] = file_path
  168 |     for relative in spec.get("asset_roots", ()):
  169 |         for path, file_path in regular_files(root, relative):
  170 |             found[path] = file_path
  171 |     return sorted(found.items())
  172 | 
  173 | 
  174 | def component_identity(assets: list[dict[str, Any]]) -> str:
  175 |     lines = "".join(
  176 |         f"{asset['path']}\t{asset['sha256']}\t{asset['bytes']}\n" for asset in assets
  177 |     )
  178 |     return sha256_bytes(lines.encode("utf-8"))
  179 | 
  180 | 
  181 | def snapshot_identity(manifest: dict[str, Any]) -> str:
  182 |     identity_input = {
  183 |         key: manifest[key]
  184 |         for key in (
  185 |             "manifest_version",
  186 |             "package_id",
  187 |             "package_version",
  188 |             "contract",
  189 |             "versions",
  190 |             "components",
  191 |         )
  192 |     }
  193 |     return sha256_bytes(canonical_json(identity_input))
  194 | 
  195 | 
  196 | def build_manifest(root: Path) -> dict[str, Any]:
  197 |     root = root.resolve()
  198 |     if not root.is_dir():
  199 |         raise ReleaseError(f"package root is not a directory: {root}")
  200 | 
  201 |     contract = read_json(root, "project/spec/manifest.json")
  202 |     protocol = read_json(root, "project/spec/protocol/protocol-manifest.json")
  203 |     memory = read_json(root, "project/spec/memory-manifest.json")
  204 |     directives = read_json(root, "project/spec/guidance/directive-registry.json")
  205 |     workflows = read_json(root, "project/spec/workflows/package.json")
  206 |     skills = read_json(root, "skills/manifest.json")
  207 | 
  208 |     versions = {
  209 |         "protocol": {
  210 |             "version": field(protocol, COMPONENTS["protocol"]["version_field"], "protocol manifest"),
  211 |             "schema": field(protocol, COMPONENTS["protocol"]["schema_field"], "protocol manifest"),
  212 |         },
  213 |         "schema": {
  214 |             "version": field(contract, COMPONENTS["schema"]["version_field"], "spec manifest"),
  215 |             "schema": field(contract, COMPONENTS["schema"]["schema_field"], "spec manifest"),
  216 |         },
  217 |         "memory": {
  218 |             "version": field(memory, COMPONENTS["memory"]["version_field"], "memory manifest"),
  219 |             "schema": field(memory, COMPONENTS["memory"]["schema_field"], "memory manifest"),
  220 |         },
  221 |         "directive": {
  222 |             "version": field(directives, COMPONENTS["directive"]["version_field"], "directive registry"),
  223 |             "schema": field(directives, COMPONENTS["directive"]["schema_field"], "directive registry"),
  224 |         },
  225 |         "workflow": {
  226 |             "version": field(workflows, COMPONENTS["workflow"]["version_field"], "workflow package"),
  227 |             "schema": field(workflows, COMPONENTS["workflow"]["schema_field"], "workflow package"),
  228 |         },
  229 |         "skill": {
  230 |             "version": field(skills, COMPONENTS["skill"]["version_field"], "skill package"),
  231 |             "schema": field(skills, COMPONENTS["skill"]["schema_field"], "skill package"),
  232 |         },
  233 |     }
  234 | 
  235 |     components: dict[str, Any] = {}
  236 |     for name, spec in COMPONENTS.items():
  237 |         assets = []
  238 |         for relative, path in asset_paths(root, spec):
  239 |             ensure_relative(relative)
  240 |             try:
  241 |                 size = path.stat().st_size
  242 |             except OSError as exc:
  243 |                 raise ReleaseError(f"cannot stat asset {relative}: {exc}") from exc
  244 |             assets.append({"path": relative, "bytes": size, "sha256": sha256_file(path)})
  245 |         if not assets:
  246 |             raise ReleaseError(f"component {name} has no assets")
  247 |         components[name] = {
  248 |             "version": versions[name]["version"],
  249 |             "schema": versions[name]["schema"],
  250 |             "identity": component_identity(assets),
  251 |             "assets": assets,
  252 |         }
  253 | 
  254 |     manifest: dict[str, Any] = {
  255 |         "manifest_version": MANIFEST_VERSION,
  256 |         "package_id": PACKAGE_ID,
  257 |         "package_version": package_version(root),
  258 |         "contract": {
  259 |             "fixture_version": field(contract, ("fixture_version",), "spec manifest"),
  260 |             "contract_revision": field(contract, ("contract_revision",), "spec manifest"),
````
