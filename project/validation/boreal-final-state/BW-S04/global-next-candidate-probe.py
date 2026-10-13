#!/usr/bin/env python3
"""Disposable regression for Global Next session coverage at association 101."""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile


REPO = pathlib.Path(__file__).resolve().parents[4]
BINARY = REPO / "target/debug/bwrk"
EVIDENCE = pathlib.Path(__file__).with_name("global-next-candidate-probe.json")


def run_cli(root: pathlib.Path, args: list[str], *, cwd: pathlib.Path, global_env: bool = True):
    env = os.environ.copy()
    if global_env:
        env["BOREAL_GLOBAL_ROOT"] = str(root)
    result = subprocess.run(
        [str(BINARY), *args, "--json"], cwd=cwd, env=env, text=True, capture_output=True
    )
    try:
        envelope = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"invalid JSON from {args}: {result.stdout[:1000]}") from error
    if result.returncode != 0 or envelope.get("transport") != "ok":
        raise RuntimeError(
            f"{args}: exit={result.returncode}, envelope={json.dumps(envelope)}, stderr={result.stderr}"
        )
    return result, envelope


def main() -> int:
    temp = pathlib.Path(tempfile.mkdtemp(prefix="bw-s04-next-candidate-"))
    global_root = temp / "global"
    workspace = temp / "candidate-workspace"
    workspace.mkdir()
    try:
        run_cli(global_root, ["global", "bootstrap"], cwd=REPO)
        _, init = run_cli(global_root, ["init", "--yes"], cwd=workspace, global_env=False)
        metadata_path = workspace / ".boreal/project.json"
        metadata = json.loads(metadata_path.read_text())
        project_id = metadata["project_id"]
        operator = metadata["operator_actor"]
        operator_session = metadata["operator_session"]
        setup_operator_actor = operator
        setup_operator_session = operator_session

        _, operator_session_start = run_cli(
            global_root,
            ["session", "start", "--project", project_id, "--session", operator_session,
             "--harness", "t90-probe", "--actor", operator],
            cwd=workspace,
            global_env=False,
        )
        _, enrollment = run_cli(
            global_root, ["auth", "key", "--actor", "agent-a"], cwd=workspace, global_env=False
        )
        _, grant = run_cli(
            global_root,
            ["auth", "grant", "--input", enrollment["data"]["enrollment_path"],
             "--expected-revision", str(operator_session_start["revision"]),
             "--reason", "Disposable S04 candidate probe", "--yes", "--actor", operator,
             "--session", operator_session],
            cwd=workspace,
            global_env=False,
        )
        _, agent_session_start = run_cli(
            global_root,
            ["session", "start", "--project", project_id, "--session", "candidate-session",
             "--harness", "t90-probe", "--actor", "agent-a"],
            cwd=workspace,
            global_env=False,
        )
        _, created = run_cli(
            global_root,
            ["work", "create", project_id, "candidate-beyond-cap", "Candidate beyond summary cap",
             "--kind", "task", "--dispatch", "automatic", "--actor", "agent-a",
             "--session", "candidate-session", "--expected-revision", str(agent_session_start["revision"])],
            cwd=workspace,
            global_env=False,
        )
        _, agent_b_enrollment = run_cli(
            global_root, ["auth", "key", "--actor", "agent-b"], cwd=workspace, global_env=False
        )
        _, agent_b_grant = run_cli(
            global_root,
            ["auth", "grant", "--input", agent_b_enrollment["data"]["enrollment_path"],
             "--expected-revision", str(created["revision"]),
             "--reason", "Disposable wrong-actor session probe", "--yes", "--actor", operator,
             "--session", operator_session],
            cwd=workspace,
            global_env=False,
        )
        _, other_actor_session_start = run_cli(
            global_root,
            ["session", "start", "--project", project_id, "--session", "other-actor-session",
             "--harness", "t90-probe", "--actor", "agent-b"],
            cwd=workspace,
            global_env=False,
        )
        _, agent_status = run_cli(
            global_root,
            ["status", project_id, "--actor", "agent-a", "--session", "candidate-session"],
            cwd=workspace,
            global_env=False,
        )
        work_row = next(
            item for item in agent_status["data"]["items"] if item["work_id"] == "candidate-beyond-cap"
        )
        claimable_with_session = work_row["claimable_for_actor"] is True

        # Bind the disposable Global Next fixture to the same actor/session
        # whose canonical status proves this task claimable.
        metadata["operator_actor"] = "agent-a"
        metadata["operator_session"] = "candidate-session"
        metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")

        for index in range(100):
            folder = temp / f"folder-{index:03d}"
            folder.mkdir()
            _, project = run_cli(
                global_root, ["global", "project", "add", "--name", f"Folder {index:03d}"], cwd=REPO
            )
            run_cli(
                global_root,
                ["global", "project", "attach-folder", project["data"]["id"], "--folder", str(folder)],
                cwd=REPO,
            )

        _, management_project = run_cli(
            global_root, ["global", "project", "add", "--name", "Candidate workspace"], cwd=REPO
        )
        management_project_id = management_project["data"]["id"]
        run_cli(
            global_root,
            ["global", "project", "link", management_project_id, "--workspace", str(workspace)],
            cwd=REPO,
        )

        connection = sqlite3.connect(global_root / "global.sqlite")
        state = json.loads(
            connection.execute(
                "SELECT state_json FROM global_manager_state WHERE singleton=1"
            ).fetchone()[0]
        )
        connection.close()
        association_index = next(
            index for index, association in enumerate(state["associations"])
            if association.get("kind") == "workspace" and association.get("identity") == project_id
        )

        def global_next_for_session(session_id: str) -> dict:
            metadata["operator_session"] = session_id
            metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")
            _, response = run_cli(global_root, ["global", "next"], cwd=REPO)
            data = response["data"]
            checks = [check for check in data["checks"] if check.get("workspace_id") == project_id]
            return {
                "configured_session_id": session_id,
                "coverage": data.get("coverage"),
                "passed": data.get("passed"),
                "candidate_count": data.get("candidate_count"),
                "selected": data.get("selected"),
                "candidates": data.get("candidates"),
                "workspace_checks": checks,
            }

        active_session_result = global_next_for_session("candidate-session")
        missing_session_result = global_next_for_session("missing-session")
        wrong_actor_session_result = global_next_for_session("other-actor-session")

        # End the actual candidate session after the successful-selection case;
        # the next Global Next read must not treat its empty candidate set as complete.
        run_cli(
            global_root,
            ["session", "end", "--project", project_id, "--session", "candidate-session",
             "--actor", "agent-a", "--expected-revision", str(other_actor_session_start["revision"])],
            cwd=workspace,
            global_env=False,
        )
        ended_session_result = global_next_for_session("candidate-session")

        command_registry_source = (REPO / "crates/cli/src/command_registry.rs").read_text()
        command_spec_line = next(
            line for line in command_registry_source.splitlines()
            if 'CommandSpec {path:"global next"' in line
        )
        command_syntax = command_spec_line.split('syntax:"', 1)[1].split('"', 1)[0]
        candidate_selected = (
            active_session_result.get("selected") is not None
            and active_session_result["selected"].get("workspace_id") == project_id
            and active_session_result["selected"].get("work_id") == "candidate-beyond-cap"
        )
        invalid_sessions_are_partial = all(
            item.get("coverage", {}).get("complete") is False
            and item.get("coverage", {}).get("state") == "partial"
            and item.get("passed") is False
            and any(check.get("state") == "read_failed" for check in item.get("workspace_checks", []))
            for item in (missing_session_result, wrong_actor_session_result, ended_session_result)
        )
        source_commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=REPO, text=True
        ).strip()
        result = {
            "probe": "BW-S04 Global Next candidate/session coverage at association index 100",
            "source_commit": source_commit,
            "binary_sha256": hashlib.sha256(BINARY.read_bytes()).hexdigest(),
            "disposable_only": True,
            "workspace_id": project_id,
            "management_project_id": management_project_id,
            "work_id": "candidate-beyond-cap",
            "claimable_actor_id": "agent-a",
            "claimable_session_id": "candidate-session",
            "setup_operator_actor_before_fixture_rebind": setup_operator_actor,
            "setup_operator_session_before_fixture_rebind": setup_operator_session,
            "setup_operator_actor_matches_claimable_actor": setup_operator_actor == "agent-a",
            "configured_operator_actor_used_by_global_next": metadata["operator_actor"],
            "configured_operator_session_in_disposable_metadata": metadata["operator_session"],
            "actor_identity_matches": metadata["operator_actor"] == "agent-a",
            "global_next_syntax": command_syntax,
            "global_next_has_typed_actor_or_session_input": "--actor" in command_syntax or "--session" in command_syntax,
            "fixture_metadata_was_rebound_for_same_actor_test": True,
            "work_create_revision": created["revision"],
            "other_actor_grant_revision": agent_b_grant["revision"],
            "other_actor_session_start_revision": other_actor_session_start["revision"],
            "agent_status_revision": agent_status["data"]["project_revision"],
            "claimable_for_agent_with_active_session": claimable_with_session,
            "association_index_zero_based": association_index,
            "global_association_count": len(state["associations"]),
            "summary_cap": 100,
            "beyond_summary_cap": association_index >= 100,
            "active_session_result": active_session_result,
            "missing_session_result": missing_session_result,
            "wrong_actor_session_result": wrong_actor_session_result,
            "ended_session_result": ended_session_result,
            "candidate_selected": candidate_selected,
            "invalid_sessions_are_partial": invalid_sessions_are_partial,
            "result": "PASS" if (
                claimable_with_session
                and association_index >= 100
                and active_session_result.get("coverage", {}).get("complete") is True
                and candidate_selected
                and invalid_sessions_are_partial
            ) else "FAIL",
        }
        EVIDENCE.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
        return 0 if result["result"] == "PASS" else 1
    finally:
        shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
