#!/usr/bin/env python3
"""Validate V3 planning artifacts, never a runtime database or product behavior.

No dependencies beyond Python's standard library. Run from any directory.
Historical V1/V2 templates are immutable; V3 uses the existing schema 1.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


class PlanError(ValueError):
    """A planning artifact is malformed or inconsistent."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PlanError(message)


def pairs(entries: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in entries:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=pairs)
    require(isinstance(value, dict), f"Expected object: {path.name}")
    return value


def tid(key: str) -> str:
    return "BW-" + key.upper()


def blob_sha(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def validate(root: Path) -> dict[str, int]:
    template = load(root / "BOREAL_TEMPLATE_V3.json")
    context = load(root / "PLAN_CONTEXT.json")
    delta = load(root / "PLAN_UPGRADE_V3.json")
    require(template.get("schema_version") == 1, "Use supported work-template schema 1")
    require(template.get("id") == "boreal-final-state-v3" and template.get("version") == 3,
            "Wrong active template identity")
    require(context.get("plan_version") == 3, "Context version drift")
    require(context.get("active_template") == "BOREAL_TEMPLATE_V3.json", "Active template drift")
    require(blob_sha(root / "BOREAL_TEMPLATE.json") == "b31c07691989b2ba392b25ab71c238db74fc0fc5",
            "Historical V1 template changed")
    require(blob_sha(root / "BOREAL_TEMPLATE_V2.json") == "1ad7bfed8d303008f144218371ae4a29f830cf20",
            "Historical V2 template changed")
    raw = template.get("items")
    require(isinstance(raw, list), "items must be a list")
    by_key: dict[str, dict[str, Any]] = {}
    fields = {"key", "kind", "parent", "title", "description", "priority", "dispatch",
              "dependencies", "labels", "acceptance_profile"}
    for item in raw:
        require(isinstance(item, dict) and set(item) == fields, "Unexpected work item fields")
        key = item["key"]
        require(isinstance(key, str) and bool(re.fullmatch(r"milestone|s\d{2}(?:-t\d{2})?", key)),
                f"Invalid key: {key}")
        require(key not in by_key, f"Duplicate work key: {key}")
        require(item["kind"] in {"milestone", "sprint", "task"}, f"Invalid kind: {key}")
        require(item["dispatch"] in {"automatic", "operator_only", "paused"}, f"Invalid dispatch: {key}")
        require(item["acceptance_profile"] in {"focused", "reviewed"}, f"Invalid profile: {key}")
        require(type(item["priority"]) is int and 0 <= item["priority"] <= 10, f"Invalid priority: {key}")
        require(isinstance(item["dependencies"], list) and
                all(isinstance(x, str) for x in item["dependencies"]), f"Invalid dependencies: {key}")
        require(isinstance(item["labels"], list) and all(isinstance(x, str) for x in item["labels"]),
                f"Invalid labels: {key}")
        require(all(isinstance(item[x], str) and item[x].strip() for x in ["title", "description"]),
                f"Missing title/description: {key}")
        by_key[key] = item
    tasks = {k: v for k, v in by_key.items() if v["kind"] == "task"}
    sprints = {k: v for k, v in by_key.items() if v["kind"] == "sprint"}
    require(len(raw) == 95 and len(tasks) == 81 and len(sprints) == 13, "Required scope count drift")
    require(by_key["milestone"]["kind"] == "milestone" and
            by_key["milestone"]["parent"] is None, "Invalid milestone")
    require(context.get("task_count") == len(tasks) and
            context.get("work_template_item_count") == len(raw), "Context count drift")
    require(set(context.get("sprints", [])) == set(map(tid, sprints)), "Context sprint drift")
    require(set(context.get("task_context", {})) == set(map(tid, tasks)), "Context task membership drift")
    deferred = {"s10-t04", "s10-t05", "s10-t06"}
    require(not deferred.intersection(by_key), "Deferred task present in required import")
    require(set(context.get("deferred_task_context", {})) == set(map(tid, deferred)), "Deferred context drift")
    old = {v["key"] for v in load(root / "BOREAL_TEMPLATE_V2.json")["items"]}
    require(old - set(by_key) == deferred, "Unexpected removal of historical keys")
    require(set(by_key) - old == set(delta.get("new_keys", [])), "Upgrade additions drift")
    require(set(delta.get("deferred_outside_core", [])) == deferred and
            delta.get("removed_ids") == [] and delta.get("not_a_bwrk_input") is True,
            "Unsafe/incorrect upgrade manifest")
    for key, item in by_key.items():
        if item["kind"] != "task":
            require(not item["dependencies"], f"Unsupported container dependency: {key}")
            if item["kind"] == "sprint":
                require(item["parent"] == "milestone", f"Invalid sprint parent: {key}")
            continue
        require(item["parent"] in sprints, f"Invalid task parent: {key}")
        deps = item["dependencies"]
        require(len(deps) == len(set(deps)) and key not in deps, f"Duplicate/self dependency: {key}")
        require(all(x in tasks for x in deps), f"Unresolved/non-task dependency: {key}")
        c = context["task_context"][tid(key)]
        require(c["dependencies"] == list(map(tid, deps)) and c["dispatch"] == item["dispatch"],
                f"Context edges/dispatch drift: {key}")
        require(c["sprint"] == tid(item["parent"]), f"Context parent drift: {key}")
        for field in ["owned_paths", "shared_paths"]:
            require(isinstance(c[field], list) and all(isinstance(x, str) and x for x in c[field]),
                    f"Missing write-boundary metadata: {key}")
        card = root / "sprints" / tid(item["parent"]) / "tasks" / (tid(key) + ".md")
        text = card.read_text(encoding="utf-8")
        require(text.splitlines()[0] == "# " + item["title"], f"Task title drift: {key}")
        expected = ", ".join(map(tid, deps)) or "None"
        require(f"**Direct prerequisites:** {expected}\n" in text, f"Task prerequisite drift: {key}")
        require(f"**Dispatch:** `{item['dispatch']}`" in text, f"Task dispatch drift: {key}")
        require(f"**Acceptance profile:** `{item['acceptance_profile']}`" in text,
                f"Task acceptance drift: {key}")
        require("## Work" in text, f"Missing implementation instructions: {key}")
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(key: str) -> None:
        require(key not in visiting, f"Dependency cycle at {key}")
        if key in visited:
            return
        visiting.add(key)
        for dep in tasks[key]["dependencies"]:
            visit(dep)
        visiting.remove(key)
        visited.add(key)

    for key in tasks:
        visit(key)
    for key in sprints:
        leaves = {k for k, v in tasks.items() if v["parent"] == key and not k.endswith("-t90")}
        require(set(tasks[key + "-t90"]["dependencies"]) == leaves, f"Sprint gate coverage drift: {key}")
        text = (root / "sprints" / tid(key) / "SPRINT.md").read_text(encoding="utf-8")
        table = text.split("## Tasks\n", 1)[1].split("\n## ", 1)[0]
        rows = set(re.findall(r"\| \[(BW-S\d{2}-T\d{2})\]", table))
        require(rows == set(map(tid, leaves | {key + "-t90"})), f"Sprint table membership drift: {key}")
    for key, item in tasks.items():
        if key.startswith("s11-") and key != "s11-t90":
            require("s12-t90" in item["dependencies"], f"Missing portable-workflow release gate: {key}")
    require(by_key["milestone"]["acceptance_profile"] == "reviewed" and
            tasks["s11-t90"]["acceptance_profile"] == "reviewed", "Final review weakened")
    require(tasks["s00-t05"]["dispatch"] == "operator_only", "Existing recovery authority changed")
    journeys = (root / "WORKFLOW_CONTRACT.md").read_text(encoding="utf-8")
    rows = re.findall(r"^\| (J\d{2}) \|.*$", journeys, flags=re.M)
    require(rows == [f"J{i:02}" for i in range(1, 19)], "Required journey membership drift")
    require(set(re.findall(r"BW-S\d{2}-T\d{2}", journeys)) <= set(map(tid, tasks)),
            "Unknown/deferred journey owner")
    return {"sprints": len(sprints), "required_tasks": len(tasks), "work_items": len(raw),
            "deferred_tasks": len(deferred), "journeys": len(rows)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        summary = validate(args.root)
    except (PlanError, OSError, ValueError, KeyError, TypeError, IndexError) as exc:
        print(f"FAIL plan consistency: {exc}", file=sys.stderr)
        return 1
    print("PASS plan consistency: " + json.dumps(summary, sort_keys=True))
    print("No product tests or runtime database mutations performed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
