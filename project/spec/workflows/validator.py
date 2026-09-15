#!/usr/bin/env python3
"""Fail-closed validator for the checked-in Boreal v2 workflow package.

This validator intentionally has no third-party dependencies and does not
execute commands from an asset.  It validates the package boundary that is
consumed by the application workflow registry and compares command families
and flags with the versioned CLI parity contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


PACKAGE_SCHEMA = "boreal.workflow_package.v1"
ASSET_SCHEMA = "boreal.workflow_asset.v1"
AUTHORITY = "boreal.application.v2"
EXECUTION_MODEL = "one_action_per_guidance_response"
PACKAGE_ID = "boreal.core-workflows"
CORE_REFS = {
    "boreal.workflow.route.v1",
    "boreal.workflow.context.v1",
    "boreal.workflow.plan.v1",
    "boreal.workflow.claim.v1",
    "boreal.workflow.finish.v1",
    "boreal.workflow.review.v1",
    "boreal.workflow.audit.v1",
    "boreal.workflow.handoff.v1",
    "boreal.workflow.health.v1",
    "boreal.workflow.memory.v1",
}
CORE_KINDS = {ref.rsplit(".", 2)[1] for ref in CORE_REFS}
REF_PATTERN = re.compile(r"^boreal\.workflow\.[a-z0-9-]+\.v[0-9]+$")
SEMVER_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
PLACEHOLDER_PATTERN = re.compile(r"^<[a-z][a-z0-9_]*>$")
SHELL_METACHARACTERS = set(";&|<>$`()\\\n\r")

PACKAGE_KEYS = {
    "schema_version",
    "package_id",
    "package_version",
    "asset_identity",
    "state_authority",
    "execution_model",
    "assets",
    "validation",
}
PACKAGE_ASSET_KEYS = {"ref", "path", "kind"}
ASSET_KEYS = {
    "schema_version",
    "asset_version",
    "ref",
    "kind",
    "title",
    "refs",
    "allowed_commands",
    "typed_inputs",
    "finish_criteria",
    "next_refs",
    "state_transition_owner",
}
INPUT_KEYS = {"name", "type", "required", "source", "validation", "default"}
CRITERION_KEYS = {"id", "type", "required"}
MANIFEST_KEYS = {
    "schema_version",
    "fixture_version",
    "registry_version",
    "trusted",
    "workflow_refs",
    "asset_policy",
}
MANIFEST_POLICY_KEYS = {
    "checked_in",
    "allowed_commands_only",
    "free_form_commands_are_data",
    "unknown_fields",
}


class ValidationError(ValueError):
    """A package defect that must fail packaging or CI."""


@dataclass(frozen=True)
class ValidationReport:
    package_id: str
    package_version: str
    asset_identity: str
    asset_count: int
    command_count: int
    referenced_cli_shapes: int


def _label(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def _load_json(path: Path, root: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValidationError(f"{_label(path, root)}: cannot read JSON: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValidationError(f"{_label(path, root)}: invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ValidationError(f"{_label(path, root)}: root must be an object")
    return value


def _strict_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    unknown = sorted(set(value) - expected)
    missing = sorted(expected - set(value))
    if unknown:
        raise ValidationError(f"{label}: unknown field(s): {', '.join(unknown)}")
    if missing:
        raise ValidationError(f"{label}: missing field(s): {', '.join(missing)}")


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{label}: expected a non-empty string")
    return value


def _string_array(value: Any, label: str, *, non_empty: bool = True) -> list[str]:
    if not isinstance(value, list) or (non_empty and not value):
        raise ValidationError(f"{label}: expected a non-empty array")
    result = []
    for index, item in enumerate(value):
        result.append(_string(item, f"{label}[{index}]"))
    return result


def _unique(values: Iterable[str], label: str) -> None:
    seen: set[str] = set()
    duplicates: list[str] = []
    for value in values:
        if value in seen and value not in duplicates:
            duplicates.append(value)
        seen.add(value)
    if duplicates:
        raise ValidationError(f"{label}: duplicate value(s): {', '.join(duplicates)}")


def _sha256_identity(package: dict[str, Any], root: Path) -> str:
    """Hash the ordered asset metadata paths and exact asset bytes.

    The package file is excluded to avoid a circular digest.  Metadata order is
    significant, so reordering assets is an intentional package change.
    """

    digest = hashlib.sha256()
    for entry in package["assets"]:
        path = root / entry["path"]
        digest.update(entry["path"].encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def _contract_command_shapes(cli_contract: dict[str, Any]) -> tuple[set[tuple[str, ...]], set[str]]:
    shapes: set[tuple[str, ...]] = set()
    flags: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            syntax = value.get("syntax")
            if isinstance(syntax, str) and syntax.startswith("bwrk "):
                tokens = shlex.split(syntax)
                head = ["bwrk"]
                for token in tokens[1:]:
                    if token.startswith("-") or token.startswith("[") or token.startswith("("):
                        break
                    if token.startswith("<") or token.isupper():
                        break
                    head.append(token)
                shapes.add(tuple(head))
                flags.update(re.findall(r"--[a-z][a-z0-9-]*", syntax))
            for key, child in value.items():
                if key == "global_options" and isinstance(child, list):
                    for option in child:
                        if isinstance(option, dict) and isinstance(option.get("name"), str):
                            flags.add(option["name"])
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(cli_contract)
    flags.add("--json")
    if not shapes:
        raise ValidationError("cli-contract.json: no bwrk command syntax entries found")
    return shapes, flags


def _validate_command(command: str, label: str, shapes: set[tuple[str, ...]], flags: set[str]) -> None:
    command_without_placeholders = re.sub(r"<[a-z][a-z0-9_]*>", "", command)
    if any(character in command_without_placeholders for character in SHELL_METACHARACTERS):
        raise ValidationError(f"{label}: command contains shell metacharacters")
    try:
        tokens = shlex.split(command)
    except ValueError as exc:
        raise ValidationError(f"{label}: command is not a safe argv shape: {exc}") from exc
    if not tokens or tokens[0] != "bwrk":
        raise ValidationError(f"{label}: command must start with bwrk")
    if tokens[-1] != "--json":
        raise ValidationError(f"{label}: command must end with --json")

    head: list[str] = ["bwrk"]
    for token in tokens[1:]:
        if token.startswith("--"):
            flag = token.split("=", 1)[0]
            if flag not in flags:
                raise ValidationError(f"{label}: flag {flag} is not in cli-contract.json")
            continue
        if token.startswith("-"):
            raise ValidationError(f"{label}: short or malformed option {token!r}")
        if PLACEHOLDER_PATTERN.fullmatch(token):
            continue
        if not re.fullmatch(r"[a-z][a-z0-9-]*", token):
            raise ValidationError(f"{label}: non-literal command token {token!r}")
        head.append(token)
    if tuple(head) not in shapes:
        rendered = " ".join(head)
        raise ValidationError(f"{label}: command shape {rendered!r} is not in cli-contract.json")


def _validate_asset(
    path: Path,
    root: Path,
    metadata: dict[str, Any],
    known_refs: set[str],
    cli_shapes: set[tuple[str, ...]],
    cli_flags: set[str],
) -> tuple[str, str, int]:
    value = _load_json(path, root)
    label = _label(path, root)
    _strict_keys(value, ASSET_KEYS, label)
    if value["schema_version"] != ASSET_SCHEMA:
        raise ValidationError(f"{label}: schema_version must be {ASSET_SCHEMA}")
    if not SEMVER_PATTERN.fullmatch(_string(value["asset_version"], f"{label}.asset_version")):
        raise ValidationError(f"{label}: asset_version must be semantic version text")
    reference = _string(value["ref"], f"{label}.ref")
    if not REF_PATTERN.fullmatch(reference):
        raise ValidationError(f"{label}: invalid workflow ref {reference!r}")
    kind = _string(value["kind"], f"{label}.kind")
    if metadata["ref"] != reference or metadata["kind"] != kind:
        raise ValidationError(f"{label}: package identity does not match asset")
    _string(value["title"], f"{label}.title")
    if value["state_transition_owner"] != AUTHORITY:
        raise ValidationError(f"{label}: state_transition_owner must be {AUTHORITY}")

    refs = value["refs"]
    if not isinstance(refs, dict) or not refs:
        raise ValidationError(f"{label}.refs: expected a non-empty object")
    for name, ref in refs.items():
        if not re.fullmatch(r"[a-z][a-z0-9_]*", name) or not isinstance(ref, str):
            raise ValidationError(f"{label}.refs: malformed named reference")
        if ref not in known_refs:
            raise ValidationError(f"{label}: unknown workflow ref {ref}")

    commands = _string_array(value["allowed_commands"], f"{label}.allowed_commands")
    for index, command in enumerate(commands):
        _validate_command(command, f"{label}.allowed_commands[{index}]", cli_shapes, cli_flags)

    inputs = value["typed_inputs"]
    if not isinstance(inputs, list) or not inputs:
        raise ValidationError(f"{label}.typed_inputs: expected a non-empty array")
    input_names: list[str] = []
    for index, item in enumerate(inputs):
        input_label = f"{label}.typed_inputs[{index}]"
        if not isinstance(item, dict):
            raise ValidationError(f"{input_label}: expected an object")
        unknown = sorted(set(item) - INPUT_KEYS)
        if unknown:
            raise ValidationError(f"{input_label}: unknown field(s): {', '.join(unknown)}")
        for field in ("name", "type", "source", "validation"):
            _string(item.get(field), f"{input_label}.{field}")
        if not isinstance(item.get("required"), bool):
            raise ValidationError(f"{input_label}.required: expected boolean")
        input_names.append(item["name"])
    _unique(input_names, f"{label}.typed_inputs.name")

    criteria = value["finish_criteria"]
    if not isinstance(criteria, list) or not criteria:
        raise ValidationError(f"{label}.finish_criteria: expected a non-empty array")
    criterion_ids: list[str] = []
    required_count = 0
    for index, item in enumerate(criteria):
        criterion_label = f"{label}.finish_criteria[{index}]"
        if not isinstance(item, dict):
            raise ValidationError(f"{criterion_label}: expected an object")
        _strict_keys(item, CRITERION_KEYS, criterion_label)
        criterion_ids.append(_string(item["id"], f"{criterion_label}.id"))
        _string(item["type"], f"{criterion_label}.type")
        if not isinstance(item["required"], bool):
            raise ValidationError(f"{criterion_label}.required: expected boolean")
        required_count += int(item["required"])
    _unique(criterion_ids, f"{label}.finish_criteria.id")
    if required_count == 0:
        raise ValidationError(f"{label}.finish_criteria: at least one criterion must be required")

    next_refs = _string_array(value["next_refs"], f"{label}.next_refs")
    _unique(next_refs, f"{label}.next_refs")
    for ref in next_refs:
        if ref not in known_refs:
            raise ValidationError(f"{label}: unknown next ref {ref}")
    return reference, kind, len(commands)


def validate(root: Path) -> ValidationReport:
    """Validate one workflow package directory and its CLI parity contract."""

    root = root.resolve()
    package_path = root / "package.json"
    manifest_path = root / "manifest.json"
    cli_path = root.parent / "cli-contract.json"
    package = _load_json(package_path, root)
    _strict_keys(package, PACKAGE_KEYS, "package.json")
    if package["schema_version"] != PACKAGE_SCHEMA:
        raise ValidationError(f"package.json: schema_version must be {PACKAGE_SCHEMA}")
    package_id = _string(package["package_id"], "package.json.package_id")
    if package_id != PACKAGE_ID:
        raise ValidationError(f"package.json.package_id: must be {PACKAGE_ID}")
    package_version = _string(package["package_version"], "package.json.package_version")
    if not SEMVER_PATTERN.fullmatch(package_version):
        raise ValidationError("package.json.package_version: expected semantic version text")
    asset_identity = _string(package["asset_identity"], "package.json.asset_identity")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", asset_identity):
        raise ValidationError("package.json.asset_identity: expected sha256:<64 lowercase hex>")
    if package["state_authority"] != AUTHORITY:
        raise ValidationError(f"package.json.state_authority must be {AUTHORITY}")
    if package["execution_model"] != EXECUTION_MODEL:
        raise ValidationError(f"package.json.execution_model must be {EXECUTION_MODEL}")

    validation = package["validation"]
    expected_validation = {
        "refs_must_be_unique": True,
        "commands_must_be_allowlisted": True,
        "inputs_must_be_typed": True,
        "finish_criteria_must_be_explicit": True,
        "unknown_fields": "reject",
    }
    if validation != expected_validation:
        raise ValidationError("package.json.validation: must declare the strict package policy")

    package_assets = package["assets"]
    if not isinstance(package_assets, list) or not package_assets:
        raise ValidationError("package.json.assets: expected a non-empty array")
    refs: list[str] = []
    paths: list[str] = []
    kinds: list[str] = []
    for index, metadata in enumerate(package_assets):
        label = f"package.json.assets[{index}]"
        if not isinstance(metadata, dict):
            raise ValidationError(f"{label}: expected an object")
        _strict_keys(metadata, PACKAGE_ASSET_KEYS, label)
        ref = _string(metadata["ref"], f"{label}.ref")
        path_value = _string(metadata["path"], f"{label}.path")
        kind = _string(metadata["kind"], f"{label}.kind")
        if not REF_PATTERN.fullmatch(ref):
            raise ValidationError(f"{label}.ref: invalid workflow ref {ref!r}")
        if ref not in CORE_REFS:
            raise ValidationError(f"{label}.ref: unknown core workflow ref {ref}")
        if kind not in CORE_KINDS:
            raise ValidationError(f"{label}.kind: unknown core workflow kind {kind!r}")
        relative = Path(path_value)
        if relative.is_absolute() or relative.parent != Path(".") or relative.suffix != ".json":
            raise ValidationError(f"{label}.path: asset path must be a single local JSON filename")
        if relative.name in {"package.json", "manifest.json"}:
            raise ValidationError(f"{label}.path: package metadata cannot be an asset")
        asset_path = root / relative
        if not asset_path.is_file():
            raise ValidationError(f"{label}: missing asset {path_value}")
        refs.append(ref)
        paths.append(path_value)
        kinds.append(kind)
    _unique(refs, "package.json.assets.ref")
    _unique(paths, "package.json.assets.path")
    _unique(kinds, "package.json.assets.kind")
    if set(refs) != CORE_REFS:
        raise ValidationError("package.json.assets.ref: core workflow set is incomplete or overfull")
    known_refs = set(refs)

    manifest = _load_json(manifest_path, root)
    _strict_keys(manifest, MANIFEST_KEYS, "manifest.json")
    if manifest["schema_version"] != ASSET_SCHEMA:
        raise ValidationError(f"manifest.json: schema_version must be {ASSET_SCHEMA}")
    _string(manifest["fixture_version"], "manifest.json.fixture_version")
    _string(manifest["registry_version"], "manifest.json.registry_version")
    if manifest["trusted"] is not True:
        raise ValidationError("manifest.json: trusted must be true")
    if manifest["workflow_refs"] != refs:
        raise ValidationError("manifest.json.workflow_refs: must exactly match package asset refs")
    policy = manifest["asset_policy"]
    if not isinstance(policy, dict):
        raise ValidationError("manifest.json.asset_policy: expected object")
    _strict_keys(policy, MANIFEST_POLICY_KEYS, "manifest.json.asset_policy")
    expected_policy = {
        "checked_in": True,
        "allowed_commands_only": True,
        "free_form_commands_are_data": True,
        "unknown_fields": "reject",
    }
    if policy != expected_policy:
        raise ValidationError("manifest.json.asset_policy: must declare the strict package policy")

    cli_contract = _load_json(cli_path, root)
    cli_shapes, cli_flags = _contract_command_shapes(cli_contract)
    total_commands = 0
    for metadata in package_assets:
        path = root / metadata["path"]
        _, _, command_count = _validate_asset(
            path, root, metadata, known_refs, cli_shapes, cli_flags
        )
        total_commands += command_count

    root_json = {path.relative_to(root).as_posix() for path in root.rglob("*.json")}
    expected_json = {"package.json", "manifest.json", *paths}
    unknown_json = sorted(root_json - expected_json)
    if unknown_json:
        raise ValidationError(
            "workflows/: unlisted JSON asset(s): " + ", ".join(unknown_json)
        )
    computed_identity = _sha256_identity(package, root)
    if asset_identity != computed_identity:
        raise ValidationError(
            "package.json.asset_identity: digest mismatch "
            f"(declared {asset_identity}, computed {computed_identity})"
        )
    return ValidationReport(
        package_id=package_id,
        package_version=package_version,
        asset_identity=asset_identity,
        asset_count=len(package_assets),
        command_count=total_commands,
        referenced_cli_shapes=len(cli_shapes),
    )


class ValidatorTests(unittest.TestCase):
    """Focused mutation tests for the executable packaging fixture."""

    source_root = Path(__file__).resolve().parent
    spec_root = source_root.parent

    def _copy_fixture(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        import shutil

        temporary = tempfile.TemporaryDirectory(prefix="boreal-workflow-validator-")
        root = Path(temporary.name) / "spec" / "workflows"
        root.parent.mkdir(parents=True)
        shutil.copytree(self.source_root, root)
        shutil.copy2(self.spec_root / "cli-contract.json", root.parent / "cli-contract.json")
        return temporary, root

    def test_checked_in_package_passes(self) -> None:
        report = validate(self.source_root)
        self.assertEqual(report.asset_count, 10)
        self.assertGreaterEqual(report.command_count, 20)

    def test_unknown_package_field_is_rejected(self) -> None:
        temporary, root = self._copy_fixture()
        self.addCleanup(temporary.cleanup)
        package_path = root / "package.json"
        package = json.loads(package_path.read_text())
        package["surprise"] = True
        package_path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValidationError, "unknown field"):
            validate(root)

    def test_unknown_asset_field_is_rejected(self) -> None:
        temporary, root = self._copy_fixture()
        self.addCleanup(temporary.cleanup)
        asset_path = root / "route.json"
        asset = json.loads(asset_path.read_text())
        asset["untrusted_instruction"] = "run this"
        asset_path.write_text(json.dumps(asset))
        with self.assertRaisesRegex(ValidationError, "unknown field"):
            validate(root)

    def test_unknown_ref_and_unsafe_command_are_rejected(self) -> None:
        temporary, root = self._copy_fixture()
        self.addCleanup(temporary.cleanup)
        asset_path = root / "route.json"
        asset = json.loads(asset_path.read_text())
        asset["next_refs"].append("boreal.workflow.missing.v1")
        asset_path.write_text(json.dumps(asset))
        with self.assertRaisesRegex(ValidationError, "unknown next ref"):
            validate(root)

        temporary, root = self._copy_fixture()
        self.addCleanup(temporary.cleanup)
        asset_path = root / "route.json"
        asset = json.loads(asset_path.read_text())
        asset["allowed_commands"][0] = "bwrk next --json; rm -rf /"
        asset_path.write_text(json.dumps(asset))
        with self.assertRaisesRegex(ValidationError, "shell metacharacters"):
            validate(root)

    def test_authority_and_typed_inputs_are_fail_closed(self) -> None:
        temporary, root = self._copy_fixture()
        self.addCleanup(temporary.cleanup)
        package_path = root / "package.json"
        package = json.loads(package_path.read_text())
        package["state_authority"] = "task-text"
        package_path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValidationError, "state_authority"):
            validate(root)

        temporary, root = self._copy_fixture()
        self.addCleanup(temporary.cleanup)
        asset_path = root / "claim.json"
        asset = json.loads(asset_path.read_text())
        asset["typed_inputs"][0]["required"] = "yes"
        asset_path.write_text(json.dumps(asset))
        with self.assertRaisesRegex(ValidationError, "expected boolean"):
            validate(root)

    def test_asset_transition_owner_cannot_be_redefined(self) -> None:
        temporary, root = self._copy_fixture()
        self.addCleanup(temporary.cleanup)
        asset_path = root / "route.json"
        asset = json.loads(asset_path.read_text())
        asset["state_transition_owner"] = "workflow-json"
        asset_path.write_text(json.dumps(asset))
        with self.assertRaisesRegex(ValidationError, "state_transition_owner"):
            validate(root)


def _self_test() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ValidatorTests)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    return 0 if result.wasSuccessful() else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return _self_test()
    try:
        report = validate(args.root)
    except ValidationError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(
        f"PASS: {report.package_id} v{report.package_version}; "
        f"{report.asset_count} assets, {report.command_count} command shapes; "
        f"asset_identity={report.asset_identity}; "
        f"{report.referenced_cli_shapes} CLI shapes available"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
