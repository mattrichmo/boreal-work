# R-EVIDENCE — project/validation/m02/evidence/run-01/checks.json

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/validation/m02/evidence/run-01/checks.json:L1–L263`  
**File SHA-256:** `7fe3e905e8c44d0fa8f483762553d8c500db050ae06bf2a28c2b758b0b5076ca`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Historical command outcomes tied to an earlier candidate; not fresh-tree proof.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,263p' 'project/validation/m02/evidence/run-01/checks.json'
```

## Exact baseline excerpt

````text
    1 | {
    2 |   "schema": "boreal.m02.candidate-checks/1",
    3 |   "as_of": "2026-09-21T18:29:49.530298+00:00",
    4 |   "host": "Linux-6.18.44-x86_64-with-glibc2.41",
    5 |   "checks": [
    6 |     {
    7 |       "name": "diff-whitespace",
    8 |       "command": [
    9 |         "git",
   10 |         "diff",
   11 |         "--check"
   12 |       ],
   13 |       "scope": "source hygiene only",
   14 |       "status": "passed",
   15 |       "exit_code": 0,
   16 |       "evidence_file": "diff-whitespace.md"
   17 |     },
   18 |     {
   19 |       "name": "contracts",
   20 |       "command": [
   21 |         "python3",
   22 |         "project/spec/validate_contracts.py"
   23 |       ],
   24 |       "scope": "structural existing contract/SQLite fixtures; not full M02",
   25 |       "status": "passed",
   26 |       "exit_code": 0,
   27 |       "evidence_file": "contracts.md"
   28 |     },
   29 |     {
   30 |       "name": "rust-format",
   31 |       "command": [
   32 |         "cargo",
   33 |         "fmt",
   34 |         "--all",
   35 |         "--",
   36 |         "--check"
   37 |       ],
   38 |       "scope": "Rust formatting; requires installed rustfmt",
   39 |       "status": "blocked_tool_unavailable",
   40 |       "exit_code": 127,
   41 |       "evidence_file": "rust-format.md"
   42 |     },
   43 |     {
   44 |       "name": "rust-domain",
   45 |       "command": [
   46 |         "cargo",
   47 |         "test",
   48 |         "--locked",
   49 |         "-p",
   50 |         "boreal-domain",
   51 |         "--test",
   52 |         "m02_status"
   53 |       ],
   54 |       "scope": "authored M02 evaluator tests",
   55 |       "status": "blocked_tool_unavailable",
   56 |       "exit_code": 127,
   57 |       "evidence_file": "rust-domain.md"
   58 |     },
   59 |     {
   60 |       "name": "rust-store",
   61 |       "command": [
   62 |         "cargo",
   63 |         "test",
   64 |         "--locked",
   65 |         "-p",
   66 |         "boreal-store",
   67 |         "--test",
   68 |         "m02_claim"
   69 |       ],
   70 |       "scope": "authored canonical claim/race tests",
   71 |       "status": "blocked_tool_unavailable",
   72 |       "exit_code": 127,
   73 |       "evidence_file": "rust-store.md"
   74 |     },
   75 |     {
   76 |       "name": "rust-application",
   77 |       "command": [
   78 |         "cargo",
   79 |         "test",
   80 |         "--locked",
   81 |         "-p",
   82 |         "boreal-application",
   83 |         "--test",
   84 |         "m02_status_authority"
   85 |       ],
   86 |       "scope": "authored durable actor/status tests",
   87 |       "status": "blocked_tool_unavailable",
   88 |       "exit_code": 127,
   89 |       "evidence_file": "rust-application.md"
   90 |     },
   91 |     {
   92 |       "name": "rust-protocol",
   93 |       "command": [
   94 |         "cargo",
   95 |         "test",
   96 |         "--locked",
   97 |         "-p",
   98 |         "boreal-protocol",
   99 |         "--test",
  100 |         "m02_status_wire"
  101 |       ],
  102 |       "scope": "authored additive DTO tests",
  103 |       "status": "blocked_tool_unavailable",
  104 |       "exit_code": 127,
  105 |       "evidence_file": "rust-protocol.md"
  106 |     },
  107 |     {
  108 |       "name": "rust-workspace",
  109 |       "command": [
  110 |         "cargo",
  111 |         "test",
  112 |         "--locked",
  113 |         "--workspace"
  114 |       ],
  115 |       "scope": "full locked workspace tests",
  116 |       "status": "blocked_tool_unavailable",
  117 |       "exit_code": 127,
  118 |       "evidence_file": "rust-workspace.md"
  119 |     },
  120 |     {
  121 |       "name": "rust-cli-build",
  122 |       "command": [
  123 |         "cargo",
  124 |         "build",
  125 |         "--locked",
  126 |         "-p",
  127 |         "boreal-cli"
  128 |       ],
  129 |       "scope": "CLI build, not release packaging",
  130 |       "status": "blocked_tool_unavailable",
  131 |       "exit_code": 127,
  132 |       "evidence_file": "rust-cli-build.md"
  133 |     },
  134 |     {
  135 |       "name": "tui-typecheck",
  136 |       "command": [
  137 |         "npm",
  138 |         "--prefix",
  139 |         "apps/tui",
  140 |         "run",
  141 |         "typecheck"
  142 |       ],
  143 |       "scope": "TypeScript compiler",
  144 |       "status": "passed",
  145 |       "exit_code": 0,
  146 |       "evidence_file": "tui-typecheck.md"
  147 |     },
  148 |     {
  149 |       "name": "tui-tests",
  150 |       "command": [
  151 |         "npm",
  152 |         "--prefix",
  153 |         "apps/tui",
  154 |         "test"
  155 |       ],
  156 |       "scope": "core suite + Node unit/presentation fixtures",
  157 |       "status": "passed",
  158 |       "exit_code": 0,
  159 |       "evidence_file": "tui-tests.md"
  160 |     },
  161 |     {
  162 |       "name": "installer-identity",
  163 |       "command": [
  164 |         "node",
  165 |         "scripts/build-installer.mjs",
  166 |         "--check"
  167 |       ],
  168 |       "scope": "generated wizard and embedded installer byte identity",
  169 |       "status": "passed",
  170 |       "exit_code": 0,
  171 |       "evidence_file": "installer-identity.md"
  172 |     },
  173 |     {
  174 |       "name": "shell-syntax",
  175 |       "command": [
  176 |         "sh",
  177 |         "-n",
  178 |         "install.sh"
  179 |       ],
  180 |       "scope": "shell parser only",
  181 |       "status": "passed",
  182 |       "exit_code": 0,
  183 |       "evidence_file": "shell-syntax.md"
  184 |     },
  185 |     {
  186 |       "name": "zip-js-syntax",
  187 |       "command": [
  188 |         "node",
  189 |         "--check",
  190 |         "create-zips.mjs"
  191 |       ],
  192 |       "scope": "JavaScript parser only",
  193 |       "status": "passed",
  194 |       "exit_code": 0,
  195 |       "evidence_file": "zip-js-syntax.md"
  196 |     },
  197 |     {
  198 |       "name": "wizard-js-syntax",
  199 |       "command": [
  200 |         "node",
  201 |         "--check",
  202 |         "apps/tui/installer/wizard.cjs"
  203 |       ],
  204 |       "scope": "JavaScript parser only",
  205 |       "status": "passed",
  206 |       "exit_code": 0,
  207 |       "evidence_file": "wizard-js-syntax.md"
  208 |     },
  209 |     {
  210 |       "name": "wizard-body-js-syntax",
  211 |       "command": [
  212 |         "node",
  213 |         "--check",
  214 |         "apps/tui/installer/wizard-body.cjs"
  215 |       ],
  216 |       "scope": "JavaScript parser only",
  217 |       "status": "passed",
  218 |       "exit_code": 0,
  219 |       "evidence_file": "wizard-body-js-syntax.md"
  220 |     },
  221 |     {
  222 |       "name": "premium",
  223 |       "command": [
  224 |         "python3",
  225 |         "scripts/validation/premium/validate_premium.py",
  226 |         "-v"
  227 |       ],
  228 |       "scope": "real PTYs and local fake release/controller fixtures, NOT Rust E2E",
  229 |       "status": "passed",
  230 |       "exit_code": 0,
  231 |       "evidence_file": "premium.md"
  232 |     },
  233 |     {
  234 |       "name": "responsive",
  235 |       "command": [
  236 |         "python3",
  237 |         "scripts/validation/premium/validate_responsive.py",
  238 |         "-v"
  239 |       ],
  240 |       "scope": "real PTYs and fake service fixtures, NOT Rust E2E",
  241 |       "status": "passed",
  242 |       "exit_code": 0,
  243 |       "evidence_file": "responsive.md"
  244 |     },
  245 |     {
  246 |       "name": "source-archive",
  247 |       "command": [
  248 |         "python3",
  249 |         "scripts/validation/m02/source_archive_test.py",
  250 |         "--exercise"
  251 |       ],
  252 |       "scope": "real root ZIP generator + isolated TUI rebuild; NOT release binary",
  253 |       "status": "passed",
  254 |       "exit_code": 0,
  255 |       "evidence_file": "source-archive.md"
  256 |     }
  257 |   ],
  258 |   "all_executable_checks_passed": false,
  259 |   "m02_acceptance": "not_certified",
  260 |   "release_decision": "do not ship",
  261 |   "independent_review": "not performed",
  262 |   "warning": "This runner does not certify sprint gates, migration parity, genuine service-backed lifecycle or supported release platforms."
  263 | }
````
