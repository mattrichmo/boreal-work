#!/usr/bin/env python3
"""Run Boreal's project-level creation and lifecycle acceptance suite.

The suite deliberately drives the public CLI against a fresh database under
the supplied project root.  It never touches test-project/.boreal/boreal.sqlite
unless the caller explicitly points --run-root there.  Every command is
recorded as structured JSONL, including stdout/stderr, envelope, exit code,
duration, and the scenario that issued it.

Examples:

    python3 scripts/validation/creation/run_suite.py \
        --bin target/debug/bwrk --chain-length 100

    python3 scripts/validation/creation/run_suite.py \
        --bin test-project/.boreal/bin/bwrk-v2 --chain-length 32
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[3]
PROJECT_ROOT = ROOT / "test-project"
MATRIX_PATH = Path(__file__).with_name("scenario_matrix.json")


class ScenarioSkipped(Exception):
    pass


class CheckFailure(AssertionError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_text(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


class Suite:
    def __init__(self, binary: Path, project_root: Path, run_root: Path, chain_length: int):
        self.binary = binary.resolve()
        self.project_root = project_root.resolve()
        self.run_root = run_root.resolve()
        self.state_root = self.run_root / ".boreal"
        self.database = self.state_root / "boreal.sqlite"
        self.gates = self.state_root / "gates"
        self.chain_length = chain_length
        self.project = "creation-suite"
        self.started_at = now_iso()
        self.operation_number = 0
        self.command_number = 0
        self.current_scenario = "bootstrap"
        self.records: list[dict[str, Any]] = []
        self.command_log = self.run_root / "commands.jsonl"
        self.route_registry: dict[str, Any] = {}
        self.scenario_matrix = json.loads(MATRIX_PATH.read_text(encoding="utf-8"))
        self.ids: dict[str, str] = {}
        self._prepare()

    def _prepare(self) -> None:
        self.run_root.mkdir(parents=True, exist_ok=True)
        self.state_root.mkdir(parents=True, exist_ok=True)
        self.gates.mkdir(parents=True, exist_ok=True)
        self.command_log.write_text("", encoding="utf-8")

    def operation(self, label: str) -> str:
        self.operation_number += 1
        safe = "".join(character if character.isalnum() else "-" for character in label)
        return f"op_creation_{self.operation_number:04d}_{safe}"

    def _record_command(self, record: dict[str, Any]) -> None:
        with self.command_log.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, sort_keys=True) + "\n")

    def call(
        self,
        args: list[str],
        *,
        label: str,
        operation: str | None = None,
        include_db: bool = True,
        include_json: bool = True,
        timeout: float = 45.0,
        socket: Path | None = None,
    ) -> dict[str, Any]:
        argv = [str(self.binary), *args]
        if include_db and "--db" not in argv:
            argv.extend(["--db", str(self.database)])
        if socket is not None and "--socket" not in argv:
            argv.extend(["--socket", str(socket)])
        if operation is not None and "--operation-id" not in argv:
            argv.extend(["--operation-id", operation])
        if include_json and "--json" not in argv:
            argv.append("--json")

        started = time.perf_counter()
        try:
            completed = subprocess.run(
                argv,
                cwd=self.run_root,
                text=True,
                capture_output=True,
                timeout=timeout,
                check=False,
            )
            timed_out = False
        except subprocess.TimeoutExpired as error:
            completed = subprocess.CompletedProcess(argv, 124, error.stdout or "", error.stderr or "")
            timed_out = True
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        stdout = completed.stdout or ""
        stderr = completed.stderr or ""
        envelope: dict[str, Any] | None = None
        parse_error: str | None = None
        lines = [line for line in stdout.splitlines() if line.strip()]
        if lines:
            try:
                parsed = json.loads(lines[-1])
                if isinstance(parsed, dict):
                    envelope = parsed
            except json.JSONDecodeError as error:
                parse_error = str(error)
        self.command_number += 1
        record = {
            "command_number": self.command_number,
            "scenario": self.current_scenario,
            "label": label,
            "argv": argv,
            "cwd": str(self.run_root),
            "started_at": now_iso(),
            "duration_ms": elapsed_ms,
            "exit_code": completed.returncode,
            "timed_out": timed_out,
            "stdout": stdout,
            "stderr": stderr,
            "envelope": envelope,
            "parse_error": parse_error,
        }
        self._record_command(record)
        return record

    def require_envelope(self, result: dict[str, Any]) -> dict[str, Any]:
        envelope = result.get("envelope")
        if not isinstance(envelope, dict):
            raise CheckFailure(
                f"{result['label']} did not return a JSON envelope: "
                f"stdout={result['stdout']!r} stderr={result['stderr']!r}"
            )
        return envelope

    def expect_success(self, result: dict[str, Any], outcome: str | None = None) -> dict[str, Any]:
        envelope = self.require_envelope(result)
        if result["exit_code"] != 0:
            raise CheckFailure(f"{result['label']} exited {result['exit_code']}: {json_text(envelope)}")
        if outcome is not None and envelope.get("outcome") != outcome:
            raise CheckFailure(
                f"{result['label']} expected outcome {outcome!r}, got {envelope.get('outcome')!r}"
            )
        return envelope

    def expect_rejected(self, result: dict[str, Any], codes: set[str] | None = None) -> dict[str, Any]:
        envelope = self.require_envelope(result)
        if result["exit_code"] == 0:
            raise CheckFailure(f"{result['label']} unexpectedly succeeded: {json_text(envelope)}")
        if envelope.get("outcome") not in {"rejected", "conflict", "failed", "unknown"}:
            raise CheckFailure(f"{result['label']} has unexpected outcome: {json_text(envelope)}")
        if codes is not None and envelope.get("error", {}).get("code") not in codes:
            raise CheckFailure(
                f"{result['label']} expected one of {sorted(codes)}, "
                f"got {envelope.get('error', {}).get('code')!r}"
            )
        return envelope

    def path_available(self, path: str) -> bool:
        available = self.route_registry.get("data", {}).get("available", [])
        return any(item.get("path") == path for item in available if isinstance(item, dict))

    def require_route(self, path: str) -> None:
        if not self.path_available(path):
            unavailable = self.route_registry.get("data", {}).get("unavailable_routes", [])
            match = next((item for item in unavailable if item.get("path") == path), None)
            reason = match.get("code", "route not advertised") if match else "route not advertised"
            raise ScenarioSkipped(f"{path}: {reason}")

    def scenario(self, scenario_id: str, family: str, action: Callable[[], dict[str, Any] | None]) -> None:
        self.current_scenario = scenario_id
        started = time.perf_counter()
        record: dict[str, Any] = {
            "id": scenario_id,
            "family": family,
            "started_at": now_iso(),
        }
        try:
            details = action() or {}
            record.update({"status": "pass", "details": details})
        except ScenarioSkipped as error:
            record.update({"status": "skip", "reason": str(error)})
        except Exception as error:  # noqa: BLE001 - preserve all failures in the report
            record.update(
                {
                    "status": "fail",
                    "error_type": type(error).__name__,
                    "error": str(error),
                }
            )
        record["duration_ms"] = round((time.perf_counter() - started) * 1000, 3)
        self.records.append(record)

    def create_work(
        self,
        work_id: str,
        title: str,
        kind: str,
        parent: str | None = None,
        *,
        priority: int | None = None,
        description: str | None = None,
        dispatch: str | None = None,
        hold: str | None = None,
        operation: str | None = None,
    ) -> dict[str, Any]:
        args = ["work", "create", self.project, work_id, title, "--kind", kind, "--actor", "suite-agent"]
        if parent is not None:
            args.extend(["--parent", parent])
        if priority is not None:
            args.extend(["--priority", str(priority)])
        if description is not None:
            args.extend(["--description", description])
        if dispatch is not None:
            args.extend(["--dispatch", dispatch])
        if hold is not None:
            args.extend(["--hold", hold])
        return self.expect_success(
            self.call(args, label=f"create:{work_id}", operation=operation or self.operation(f"create-{work_id}")),
            "changed",
        )

    def status_items(
        self,
        *,
        limit: int | None = None,
        offset: int | None = None,
        label: str = "status",
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        args = ["status", self.project]
        if limit is not None:
            args.extend(["--limit", str(limit)])
        if offset is not None:
            args.extend(["--offset", str(offset)])
        envelope = self.expect_success(
            self.call(args, label=label, operation=self.operation(label))
        )
        data = envelope.get("data") or {}
        return data, data.get("items", [])

    def _write_gate(self, gate_id: str, source_version: str, config_identity: str, *, expected: str) -> None:
        declaration = {
            "gate_id": gate_id,
            "kind": gate_id,
            "executable": "printf",
            "argv": ["printf", expected],
            "cwd": ".",
            "source_snapshot_hash": source_version,
            "config_identity": config_identity,
            "environment_fingerprint": "suite-environment",
            "observables": [expected],
            "max_runtime_ms": 30_000,
        }
        (self.gates / f"{gate_id}.json").write_text(json.dumps(declaration), encoding="utf-8")

    def bootstrap(self) -> dict[str, Any]:
        init = self.expect_success(
            self.call(
                ["init", self.project, "--actor", "suite-agent"],
                label="init",
                operation=self.operation("init"),
            ),
            "changed",
        )
        registry = self.call(
            ["commands"], label="command-registry", operation=self.operation("registry"), include_db=False
        )
        self.route_registry = self.require_envelope(registry)
        return {
            "revision": init.get("revision"),
            "available_routes": self.route_registry.get("data", {}).get("count"),
            "unavailable_routes": self.route_registry.get("data", {}).get("unavailable_count"),
        }

    def hierarchy(self) -> dict[str, Any]:
        self.ids.update({"milestone": "m1", "sprint": "s1", "task": "t1"})
        self.create_work("m1", "Creation suite milestone", "milestone", operation="op-hierarchy-m1")
        self.create_work("s1", "Creation suite sprint", "sprint", "m1", operation="op-hierarchy-s1")
        self.create_work("t1", "Creation suite task", "task", "s1", operation="op-hierarchy-t1")
        replay = self.call(
            [
                "work",
                "create",
                self.project,
                "m1",
                "Creation suite milestone",
                "--kind",
                "milestone",
                "--actor",
                "suite-agent",
            ],
            label="replay:create-m1",
            operation="op-hierarchy-m1",
        )
        replay_envelope = self.expect_success(replay)
        replay_failure: str | None = None
        if replay_envelope.get("outcome") != "unchanged":
            replay_failure = f"idempotent create did not replay unchanged: {json_text(replay_envelope)}"
        duplicate = self.call(
            ["work", "create", self.project, "m1", "Different title", "--kind", "milestone"],
            label="reject:duplicate-work-id",
            operation="op-hierarchy-duplicate",
        )
        self.expect_rejected(duplicate)
        invalid = self.call(
            ["work", "create", self.project, "root-sprint", "Invalid root sprint", "--kind", "sprint"],
            label="reject:root-sprint",
            operation="op-hierarchy-root-sprint",
        )
        self.expect_rejected(invalid)
        listing = self.expect_success(
            self.call(["work", "list", self.project], label="work-list", operation=self.operation("work-list"))
        )
        items = listing.get("data", {}).get("items", [])
        expected = {"m1": ("milestone", None), "s1": ("sprint", "m1"), "t1": ("task", "s1")}
        observed = {item.get("work_id"): (item.get("kind"), item.get("parent_id")) for item in items}
        if any(observed.get(work_id) != value for work_id, value in expected.items()):
            raise CheckFailure(f"hierarchy mismatch: observed={observed}")
        shown = self.expect_success(
            self.call(["work", "show", self.project, "t1"], label="work-show:t1", operation=self.operation("show-t1"))
        )
        if shown.get("data", {}).get("kind") != "task":
            raise CheckFailure(f"work show lost kind: {json_text(shown)}")
        if replay_failure is not None:
            raise CheckFailure(replay_failure)
        return {"created": len(items), "revision": listing.get("revision")}

    def attributes_and_revisions(self) -> dict[str, Any]:
        self.require_route("work edit")
        self.require_route("work hold add")
        data, _ = self.status_items()
        revision = int(data["project_revision"])
        edited = self.expect_success(
            self.call(
                [
                    "work",
                    "edit",
                    self.project,
                    "t1",
                    "--actor",
                    "suite-agent",
                    "--title",
                    "Edited task",
                    "--description",
                    "planning fields",
                    "--priority",
                    "7",
                    "--expected-revision",
                    str(revision),
                ],
                label="edit:t1",
                operation=self.operation("edit-t1"),
            ),
            "changed",
        )
        stale = self.call(
            [
                "work",
                "edit",
                self.project,
                "t1",
                "--actor",
                "suite-agent",
                "--title",
                "stale edit",
                "--expected-revision",
                str(revision),
            ],
            label="reject:stale-edit",
            operation=self.operation("stale-edit"),
        )
        self.expect_rejected(stale, {"conflict", "stale_revision", "revision_conflict", "invalid_argument"})
        latest = int(edited.get("revision") or edited.get("data", {}).get("revision") or revision + 1)
        held = self.expect_success(
            self.call(
                [
                    "work",
                    "hold",
                    "add",
                    self.project,
                    "t1",
                    "--actor",
                    "suite-agent",
                    "--reason",
                    "manual-review",
                    "--expected-revision",
                    str(latest),
                ],
                label="hold:add:t1",
                operation=self.operation("hold-t1"),
            ),
            "changed",
        )
        status_data, items = self.status_items()
        task = next(item for item in items if item.get("work_id") == "t1")
        reason_codes = task.get("reason_codes", [])
        if task.get("display_status") not in {"blocked", "paused"} and not any("hold" in code for code in reason_codes):
            raise CheckFailure(f"hold did not affect status: {json_text(task)}")
        return {"revision": status_data.get("project_revision"), "hold_result": held.get("data")}

    def dependencies(self) -> dict[str, Any]:
        self.require_route("dep add")
        self.require_route("dep tree")
        chain_ids = [f"chain-{index:03d}" for index in range(self.chain_length)]
        for work_id in chain_ids:
            self.create_work(work_id, f"Chain task {work_id}", "task", "s1")
        for prerequisite, dependent in zip(chain_ids, chain_ids[1:]):
            self.expect_success(
                self.call(
                    ["dep", "add", self.project, prerequisite, dependent, "--actor", "suite-agent"],
                    label=f"dep-add:{prerequisite}->{dependent}",
                    operation=self.operation(f"dep-{prerequisite}-{dependent}"),
                ),
                "changed",
            )
        tree = self.expect_success(
            self.call(["dep", "tree", self.project], label="dep-tree", operation=self.operation("dep-tree"))
        )
        edges = tree.get("data", {}).get("edges", [])
        if len(edges) != self.chain_length - 1:
            raise CheckFailure(f"chain edge count {len(edges)} != {self.chain_length - 1}")
        cycle = self.call(
            ["dep", "add", self.project, chain_ids[-1], chain_ids[0], "--actor", "suite-agent"],
            label="reject:dependency-cycle",
            operation=self.operation("cycle"),
        )
        self.expect_rejected(cycle, {"conflict", "cycle", "dependency_cycle", "invalid_argument"})
        status_data, items = self.status_items(limit=20, label="status:chain-page-0")
        all_items = list(items)
        next_offset = status_data.get("next_offset")
        page_number = 1
        while status_data.get("has_more"):
            if not isinstance(next_offset, int):
                raise CheckFailure(f"status page omitted next_offset: {json_text(status_data)}")
            status_data, page_items = self.status_items(
                limit=20,
                offset=next_offset,
                label=f"status:chain-page-{page_number}",
            )
            all_items.extend(page_items)
            next_offset = status_data.get("next_offset")
            page_number += 1
        if len(all_items) != int(status_data.get("total", len(all_items))):
            raise CheckFailure(
                f"status pagination lost items: got {len(all_items)}, expected {status_data.get('total')}"
            )
        by_id = {item.get("work_id"): item for item in all_items}
        if by_id[chain_ids[0]].get("display_status") != "ready":
            raise CheckFailure(f"chain head is not ready: {json_text(by_id[chain_ids[0]])}")
        queued = [item for item in (by_id[item_id] for item_id in chain_ids[1:]) if item.get("display_status") == "queued"]
        if len(queued) != self.chain_length - 1:
            raise CheckFailure(f"expected queued tail, got {len(queued)} of {self.chain_length - 1}")
        return {
            "chain_length": self.chain_length,
            "edge_count": len(edges),
            "queued_tail": len(queued),
            "revision": status_data.get("project_revision"),
        }

    def lifecycle(self) -> dict[str, Any]:
        for path in ("work claim", "work accept", "work heartbeat", "work renew", "work release"):
            self.require_route(path)
        self.create_work("run-task", "Lifecycle task", "task", "s1")
        guide = self.expect_success(
            self.call(
                ["agent", "guide", "--project", self.project, "--work", "run-task"],
                label="agent-guide:before-claim",
                operation=self.operation("guide"),
            )
        )
        nxt = self.expect_success(
            self.call(
                ["next", "--project", self.project, "--work", "run-task"],
                label="agent-next:before-claim",
                operation=self.operation("next"),
            )
        )
        claim = self.expect_success(
            self.call(
                [
                    "work",
                    "claim",
                    self.project,
                    "run-task",
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "suite-harness",
                    "--session",
                    "suite-session-a",
                    "--lease-ttl",
                    "30s",
                    "--time-limit",
                    "2m",
                ],
                label="claim:run-task",
                operation=self.operation("claim-run-task"),
            ),
            "changed",
        )
        attempt = claim.get("data", {}).get("attempt_id")
        fence = claim.get("data", {}).get("fence")
        if not isinstance(attempt, str) or not isinstance(fence, int):
            raise CheckFailure(f"claim omitted attempt/fence: {json_text(claim)}")
        common = [
            "work",
            "accept",
            self.project,
            "run-task",
            "--actor",
            "suite-agent",
            "--harness",
            "suite-harness",
            "--session",
            "suite-session-a",
            "--attempt",
            attempt,
            "--fence",
            str(fence),
        ]
        self.expect_success(self.call(common, label="accept:run-task", operation=self.operation("accept")), "changed")
        self.expect_success(
            self.call(
                [
                    "work",
                    "heartbeat",
                    self.project,
                    "run-task",
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "suite-harness",
                    "--session",
                    "suite-session-a",
                    "--attempt",
                    attempt,
                    "--fence",
                    str(fence),
                ],
                label="heartbeat:run-task",
                operation=self.operation("heartbeat"),
            ),
            "changed",
        )
        self.expect_success(
            self.call(
                [
                    "work",
                    "renew",
                    self.project,
                    "run-task",
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "suite-harness",
                    "--session",
                    "suite-session-a",
                    "--attempt",
                    attempt,
                    "--fence",
                    str(fence),
                    "--lease-ttl",
                    "1m",
                ],
                label="renew:run-task",
                operation=self.operation("renew"),
            ),
            "changed",
        )
        missing_proof = self.call(
            [
                "work",
                "finish",
                self.project,
                "run-task",
                "--actor",
                "suite-agent",
                "--harness",
                "suite-harness",
                "--session",
                "suite-session-a",
                "--attempt",
                attempt,
                "--fence",
                str(fence),
            ],
            label="reject:finish-without-proof",
            operation=self.operation("finish-without-proof"),
        )
        self.expect_rejected(missing_proof)
        released = self.expect_success(
            self.call(
                [
                    "work",
                    "release",
                    self.project,
                    "run-task",
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "suite-harness",
                    "--session",
                    "suite-session-a",
                    "--attempt",
                    attempt,
                    "--fence",
                    str(fence),
                ],
                label="release:run-task",
                operation=self.operation("release"),
            ),
            "changed",
        )
        if released.get("data", {}).get("fence", fence) != fence:
            raise CheckFailure("release changed the historical fence")
        reclaimed = self.expect_success(
            self.call(
                [
                    "work",
                    "claim",
                    self.project,
                    "run-task",
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "suite-harness-2",
                    "--session",
                    "suite-session-b",
                    "--lease-ttl",
                    "30s",
                    "--time-limit",
                    "1m",
                ],
                label="reclaim:run-task",
                operation=self.operation("reclaim"),
            ),
            "changed",
        )
        stale = self.call(
            [
                "work",
                "release",
                self.project,
                "run-task",
                "--actor",
                "suite-agent",
                "--harness",
                "suite-harness",
                "--session",
                "suite-session-a",
                "--attempt",
                attempt,
                "--fence",
                str(fence),
            ],
            label="reject:stale-release",
            operation=self.operation("stale-release"),
        )
        self.expect_rejected(stale)
        new_attempt = reclaimed.get("data", {}).get("attempt_id")
        new_fence = reclaimed.get("data", {}).get("fence")
        self.expect_success(
            self.call(
                [
                    "work",
                    "release",
                    self.project,
                    "run-task",
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "suite-harness-2",
                    "--session",
                    "suite-session-b",
                    "--attempt",
                    str(new_attempt),
                    "--fence",
                    str(new_fence),
                ],
                label="release:reclaimed-task",
                operation=self.operation("release-reclaimed"),
            ),
            "changed",
        )
        return {
            "attempt_id": attempt,
            "fence": fence,
            "guide_directive": guide.get("data", {}).get("next_action", {}).get("directive_id"),
            "next_status": nxt.get("data", {}).get("status"),
        }

    def evidence_closeout(self) -> dict[str, Any]:
        for path in ("source add", "evidence run", "agent finish"):
            self.require_route(path)
        source_input = self.run_root / "source-fixture.md"
        source_input.write_text("creation-suite source fixture\n", encoding="utf-8")
        source = self.expect_success(
            self.call(
                [
                    "source",
                    "add",
                    self.project,
                    "--input",
                    str(source_input),
                    "--origin",
                    "creation-suite",
                    "--actor",
                    "suite-agent",
                ],
                label="source-add",
                operation=self.operation("source"),
            ),
            "changed",
        )
        source_id = source.get("data", {}).get("source", {}).get("source_version_id")
        if not isinstance(source_id, str):
            raise CheckFailure(f"source add omitted source_version_id: {json_text(source)}")
        config = "sha256:creation-suite-config"
        self.create_work("close-task", "Evidence closeout task", "task", "s1")
        claim = self.expect_success(
            self.call(
                [
                    "work",
                    "claim",
                    self.project,
                    "close-task",
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "close-harness",
                    "--session",
                    "close-session",
                    "--source-version",
                    source_id,
                    "--config-identity",
                    config,
                    "--lease-ttl",
                    "5m",
                    "--time-limit",
                    "10m",
                ],
                label="claim:close-task",
                operation=self.operation("claim-close"),
            ),
            "changed",
        )
        attempt = claim.get("data", {}).get("attempt_id")
        fence = claim.get("data", {}).get("fence")
        self.expect_success(
            self.call(
                [
                    "agent",
                    "start",
                    "close-task",
                    "--project",
                    self.project,
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "close-harness",
                    "--session",
                    "close-session",
                    "--lease-ttl",
                    "5m",
                    "--time-limit",
                    "10m",
                ],
                label="agent-start:close-task",
                operation=self.operation("start-close"),
            ),
            "changed",
        )
        for gate in ("checkpoint", "verification", "summary"):
            self._write_gate(gate, source_id, config, expected=gate)
        receipts: dict[str, str] = {}
        for gate in ("checkpoint", "verification", "summary"):
            evidence = self.expect_success(
                self.call(
                    [
                        "evidence",
                        "run",
                        "--project",
                        self.project,
                        "--work",
                        "close-task",
                        "--gate",
                        gate,
                        "--actor",
                        "suite-agent",
                        "--harness",
                        "close-harness",
                        "--session",
                        "close-session",
                        "--attempt",
                        str(attempt),
                        "--fence",
                        str(fence),
                    ],
                    label=f"evidence:{gate}",
                    operation=self.operation(f"evidence-{gate}"),
                ),
                "changed",
            )
            receipt_path = evidence.get("data", {}).get("receipt_path")
            if not isinstance(receipt_path, str):
                raise CheckFailure(f"evidence {gate} omitted receipt path: {json_text(evidence)}")
            receipts[gate] = receipt_path
        replay_operation = self.operation("evidence-replay")
        first = self.expect_success(
            self.call(
                [
                    "evidence",
                    "run",
                    "--project",
                    self.project,
                    "--work",
                    "close-task",
                    "--gate",
                    "verification",
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "close-harness",
                    "--session",
                    "close-session",
                    "--attempt",
                    str(attempt),
                    "--fence",
                    str(fence),
                ],
                label="evidence-replay:first",
                operation=replay_operation,
            )
        )
        replay = self.expect_success(
            self.call(
                [
                    "evidence",
                    "run",
                    "--project",
                    self.project,
                    "--work",
                    "close-task",
                    "--gate",
                    "verification",
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "close-harness",
                    "--session",
                    "close-session",
                    "--attempt",
                    str(attempt),
                    "--fence",
                    str(fence),
                ],
                label="evidence-replay:second",
                operation=replay_operation,
            )
        )
        if replay.get("outcome") != "unchanged" or not replay.get("data", {}).get("replayed"):
            raise CheckFailure(f"evidence replay was not unchanged: first={json_text(first)} replay={json_text(replay)}")
        summary = self.run_root / "close-summary.md"
        summary.write_text("Evidence-backed creation-suite closeout.\n", encoding="utf-8")
        direct_finish = self.call(
                [
                    "agent",
                    "finish",
                    "close-task",
                    "--close",
                    "--project",
                    self.project,
                    "--actor",
                    "suite-agent",
                    "--harness",
                    "close-harness",
                    "--session",
                    "close-session",
                    "--attempt",
                    str(attempt),
                    "--fence",
                    str(fence),
                    "--receipt",
                    receipts["verification"],
                    "--summary",
                    str(summary),
                ],
                label="finish:close-task",
                operation=self.operation("finish-close"),
        )
        self.expect_rejected(direct_finish, {"receipt_invalid", "invalid_argument", "gate_unsatisfied"})
        return {"source_version_id": source_id, "receipts": len(receipts), "finish": "service_required"}

    def service_restart(self) -> dict[str, Any]:
        self.require_route("status")
        service_dir = self.run_root / "service"
        service_dir.mkdir(exist_ok=True)
        socket = service_dir / "boreal.sock"
        log = service_dir / "service.log"
        self.create_work("service-task", "Service task", "task", "s1")
        with log.open("w", encoding="utf-8") as stream:
            process = subprocess.Popen(
                [
                    str(self.binary),
                    "service",
                    "run",
                    "--db",
                    str(self.database),
                    "--socket",
                    str(socket),
                    "--max-requests",
                    "3",
                    "--json",
                ],
                cwd=self.run_root,
                stdout=stream,
                stderr=subprocess.STDOUT,
                text=True,
            )
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and not socket.exists():
                if process.poll() is not None:
                    break
                time.sleep(0.02)
            if not socket.exists():
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
                service_output = log.read_text(encoding="utf-8")
                if "Operation not permitted" in service_output or "EPERM" in service_output:
                    raise ScenarioSkipped("Unix service socket was unavailable in this environment")
                raise CheckFailure(f"service failed to create socket; log={service_output}")
            self.expect_success(
                self.call(["status", self.project], label="service:status-before", operation=self.operation("service-status-1"), socket=socket),
            )
            claim = self.expect_success(
                self.call(
                    [
                        "work",
                        "claim",
                        self.project,
                        "service-task",
                        "--actor",
                        "suite-agent",
                        "--harness",
                        "service-harness",
                        "--session",
                        "service-session",
                    ],
                    label="service:claim",
                    operation=self.operation("service-claim"),
                    socket=socket,
                ),
                "changed",
            )
            self.expect_success(
                self.call(["status", self.project], label="service:status-after", operation=self.operation("service-status-2"), socket=socket),
            )
            return_code = process.wait(timeout=10)
        if return_code != 0:
            raise CheckFailure(f"service exited {return_code}; log={log.read_text(encoding='utf-8')}")
        if socket.exists():
            raise CheckFailure("bounded service left its socket behind")
        return {"claim_attempt": claim.get("data", {}).get("attempt_id"), "service_log": str(log)}

    def report(self) -> dict[str, Any]:
        counts = {status: sum(record.get("status") == status for record in self.records) for status in ("pass", "fail", "skip")}
        return {
            "result_version": "boreal.creation-suite/1",
            "run_id": self.run_root.name,
            "started_at": self.started_at,
            "finished_at": now_iso(),
            "workspace": str(self.project_root),
            "run_root": str(self.run_root),
            "database": str(self.database),
            "binary": str(self.binary),
            "binary_sha256": sha256(self.binary),
            "host": {
                "system": platform.system(),
                "release": platform.release(),
                "machine": platform.machine(),
                "python": platform.python_version(),
            },
            "chain_length": self.chain_length,
            "command_count": self.command_number,
            "counts": counts,
            "scenarios": self.records,
            "scenario_matrix": self.scenario_matrix,
            "route_registry": self.route_registry.get("data", {}),
            "artifacts": {
                "command_log": str(self.command_log),
                "service_log": str(self.run_root / "service" / "service.log") if (self.run_root / "service" / "service.log").exists() else None,
            },
        }


def sha256(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Boreal creation and lifecycle suite",
        "",
        f"Run: `{report['run_id']}`  ",
        f"Binary: `{report['binary']}`  ",
        f"Chain length: `{report['chain_length']}`  ",
        f"Commands: `{report['command_count']}`",
        "",
        f"Pass: **{report['counts']['pass']}**, skip: **{report['counts']['skip']}**, fail: **{report['counts']['fail']}**",
        "",
        "| Scenario | Family | Status | Duration (ms) | Detail |",
        "| --- | --- | --- | ---: | --- |",
    ]
    for item in report["scenarios"]:
        detail = item.get("reason") or item.get("error") or json_text(item.get("details", {}))
        detail = detail.replace("|", "\\|").replace("\n", " ")
        lines.append(f"| `{item['id']}` | `{item['family']}` | **{item['status']}** | {item['duration_ms']} | {detail} |")
    gaps = report.get("route_registry", {}).get("unavailable_routes", [])
    lines.extend(["", "## Advertised route gaps", ""])
    if gaps:
        for gap in gaps:
            lines.append(f"- `{gap.get('path')}` — `{gap.get('code')}`: {gap.get('summary', '')}")
    else:
        lines.append("None reported by the command registry.")
    lines.extend(["", f"Command log: `{report['artifacts']['command_log']}`", ""])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", dest="binary", type=Path, help="Boreal v2 binary")
    parser.add_argument("--project-root", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--run-root", type=Path, help="preserve test state at this exact path")
    parser.add_argument("--chain-length", type=int, default=32)
    parser.add_argument("--output", type=Path, default=ROOT / "scripts/validation/creation/results/latest.json")
    parser.add_argument("--report", type=Path, default=ROOT / "scripts/validation/creation/results/latest.md")
    args = parser.parse_args()
    if args.chain_length < 2:
        parser.error("--chain-length must be at least 2")

    binary = args.binary or (args.project_root / ".boreal/bin/bwrk-v2")
    if not binary.exists():
        binary = ROOT / "target/debug/bwrk"
    if not binary.is_file() or not os.access(binary, os.X_OK):
        parser.error(f"Boreal binary is not executable: {binary}")
    project_root = args.project_root.resolve()
    run_root = args.run_root.resolve() if args.run_root else Path(tempfile.mkdtemp(prefix="creation-suite-", dir=project_root / ".boreal"))
    suite = Suite(binary, project_root, run_root, args.chain_length)
    suite.scenario("bootstrap.registry", "workspace", suite.bootstrap)
    suite.scenario("hierarchy.create-and-validate", "creation", suite.hierarchy)
    suite.scenario("planning.attributes-and-revisions", "planning", suite.attributes_and_revisions)
    suite.scenario("dependencies.long-chain-and-cycle", "dependencies", suite.dependencies)
    suite.scenario("lifecycle.claim-lease-proof-release", "lifecycle", suite.lifecycle)
    suite.scenario("evidence.closeout-and-replay", "evidence", suite.evidence_closeout)
    suite.scenario("service.restart-and-bounded-reads", "service", suite.service_restart)
    report = suite.report()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(markdown(report), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "report": str(args.report), "run_root": str(run_root), "counts": report["counts"]}, indent=2))
    return 1 if report["counts"]["fail"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
