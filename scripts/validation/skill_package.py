#!/usr/bin/env python3
"""Dependency-free structural validation for the Boreal v2 skill package."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


KEY_VALUE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$")
QUOTED_VALUE = re.compile(r'^\s*[A-Za-z_][A-Za-z0-9_]*:\s*["\'](.*)["\']\s*$')


def fail(message: str) -> None:
    raise ValueError(message)


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"{path}: invalid JSON: {exc}")
    if not isinstance(value, dict):
        fail(f"{path}: expected a JSON object")
    return value


def yaml_scalar(value: str) -> str:
    value = value.strip()
    if value in {"true", "false"}:
        return value
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def read_simple_yaml(path: Path) -> tuple[dict[str, str], list[str]]:
    fields: dict[str, str] = {}
    workflows: list[str] = []
    in_workflows = False
    for line_number, raw_line in enumerate(path.read_text().splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line == "workflows:":
            in_workflows = True
            continue
        if in_workflows and line.startswith("-"):
            workflows.append(yaml_scalar(line[1:].strip()))
            continue
        match = KEY_VALUE.match(line)
        if not match:
            fail(f"{path}:{line_number}: unsupported YAML shape")
        key, value = match.groups()
        fields[key] = yaml_scalar(value)
        in_workflows = False
    return fields, workflows


def read_frontmatter(path: Path) -> dict[str, str]:
    lines = path.read_text().splitlines()
    if not lines or lines[0].strip() != "---":
        fail(f"{path}: missing frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError:
        fail(f"{path}: unterminated frontmatter")
    fields: dict[str, str] = {}
    for line_number, line in enumerate(lines[1:end], 2):
        match = KEY_VALUE.match(line)
        if not match:
            fail(f"{path}:{line_number}: invalid frontmatter")
        key, value = match.groups()
        fields[key] = yaml_scalar(value)
    return fields


def read_openai_metadata(path: Path) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in path.read_text().splitlines():
        match = QUOTED_VALUE.match(line)
        if match:
            key = line.split(":", 1)[0].strip()
            fields[key] = match.group(1)
    return fields


def validate(root: Path) -> None:
    manifest_path = root / "skills" / "manifest.json"
    manifest = load_json(manifest_path)
    if manifest.get("schema_version") != "boreal.skill_package.v2":
        fail(f"{manifest_path}: wrong schema_version")
    if manifest.get("package_id") != "boreal.core-skills":
        fail(f"{manifest_path}: wrong package_id")
    if manifest.get("state_authority") != "boreal.application.v2":
        fail(f"{manifest_path}: wrong state_authority")
    if set(manifest.get("harnesses", [])) != {"codex", "claude"}:
        fail(f"{manifest_path}: harnesses must be exactly codex and claude")

    workflow_package = load_json(root / "project/spec/workflows/package.json")
    workflow_refs = {asset["ref"] for asset in workflow_package["assets"]}
    skills = manifest.get("skills")
    if not isinstance(skills, list) or not skills:
        fail(f"{manifest_path}: skills must be a non-empty list")
    names = [skill.get("name") for skill in skills]
    if len(set(names)) != len(names):
        fail(f"{manifest_path}: duplicate skill names")

    package_dirs = {
        path.name for path in (root / "skills").iterdir()
        if path.is_dir() and not path.name.startswith(".")
    }
    declared_dirs = {skill.get("path") for skill in skills}
    if package_dirs != declared_dirs:
        fail(f"{manifest_path}: declared skill directories do not match package directories")

    for skill in skills:
        name = skill.get("name")
        path_value = skill.get("path")
        if not isinstance(name, str) or not isinstance(path_value, str):
            fail(f"{manifest_path}: every skill needs name and path")
        skill_dir = root / "skills" / path_value
        if skill_dir.parent != root / "skills":
            fail(f"{manifest_path}: skill path escapes skills directory: {path_value}")
        skill_md = skill_dir / "SKILL.md"
        boreal_yaml = skill_dir / "boreal.yaml"
        openai_yaml = skill_dir / "agents/openai.yaml"
        for required in (skill_md, boreal_yaml, openai_yaml):
            if not required.is_file():
                fail(f"{name}: missing {required.relative_to(root)}")

        frontmatter = read_frontmatter(skill_md)
        if frontmatter.get("name") != name or not frontmatter.get("description"):
            fail(f"{skill_md}: name/description do not identify the package skill")

        fields, workflows = read_simple_yaml(boreal_yaml)
        expected_fields = {
            "schema_version": "boreal.skill.v2",
            "system": "boreal",
            "skill": name,
            "workflow_package": "boreal.core-workflows",
            "workflow_package_version": workflow_package["package_version"],
            "state_authority": "boreal.application.v2",
            "harness_neutral": "true",
        }
        for key, expected in expected_fields.items():
            if fields.get(key) != expected:
                fail(f"{boreal_yaml}: {key} must be {expected!r}")
        declared_workflows = skill.get("workflows")
        if workflows != declared_workflows:
            fail(f"{name}: boreal.yaml and manifest workflow refs differ")
        if not workflows or any(ref not in workflow_refs for ref in workflows):
            fail(f"{name}: workflow ref is not in the trusted workflow package")

        metadata = read_openai_metadata(openai_yaml)
        for key in ("display_name", "short_description", "default_prompt"):
            if not metadata.get(key):
                fail(f"{openai_yaml}: missing quoted {key}")
        if not (25 <= len(metadata["short_description"]) <= 64):
            fail(f"{openai_yaml}: short_description must be 25-64 characters")
        if f"${name}" not in metadata["default_prompt"]:
            fail(f"{openai_yaml}: default_prompt must reference ${name}")

    print(f"PASS: {manifest['package_id']} v{manifest['package_version']}; {len(skills)} skills; Codex + Claude")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    try:
        validate(args.root.resolve())
    except (OSError, ValueError, KeyError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
