# R-COMMAND-REGISTRY — crates/cli/src/command_registry.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/cli/src/command_registry.rs:L1–L260`  
**File SHA-256:** `9e49764f66aebe72dc54690e30884f640260cbb168e554679a5d66479cd9693a`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Authoritative public capability/command registry; one owner integrates registration and schema identity edits.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,260p' 'crates/cli/src/command_registry.rs'
```

## Exact baseline excerpt

````text
    1 | //! The executable public command registry.
    2 | //!
    3 | //! This is deliberately smaller than the planning catalog in
    4 | //! `project/spec/cli-contract.json`: a command is listed as available only
    5 | //! when this binary has a real adapter for it. Planned work is returned as a
    6 | //! typed gap so agents can discover the boundary without being handed an
    7 | //! argv recipe that cannot work.
    8 | 
    9 | use super::*;
   10 | 
   11 | pub(crate) const REGISTRY_ID: &str = "boreal.cli.registry.v1";
   12 | 
   13 | #[derive(Clone, Copy)]
   14 | struct CommandSpec {
   15 |     path: &'static str,
   16 |     syntax: &'static str,
   17 |     action: &'static str,
   18 |     output: &'static str,
   19 |     direct: bool,
   20 |     service: bool,
   21 |     summary: &'static str,
   22 | }
   23 | 
   24 | #[derive(Clone, Copy)]
   25 | struct GapSpec {
   26 |     path: &'static str,
   27 |     code: &'static str,
   28 |     summary: &'static str,
   29 |     owner: &'static str,
   30 |     scope: &'static str,
   31 | }
   32 | 
   33 | // Keep this list close to the dispatch boundary. The registry is a product
   34 | // contract, not a copy of the aspirational command-plan document.
   35 | const COMMANDS: &[CommandSpec] = &[
   36 |     CommandSpec {
   37 |         path: "commands",
   38 |         syntax: "bwrk commands [PATH] [--json]",
   39 |         action: "read",
   40 |         output: "command_registry",
   41 |         direct: true,
   42 |         service: false,
   43 |         summary: "discover executable routes and their transport support",
   44 |     },
   45 |     CommandSpec {
   46 |         path: "help",
   47 |         syntax: "bwrk help [PATH]",
   48 |         action: "read",
   49 |         output: "help",
   50 |         direct: true,
   51 |         service: false,
   52 |         summary: "show the same registry-backed command help",
   53 |     },
   54 |     CommandSpec {
   55 |         path: "version",
   56 |         syntax: "bwrk version [--json]",
   57 |         action: "read",
   58 |         output: "version",
   59 |         direct: true,
   60 |         service: false,
   61 |         summary: "show binary, protocol, schema, and registry identity",
   62 |     },
   63 |     CommandSpec {
   64 |         path: "init",
   65 |         syntax: "bwrk init [PROJECT] [--interactive|--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]",
   66 |         action: "mutate",
   67 |         output: "project",
   68 |         direct: true,
   69 |         service: true,
   70 |         summary: "initialize and scaffold a project; prompts for agent skill targets in a terminal",
   71 |     },
   72 |     CommandSpec {
   73 |         path: "setup",
   74 |         syntax: "bwrk setup [PROJECT] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]",
   75 |         action: "mutate",
   76 |         output: "project_setup",
   77 |         direct: true,
   78 |         service: false,
   79 |         summary: "recommended project setup alias for init",
   80 |     },
   81 |     CommandSpec {
   82 |         path: "install",
   83 |         syntax: "bwrk install [PROJECT] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]",
   84 |         action: "mutate",
   85 |         output: "project_setup",
   86 |         direct: true,
   87 |         service: false,
   88 |         summary: "compatibility alias for project setup",
   89 |     },
   90 |     CommandSpec {
   91 |         path: "update",
   92 |         syntax: "bwrk update [--json]",
   93 |         action: "mutate",
   94 |         output: "machine_update",
   95 |         direct: true,
   96 |         service: false,
   97 |         summary: "update a release-installed bwrk binary and its packaged TUI",
   98 |     },
   99 |     CommandSpec {
  100 |         path: "upgrade",
  101 |         syntax: "bwrk upgrade --machine [--json]",
  102 |         action: "mutate",
  103 |         output: "machine_update",
  104 |         direct: true,
  105 |         service: false,
  106 |         summary: "v1-compatible alias for the machine update operation",
  107 |     },
  108 |     CommandSpec {
  109 |         path: "status",
  110 |         syntax: "bwrk status PROJECT [--limit N] [--offset N] [--json]",
  111 |         action: "read",
  112 |         output: "status",
  113 |         direct: true,
  114 |         service: true,
  115 |         summary: "read the revisioned derived project status",
  116 |     },
  117 |     CommandSpec {
  118 |         path: "prime",
  119 |         syntax: "bwrk prime PROJECT [--limit N] [--offset N] [--json]",
  120 |         action: "read",
  121 |         output: "status",
  122 |         direct: true,
  123 |         service: true,
  124 |         summary: "status compatibility alias",
  125 |     },
  126 |     CommandSpec {
  127 |         path: "dashboard",
  128 |         syntax: "bwrk dashboard [PROJECT] [--project PROJECT] [--db PATH]",
  129 |         action: "read",
  130 |         output: "dashboard",
  131 |         direct: true,
  132 |         service: false,
  133 |         summary: "launch the managed one-terminal dashboard",
  134 |     },
  135 |     CommandSpec {
  136 |         path: "view",
  137 |         syntax: "bwrk view [PROJECT] [--project PROJECT] [--db PATH]",
  138 |         action: "read",
  139 |         output: "dashboard",
  140 |         direct: true,
  141 |         service: false,
  142 |         summary: "dashboard compatibility alias",
  143 |     },
  144 |     CommandSpec {
  145 |         path: "work list",
  146 |         syntax: "bwrk work list PROJECT [--limit N] [--offset N]",
  147 |         action: "read",
  148 |         output: "work_list",
  149 |         direct: true,
  150 |         service: false,
  151 |         summary: "list work with bounded pagination",
  152 |     },
  153 |     CommandSpec {
  154 |         path: "work show",
  155 |         syntax: "bwrk work show PROJECT WORK_ID",
  156 |         action: "read",
  157 |         output: "work",
  158 |         direct: true,
  159 |         service: true,
  160 |         summary: "read one exact work item",
  161 |     },
  162 |     CommandSpec {
  163 |         path: "work create",
  164 |         syntax: "bwrk work create PROJECT WORK_ID TITLE [--kind milestone|sprint|task] [--parent WORK_ID] [--priority N] [--description TEXT] [--dispatch automatic|operator_only|paused] [--hold CODE]",
  165 |         action: "mutate",
  166 |         output: "work",
  167 |         direct: true,
  168 |         service: true,
  169 |         summary: "create typed planning or executable work",
  170 |     },
  171 |     CommandSpec {
  172 |         path: "work edit",
  173 |         syntax: "bwrk work edit PROJECT WORK_ID [--title TEXT] [--description TEXT] [--parent WORK_ID] [--priority N] [--dispatch automatic|operator_only|paused] --expected-revision N",
  174 |         action: "mutate",
  175 |         output: "work",
  176 |         direct: true,
  177 |         service: true,
  178 |         summary: "edit planning fields under an expected project revision",
  179 |     },
  180 |     CommandSpec {
  181 |         path: "dep add",
  182 |         syntax: "bwrk dep add PROJECT PREREQUISITE_ID DEPENDENT_ID [--expected-revision N]",
  183 |         action: "mutate",
  184 |         output: "dependency",
  185 |         direct: true,
  186 |         service: true,
  187 |         summary: "add a close-only dependency with cycle protection",
  188 |     },
  189 |     CommandSpec {
  190 |         path: "dep remove",
  191 |         syntax: "bwrk dep remove PROJECT PREREQUISITE_ID DEPENDENT_ID --expected-revision N",
  192 |         action: "mutate",
  193 |         output: "dependency",
  194 |         direct: true,
  195 |         service: true,
  196 |         summary: "remove one dependency under an expected project revision",
  197 |     },
  198 |     CommandSpec {
  199 |         path: "dep tree",
  200 |         syntax: "bwrk dep tree PROJECT",
  201 |         action: "read",
  202 |         output: "dependency_graph",
  203 |         direct: true,
  204 |         service: true,
  205 |         summary: "read the canonical dependency graph and cycle diagnostics",
  206 |     },
  207 |     CommandSpec {
  208 |         path: "dep cycles",
  209 |         syntax: "bwrk dep cycles PROJECT",
  210 |         action: "read",
  211 |         output: "dependency_graph",
  212 |         direct: true,
  213 |         service: true,
  214 |         summary: "report dependency cycles found in the project snapshot",
  215 |     },
  216 |     CommandSpec {
  217 |         path: "work claim",
  218 |         syntax: "bwrk work claim PROJECT WORK_ID [--session ID] [--lease-ttl DURATION]",
  219 |         action: "mutate",
  220 |         output: "attempt",
  221 |         direct: true,
  222 |         service: true,
  223 |         summary: "atomically claim one work item",
  224 |     },
  225 |     CommandSpec {
  226 |         path: "work accept",
  227 |         syntax: "bwrk work accept PROJECT WORK_ID --attempt ID --fence N",
  228 |         action: "mutate",
  229 |         output: "attempt",
  230 |         direct: true,
  231 |         service: true,
  232 |         summary: "acknowledge a claimed attempt",
  233 |     },
  234 |     CommandSpec {
  235 |         path: "work heartbeat",
  236 |         syntax: "bwrk work heartbeat PROJECT WORK_ID --attempt ID --fence N",
  237 |         action: "mutate",
  238 |         output: "attempt",
  239 |         direct: true,
  240 |         service: true,
  241 |         summary: "record liveness without extending the hard deadline",
  242 |     },
  243 |     CommandSpec {
  244 |         path: "work renew",
  245 |         syntax: "bwrk work renew PROJECT WORK_ID --attempt ID --fence N [--lease-ttl DURATION]",
  246 |         action: "mutate",
  247 |         output: "attempt",
  248 |         direct: true,
  249 |         service: true,
  250 |         summary: "renew only the bounded renewable lease",
  251 |     },
  252 |     CommandSpec {
  253 |         path: "work release",
  254 |         syntax: "bwrk work release PROJECT WORK_ID --attempt ID --fence N [--reason CODE]",
  255 |         action: "mutate",
  256 |         output: "attempt",
  257 |         direct: true,
  258 |         service: true,
  259 |         summary: "release the current attempt while retaining history",
  260 |     },
````
