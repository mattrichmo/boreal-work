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
import tempfile
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


def source_identity(root: Path) -> str:
    """Match the Rust CLI build fingerprint exactly."""
    files: set[Path] = set()
    for directory in (root / "crates", root / "skills", root / "project/spec/workflows"):
        if directory.is_dir():
            for path in directory.rglob("*"):
                if path.is_symlink() or not path.is_file():
                    continue
                if any(part in {"tests", "benches", "examples"} for part in path.relative_to(directory).parts):
                    continue
                if path.name == "Cargo.toml" or path.suffix in {
                    ".rs", ".md", ".yaml", ".yml", ".json", ".toml"
                }:
                    files.add(path)
    for relative in (
        "Cargo.toml",
        "Cargo.lock",
        "apps/tui/installer/wizard.cjs",
        "apps/tui/installer/wizard-body.cjs",
    ):
        path = root / relative
        if path.is_file() and not path.is_symlink():
            files.add(path)
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda item: item.relative_to(root).as_posix()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\n")
    return "sha256:" + digest.hexdigest()


def runtime_source_identity(root: Path, app_name: str) -> str:
    """Fingerprint authored TUI inputs separately from the CLI build fingerprint."""
    app_root = root / "apps" / app_name
    files: set[Path] = set()
    source_root = app_root / "src"
    if not source_root.is_dir() or source_root.is_symlink():
        raise ReleaseBuildError(f"TUI source directory is missing: {source_root}")
    for path in source_root.rglob("*.ts"):
        relative = path.relative_to(source_root)
        if path.is_symlink() or relative.name == "test.ts" or relative.name.endswith(".test.ts"):
            continue
        files.add(path)
    for name in ("package.json", "package-lock.json", "tsconfig.json"):
        path = app_root / name
        if path.is_file() and not path.is_symlink():
            files.add(path)
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda item: item.relative_to(root).as_posix()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\n")
    return "sha256:" + digest.hexdigest()

def binary_version(binary: Path) -> dict[str, Any]:
    result = subprocess.run(
        [str(binary), "--version", "--json"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise ReleaseBuildError(f"release binary version probe failed: {result.stderr.strip()}")
    try:
        envelope = json.loads(result.stdout)
        data = envelope["data"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise ReleaseBuildError(f"release binary returned invalid version JSON: {error}") from error
    if not isinstance(data, dict) or data.get("command") != "version":
        raise ReleaseBuildError("release binary version probe returned no version data")
    return data


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


TUI_UI_MODULES = ("cells", "dashboard", "input", "keys", "layout", "model", "screen", "terminal-size")
def compiled_module_paths(source_root: Path) -> list[Path]:
    """Return runtime outputs derived from authored TypeScript source files."""
    source_directory = source_root / "src"
    if source_directory.is_symlink() or not source_directory.is_dir():
        raise ReleaseBuildError(f"TUI source directory is missing: {source_directory}")
    modules: list[Path] = []
    for source in sorted(source_directory.rglob("*.ts")):
        relative = source.relative_to(source_directory)
        if (
            source.is_symlink()
            or relative.name.endswith(".d.ts")
            or relative.name == "test.ts"
            or relative.name.endswith(".test.ts")
        ):
            continue
        modules.append(relative.with_suffix(".js"))
    if not modules:
        raise ReleaseBuildError(f"TUI source directory has no runtime modules: {source_directory}")
    return modules


def stage_tui(root: Path, stage: Path, compiled_root: Path) -> None:
    """Stage only source-backed runtime modules, omitting TS source and stale dist files."""
    source_root = root / "apps/tui"
    runtime_root = stage / "lib/boreal/tui"
    runtime_root.mkdir(parents=True, exist_ok=True)
    modules = compiled_module_paths(source_root)
    for module in TUI_UI_MODULES:
        if Path("ui") / f"{module}.js" not in modules:
            raise ReleaseBuildError(f"compiled TUI module is missing: ui/{module}.js")
    for relative in modules:
        source = compiled_root / relative
        if source.is_symlink() or not source.is_file():
            raise ReleaseBuildError(f"compiled TUI module is missing or unsafe: {relative}")
        destination = runtime_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    # Node must interpret installed .js modules the same way the source tree does.
    shutil.copy2(source_root / "package.json", runtime_root / "package.json")


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
    global_root = stage / "lib/boreal/global-tui"
    if not (global_root / "entrypoint.js").is_file():
        raise ReleaseBuildError("compiled global TUI entrypoint is missing from the release")
    paths.extend(path.relative_to(stage).as_posix() for path in sorted(global_root.rglob("*")) if path.is_file())
    for module in TUI_UI_MODULES:
        if not (tui_root / "ui" / f"{module}.js").is_file():
            raise ReleaseBuildError(f"installed TUI module is missing: ui/{module}.js")
    return [asset_record(stage, relative) for relative in sorted(set(paths))]


def stage_global_tui(root: Path, stage: Path, compiled_root: Path) -> None:
    source_root = root / "apps/global-tui"
    runtime_root = stage / "lib/boreal/global-tui"
    runtime_root.mkdir(parents=True, exist_ok=True)
    for relative in compiled_module_paths(source_root):
        source = compiled_root / relative
        if source.is_symlink() or not source.is_file():
            raise ReleaseBuildError(f"compiled Global TUI module is missing or unsafe: {relative}")
        destination = runtime_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    shutil.copy2(source_root / "package.json", runtime_root / "package.json")

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


def build(
    root: Path, target: str, skip_cli_build: bool, compiled_output: Path
) -> tuple[Path, Path]:
    if not skip_cli_build:
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
    else:
        print("Skipping CLI compilation; compiling clean TUI runtime output")

    tui_output = compiled_output / "tui"
    global_tui_output = compiled_output / "global-tui"
    tui_output.mkdir(parents=True)
    global_tui_output.mkdir(parents=True)
    for package, output in (("tui", tui_output), ("global-tui", global_tui_output)):
        run(
            [
                "npm",
                "--prefix",
                str(root / f"apps/{package}"),
                "run",
                "build",
                "--",
                "--outDir",
                str(output),
            ],
            cwd=root,
        )
    return tui_output, global_tui_output

def binary_path(root: Path, target: str) -> Path:
    if target:
        return root / "target" / target / "release" / "bwrk"
    return root / "target" / "release" / "bwrk"


def write_release_manifest(
    stage: Path,
    *,
    version: str,
    target: str,
    revision: str,
    source_id: str,
    tui_source_id: str,
    global_tui_source_id: str,
    contract: dict[str, Any],
    tui_node_range: str,
) -> Path:
    assets = collect_assets(stage)
    manifest: dict[str, Any] = {
        "manifest_version": "boreal.binary_release.v1",
        "package_id": "boreal-work",
        "version": version,
        "source_revision": revision,
        "source_id": source_id,
        "target": target,
        "binary": {"path": "bin/bwrk", "sha256": next(a["sha256"] for a in assets if a["path"] == "bin/bwrk")},
        "tui": {
            "runtime": "node",
            "source_id": tui_source_id,
            "node_range": tui_node_range,
            "api_version": contract["contract"]["api_version"],
            "envelope_schema": contract["components"]["protocol"]["schema"],
            "entrypoint": "lib/boreal/tui/entrypoint.js",
            "assets": [a for a in assets if a["path"].startswith("lib/boreal/tui/")],
        },
        "global_tui": {
            "runtime": "node",
            "source_id": global_tui_source_id,
            "node_range": tui_node_range,
            "api_version": contract["contract"]["api_version"],
            "entrypoint": "lib/boreal/global-tui/entrypoint.js",
            "assets": [a for a in assets if a["path"].startswith("lib/boreal/global-tui/")],
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


def write_sha256sums(output_dir: Path, version: str) -> None:
    """Index the target archives for this version in the output directory."""
    entries = [
        f"{sha256_file(archive).removeprefix('sha256:')}  {archive.name}"
        for archive in sorted(output_dir.glob(f"bwrk-v{version}-*.tar.gz"))
        if archive.is_file()
    ]
    (output_dir / "SHA256SUMS").write_text(
        "".join(f"{entry}\n" for entry in entries), encoding="utf-8"
    )


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
        help="package an existing target/release/bwrk; TUI outputs are still compiled cleanly",
    )
    return parser.parse_args()


def build_archive(
    root: Path,
    output_dir: Path,
    version: str,
    target: str,
    cargo_target: str,
    compiled_tui: Path,
    compiled_global_tui: Path,
) -> Path:
    archive_base = f"bwrk-v{version}-{target}"
    stage = output_dir / archive_base
    archive = output_dir / f"{archive_base}.tar.gz"
    release_manifest = output_dir / f"{archive_base}.release.json"
    if stage.exists() or archive.exists() or release_manifest.exists():
        raise ReleaseBuildError(f"release output already exists: {output_dir}")

    binary = binary_path(root, cargo_target)
    if not binary.is_file():
        raise ReleaseBuildError(f"release binary is missing: {binary}")
    source_id = source_identity(root)
    version_data = binary_version(binary)
    if version_data.get("build_source_id") != source_id:
        raise ReleaseBuildError(
            "release binary is stale for the current source tree: "
            f"binary={version_data.get('build_source_id')!r}, source={source_id!r}"
        )
    if version_data.get("workflow_assets") != "boreal.workflow.assets.v1" or version_data.get("skill_assets") != "boreal.core-skills":
        raise ReleaseBuildError("release binary does not report its workflow and skill capabilities")
    build_revision = version_data.get("build_revision")
    if not isinstance(build_revision, str) or not build_revision:
        raise ReleaseBuildError("release binary does not report its build revision")

    stage.mkdir(parents=True)
    (stage / "bin").mkdir()
    (stage / "share/boreal").mkdir(parents=True)
    shutil.copy2(binary, stage / "bin/bwrk")
    (stage / "bin/bwrk").chmod(0o755)
    stage_tui(root, stage, compiled_tui)
    stage_global_tui(root, stage, compiled_global_tui)
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
            revision=build_revision,
            source_id=source_id,
            tui_source_id=runtime_source_identity(root, "tui"),
            global_tui_source_id=runtime_source_identity(root, "global-tui"),
            contract=contract,
            tui_node_range=tui_node_range(root),
        )
        run(
            [
                sys.executable,
                str(root / "scripts/release/verify_release_package.py"),
                str(stage),
                str(stage / "share/boreal/release.json"),
            ],
            cwd=root,
        )
        create_archive(stage, archive)
        shutil.copy2(stage / "share/boreal/release.json", release_manifest)
        write_sha256sums(output_dir, version)
    finally:
        contract_file.unlink(missing_ok=True)

    print(json.dumps({
        "archive": str(archive),
        "release_manifest": str(release_manifest),
        "target": target,
        "version": version,
        "sha256": sha256_file(archive),
    }, sort_keys=True))
    return archive


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

    with tempfile.TemporaryDirectory(prefix="boreal-release-", dir=output_dir) as temporary:
        compiled_tui, compiled_global_tui = build(
            root, args.target or "", args.skip_build, Path(temporary)
        )
        build_archive(
            root,
            output_dir,
            version,
            target,
            args.target or "",
            compiled_tui,
            compiled_global_tui,
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ReleaseBuildError, json.JSONDecodeError) as error:
        print(f"release build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
