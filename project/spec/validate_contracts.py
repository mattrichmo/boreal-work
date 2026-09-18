#!/usr/bin/env python3
"""Small dependency-free structural validator for the P0-03 fixture tree."""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROTOCOL = ROOT / "protocol"
GUIDANCE = ROOT / "guidance"


def fail(message: str) -> None:
    raise ValueError(message)


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"{path.relative_to(ROOT)}: invalid JSON: {exc}")
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)}: root must be an object")
    return value


def require(value: dict, fields: tuple[str, ...], path: Path) -> None:
    missing = [field for field in fields if field not in value]
    if missing:
        fail(f"{path.relative_to(ROOT)}: missing {', '.join(missing)}")


def validate_envelopes() -> int:
    required = (
        "api_version",
        "schema_version",
        "operation_id",
        "revision",
        "as_of",
        "next_status_change_at",
        "transport",
        "outcome",
        "data",
        "detail_ref",
        "error",
    )
    registry = load_json(GUIDANCE / "directive-registry.json")
    registry_ids = {entry.get("registry_id") for entry in registry.get("entries", [])}
    count = 0
    for path in sorted(PROTOCOL.glob("envelope-*.json")):
        value = load_json(path)
        require(value, required, path)
        if value["api_version"] != "2":
            fail(f"{path.name}: api_version must be 2")
        if not str(value["operation_id"]).startswith("op_"):
            fail(f"{path.name}: operation_id must start with op_")
        if value["transport"] not in {"ok", "error"}:
            fail(f"{path.name}: invalid transport")
        if value["outcome"] not in {"changed", "unchanged", "rejected", "conflict", "busy", "failed", "unknown"}:
            fail(f"{path.name}: invalid outcome")
        if value["outcome"] in {"changed", "unchanged"} and value["error"] is not None:
            fail(f"{path.name}: successful outcome cannot carry an error")
        if value["outcome"] not in {"changed", "unchanged"} and value["error"] is None:
            fail(f"{path.name}: rejected/failed outcome needs an error")
        def check_directives(node: object) -> None:
            if isinstance(node, dict):
                if "directive_id" in node and node["directive_id"] not in registry_ids:
                    fail(f"{path.name}: protocol directive is not in trusted registry: {node['directive_id']}")
                for child in node.values():
                    check_directives(child)
            elif isinstance(node, list):
                for child in node:
                    check_directives(child)
        check_directives(value)
        count += 1
    if count < 8:
        fail("protocol: expected success, empty, conflict, busy, stale, invalid, unavailable, and unknown fixtures")
    return count


def validate_guidance() -> int:
    registry = load_json(GUIDANCE / "directive-registry.json")
    entries = registry.get("entries", [])
    registry_ids = {entry.get("registry_id") for entry in entries}
    if not entries or any(not entry.get("registry_id") for entry in entries):
        fail("guidance/directive-registry.json: registry entries need registry_id")
    count = 0
    for path in sorted(GUIDANCE.glob("*.json")):
        value = load_json(path)
        if path.name in {"directive-registry.json", "gap-registry.json", "safe-argv.json"}:
            continue
        require(value, ("schema_version", "fixture_id", "status", "requirements", "next_action", "provenance"), path)
        action = value["next_action"]
        if action is not None:
            require(action, ("directive_id", "safe_argv", "cwd", "runner", "shell"), path)
            if action["directive_id"] not in registry_ids:
                fail(f"{path.name}: directive is not in trusted registry")
            if action["shell"] is not False:
                fail(f"{path.name}: safe action must set shell=false")
            if not isinstance(action["safe_argv"], list) or "--json" not in action["safe_argv"]:
                fail(f"{path.name}: safe action needs argv list containing --json")
        count += 1
    if count < 8:
        fail("guidance: expected no-goal, idle, ready, queued, blocked, expiry, active, and gate fixtures")
    return count


def validate_workflows() -> int:
    package = load_json(ROOT / "workflows" / "package.json")
    assets = package.get("assets", [])
    refs = {asset.get("ref") for asset in assets}
    if len(refs) != len(assets):
        fail("workflows/package.json: duplicate asset refs")
    for asset in assets:
        path = ROOT / "workflows" / asset["path"]
        if not path.exists():
            fail(f"workflows/package.json: missing asset {asset['path']}")
        value = load_json(path)
        require(value, ("schema_version", "asset_version", "ref", "kind", "allowed_commands", "typed_inputs", "finish_criteria"), path)
        if value["ref"] != asset["ref"] or value["kind"] != asset["kind"]:
            fail(f"{path.name}: package identity does not match asset")
        if not value["allowed_commands"] or not value["typed_inputs"] or not value["finish_criteria"]:
            fail(f"{path.name}: allowed commands, typed inputs, and finish criteria are required")
        for ref in value.get("refs", {}).values():
            if ref not in refs:
                fail(f"{path.name}: unknown workflow ref {ref}")
        for ref in value.get("next_refs", []):
            if ref not in refs:
                fail(f"{path.name}: unknown next ref {ref}")
    return len(assets)


def validate_cross_fixture_semantics() -> None:
    manifest = load_json(ROOT / "manifest.json")
    expected_revision = manifest["fixture_version"]
    for path in sorted(ROOT.rglob("*.json")):
        value = load_json(path)
        if "fixture_version" in value and value["fixture_version"] != expected_revision:
            fail(f"{path.relative_to(ROOT)}: fixture revision differs from manifest")

    protocol = load_json(PROTOCOL / "protocol-manifest.json")
    cli = load_json(ROOT / "cli-contract.json")
    clock = load_json(ROOT / "clock-and-attempt.json")
    declared_flags = set(re.findall(r"--[a-z][a-z0-9-]+", (ROOT / "cli-contract.json").read_text()))
    for path in sorted((GUIDANCE, PROTOCOL)):
        for fixture in path.glob("*.json"):
            value = load_json(fixture)
            encoded = json.dumps(value)
            for flag in re.findall(r"--[a-z][a-z0-9-]+", encoded):
                if flag not in declared_flags:
                    fail(f"{fixture.relative_to(ROOT)}: safe action uses undeclared CLI flag {flag}")
    if protocol["identity_rules"]["default_hard_time_limit"] != "2h from claimed_at":
        fail("protocol: default hard time limit must be 2h from claimed_at")
    if protocol["identity_rules"]["default_lease_ttl"] != "30m renewable ownership lease fixture":
        fail("protocol: default lease TTL must be the frozen 30m fixture")
    if cli["attempt_time_options"]["--lease-ttl"]["default"] != "30m":
        fail("cli-contract: --lease-ttl default must match protocol")
    if cli["attempt_time_options"]["--time-limit"]["default"] != "2h":
        fail("cli-contract: --time-limit default must be 2h")
    if clock["clock"]["default_lease_ttl"] != "30m" or clock["clock"]["default_time_limit"] != "2h":
        fail("clock-and-attempt: defaults do not match the frozen policy")

    transition = (ROOT / "transition-table.md").read_text()
    for token in ("queued", "blocked", "claimed", "in_progress", "complete", "closed", "expired_review", "hard_budget_elapsed", "lease_elapsed"):
        if f"`{token}`" not in transition:
            fail(f"transition-table.md: missing required vocabulary {token}")
    errors_value = load_json(PROTOCOL / "error-registry.json")
    error_codes = {entry["code"] for entry in errors_value.get("entries", errors_value.get("errors", []))}
    referenced = set(re.findall(r"`([a-z][a-z0-9_.-]+)`", transition))
    required_errors = {"dependency_cycle", "review_required", "stale_fence", "close_intent_missing", "role_denied", "operation_unknown"}
    if not required_errors.issubset(error_codes):
        fail(f"error-registry.json: missing required error codes {sorted(required_errors - error_codes)}")
    if "stale_fence" not in referenced or "review_required" not in referenced:
        fail("transition-table.md: required errors are not referenced by illegal vectors")


def validate_schema() -> None:
    path = ROOT / "schema-v2.sql"
    if not path.exists():
        fail("schema-v2.sql is missing")
    sql = path.read_text()
    required_tokens = ("PRAGMA foreign_keys", "CREATE TABLE", "audit", "revision", "attempt", "receipt", "source")
    for token in required_tokens:
        if token.lower() not in sql.lower():
            fail(f"schema-v2.sql: missing required token {token}")
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(sql)
        if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            fail("schema-v2.sql: foreign key enforcement is not enabled")
        connection.execute("INSERT INTO project VALUES ('p1', 2, 'boreal.work-status/2', 0, 't', 't')")
        connection.execute("INSERT INTO project VALUES ('p2', 2, 'boreal.work-status/2', 0, 't', 't')")
        connection.execute("INSERT INTO actor VALUES ('agent', 'agent', 'cred-agent', 'Agent', 't')")
        connection.execute("INSERT INTO actor VALUES ('reviewer', 'reviewer', 'cred-reviewer', 'Reviewer', 't')")
        connection.execute("INSERT INTO acceptance_profile VALUES ('focused', 1, 'sha256:policy', '{}', 't')")
        connection.execute("INSERT INTO work_item (work_id, project_id, kind, parent_id, lifecycle, dispatch_policy, acceptance_profile_id, acceptance_profile_version, title, created_at, updated_at) VALUES ('w1', 'p1', 'task', NULL, 'open', 'automatic', 'focused', 1, 'one', 't', 't')")
        connection.execute("INSERT INTO work_item (work_id, project_id, kind, parent_id, lifecycle, dispatch_policy, acceptance_profile_id, acceptance_profile_version, title, created_at, updated_at) VALUES ('w2', 'p2', 'task', NULL, 'open', 'automatic', 'focused', 1, 'two', 't', 't')")
        def expect_constraint(statement: str, parameters: tuple = ()) -> None:
            try:
                connection.execute(statement, parameters)
            except sqlite3.IntegrityError:
                return
            fail(f"schema-v2.sql: expected constraint rejection for {statement}")
        expect_constraint("INSERT INTO work_item (work_id, project_id, kind, parent_id, lifecycle, dispatch_policy, acceptance_profile_id, acceptance_profile_version, title, created_at, updated_at) VALUES ('cross-parent', 'p1', 'task', 'w2', 'open', 'automatic', 'focused', 1, 'bad', 't', 't')")
        expect_constraint("INSERT INTO dependency (project_id, prerequisite_id, dependent_id, created_at) VALUES ('p1', 'w1', 'w2', 't')")
        connection.execute("INSERT INTO gate (gate_id, work_id, profile_id, profile_version, kind, required, subject_ref, updated_at) VALUES ('g1', 'w1', 'focused', 1, 'verification', 1, '', 't')")
        expect_constraint("INSERT INTO gate (gate_id, work_id, profile_id, profile_version, kind, required, subject_ref, updated_at) VALUES ('g2', 'w1', 'focused', 1, 'verification', 1, '', 't')")
        connection.execute("INSERT INTO session VALUES ('s1', 'agent', 'harness', 'active', 't', NULL)")
        connection.execute("INSERT INTO attempt (attempt_id, work_id, actor_id, harness_id, session_id, fence, current, state, claimed_at, accepted_at, lease_deadline, max_attempt_deadline, config_identity, binary_identity, protocol_version, schema_version) VALUES ('a1', 'w1', 'agent', 'harness', 's1', 1, 1, 'running', 't', 't', 't2', 't3', 'cfg', 'bin', '2', 2)")
        expect_constraint("INSERT INTO review (review_id, work_id, attempt_id, fence, reviewer_actor_id, decision, reason, policy_digest, created_at) VALUES ('r1', 'w1', 'a1', 1, 'agent', 'accepted', 'self', 'policy', 't')")
    except sqlite3.DatabaseError as exc:
        fail(f"schema-v2.sql: SQLite rejected fixture: {exc}")
    finally:
        connection.close()


def validate_transition_cases() -> tuple[int, int, int]:
    transition = (ROOT / "transition-table.md").read_text()
    legal = len(re.findall(r"\| T\d+ \|", transition))
    illegal = len(re.findall(r"\| I\d+ \|", transition))
    if legal < 18 or illegal < 15:
        fail(f"transition-table.md: expected at least 18 legal and 15 illegal vectors, got {legal}/{illegal}")
    clock = load_json(ROOT / "clock-and-attempt.json")
    dependency = load_json(ROOT / "dependency.json")
    clock_ids = {case.get("id") for case in clock.get("cases", [])}
    dependency_ids = {case.get("id") for case in dependency.get("cases", [])}
    if not {f"C{i:02d}" for i in range(1, 13)}.issubset(clock_ids):
        fail("clock-and-attempt.json: C01-C12 virtual-clock cases are required")
    if not {f"D{i:02d}" for i in range(1, 8)}.issubset(dependency_ids):
        fail("dependency.json: D01-D07 dependency cases are required")
    profiles = load_json(ROOT / "acceptance-profiles.json").get("profiles", [])
    if {profile.get("id") for profile in profiles} != {"focused", "reviewed", "operator"}:
        fail("acceptance-profiles.json: focused/reviewed/operator profiles are required")
    return legal, illegal, len(clock_ids) + len(dependency_ids)


def validate_conformance_matrix() -> int:
    matrix = load_json(ROOT / "conformance.json")
    if matrix.get("schema_version") != "boreal.conformance.v1":
        fail("conformance.json: unsupported schema_version")
    transition = (ROOT / "transition-table.md").read_text()
    expected = set(re.findall(r"\| ((?:T|I)\d+) \|", transition))
    clock = load_json(ROOT / "clock-and-attempt.json")
    dependency = load_json(ROOT / "dependency.json")
    expected.update(case.get("id") for case in clock.get("cases", []))
    expected.update(case.get("id") for case in dependency.get("cases", []))
    entries = matrix.get("entries", [])
    identifiers = [entry.get("id") for entry in entries]
    if any(not entry.get("id") or not entry.get("selector") for entry in entries):
        fail("conformance.json: every entry needs an id and selector")
    if len(set(identifiers)) != len(identifiers):
        fail("conformance.json: fixture IDs must be unique")
    observed = set(identifiers)
    if observed != expected:
        fail(
            "conformance.json: fixture IDs differ from source fixtures; "
            f"missing={sorted(expected - observed)}, extra={sorted(observed - expected)}"
        )
    return len(entries)


def main() -> int:
    try:
        manifest = load_json(ROOT / "manifest.json")
        require(manifest, ("fixture_version", "api_version", "schema_version", "protocol_version", "required_paths"), ROOT / "manifest.json")
        for relative in manifest["required_paths"]:
            if not (ROOT / relative).exists():
                fail(f"manifest required path missing: {relative}")
        for path in sorted(ROOT.rglob("*.json")):
            load_json(path)
        envelope_count = validate_envelopes()
        guidance_count = validate_guidance()
        workflow_count = validate_workflows()
        validate_cross_fixture_semantics()
        legal_count, illegal_count, scenario_count = validate_transition_cases()
        conformance_count = validate_conformance_matrix()
        validate_schema()
    except ValueError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(f"PASS: {envelope_count} protocol envelopes, {guidance_count} guidance fixtures, {workflow_count} workflow assets, {legal_count} legal/{illegal_count} illegal transition vectors, {scenario_count} clock/dependency cases, {conformance_count} conformance mappings, SQLite schema parsed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
