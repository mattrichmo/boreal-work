# R-RELEASE-BUILDER — scripts/release/build_release.py

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/release/build_release.py:L1–L260`  
**File SHA-256:** `74babe9f0fe8c473b57e9b6453e6c3b5f8d1233cdd1bf306ddafabae9cc24194`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Artifact construction, identity verification and build-versus-skip semantics.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'scripts/release/build_release.py'
```

## Exact baseline excerpt

````text
    1 | #!/usr/bin/env python3
    2 | """Build a self-contained Boreal v2 CLI/TUI release archive.
    3 | 
    4 | The script deliberately owns staging and archive creation only.  The Rust
    5 | application remains the authority for project state, while this boundary
    6 | records the exact executable, TUI, toolchain, and contract identities shipped
    7 | to a user.
    8 | """
    9 | 
   10 | from __future__ import annotations
   11 | 
   12 | import argparse
   13 | import gzip
   14 | import hashlib
   15 | import json
   16 | import re
   17 | import shutil
   18 | import subprocess
   19 | import sys
   20 | import tarfile
   21 | from pathlib import Path
   22 | from typing import Any
   23 | 
   24 | 
   25 | HERE = Path(__file__).resolve().parent
   26 | ROOT = HERE.parents[1]
   27 | SEMVER = re.compile(
   28 |     r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
   29 |     r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
   30 | )
   31 | TARGET = re.compile(r"^[A-Za-z0-9_.-]+$")
   32 | 
   33 | 
   34 | class ReleaseBuildError(RuntimeError):
   35 |     """A release input or build step failed safely."""
   36 | 
   37 | 
   38 | def run(command: list[str], *, cwd: Path = ROOT, capture: bool = False) -> str:
   39 |     print("+", " ".join(command))
   40 |     result = subprocess.run(
   41 |         command,
   42 |         cwd=cwd,
   43 |         check=False,
   44 |         text=True,
   45 |         stdout=subprocess.PIPE if capture else None,
   46 |         stderr=subprocess.PIPE if capture else None,
   47 |     )
   48 |     if result.returncode != 0:
   49 |         detail = (result.stderr or result.stdout or "").strip()
   50 |         raise ReleaseBuildError(
   51 |             f"command failed with exit {result.returncode}: {' '.join(command)}"
   52 |             + (f"\n{detail}" if detail else "")
   53 |         )
   54 |     return result.stdout or ""
   55 | 
   56 | 
   57 | def workspace_version(root: Path) -> str:
   58 |     text = (root / "Cargo.toml").read_text(encoding="utf-8")
   59 |     section = re.search(r"(?ms)^\[workspace\.package\]\s*(.*?)(?:^\[|\Z)", text)
   60 |     if not section:
   61 |         raise ReleaseBuildError("Cargo.toml is missing [workspace.package]")
   62 |     match = re.search(r'^version\s*=\s*["\']([^"\']+)["\']\s*$', section.group(1), re.M)
   63 |     if not match:
   64 |         raise ReleaseBuildError("Cargo.toml is missing workspace package version")
   65 |     version = match.group(1)
   66 |     if not SEMVER.fullmatch(version):
   67 |         raise ReleaseBuildError(f"workspace version is not semver: {version!r}")
   68 |     return version
   69 | 
   70 | 
   71 | def host_target() -> str:
   72 |     output = run(["rustc", "-vV"], capture=True)
   73 |     for line in output.splitlines():
   74 |         if line.startswith("host:"):
   75 |             return line.split(":", 1)[1].strip()
   76 |     raise ReleaseBuildError("rustc -vV did not report a host target")
   77 | 
   78 | 
   79 | def tool_version(command: list[str]) -> str:
   80 |     output = run(command, capture=True).strip()
   81 |     return output.splitlines()[0] if output else "unknown"
   82 | 
   83 | 
   84 | def sha256_file(path: Path) -> str:
   85 |     digest = hashlib.sha256()
   86 |     with path.open("rb") as handle:
   87 |         for chunk in iter(lambda: handle.read(1024 * 1024), b""):
   88 |             digest.update(chunk)
   89 |     return "sha256:" + digest.hexdigest()
   90 | 
   91 | 
   92 | def canonical_json(value: Any) -> bytes:
   93 |     return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode(
   94 |         "utf-8"
   95 |     )
   96 | 
   97 | 
   98 | def asset_record(stage: Path, relative: str) -> dict[str, Any]:
   99 |     path = stage / relative
  100 |     if path.is_symlink() or not path.is_file():
  101 |         raise ReleaseBuildError(f"release asset is not a regular file: {relative}")
  102 |     return {
  103 |         "path": relative,
  104 |         "bytes": path.stat().st_size,
  105 |         "sha256": sha256_file(path),
  106 |     }
  107 | 
  108 | 
  109 | def collect_assets(stage: Path) -> list[dict[str, Any]]:
  110 |     paths = ["bin/bwrk", "share/boreal/LICENSE", "share/boreal/install.sh"]
  111 |     tui_root = stage / "lib/boreal/tui"
  112 |     if not (tui_root / "entrypoint.js").is_file():
  113 |         raise ReleaseBuildError("compiled TUI entrypoint is missing from the staged release")
  114 |     paths.extend(
  115 |         path.relative_to(stage).as_posix()
  116 |         for path in sorted(tui_root.rglob("*"))
  117 |         if path.is_file()
  118 |     )
  119 |     return [asset_record(stage, relative) for relative in sorted(paths)]
  120 | 
  121 | 
  122 | def contract_identity(root: Path, output: Path) -> dict[str, Any]:
  123 |     run(
  124 |         [
  125 |             sys.executable,
  126 |             str(root / "scripts/release/release_identity.py"),
  127 |             "manifest",
  128 |             "--root",
  129 |             str(root),
  130 |             "--output",
  131 |             str(output),
  132 |         ]
  133 |     )
  134 |     return json.loads(output.read_text(encoding="utf-8"))
  135 | 
  136 | 
  137 | def build(root: Path, target: str, skip_build: bool) -> None:
  138 |     if skip_build:
  139 |         print("Skipping compilation; using existing release binary and TUI dist")
  140 |         return
  141 |     cargo = [
  142 |         "cargo",
  143 |         "build",
  144 |         "--release",
  145 |         "--locked",
  146 |         "-p",
  147 |         "boreal-cli",
  148 |         "--bin",
  149 |         "bwrk",
  150 |     ]
  151 |     if target:
  152 |         cargo.extend(["--target", target])
  153 |     run(cargo, cwd=root)
  154 |     run(["npm", "--prefix", str(root / "apps/tui"), "run", "build"], cwd=root)
  155 | 
  156 | 
  157 | def binary_path(root: Path, target: str) -> Path:
  158 |     if target:
  159 |         return root / "target" / target / "release" / "bwrk"
  160 |     return root / "target" / "release" / "bwrk"
  161 | 
  162 | 
  163 | def write_release_manifest(
  164 |     stage: Path,
  165 |     *,
  166 |     version: str,
  167 |     target: str,
  168 |     contract: dict[str, Any],
  169 |     tui_node_range: str,
  170 | ) -> Path:
  171 |     assets = collect_assets(stage)
  172 |     manifest: dict[str, Any] = {
  173 |         "manifest_version": "boreal.binary_release.v1",
  174 |         "package_id": "boreal-work",
  175 |         "version": version,
  176 |         "target": target,
  177 |         "binary": {"path": "bin/bwrk", "sha256": next(a["sha256"] for a in assets if a["path"] == "bin/bwrk")},
  178 |         "tui": {
  179 |             "runtime": "node",
  180 |             "node_range": tui_node_range,
  181 |             "api_version": contract["contract"]["api_version"],
  182 |             "envelope_schema": contract["components"]["protocol"]["schema"],
  183 |             "entrypoint": "lib/boreal/tui/entrypoint.js",
  184 |             "assets": [a for a in assets if a["path"].startswith("lib/boreal/tui/")],
  185 |         },
  186 |         "toolchain": {
  187 |             "rustc": tool_version(["rustc", "--version"]),
  188 |             "cargo": tool_version(["cargo", "--version"]),
  189 |             "node": tool_version(["node", "--version"]),
  190 |             "typescript": tool_version(["tsc", "--version"]),
  191 |         },
  192 |         "contracts": {
  193 |             "snapshot_identity": contract["snapshot_identity"],
  194 |             "asset_count": sum(
  195 |                 len(component.get("assets", []))
  196 |                 for component in contract.get("components", {}).values()
  197 |             ),
  198 |             "api_version": contract["contract"]["api_version"],
  199 |             "contract_revision": contract["contract"]["contract_revision"],
  200 |             "fixture_version": contract["contract"]["fixture_version"],
  201 |             "components": {
  202 |                 name: {
  203 |                     "schema": component["schema"],
  204 |                     "version": component["version"],
  205 |                     "identity": component["identity"],
  206 |                 }
  207 |                 for name, component in sorted(contract["components"].items())
  208 |             },
  209 |         },
  210 |         "assets": assets,
  211 |     }
  212 |     manifest["artifact_identity"] = "sha256:" + hashlib.sha256(
  213 |         canonical_json({key: value for key, value in manifest.items() if key != "artifact_identity"})
  214 |     ).hexdigest()
  215 |     output = stage / "share/boreal/release.json"
  216 |     output.parent.mkdir(parents=True, exist_ok=True)
  217 |     output.write_bytes(canonical_json(manifest))
  218 |     return output
  219 | 
  220 | 
  221 | def tui_node_range(root: Path) -> str:
  222 |     package = json.loads((root / "apps/tui/package.json").read_text(encoding="utf-8"))
  223 |     value = package.get("engines", {}).get("node")
  224 |     if not isinstance(value, str) or not value:
  225 |         raise ReleaseBuildError("apps/tui/package.json is missing a Node.js engine range")
  226 |     return value
  227 | 
  228 | 
  229 | def create_archive(stage: Path, archive: Path) -> None:
  230 |     # Normalize archive metadata so rebuilding the same staged payload does
  231 |     # not change the tarball because of checkout timestamps or local uid/gid.
  232 |     with archive.open("wb") as raw:
  233 |         with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
  234 |             with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as handle:
  235 |                 paths = [stage, *sorted(stage.rglob("*"))]
  236 |                 for path in paths:
  237 |                     relative = path.relative_to(stage)
  238 |                     arcname = stage.name if not relative.parts else f"{stage.name}/{relative.as_posix()}"
  239 |                     info = handle.gettarinfo(path, arcname=arcname)
  240 |                     info.mtime = 0
  241 |                     info.uid = 0
  242 |                     info.gid = 0
  243 |                     info.uname = ""
  244 |                     info.gname = ""
  245 |                     if info.isfile():
  246 |                         info.mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
  247 |                         with path.open("rb") as source:
  248 |                             handle.addfile(info, source)
  249 |                     else:
  250 |                         handle.addfile(info)
  251 | 
  252 | 
  253 | def parse_args() -> argparse.Namespace:
  254 |     parser = argparse.ArgumentParser(description=__doc__)
  255 |     parser.add_argument("--root", type=Path, default=ROOT)
  256 |     parser.add_argument("--version", help="release version; defaults to Cargo workspace version")
  257 |     parser.add_argument("--target", help="Rust target triple; defaults to the local host")
  258 |     parser.add_argument(
  259 |         "--output-dir",
  260 |         type=Path,
````
