# R-FULL-SUITE — scripts/validation/run_full_suite.py

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/validation/run_full_suite.py:L1–L280`  
**File SHA-256:** `f582882c598662b49d4734c0248bcfc2b331a5c881b0357b7bcd633120b713e3`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing orchestrator; inspect failure handling, selected slices, source identity and retained evidence before extending.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,280p' 'scripts/validation/run_full_suite.py'
```

## Exact baseline excerpt

````text
    1 | #!/usr/bin/env python3
    2 | """Run the complete Boreal validation stack and retain one aggregate report."""
    3 | 
    4 | from __future__ import annotations
    5 | 
    6 | import argparse
    7 | import hashlib
    8 | import json
    9 | import platform
   10 | import subprocess
   11 | import sys
   12 | import time
   13 | from datetime import datetime, timezone
   14 | from pathlib import Path
   15 | from typing import Any
   16 | 
   17 | 
   18 | ROOT = Path(__file__).resolve().parents[2]
   19 | 
   20 | 
   21 | def now_iso() -> str:
   22 |     return datetime.now(timezone.utc).isoformat()
   23 | 
   24 | 
   25 | def run_check(
   26 |     label: str,
   27 |     command: list[str],
   28 |     log_dir: Path,
   29 |     *,
   30 |     timeout_seconds: float = 900.0,
   31 | ) -> dict[str, Any]:
   32 |     started = time.perf_counter()
   33 |     timed_out = False
   34 |     try:
   35 |         completed = subprocess.run(
   36 |             command,
   37 |             cwd=ROOT,
   38 |             text=True,
   39 |             capture_output=True,
   40 |             check=False,
   41 |             timeout=timeout_seconds,
   42 |         )
   43 |     except subprocess.TimeoutExpired as error:
   44 |         timed_out = True
   45 |         completed = subprocess.CompletedProcess(
   46 |             command,
   47 |             124,
   48 |             error.stdout or "",
   49 |             error.stderr or "",
   50 |         )
   51 |     elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
   52 |     stdout_path = log_dir / f"{label}.stdout.log"
   53 |     stderr_path = log_dir / f"{label}.stderr.log"
   54 |     stdout = completed.stdout or ""
   55 |     stderr = completed.stderr or ""
   56 |     stdout_path.write_text(stdout, encoding="utf-8")
   57 |     stderr_path.write_text(stderr, encoding="utf-8")
   58 |     combined_lower = f"{stdout}\n{stderr}".lower()
   59 |     socket_denied = (
   60 |         completed.returncode != 0
   61 |         and not timed_out
   62 |         and ("eperm" in combined_lower or "operation not permitted" in combined_lower)
   63 |         and any(token in combined_lower for token in ("sock", "listen", "service_unavailable"))
   64 |     )
   65 |     explicit_skip = "boreal_validation_skip:" in combined_lower
   66 |     sqlite_floor_failure = (
   67 |         label == "release-performance"
   68 |         and "below the required 3.51.3 release floor" in combined_lower
   69 |     )
   70 |     offline_lockfile = (
   71 |         label == "concurrency"
   72 |         and completed.returncode != 0
   73 |         and "needs to be updated but --locked" in combined_lower
   74 |         and "--offline" in combined_lower
   75 |     )
   76 |     environment_skip = socket_denied or offline_lockfile or explicit_skip
   77 |     reason = (
   78 |         "sandbox denied Unix socket creation"
   79 |         if socket_denied
   80 |         else "standalone concurrency probe lockfile is not buildable from the offline cache"
   81 |         if offline_lockfile
   82 |         else "linked SQLite runtime is below the required 3.51.3 release floor"
   83 |         if sqlite_floor_failure
   84 |         else "child check reported an environment skip"
   85 |         if explicit_skip
   86 |         else None
   87 |     )
   88 |     return {
   89 |         "label": label,
   90 |         "command": command,
   91 |         "exit_code": completed.returncode,
   92 |         "status": "skip" if environment_skip else "pass" if completed.returncode == 0 else "fail",
   93 |         "reason": "timed out after {timeout_seconds:g}s".format(timeout_seconds=timeout_seconds)
   94 |         if timed_out
   95 |         else reason,
   96 |         "duration_ms": elapsed_ms,
   97 |         "timeout_seconds": timeout_seconds,
   98 |         "stdout_log": str(stdout_path),
   99 |         "stderr_log": str(stderr_path),
  100 |     }
  101 | 
  102 | 
  103 | def markdown(report: dict[str, Any]) -> str:
  104 |     lines = [
  105 |         "# Boreal full validation suite",
  106 |         "",
  107 |         f"Profile: **{report['profile']}**  ",
  108 |         f"Binary: `{report['binary']}`  ",
  109 |         f"Pass: **{report['counts']['pass']}**, skip: **{report['counts']['skip']}**, fail: **{report['counts']['fail']}**",
  110 |         "",
  111 |         "| Check | Status | Exit | Duration (ms) | Reason |",
  112 |         "| --- | --- | ---: | ---: | --- |",
  113 |     ]
  114 |     for check in report["checks"]:
  115 |         reason = (check.get("reason") or "").replace("|", "\\|").replace("\n", " ")
  116 |         lines.append(
  117 |             f"| `{check['label']}` | **{check['status']}** | {check['exit_code']} | "
  118 |             f"{check['duration_ms']} | {reason} |"
  119 |         )
  120 |     lines.extend(["", f"Logs: `{report['log_dir']}`", ""])
  121 |     return "\n".join(lines)
  122 | 
  123 | 
  124 | def binary_freshness(binary: Path) -> dict[str, Any]:
  125 |     """Reject black-box evidence from a binary older than its source inputs."""
  126 |     if not binary.exists():
  127 |         return {
  128 |             "label": "binary-freshness",
  129 |             "command": [],
  130 |             "exit_code": 2,
  131 |             "status": "fail",
  132 |             "reason": f"validation binary is missing: {binary}",
  133 |             "duration_ms": 0.0,
  134 |             "timeout_seconds": None,
  135 |             "stdout_log": None,
  136 |             "stderr_log": None,
  137 |         }
  138 |     source_paths = [ROOT / "Cargo.toml", ROOT / "Cargo.lock"]
  139 |     source_paths.extend((ROOT / "crates").glob("**/*.rs"))
  140 |     source_paths.extend((ROOT / "apps/tui/src").glob("**/*.ts"))
  141 |     newest = max((path.stat().st_mtime for path in source_paths if path.exists()), default=0.0)
  142 |     if binary.stat().st_mtime < newest:
  143 |         return {
  144 |             "label": "binary-freshness",
  145 |             "command": [],
  146 |             "exit_code": 2,
  147 |             "status": "fail",
  148 |             "reason": "validation binary is older than current Rust/TypeScript source; rebuild before black-box checks",
  149 |             "duration_ms": 0.0,
  150 |             "timeout_seconds": None,
  151 |             "stdout_log": None,
  152 |             "stderr_log": None,
  153 |         }
  154 |     return {
  155 |         "label": "binary-freshness",
  156 |         "command": [],
  157 |         "exit_code": 0,
  158 |         "status": "pass",
  159 |         "reason": None,
  160 |         "duration_ms": 0.0,
  161 |         "timeout_seconds": None,
  162 |         "stdout_log": None,
  163 |         "stderr_log": None,
  164 |     }
  165 | 
  166 | 
  167 | def binary_runtime_check(
  168 |     binary: Path, log_dir: Path, *, require_sqlite_floor: bool
  169 | ) -> dict[str, Any]:
  170 |     """Prove the selected executable's actual SQLite runtime, not a test crate's."""
  171 |     result = run_check(
  172 |         "binary-runtime",
  173 |         [str(binary), "version", "--json"],
  174 |         log_dir,
  175 |     )
  176 |     result["binary_sha256"] = (
  177 |         hashlib.sha256(binary.read_bytes()).hexdigest() if binary.exists() else None
  178 |     )
  179 |     if result["status"] != "pass":
  180 |         return result
  181 |     try:
  182 |         lines = [
  183 |             line for line in (log_dir / "binary-runtime.stdout.log")
  184 |             .read_text(encoding="utf-8")
  185 |             .splitlines()
  186 |             if line.strip()
  187 |         ]
  188 |         envelope = json.loads(lines[-1])
  189 |         runtime = envelope["data"]["sqlite_runtime"]
  190 |         libversion = str(runtime["libversion"])
  191 |         version = tuple(int(part) for part in libversion.split(".")[:3])
  192 |     except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
  193 |         result["status"] = "fail"
  194 |         result["exit_code"] = 2
  195 |         result["reason"] = f"selected binary did not report a parseable SQLite runtime: {error}"
  196 |         return result
  197 |     meets_floor = version >= (3, 51, 3)
  198 |     result["sqlite_runtime"] = {
  199 |         "libversion": libversion,
  200 |         "source_id": runtime.get("source_id"),
  201 |         "meets_floor": meets_floor,
  202 |         "required_floor": "3.51.3",
  203 |     }
  204 |     if require_sqlite_floor and not meets_floor:
  205 |         result["status"] = "fail"
  206 |         result["exit_code"] = 2
  207 |         result["reason"] = (
  208 |             f"selected binary links SQLite {libversion}, below the required 3.51.3 release floor"
  209 |         )
  210 |     return result
  211 | 
  212 | 
  213 | def main() -> int:
  214 |     parser = argparse.ArgumentParser(description=__doc__)
  215 |     parser.add_argument("--profile", choices=("smoke", "full"), default="smoke")
  216 |     parser.add_argument("--bin", type=Path, help="Boreal v2 binary for the black-box suite")
  217 |     parser.add_argument("--output", type=Path, default=ROOT / "scripts/validation/results/full-suite.latest.json")
  218 |     parser.add_argument("--report", type=Path, help="Markdown report path; defaults beside --output")
  219 |     parser.add_argument(
  220 |         "--strict",
  221 |         action="store_true",
  222 |         help="release-style gate: require the current binary, benchmark, SQLite floor, and no skips",
  223 |     )
  224 |     parser.add_argument(
  225 |         "--require-no-skips",
  226 |         action="store_true",
  227 |         help="return failure when any check is classified as an environment skip",
  228 |     )
  229 |     parser.add_argument(
  230 |         "--allow-skips",
  231 |         action="store_true",
  232 |         help="exploratory override; keep skips visible but allow a zero exit",
  233 |     )
  234 |     parser.add_argument(
  235 |         "--require-current-binary",
  236 |         action="store_true",
  237 |         help="use and require target/debug/bwrk for black-box validation",
  238 |     )
  239 |     parser.add_argument(
  240 |         "--require-sqlite-floor",
  241 |         action="store_true",
  242 |         help="require the release-performance SQLite runtime floor",
  243 |     )
  244 |     parser.add_argument(
  245 |         "--require-benchmark",
  246 |         action="store_true",
  247 |         help="run the release status-scale benchmark instead of skipping it",
  248 |     )
  249 |     parser.add_argument(
  250 |         "--timeout-seconds",
  251 |         type=float,
  252 |         default=900.0,
  253 |         help="maximum runtime for each child check (default: 900)",
  254 |     )
  255 |     parser.add_argument(
  256 |         "--online",
  257 |         action="store_true",
  258 |         help="allow Cargo child checks to resolve dependencies from the network",
  259 |     )
  260 |     parser.add_argument(
  261 |         "--soak-rounds",
  262 |         type=int,
  263 |         default=10,
  264 |         help="number of process-race rounds in the full-profile soak check (default: 10)",
  265 |     )
  266 |     args = parser.parse_args()
  267 |     if args.timeout_seconds <= 0:
  268 |         parser.error("--timeout-seconds must be positive")
  269 |     if args.soak_rounds <= 0:
  270 |         parser.error("--soak-rounds must be positive")
  271 |     if args.strict:
  272 |         if args.profile != "full":
  273 |             parser.error("--strict requires --profile full")
  274 |         args.require_no_skips = True
  275 |         args.require_current_binary = True
  276 |         args.require_sqlite_floor = True
  277 |         args.require_benchmark = True
  278 |     output = args.output.resolve()
  279 |     log_dir = output.parent / f"full-suite-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
  280 |     log_dir.mkdir(parents=True, exist_ok=True)
````
