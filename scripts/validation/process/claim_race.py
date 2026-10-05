#!/usr/bin/env python3
"""Exercise exact-work contention and operation replay with real child processes."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def invoke(binary: Path, args: list[str], *, cwd: Path) -> dict:
    completed = subprocess.run(
        [str(binary), *args],
        cwd=cwd,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    envelope = json.loads(lines[-1]) if lines else None
    if not isinstance(envelope, dict):
        raise RuntimeError(
            f"command returned no JSON envelope (exit={completed.returncode}): "
            f"stdout={completed.stdout!r} stderr={completed.stderr!r}"
        )
    return {"exit_code": completed.returncode, "envelope": envelope, "stderr": completed.stderr}


def require_success(label: str, result: dict) -> dict:
    envelope = result["envelope"]
    if result["exit_code"] != 0 or envelope.get("outcome") not in {"changed", "unchanged"}:
        raise RuntimeError(f"{label} failed: {result}")
    return envelope


def current_revision(binary: Path, *, project: str, database: Path, cwd: Path) -> int:
    result = invoke(binary, ["status", project, "--db", str(database), "--json"], cwd=cwd)
    envelope = require_success("status readback", result)
    revision = envelope.get("revision")
    if not isinstance(revision, int):
        raise RuntimeError(f"status readback did not return an integer revision: {envelope}")
    return revision


def enroll_agent(
    binary: Path,
    *,
    project: str,
    database: Path,
    cwd: Path,
    actor: str,
    session: str,
    harness: str,
) -> None:
    key = require_success(
        f"auth key for {actor}",
        invoke(
            binary,
            ["auth", "key", "--actor", actor, "--actor-role", "agent", "--db", str(database), "--json"],
            cwd=cwd,
        ),
    )
    enrollment = (key.get("data") or {}).get("enrollment_path")
    if not isinstance(enrollment, str):
        raise RuntimeError(f"auth key for {actor} returned no enrollment path: {key}")

    revision = current_revision(binary, project=project, database=database, cwd=cwd)
    require_success(
        f"auth grant for {actor}",
        invoke(
            binary,
            [
                "auth", "grant", "--actor", "operator", "--input", enrollment,
                "--expected-revision", str(revision), "--reason",
                "Authorize an isolated process-race fixture agent", "--yes",
                "--db", str(database), "--json",
            ],
            cwd=cwd,
        ),
    )

    revision = current_revision(binary, project=project, database=database, cwd=cwd)
    require_success(
        f"session start for {actor}",
        invoke(
            binary,
            [
                "session", "start", "--project", project, "--actor", actor,
                "--session", session, "--harness", harness,
                "--expected-revision", str(revision), "--db", str(database), "--json",
            ],
            cwd=cwd,
        ),
    )


def race(
    command: list[str],
    *,
    workers: int,
    root: Path,
    unique_claim_identity: bool = False,
) -> list[dict]:
    release = root / f"release-{len(list(root.glob('release-*')))}"
    env = os.environ.copy()
    env["BOREAL_RACE_RELEASE"] = str(release)
    children = []
    for worker in range(workers):
        child_command = list(command)
        if unique_claim_identity:
            operation_index = child_command.index("--operation-id") + 1
            session_index = child_command.index("--session") + 1
            actor_index = child_command.index("--actor") + 1
            child_command[operation_index] = f"race-claim-op-{worker}"
            child_command[session_index] = f"race-session-{worker:02d}"
            child_command[actor_index] = f"race-agent-{worker:02d}"
        children.append(
            subprocess.Popen(
                [sys.executable, "-c", CHILD_CODE],
                cwd=root,
                env={**env, "BOREAL_RACE_ARGV": json.dumps(child_command)},
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        )
    release.touch()
    results = []
    for child in children:
        stdout, stderr = child.communicate(timeout=45)
        lines = [line for line in stdout.splitlines() if line.strip()]
        if not lines:
            raise RuntimeError(f"race child emitted no result: stderr={stderr!r}")
        result = json.loads(lines[-1])
        result["worker_exit_code"] = child.returncode
        results.append(result)
    return results


def race_commands(commands: list[list[str]], *, root: Path) -> list[dict]:
    release = root / f"release-{len(list(root.glob('release-*')))}"
    env = os.environ.copy()
    env["BOREAL_RACE_RELEASE"] = str(release)
    children = [
        subprocess.Popen(
            [sys.executable, "-c", CHILD_CODE],
            cwd=root,
            env={**env, "BOREAL_RACE_ARGV": json.dumps(command)},
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        for command in commands
    ]
    release.touch()
    results = []
    for child in children:
        stdout, stderr = child.communicate(timeout=45)
        lines = [line for line in stdout.splitlines() if line.strip()]
        if not lines:
            raise RuntimeError(f"race child emitted no result: stderr={stderr!r}")
        result = json.loads(lines[-1])
        result["worker_exit_code"] = child.returncode
        results.append(result)
    return results


CHILD_CODE = """\
import os, subprocess, sys, time, json
release = os.environ['BOREAL_RACE_RELEASE']
argv = json.loads(os.environ['BOREAL_RACE_ARGV'])
while not os.path.exists(release):
    time.sleep(0.001)
for attempt in range(200):
    completed = subprocess.run(argv, text=True, capture_output=True, check=False, timeout=30)
    try:
        envelope = json.loads((completed.stdout or '').splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        break
    # Direct mode elects one database owner at a time. A concurrent child
    # must wait and retry the exact same operation identity; it must never
    # manufacture a fresh mutation ID after an ownership-busy response.
    if (envelope.get('error') or {}).get('code') != 'service_busy':
        break
    time.sleep(0.01)
print(json.dumps({'exit_code': completed.returncode, 'stdout': completed.stdout, 'stderr': completed.stderr}))
"""


def summarize(results: list[dict]) -> dict:
    envelopes = [json.loads((item.get("stdout") or "").splitlines()[-1]) for item in results]
    return {
        "outcomes": sorted(envelope.get("outcome") for envelope in envelopes),
        "errors": sorted(
            envelope.get("error", {}).get("code")
            for envelope in envelopes
            if envelope.get("error")
        ),
        "error_details": sorted(
            json.dumps(envelope.get("error"), sort_keys=True)
            for envelope in envelopes
            if envelope.get("error")
        ),
        "replayed": sum(
            bool((envelope.get("data") or {}).get("replayed")) for envelope in envelopes
        ),
        "exit_codes": sorted(item["exit_code"] for item in results),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", type=Path, default=ROOT / "target/debug/bwrk")
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()
    if args.workers < 2:
        parser.error("--workers must be at least 2")
    binary = args.bin.resolve()
    if not binary.exists():
        raise SystemExit(f"binary does not exist: {binary}")

    with tempfile.TemporaryDirectory(prefix="boreal-process-race-") as directory:
        root = Path(directory)
        project = "process-race-project"
        project_root = root / project
        database = project_root / ".boreal" / "boreal.sqlite"
        initialized = invoke(
            binary,
            [
                "init",
                project,
                "--db",
                str(database),
                "--operation-id",
                "race-init",
                "--json",
            ],
            cwd=root,
        )
        if initialized["exit_code"] != 0:
            raise RuntimeError(f"init failed: {initialized}")
        for worker in range(args.workers):
            enroll_agent(
                binary,
                project=project,
                database=database,
                cwd=project_root,
                actor=f"race-agent-{worker:02d}",
                session=f"race-session-{worker:02d}",
                harness="race-harness",
            )

        revision = current_revision(binary, project=project, database=database, cwd=project_root)
        created = invoke(
            binary,
            [
                "work",
                "create",
                project,
                "claim-race-task",
                "Claim race task",
                "--kind",
                "task",
                "--actor",
                "race-agent-00",
                "--session",
                "race-session-00",
                "--expected-revision",
                str(revision),
                "--db",
                str(database),
                "--operation-id",
                "race-create-claim-task",
                "--json",
            ],
            cwd=project_root,
        )
        if created["exit_code"] != 0:
            raise RuntimeError(f"task creation failed: {created}")

        source_input = project_root / ".boreal" / "claim-race-source.md"
        source_input.write_text("claim race source fixture\n", encoding="utf-8")
        source = require_success(
            "source add",
            invoke(
                binary,
                [
                    "source", "add", project, "--input", str(source_input),
                    "--origin", "claim-race", "--actor", "race-agent-00",
                    "--session", "race-session-00", "--harness", "race-harness",
                    "--expected-revision",
                    str(current_revision(binary, project=project, database=database, cwd=project_root)),
                    "--db", str(database), "--operation-id", "race-source-add", "--json",
                ],
                cwd=project_root,
            ),
        )
        source_version = (source.get("data") or {}).get("source", {}).get("source_version_id")
        if not isinstance(source_version, str):
            raise RuntimeError(f"source add returned no source version ID: {source}")

        claim_base = [
            str(binary),
            "work",
            "claim",
            project,
            "claim-race-task",
            "--actor",
            "race-agent-00",
            "--harness",
            "race-harness",
            "--session",
            "race-session-00",
            "--source-version",
            source_version,
            "--config-identity",
            "sha256:claim-race-config-v1",
            "--lease-ttl",
            "30s",
            "--time-limit",
            "2m",
            "--db",
            str(database),
            "--operation-id",
            "race-claim-op",
            "--json",
        ]
        claim_results = race(
            claim_base,
            workers=args.workers,
            root=project_root,
            unique_claim_identity=True,
        )
        claim_summary = summarize(claim_results)
        changed = claim_summary["outcomes"].count("changed")
        if changed != 1:
            raise RuntimeError(f"expected exactly one winning claim: {claim_summary}")

        for work_id in ("dependency-race-a", "dependency-race-b"):
            created = invoke(
                binary,
                [
                    "work",
                    "create",
                    project,
                    work_id,
                    work_id,
                    "--kind",
                    "task",
                    "--actor",
                    "race-agent-00",
                    "--session",
                    "race-session-00",
                    "--expected-revision",
                    str(current_revision(binary, project=project, database=database, cwd=project_root)),
                    "--db",
                    str(database),
                    "--operation-id",
                    f"race-create-{work_id}",
                    "--json",
                ],
                cwd=project_root,
            )
            if created["exit_code"] != 0:
                raise RuntimeError(f"dependency race task creation failed: {created}")
        dependency_commands = []
        for blocker, blocked in (
            ("dependency-race-a", "dependency-race-b"),
            ("dependency-race-b", "dependency-race-a"),
        ):
            revision = current_revision(binary, project=project, database=database, cwd=project_root)
            dependency_commands.append(
                [
                    str(binary),
                    "dep",
                    "add",
                    project,
                    blocker,
                    blocked,
                    "--actor",
                    "operator",
                    "--expected-revision",
                    str(revision),
                    "--db",
                    str(database),
                    "--operation-id",
                    f"race-dependency-{blocker}",
                    "--json",
                ]
            )
        dependency_results = race_commands(dependency_commands, root=project_root)
        dependency_summary = summarize(dependency_results)
        if dependency_summary["outcomes"].count("changed") != 1:
            raise RuntimeError(f"expected one opposite-edge winner: {dependency_summary}")
        tree = invoke(
            binary,
            [
                "dep",
                "tree",
                project,
                "--actor",
                "operator",
                "--db",
                str(database),
                "--json",
            ],
            cwd=project_root,
        )
        tree_data = tree["envelope"].get("data") or {}
        if tree["exit_code"] != 0 or len(tree_data.get("edges", [])) != 1:
            raise RuntimeError(f"opposite-edge race left an invalid graph: {tree}")

        create_base = [
            str(binary),
            "work",
            "create",
            project,
            "replay-race-task",
            "Replay race task",
            "--kind",
            "task",
            "--actor",
            "race-agent-00",
            "--session",
            "race-session-00",
            "--expected-revision",
            str(current_revision(binary, project=project, database=database, cwd=project_root)),
            "--db",
            str(database),
            "--operation-id",
            "race-replay-op",
            "--json",
        ]
        replay_results = race(create_base, workers=args.workers, root=project_root)
        replay_summary = summarize(replay_results)
        if replay_summary["outcomes"].count("changed") != 1:
            raise RuntimeError(f"expected exactly one replay winner: {replay_summary}")
        if replay_summary["outcomes"].count("unchanged") != args.workers - 1:
            raise RuntimeError(f"expected all other replay calls to be unchanged: {replay_summary}")

        print(
            json.dumps(
                {
                    "workers": args.workers,
                    "claim_race": claim_summary,
                    "dependency_opposite_edge_race": dependency_summary,
                    "same_operation_replay": replay_summary,
                    "barrier": "filesystem release file; child processes wait before invoking bwrk",
                },
                sort_keys=True,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
