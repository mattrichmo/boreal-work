# Boreal MCP operation matrix

This matrix is based on `bwrk commands --json` from the implementation
checkout's 320-entry public command registry. The adapter exposes typed MCP
tools over Boreal services; it does not proxy arbitrary CLI commands, SQL,
paths, shell commands, or service payloads. The explicit inventory below
separates supported mappings from routes deliberately held for an existing
owner, routes without a suitable service contract, and routes not yet mapped
by the MCP adapter.

## Implemented MCP tools

| MCP tool | Registry route or service contract | Coverage and boundary |
| --- | --- | --- |
| `boreal_capabilities` | Discovery | Reports only the authenticated principal's configured Global and Project allowlists and grants. |
| `global_page` | `global project list`, `global todo list`, `global task list`, `global milestone list`, `global note list`, `global workflow status list`, `global relationship list`; note-link and status-history list services | Bounded path-free projection for projects, items, notes, statuses, relationships, note links and status history. It does not expose associations or imported snapshots. Item kind and management-project filters are typed. |
| `global_page`, `global_history` | Partial `global status`, `global snapshot` | Their bounded rows and activity are available, but MCP does not return the complete status summary or a full snapshot. Snapshot associations and imported history can contain host paths or unbounded payloads. |
| `global_history` | `global history` | Bounded activity page with optional management-project or item filter. |
| `project_status` | `status` | Bounded status page for one explicitly named Project. |
| `project_work_show` | `work show` | Exact work item read. |
| `project_work_create`, `project_work_edit` | `work create`, `work edit` | Typed writes with expected revision and durable operation ID. |
| `project_work_claim` | `work claim` | Existing atomic claim transaction. Requires explicit Project binding, actor-specific service credential, work/attempt/session/source/config identities, expected revision and operation ID. |
| `project_agent_start` | `agent start`, partial `work accept` | Existing claim/start service. The adapter does not expose a standalone accept. |
| `project_agent_guide`, `project_agent_next`, `project_agent_resume` | `agent guide`, `agent next`, `agent resume`, `next`; partial `prime` | Typed workflow reads and lifecycle resume for the explicit Project. This is not the full combined `prime` result or the `work next` filter surface. |
| `project_work_rollup` | `work rollup` | Existing bounded container rollup. |
| `project_work_wait`, `project_work_checkpoint` | `work hold add`, `work checkpoint` | Typed wait and checkpoint services; wait requires a reason and expected revision. |
| `project_dependency_graph` | `dep tree`, `dep cycles` | Canonical bounded dependency tree or cycle diagnostics. |
| `project_session_start`, `project_session_show`, `project_session_end` | `session start`, `session show`, `session end` | Existing session service, scoped to the explicitly named Project. |
| `project_attempt_heartbeat`, `project_attempt_renew`, `project_attempt_release`, `project_attempt_submit`, `project_finish_close` | `work heartbeat`, `work renew`, `work release`, `work finish`; `agent heartbeat`, `agent renew`, `agent release`, `agent finish` | Fenced lifecycle services. Submit does not accept or close. Close has its separate `boreal:project:finish-close` grant. |
| `operation_status` | `operation show` | Reads one supplied durable operation ID for reconciliation after an uncertain reply. |
| `project_source_list`, `project_source_search` | `source list`, `source search` | Bounded metadata and excerpts; host catalog root and origin paths are removed. |
| `project_memory_search` | `memory search` | Search over published memory only, returning bounded excerpts, citation IDs and digests. |
| `project_review_list`, `project_review_show` | `review list`, `review show` | Bounded review data and evidence metadata. |
| `project_evidence_add` | `evidence add` | Adds a typed receipt/reference. It does not run a verifier or claim that the artifact was produced by a trusted verifier. |

Coverage is intentionally partial where stated. Every Project request names a
Project ID. Authentication maps to a server-side Boreal actor, allowlist and
grant set; a caller-supplied actor ID is never treated as proof of identity.
Project writes use Boreal's expected-revision and durable operation
identities, separate from MCP request IDs.

## Unmapped service-backed routes

The following entries exist in the public command registry and have a Boreal
service route, but have no typed MCP route in this release. For all entries in
this section the reason is **unfinished adapter implementation**: no typed
request schema, grant mapping and bounded result projection have been completed
for MCP. Their presence in a CLI/service registry does not make them callable
through MCP.

| Family | Exact registry routes not mapped |
| --- | --- |
| Selection, work history and operation pages | `work list`, `work ready`, `work recent-closed`, `work review-candidates`, `work parallel`, `work next`, `work history`, `operation list`, `operation stats`, `agent status`, `start`, `done`, `run`, `events`, `daemon status` |
| Dependencies and work administration | `dep add`, `dep remove`, `dep waive`, `work hold resolve`, `work dispatch set`, `work labels set`, `work reopen`, `work cancel`, `work retry`, `work publish`, `work split`, `work split show` |
| Reviews and decisions | `review decide`, `review approve`, `review reject`, `review return`, `review revoke`, `decision create`, `decision supersede`, `decision list`, `decision show`, `exception grant`, `exception revoke` |
| Cycles | `cycle current`, `cycle list`, `cycle board`, `cycle report`, `cycle create`, `cycle activate`, `cycle close`, `cycle cancel`, `cycle assign`, `cycle commit`, `cycle remove`, `cycle carry-over`, `cycle map-legacy` |
| Sprints | `sprint show`, `sprint status`, `sprint metrics`, `sprint launch`, `sprint current`, `sprint list`, `sprint board`, `sprint report`, `sprint create`, `sprint activate`, `sprint close`, `sprint cancel`, `sprint assign`, `sprint commit`, `sprint remove`, `sprint carry-over`, `sprint map-legacy` |
| Knowledge and search | `claim create`, `claim review`, `claim list`, `claim show`, `knowledge claim create`, `knowledge claim review`, `knowledge claim list`, `knowledge claim show`, `context show`, `context search`, `context rebuild`, `knowledge context show`, `knowledge context search`, `knowledge context rebuild`, `search query`, `search index` |
| Memory authoring and readback | `memory reconcile`, `memory draft`, `memory review`, `memory publish`, `memory show`, `memory readback` |
| Directives | `directives list`, `directives show`, `directives compile`, `directives render`, `directives explain`, `directives ack create`, `directives ack list`, `directives ack show` |
| Templates | `template list`, `template show`, `template validate`, `template run`, `template capture`, `templates list`, `templates show`, `templates validate`, `templates run`, `templates capture` |
| Orchestration and workers | `orchestrate pool configure`, `orchestrate pool list`, `orchestrate pool show`, `orchestrate pool remove`, `orchestrate harness configure`, `orchestrate harness list`, `orchestrate harness show`, `orchestrate harness remove`, `orchestrate daemon status`, `orchestrate start`, `orchestrate list`, `orchestrate show`, `orchestrate tick`, `orchestrate progress`, `orchestrate nudge`, `orchestrate pause`, `orchestrate resume`, `orchestrate cancel`, `orchestrate fail`, `orchestrate events`, `orchestrate complete`, `orchestration start`, `orchestration list`, `orchestration show`, `orchestration events`, `orchestration progress`, `orchestration nudge`, `orchestration tick`, `orchestration pause`, `orchestration resume`, `orchestration cancel`, `orchestration complete`, `orchestration fail`, `orchestration daemon status` |
| Summaries and handoffs | `summary list`, `summary show`, `summary render`, `summary compose`, `summary create`, `summary backfill`, `summary backfill show`, `handoff compose`, `handoff show` |
| Intake disposition and promotion | `intake promote`, `intake disposition` |
| Workflow configuration | `workflows list`, `workflows show` |
| Diagnostics and schema | `schema validate`, `doctor`, `gate policy publish`, `evidence run` |

The service-backed Project gap above includes `reservation list`,
`duplicate scan`, and `agent status` explicitly. Existing MCP coverage of
`operation show` is only a single-ID readback, not `operation list` or
`operation stats`.

## Routes held for existing owners or missing contracts

These routes are not categorized as unfinished MCP handlers. The stated
boundary is the reason they stay out of the current MCP tool list.

| Exact routes or route family | Reason |
| --- | --- |
| `backup`, `migration dry-run`, `migration verify`, `migration apply`, `recovery list`, `recovery resolve`, `recovery recover`, `maintenance show`, `snapshot list`, `snapshot show` | Recovery and install ownership remains with the recovery lane. The adapter does not create a parallel backup, migration, restore or recovery mechanism. |
| `merge show`, `merge plan`, `merge apply`, `compact show`, `compact analyze`, `compact apply`, `export json`, `export markdown` | These routes consume or write host-local files. MCP has no safe stable-artifact service contract for arbitrary path input/output. |
| `memory init`, `vault init` | Host-local storage initialization remains an operator action. |
| `global bootstrap`, `global import`, `global export`, `global service run`, `global dashboard`, `dashboard global`, `global next` | Global storage/service administration and path-dependent portfolio next-work selection remain local operator actions. `global next` can return a linked workspace path. |
| `global project add`, `global project edit`, `global project archive`, `global project unarchive`, `global project attach-folder`, `global project link`, `global project unlink`; `global todo add`, `global todo edit`, `global todo move`, `global todo reorder`, `global todo complete`, `global todo reopen`, `global todo archive`, `global todo unarchive`; `global task add`, `global task edit`, `global task archive`, `global task unarchive`; `global subtask add`; `global milestone add`, `global milestone edit`, `global milestone archive`, `global milestone unarchive`; `global workflow status add`, `global workflow status edit`; `global relationship add`, `global relationship remove`; `global note add`, `global note edit`, `global note archive`, `global note unarchive` | The existing Global mutation request contract has no authenticated actor. MCP will not create a second mutation mechanism or infer authority from a project name. A future actor-aware Global service contract is required. This also keeps Global Send and Intake separate from Project execution. |
| `global project show`, `global todo show`, `global task show`, `global milestone show`, `global note show` | Core exact-show services exist, but a typed MCP exact-ID projection and contract-level response bound have not been implemented. `global_page` does not claim exact-show parity. |
| `global linked show` | Crosses from management records into Project workspaces. It requires a separately authorized explicit execution-workspace binding and a path-free Project response contract; the current linked view contains host-path concerns. |
| `global operation show` | Stored Global operation payloads are not constrained to a path-free typed result, so exposing an arbitrary stored result is not safe. |
| `source add`, `source show`, `source verify` | Source capture takes a host-local input path, while exact source reads and verification lack the MCP-owned bounded content/artifact contract. Search and list are available through their existing bounded services. |
| `intake note`, `intake discovery`, `intake question`, `intake revisit`, `intake capture`, `intake bucket`, `intake show`, `intake list` | These are CLI-local routes without an actor-aware Project intake service contract. The MCP lane does not invent it. |
| `gate`, `gate closeout` | These CLI-local routes do not yet have the existing typed service contract needed for MCP. `evidence add` does not imply gate evaluation or acceptance. |
| Global Daily, Inbox, Today/Later and Send | These lanes are explicitly held. No public route or service contract is added by this MCP implementation. |

## Local operator commands and MCP entry points

The following public routes are not remote data tools; they require local
operator access or mutate the host configuration. They remain local:

`install status`, `integrations`, `integrations status`, `integrations add`,
`doctor skills`, `docs check`, `registry set-state`, `registry pause`,
`registry resume`, `registry doctor`, `lock inspect`, `storage rotate-log`,
`daemon run`, `orchestrate daemon run`, `auth show`, `auth key`,
`auth bootstrap`, `auth grant`, `auth revoke`, `completion`,
`commands compatibility`, `commands`, `help`, `version`, `init`, `setup`,
`install`, `update`, `upgrade`, `restore`, `dashboard`, `view`.

The root CLI MCP commands are operator entry points rather than MCP tools:

| Command | Behavior |
| --- | --- |
| `bwrk mcp start --config FILE` | Loads and validates the private config, then runs configured authenticated Streamable HTTP in the foreground. `--transport` and `--profile` are rejected. |
| `bwrk mcp serve --config FILE --transport stdio --profile NAME` | Loads the selected local allowlist profile and serves stdio. MCP frames use stdout; logs/errors use stderr. |
| `bwrk mcp serve --config FILE --transport http` | Runs configured authenticated Streamable HTTP in the foreground. A profile is rejected. |
| `bwrk mcp status --config FILE` | Validates config, reports configured scopes/project bindings and local Boreal socket reachability without returning credentials or socket paths. It does not check OAuth-provider reachability. |

HTTP defaults to loopback in examples. A non-loopback bind requires
configured OAuth introspection and TLS; no unauthenticated remote listener,
provider account, credential, certificate, tunnel, firewall rule or
persistent service was created by this implementation.

## Authorization and concurrency evidence

The tool inventory is filtered by effective token scopes and configured
Project bindings. Evidence-write and finish-close require Project read plus
their separate grants. The server resolves the Boreal actor from the
authenticated policy and uses that actor's configured internal Project
credential; OAuth bearer tokens are not forwarded to Boreal.

Project writes pass through the existing service, expected-revision checks and
durable operation identities. A lost response is reconciled with
`operation_status` using the original operation ID; MCP request IDs are not
write identities. The real-daemon ignored journey exercises claim replay and
changed-payload conflict using synthetic local service state and credentials.

## Existing core lifecycle issue found during review

The current `finish_close` service can leave its durable parent operation in
`Busy` if receipt admission succeeds and `prepare_finish` then fails (for
example, an attempt lease expires in that interval). A retry can replay the
receipt and reproduce the failure without writing the parent result operation.
This is in the existing Project lifecycle service, outside the MCP-owned
adapter contract and another lane's core ownership. `operation_status` reports
the pending outcome, but MCP cannot resolve it. The service owner must define
and implement terminal failure/reconciliation behavior before claiming this
edge is fully recovered; this MCP change does not alter that contract.
