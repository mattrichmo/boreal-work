#!/usr/bin/env python3
"""Run the source-bound pure-domain oracle targets for this checkout.

The oracle requires an external manifest so its expected Git revision is not
self-referential. This runner creates that manifest in a temporary directory,
passes it to both exact Cargo targets, then regenerates it to ensure neither
HEAD nor any artifact listed by the existing generator changed during the
run. It intentionally does not alter the generator's artifact list or checks.
"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "crates/domain/tests/generate_production_oracle_manifest.py"
MANIFEST_ENV = "BOREAL_PRODUCTION_ORACLE_MANIFEST"
MANIFEST_SCHEMA = "boreal.production-oracle-source-manifest/2"
ORACLE_TARGETS = (
    (
        "production_properties",
        (
            "cargo",
            "test",
            "--locked",
            "--offline",
            "-p",
            "boreal-domain",
            "--test",
            "production_properties",
            "--",
            "--nocapture",
        ),
    ),
    (
        "production_t10_oracle",
        (
            "cargo",
            "test",
            "--locked",
            "--offline",
            "-p",
            "boreal-domain",
            "--test",
            "production_t10_oracle",
        ),
    ),
)


def git_head() -> str:
    result = subprocess.run(
        ("git", "-C", str(ROOT), "rev-parse", "--verify", "HEAD"),
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(f"git rev-parse HEAD failed: {result.stderr.strip()}")
    return result.stdout.strip()


def manifest_fields(path: Path) -> tuple[str, tuple[str, ...], str, int]:
    text = path.read_text(encoding="utf-8")
    fields: dict[str, str] = {}
    artifacts: list[str] = []
    for line in text.splitlines():
        if line.startswith("schema:"):
            fields["schema"] = line.split("`", 2)[1]
        elif line.startswith("source_revision:"):
            fields["source_revision"] = line.split("`", 2)[1]
        elif line.startswith("source_tree_sha256:"):
            fields["source_tree_sha256"] = line.split("`", 2)[1]
        elif line.startswith("source_file_count:"):
            fields["source_file_count"] = line.split("`", 2)[1]
        elif line.startswith("artifact::"):
            try:
                key, encoded_digest = line.split("=", 1)
                artifact_path = key.removeprefix("artifact::").strip()
                digest = encoded_digest.strip().strip("`")
            except ValueError as error:
                raise RuntimeError(f"malformed artifact entry in manifest: {line}") from error
            if not artifact_path or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise RuntimeError(f"malformed artifact binding in manifest: {line}")
            artifacts.append(artifact_path)

    schema = fields.get("schema")
    revision = fields.get("source_revision")
    if schema != MANIFEST_SCHEMA:
        raise RuntimeError(f"unexpected generated manifest schema: {schema!r}")
    if not revision or not re.fullmatch(r"[0-9a-f]{40,64}", revision):
        raise RuntimeError(f"invalid source_revision in generated manifest: {revision!r}")
    tree_digest = fields.get("source_tree_sha256")
    if not tree_digest or not re.fullmatch(r"[0-9a-f]{64}", tree_digest):
        raise RuntimeError(f"invalid source_tree_sha256 in generated manifest: {tree_digest!r}")
    try:
        source_file_count = int(fields.get("source_file_count", ""))
    except ValueError as error:
        raise RuntimeError("invalid source_file_count in generated manifest") from error
    if source_file_count <= 0:
        raise RuntimeError(f"invalid source_file_count in generated manifest: {source_file_count}")
    if not artifacts or len(artifacts) != len(set(artifacts)):
        raise RuntimeError("generated manifest has no artifact bindings or duplicate paths")
    return revision, tuple(artifacts), tree_digest, source_file_count


def generate_manifest(output: Path) -> None:
    command = (sys.executable, str(GENERATOR), "--output", str(output))
    result = subprocess.run(command, cwd=ROOT, check=False)
    if result.returncode:
        raise RuntimeError(f"manifest generator failed with exit {result.returncode}")


def main() -> int:
    if not GENERATOR.is_file():
        print(f"ERROR: existing manifest generator not found: {GENERATOR}", file=sys.stderr)
        return 2

    try:
        starting_head = git_head()
        with tempfile.TemporaryDirectory(prefix="boreal-production-oracle-") as temporary:
            temporary_root = Path(temporary)
            manifest = temporary_root / "source-manifest.txt"
            after_manifest = temporary_root / "source-manifest-after.txt"

            print(f"Source HEAD: {starting_head}", flush=True)
            print("Generating an external oracle manifest from this checkout…", flush=True)
            generate_manifest(manifest)
            generated_revision, artifact_paths, tree_digest, source_file_count = manifest_fields(manifest)
            if generated_revision != starting_head or git_head() != starting_head:
                raise RuntimeError("HEAD changed while the source manifest was generated")
            print(
                f"Manifest binds HEAD, {source_file_count} tracked/untracked files, "
                f"and {len(artifact_paths)} explicit artifact hashes ({tree_digest}).",
                flush=True,
            )

            environment = os.environ.copy()
            environment[MANIFEST_ENV] = str(manifest)
            outcomes: list[tuple[str, int]] = []
            for target_name, cargo_args in ORACLE_TARGETS:
                rendered = shlex.join(cargo_args)
                print(f"\nRunning {target_name}: {MANIFEST_ENV}={manifest} {rendered}", flush=True)
                result = subprocess.run(cargo_args, cwd=ROOT, env=environment, check=False)
                outcomes.append((target_name, result.returncode))

                current_head = git_head()
                if current_head != starting_head:
                    raise RuntimeError(
                        f"HEAD changed during oracle run: started {starting_head}, now {current_head}"
                    )

            print("\nRechecking the manifest-bound source artifacts…", flush=True)
            generate_manifest(after_manifest)
            after_revision, after_artifacts, after_tree_digest, after_file_count = manifest_fields(after_manifest)
            if (
                after_revision != starting_head
                or after_artifacts != artifact_paths
                or after_tree_digest != tree_digest
                or after_file_count != source_file_count
            ):
                raise RuntimeError("HEAD or the source-tree/artifact manifest changed during oracle run")
            if manifest.read_bytes() != after_manifest.read_bytes():
                raise RuntimeError(
                    "the generated source manifest changed during oracle run; "
                    "a bound artifact or tracked-worktree state changed"
                )
            if git_head() != starting_head:
                raise RuntimeError("HEAD changed before oracle-run completion")

            failed = [(name, code) for name, code in outcomes if code != 0]
            if failed:
                summary = ", ".join(f"{name}=exit {code}" for name, code in failed)
                print(f"\nOracle target failure(s): {summary}", file=sys.stderr)
                return 1
            print("\nPASS: both source-bound pure-domain oracle targets passed.", flush=True)
            return 0
    except (OSError, RuntimeError, subprocess.SubprocessError, IndexError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
