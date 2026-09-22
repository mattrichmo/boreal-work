#!/usr/bin/env python3
"""Audit and safely apply a Boreal source archive.

The default behavior is read-only.  An archive must contain the manifest
produced by create-zips.mjs unless --allow-legacy is explicitly supplied.
Applying changes requires a separate backup directory and refuses conflicts,
protected paths, unsafe archive entries, and implicit deletions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat as stat_module
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Optional, Tuple


MANIFEST_SCHEMA = "boreal.archive-manifest.v1"
LEGACY_SCHEMA = "boreal.archive-manifest.legacy-v1"
DEFAULT_PROTECTED = {
    ".git",
    ".boreal",
    "memory",
    "target",
    "node_modules",
    "test-project",
}
BLOCKING_CLASSIFICATIONS = {
    "conflict",
    "protected",
    "unsafe",
    "manifest_mismatch",
    "deletion_blocked",
}
APPLY_CLASSIFICATIONS = {"add", "safe_replace", "mode_change"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit or safely apply a manifest-backed Boreal source ZIP."
    )
    parser.add_argument("archive", type=Path, help="incoming ZIP archive")
    parser.add_argument("--target", required=True, type=Path, help="target repository")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="read-only preflight")
    mode.add_argument("--apply", action="store_true", help="apply only if preflight is clean")
    parser.add_argument("--base", type=Path, help="baseline ZIP or manifest for three-way comparison")
    parser.add_argument(
        "--backup",
        type=Path,
        help="new, separate backup directory required with --apply",
    )
    parser.add_argument("--allow-legacy", action="store_true", help="allow an unmanifested legacy ZIP in conservative two-way mode")
    parser.add_argument("--report", type=Path, help="write a JSON and Markdown report at this path")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    return parser.parse_args()


def fail(message: str) -> None:
    print(f"overlay error: {message}", file=sys.stderr)
    raise SystemExit(2)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_relative(value: str) -> str:
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe relative path: {value!r}")
    if any(part == "" for part in path.parts):
        raise ValueError(f"empty path component: {value!r}")
    return str(path)


def is_protected(relative_path: str, protected: Iterable[str]) -> bool:
    parts = PurePosixPath(relative_path).parts
    return bool(parts and parts[0] in set(protected))


def zip_mode(info: zipfile.ZipInfo) -> int:
    mode = (info.external_attr >> 16) & 0o7777
    return mode or 0o644


def is_zip_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0o170000
    return stat_module.S_ISLNK(mode)


def common_archive_root(names: Iterable[str]) -> str:
    roots = set()
    for name in names:
        if not name or name.endswith("/"):
            continue
        roots.add(name.split("/", 1)[0])
    if len(roots) != 1:
        raise ValueError("archive must contain exactly one top-level directory")
    return next(iter(roots))


def manifest_from_json(raw: Dict[str, Any], archive_root: str) -> Dict[str, Any]:
    schema = raw.get("schema_version")
    if schema != MANIFEST_SCHEMA:
        raise ValueError(f"unsupported manifest schema: {schema!r}")
    declared_root = raw.get("archive_directory")
    if declared_root != archive_root:
        raise ValueError(
            f"manifest archive_directory {declared_root!r} does not match {archive_root!r}"
        )

    raw_entries = raw.get("files")
    if not isinstance(raw_entries, list):
        raise ValueError("manifest files must be a list")

    entries: List[Dict[str, Any]] = []
    seen = set()
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            raise ValueError("manifest file entry must be an object")
        relative_path = normalize_relative(str(raw_entry.get("path", "")))
        if relative_path in seen:
            raise ValueError(f"duplicate manifest path: {relative_path}")
        sha256 = raw_entry.get("sha256")
        if not isinstance(sha256, str) or len(sha256) != 64:
            raise ValueError(f"invalid sha256 for {relative_path}")
        entries.append(
            {
                "path": relative_path,
                "sha256": sha256,
                "bytes": int(raw_entry.get("bytes", -1)),
                "mode": int(raw_entry.get("mode", 0o644)),
            }
        )
        seen.add(relative_path)

    return {
        "schema_version": schema,
        "archive_id": raw.get("archive_id"),
        "archive_directory": archive_root,
        "generated_at": raw.get("generated_at"),
        "source_commit": raw.get("source_commit"),
        "source_branch": raw.get("source_branch"),
        "source_dirty": raw.get("source_dirty"),
        "files": entries,
        "deletions": [normalize_relative(value) for value in raw.get("deletions", [])],
        "protected_paths": sorted(
            DEFAULT_PROTECTED | set(raw.get("protected_paths", []))
        ),
        "legacy": False,
    }


def legacy_manifest(zf: zipfile.ZipFile, archive_root: str) -> Dict[str, Any]:
    entries = []
    prefix = archive_root + "/"
    for info in zf.infolist():
        if info.is_dir() or not info.filename.startswith(prefix):
            continue
        relative_path = info.filename[len(prefix) :]
        if not relative_path or relative_path in {"REFERENCE_INDEX.md", "ARCHIVE_MANIFEST.json"}:
            continue
        relative_path = normalize_relative(relative_path)
        if is_zip_symlink(info):
            raise ValueError(f"legacy archive contains a symlink: {relative_path}")
        data = zf.read(info)
        entries.append(
            {
                "path": relative_path,
                "sha256": sha256_bytes(data),
                "bytes": len(data),
                "mode": zip_mode(info),
            }
        )
    return {
        "schema_version": LEGACY_SCHEMA,
        "archive_id": "legacy",
        "archive_directory": archive_root,
        "generated_at": None,
        "source_commit": None,
        "source_branch": None,
        "source_dirty": None,
        "files": sorted(entries, key=lambda entry: entry["path"]),
        "deletions": [],
        "protected_paths": sorted(DEFAULT_PROTECTED),
        "legacy": True,
    }


def load_archive(archive: Path, allow_legacy: bool) -> Tuple[zipfile.ZipFile, Dict[str, Any], List[str]]:
    try:
        zf = zipfile.ZipFile(archive)
    except (OSError, zipfile.BadZipFile) as exc:
        raise ValueError(f"cannot open archive: {exc}") from exc

    names = [info.filename for info in zf.infolist()]
    try:
        archive_root = common_archive_root(names)
    except ValueError:
        zf.close()
        raise

    manifest_names = [
        name
        for name in names
        if name == f"{archive_root}/ARCHIVE_MANIFEST.json"
    ]
    warnings: List[str] = []
    if manifest_names:
        raw = json.loads(zf.read(manifest_names[0]).decode("utf-8"))
        manifest = manifest_from_json(raw, archive_root)
    else:
        if not allow_legacy:
            zf.close()
            raise ValueError(
                "archive has no ARCHIVE_MANIFEST.json; rerun create-zips.mjs or pass --allow-legacy"
            )
        manifest = legacy_manifest(zf, archive_root)
        warnings.append("legacy archive has no baseline, commit identity, or allowlist manifest")

    listed_members = {f"{archive_root}/{entry['path']}" for entry in manifest["files"]}
    metadata_members = {
        f"{archive_root}/REFERENCE_INDEX.md",
        f"{archive_root}/ARCHIVE_MANIFEST.json",
    }
    extra_members = []
    for info in zf.infolist():
        if info.is_dir() or not info.filename.startswith(f"{archive_root}/"):
            continue
        if info.filename not in listed_members and info.filename not in metadata_members:
            extra_members.append(info.filename)
    if extra_members:
        warnings.append("archive contains files not listed in the manifest")

    for entry in manifest["files"]:
        member = f"{archive_root}/{entry['path']}"
        try:
            info = zf.getinfo(member)
        except KeyError as exc:
            zf.close()
            raise ValueError(f"manifest file is missing from archive: {member}") from exc
        if info.is_dir() or is_zip_symlink(info):
            zf.close()
            raise ValueError(f"manifest file is not a regular file: {member}")
        data = zf.read(info)
        if sha256_bytes(data) != entry["sha256"]:
            zf.close()
            raise ValueError(f"manifest hash mismatch: {member}")
        if entry["bytes"] >= 0 and len(data) != entry["bytes"]:
            zf.close()
            raise ValueError(f"manifest byte count mismatch: {member}")

    manifest["extra_members"] = extra_members
    return zf, manifest, warnings


def run_git(target: Path, args: List[str]) -> Optional[bytes]:
    try:
        result = subprocess.run(
            ["git", "-C", str(target), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def git_base_entries(target: Path, commit: Optional[str], paths: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    if not commit:
        return {}
    if run_git(target, ["cat-file", "-e", f"{commit}^{{commit}}"]) is None:
        return {}
    result: Dict[str, Dict[str, Any]] = {}
    for relative_path in paths:
        data = run_git(target, ["show", f"{commit}:{relative_path}"])
        if data is None:
            continue
        mode_data = run_git(target, ["ls-tree", commit, "--", relative_path])
        mode = 0o644
        if mode_data:
            first = mode_data.decode("utf-8", errors="replace").split("\t", 1)[0]
            try:
                mode = int(first.split()[0], 8) & 0o777
            except (IndexError, ValueError):
                pass
        result[relative_path] = {
            "sha256": sha256_bytes(data),
            "bytes": len(data),
            "mode": mode,
        }
    return result


def load_base_entries(base: Optional[Path], target: Path, incoming: Dict[str, Any]) -> Tuple[Dict[str, Dict[str, Any]], str]:
    if base is not None:
        if base.suffix.lower() == ".json":
            raw = json.loads(base.read_text(encoding="utf-8"))
            manifest = manifest_from_json(raw, raw.get("archive_directory", ""))
            return {entry["path"]: entry for entry in manifest["files"]}, f"manifest:{base}"
        base_zip, base_manifest, _ = load_archive(base, allow_legacy=False)
        base_zip.close()
        return {
            entry["path"]: entry for entry in base_manifest["files"]
        }, f"archive:{base}"

    source_commit = incoming.get("source_commit")
    entries = git_base_entries(
        target,
        source_commit,
        (entry["path"] for entry in incoming["files"]),
    )
    if entries:
        return entries, f"git:{source_commit}"
    return {}, "none (conservative two-way mode)"


def safe_target_path(root: Path, relative_path: str) -> Tuple[Path, Optional[str]]:
    current = root
    for component in PurePosixPath(relative_path).parts:
        current = current / component
        if os.path.lexists(current) and current.is_symlink():
            return current, "target path contains a symlink"
    return current, None


def inspect_local(path: Path) -> Dict[str, Any]:
    if not os.path.lexists(path):
        return {"kind": "missing", "sha256": None, "bytes": None, "mode": None}
    info = path.lstat()
    if stat_module.S_ISLNK(info.st_mode):
        return {"kind": "symlink", "sha256": None, "bytes": None, "mode": info.st_mode & 0o777}
    if stat_module.S_ISDIR(info.st_mode):
        return {"kind": "directory", "sha256": None, "bytes": None, "mode": info.st_mode & 0o777}
    if not stat_module.S_ISREG(info.st_mode):
        return {"kind": "special", "sha256": None, "bytes": None, "mode": info.st_mode & 0o777}
    return {
        "kind": "file",
        "sha256": sha256_file(path),
        "bytes": info.st_size,
        "mode": info.st_mode & 0o777,
    }


def summarize(report: Dict[str, Any]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for item in report["files"]:
        classification = item["classification"]
        counts[classification] = counts.get(classification, 0) + 1
    for item in report.get("deletions", []):
        counts[item["classification"]] = counts.get(item["classification"], 0) + 1
    return dict(sorted(counts.items()))


def build_report(zf: zipfile.ZipFile, manifest: Dict[str, Any], target: Path, base_entries: Dict[str, Dict[str, Any]], base_source: str, warnings: List[str]) -> Dict[str, Any]:
    protected = set(manifest.get("protected_paths", [])) | DEFAULT_PROTECTED
    files: List[Dict[str, Any]] = []
    for entry in sorted(manifest["files"], key=lambda value: value["path"]):
        relative_path = entry["path"]
        target_path, path_error = safe_target_path(target, relative_path)
        local = inspect_local(target_path) if path_error is None else {"kind": "unsafe", "sha256": None, "bytes": None, "mode": None}
        base = base_entries.get(relative_path)
        item: Dict[str, Any] = {
            "path": relative_path,
            "classification": "unchanged",
            "action": "skip",
            "incoming": {key: entry.get(key) for key in ("sha256", "bytes", "mode")},
            "local": local,
            "base": base,
        }

        if is_protected(relative_path, protected):
            item["classification"] = "protected"
            item["reason"] = "manifest path is protected from archive overlay"
        elif path_error is not None or local["kind"] in {"symlink", "directory", "special", "unsafe"}:
            item["classification"] = "unsafe"
            item["reason"] = path_error or f"target is a {local['kind']}"
        elif local["kind"] == "missing":
            item["classification"] = "add"
            item["action"] = "apply"
        elif local["sha256"] == entry["sha256"]:
            if local["mode"] != entry["mode"]:
                item["classification"] = "mode_change"
                item["action"] = "apply"
            else:
                item["classification"] = "unchanged"
        elif base and local["sha256"] == base.get("sha256") and entry["sha256"] != base.get("sha256"):
            item["classification"] = "safe_replace"
            item["action"] = "apply"
        elif base and entry["sha256"] == base.get("sha256") and local["sha256"] != base.get("sha256"):
            item["classification"] = "local_preserved"
            item["reason"] = "incoming archive has no change relative to the baseline"
        else:
            item["classification"] = "conflict"
            item["reason"] = "local and incoming content both differ from the baseline"
        files.append(item)

    deletions = []
    for relative_path in manifest.get("deletions", []):
        deletions.append(
            {
                "path": relative_path,
                "classification": "deletion_blocked",
                "action": "never_delete_implicitly",
                "reason": "deletions require a separate reviewed operation",
            }
        )

    report: Dict[str, Any] = {
        "schema_version": "boreal.overlay-report.v1",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "archive": manifest.get("archive_id"),
        "archive_schema": manifest.get("schema_version"),
        "archive_generated_at": manifest.get("generated_at"),
        "source_commit": manifest.get("source_commit"),
        "target": str(target),
        "base_source": base_source,
        "legacy_archive": manifest.get("legacy", False),
        "warnings": warnings,
        "archive_errors": [
            f"unlisted archive member: {member}" for member in manifest.get("extra_members", [])
        ],
        "files": files,
        "deletions": deletions,
    }
    report["summary"] = summarize(report)
    report["blocking"] = bool(report["archive_errors"]) or any(
        item["classification"] in BLOCKING_CLASSIFICATIONS
        for item in files + deletions
    )
    return report


def markdown_report(report: Dict[str, Any]) -> str:
    lines = [
        "# Boreal overlay report",
        "",
        f"- Archive: `{report['archive']}`",
        f"- Archive schema: `{report['archive_schema']}`",
        f"- Target: `{report['target']}`",
        f"- Base: `{report['base_source']}`",
        f"- Blocking: `{report['blocking']}`",
        "",
        "## Summary",
        "",
    ]
    for key, value in report["summary"].items():
        lines.append(f"- `{key}`: {value}")
    if report["warnings"]:
        lines.extend(["", "## Warnings", ""])
        lines.extend(f"- {warning}" for warning in report["warnings"])
    if report["archive_errors"]:
        lines.extend(["", "## Archive errors", ""])
        lines.extend(f"- {error}" for error in report["archive_errors"])
    lines.extend(["", "## Files", "", "| Path | Classification | Action | Reason |", "| --- | --- | --- | --- |"])
    for item in report["files"]:
        reason = item.get("reason", "")
        lines.append(
            f"| `{item['path']}` | `{item['classification']}` | `{item['action']}` | {reason} |"
        )
    for item in report["deletions"]:
        lines.append(
            f"| `{item['path']}` | `{item['classification']}` | `{item['action']}` | {item['reason']} |"
        )
    return "\n".join(lines) + "\n"


def write_report(report: Dict[str, Any], destination: Optional[Path]) -> None:
    if destination is None:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    json_path = destination if destination.suffix.lower() == ".json" else destination.with_suffix(".json")
    markdown_path = destination if destination.suffix.lower() in {".md", ".markdown"} else destination.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_report(report), encoding="utf-8")


def ensure_backup_directory(backup: Path, target: Path) -> None:
    backup = backup.absolute()
    target = target.absolute()
    if backup == target or target in backup.parents or backup in target.parents:
        raise ValueError("backup directory must be separate from the target repository")
    if backup.exists():
        if not backup.is_dir() or any(backup.iterdir()):
            raise ValueError("backup directory must be new or empty")
    else:
        backup.mkdir(parents=True)


def write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    ) as handle:
        temporary = Path(handle.name)
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def apply_report(report: Dict[str, Any], zf: zipfile.ZipFile, manifest: Dict[str, Any], target: Path, backup: Path) -> None:
    ensure_backup_directory(backup, target)
    planned = [item for item in report["files"] if item["classification"] in APPLY_CLASSIFICATIONS]
    journal: Dict[str, Any] = {
        "schema_version": "boreal.overlay-journal.v1",
        "state": "prepared",
        "archive": report["archive"],
        "target": str(target),
        "backup": str(backup),
        "planned": [item["path"] for item in planned],
        "backed_up": [],
        "applied": [],
    }
    journal_path = backup / "OVERLAY_JOURNAL.json"
    write_json_atomic(journal_path, journal)

    for item in planned:
        relative_path = item["path"]
        target_path, path_error = safe_target_path(target, relative_path)
        if path_error:
            raise RuntimeError(f"target changed after preflight: {relative_path}: {path_error}")
        backup_path = backup / relative_path
        if target_path.exists():
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target_path, backup_path)
            journal["backed_up"].append(relative_path)
            journal["state"] = "backing_up"
            write_json_atomic(journal_path, journal)

        target_path.parent.mkdir(parents=True, exist_ok=True)
        member = f"{manifest['archive_directory']}/{relative_path}"
        temporary: Optional[Path] = None
        try:
            with zf.open(member, "r") as source:
                with tempfile.NamedTemporaryFile(
                    mode="wb", dir=target_path.parent, prefix=f".{target_path.name}.", delete=False
                ) as destination:
                    temporary = Path(destination.name)
                    shutil.copyfileobj(source, destination)
                    destination.flush()
                    os.fsync(destination.fileno())
            os.chmod(temporary, item["incoming"]["mode"])
            os.replace(temporary, target_path)
            temporary = None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

        actual = inspect_local(target_path)
        if actual["sha256"] != item["incoming"]["sha256"]:
            raise RuntimeError(f"post-apply hash mismatch: {relative_path}")
        journal["applied"].append(relative_path)
        journal["state"] = "applying"
        write_json_atomic(journal_path, journal)

    journal["state"] = "complete"
    write_json_atomic(journal_path, journal)
    report["applied"] = journal["applied"]
    report["backup"] = str(backup)
    report["journal"] = str(journal_path)


def print_report(report: Dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return
    print(f"Overlay: {report['archive']} -> {report['target']}")
    print(f"Base: {report['base_source']}")
    for key, value in report["summary"].items():
        print(f"  {key}: {value}")
    if report["warnings"]:
        print("Warnings:")
        for warning in report["warnings"]:
            print(f"  - {warning}")
    if report["archive_errors"]:
        print("Archive errors:")
        for error in report["archive_errors"]:
            print(f"  - {error}")
    blocking = [
        item for item in report["files"] + report["deletions"]
        if item["classification"] in BLOCKING_CLASSIFICATIONS
    ]
    if blocking:
        print("Blocking files:")
        for item in blocking:
            print(f"  - {item['path']}: {item.get('reason', item['classification'])}")


def main() -> int:
    args = parse_args()
    archive = args.archive.expanduser().resolve()
    target = args.target.expanduser().resolve()
    if not archive.is_file():
        fail(f"archive does not exist: {archive}")
    if not target.is_dir():
        fail(f"target is not a directory: {target}")
    if args.apply and args.backup is None:
        fail("--apply requires a separate --backup directory")

    try:
        zf, manifest, warnings = load_archive(archive, args.allow_legacy)
        base_entries, base_source = load_base_entries(args.base, target, manifest)
        report = build_report(zf, manifest, target, base_entries, base_source, warnings)
        if args.apply:
            if report["blocking"]:
                write_report(report, args.report)
                print_report(report, args.json)
                zf.close()
                print("overlay not applied: resolve the preflight report first", file=sys.stderr)
                return 1
            apply_report(report, zf, manifest, target, args.backup.expanduser().resolve())
            report["summary"] = summarize(report)
            write_report(report, args.backup.expanduser().resolve() / "OVERLAY_REPORT.json")
        write_report(report, args.report)
        zf.close()
    except (OSError, ValueError, KeyError, json.JSONDecodeError, RuntimeError) as exc:
        fail(str(exc))

    print_report(report, args.json)
    return 1 if report["blocking"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
