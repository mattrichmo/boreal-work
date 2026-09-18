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
            child_command[operation_index] = f"race-claim-op-{worker}"
            child_command[session_index] = f"race-session-{worker}"
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
        database = root / "boreal.sqlite"
        initialized = invoke(
            binary,
            [
                "init",
                "process-race-project",
                "--actor",
                "suite-agent",
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
        created = invoke(
            binary,
            [
                "work",
                "create",
                "process-race-project",
                "claim-race-task",
                "Claim race task",
                "--kind",
                "task",
                "--actor",
                "suite-agent",
                "--db",
                str(database),
                "--operation-id",
                "race-create-claim-task",
                "--json",
            ],
            cwd=root,
        )
        if created["exit_code"] != 0:
            raise RuntimeError(f"task creation failed: {created}")

        claim_base = [
            str(binary),
            "work",
            "claim",
            "process-race-project",
            "claim-race-task",
            "--actor",
            "suite-agent",
            "--harness",
            "race-harness",
            "--session",
            "race-session",
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
            root=root,
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
                    "process-race-project",
                    work_id,
                    work_id,
                    "--kind",
                    "task",
                    "--actor",
                    "suite-agent",
                    "--db",
                    str(database),
                    "--operation-id",
                    f"race-create-{work_id}",
                    "--json",
                ],
                cwd=root,
            )
            if created["exit_code"] != 0:
                raise RuntimeError(f"dependency race task creation failed: {created}")
        dependency_commands = []
        for blocker, blocked in (
            ("dependency-race-a", "dependency-race-b"),
            ("dependency-race-b", "dependency-race-a"),
        ):
            dependency_commands.append(
                [
                    str(binary),
                    "dep",
                    "add",
                    "process-race-project",
                    blocker,
                    blocked,
                    "--actor",
                    "suite-agent",
                    "--db",
                    str(database),
                    "--operation-id",
                    f"race-dependency-{blocker}",
                    "--json",
                ]
            )
        dependency_results = race_commands(dependency_commands, root=root)
        dependency_summary = summarize(dependency_results)
        if dependency_summary["outcomes"].count("changed") != 1:
            raise RuntimeError(f"expected one opposite-edge winner: {dependency_summary}")
        tree = invoke(
            binary,
            [
                "dep",
                "tree",
                "process-race-project",
                "--db",
                str(database),
                "--json",
            ],
            cwd=root,
        )
        tree_data = tree["envelope"].get("data") or {}
        if tree["exit_code"] != 0 or len(tree_data.get("edges", [])) != 1:
            raise RuntimeError(f"opposite-edge race left an invalid graph: {tree}")

        create_base = [
            str(binary),
            "work",
            "create",
            "process-race-project",
            "replay-race-task",
            "Replay race task",
            "--kind",
            "task",
            "--actor",
            "suite-agent",
            "--db",
            str(database),
            "--operation-id",
            "race-replay-op",
            "--json",
        ]
        replay_results = race(create_base, workers=args.workers, root=root)
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
