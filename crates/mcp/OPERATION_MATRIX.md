# Boreal MCP operation matrix

This matrix compares the public Project and Global CLI/service routes in the
current checkout with the MCP adapter. A mapped tool is a typed MCP request
that calls the existing Boreal service. “Partial” means the tool covers a
bounded subset of the CLI route's filters or detail shape. Missing routes stay
default-deny; MCP has no generic CLI, SQL, path, or service-command dispatch.

## Project operations

| Public Project CLI/service route family | MCP mapping | Coverage and boundary |
| --- | --- | --- |
| `status`, `prime` | `project_status`; `project_agent_guide` | Status page and workflow guide are separate bounded reads; `prime`'s combined brief and filters are not reproduced. |
| `work show` | `project_work_show` | Exact work item read. |
| `work create`, `work edit` | `project_work_create`, `project_work_edit` | Typed writes use expected revision and durable operation ID. |
| `work claim` | `project_work_claim` | Calls the same atomic Boreal claim transaction; requires project, work, attempt, session, source/config identities, positive revision and operation ID. |
| `agent start`, `agent guide`, `agent next`, `agent resume`, `next` | `project_agent_start`, `project_agent_guide`, `project_agent_next`, `project_agent_resume` | Start/resume reuses Boreal's lifecycle service. Guided selectors are explicit Project reads. `work next` filters are not reproduced. |
| `work accept` | Partial via `project_agent_start` | The atomic start route performs Boreal's accept transition with claim/start. A standalone accept tool is absent. |
| `work heartbeat` / `agent heartbeat`; `work renew` / `agent renew`; `work release` / `agent release`; `work finish`; `agent finish --close` / `--release` | `project_attempt_heartbeat`, `project_attempt_renew`, `project_attempt_release`, `project_attempt_submit`, `project_finish_close` | Fenced transitions use existing attempt services. Submit is not acceptance or close; close requires its separate grant. |
| `work hold add` | `project_work_wait` | Typed reason code and expected revision. |
| `work rollup` | `project_work_rollup` | Newly mapped bounded service read for one explicit container. |
| `dep tree`, `dep cycles` | `project_dependency_graph` | Newly mapped canonical dependency tree or cycle diagnostics. |
| `session start`, `session show`, `session end` | `project_session_start`, `project_session_show`, `project_session_end` | All three use the existing session service. Start/end are writes under work-write. |
| `operation show` | `operation_status` | Durable operation readback for a supplied ID. |
| `source list`, `source search` | `project_source_list`, `project_source_search` | Search returns bounded excerpts and citation IDs; local origin strings and the catalog root path are removed from list/search results. |
| `memory search` | `project_memory_search` | Newly mapped typed read over published memory only; returns bounded excerpts, source citations and digests. |
| `review list`, `review show` | `project_review_list`, `project_review_show` | Read-only review records and bounded evidence metadata. |
| `work list`, `work ready`, `work recent-closed`, `work review-candidates`, `work parallel`; `work history`; `operation list`, `operation stats` | None | Existing service/feature operations have no typed MCP mapping yet. The client cannot invoke them through a generic feature command. |
| `dep add`, `dep remove` | None | Service routes exist, but no typed MCP mutation is currently mapped. |
| `work hold resolve`, `work dispatch set` | None as dedicated tools | Hold resolution needs an elevated operator grant. Dispatch fields can be edited through `project_work_edit`, but route-specific parity and discovery are absent. |
| `source add`, `source show`, `source verify`; `evidence add` | `project_evidence_add` only for `evidence add` | Source capture needs a host path and remains local. Full source records and verification are not exposed. Receipt import does not run a verifier. |
| `evidence run`, `gate policy publish` | None | Verifier execution and gate-policy publication are not exposed. |
| Review decisions, exceptions, dependency waivers, work reopen/cancel/retry/publish | None | These acceptance-changing routes need stronger role/grant and typed request contracts. |
| Cycle/sprint reads and mutations | None | Existing routes are file-backed/versioned CLI operations; no typed MCP contract is mapped. |
| Recovery, project migration/backup, maintenance, schema/doctor, workflow configuration, orchestration, worker pool, templates, split/labels, directives/acknowledgements, intake, summaries/handoffs, context/index, and memory draft/review/publish/readback/reconcile | None | These families remain unavailable in MCP pending typed, bounded service contracts and appropriate scopes. The local/operator routes are not proxied. |
| Project initialization, restore, dashboards, local service lifecycle, auth/key/grant/revoke, lock inspection, diagnostic log rotation | None | Host and machine administration stays local. |

## Global operations

| Public Global CLI/service route family | MCP mapping | Coverage and boundary |
| --- | --- | --- |
| `global project list`, `global todo/task/milestone/note list` | `global_page` collections `projects`, `items`, `notes` | Bounded Global read. Item `kind` and `management_project_id` filters are typed. Note bodies and project/item descriptions are redacted. |
| `global workflow status list`, `global relationship list`, note-link listing, status history | `global_page` collections `statuses`, `relationships`, `note_links`, `status_history` | Newly available bounded read collections. Association paths and imported snapshot history are not allowed collections. |
| `global history` | `global_history` | Newly mapped bounded activity read, optionally filtered by management project or item. |
| `global status`, `global snapshot` | Partial via `global_page` and `global_history` | No full snapshot tool; snapshot associations may contain filesystem paths. |
| `global project/todo/task/milestone/note show`; `global operation show` | None as exact-detail tools | Page/search views do not guarantee exact-ID detail semantics; operation results may contain arbitrary stored payloads. |
| `global linked show` / linked page and job status | None | Crosses into Project databases and can disclose configured workspace paths; requires independent explicit Project binding and Project-read authorization. |
| Global project/item/note/workflow/relationship mutations | None | The Global service mutation contract has no authenticated actor field. MCP must not create a parallel Global write lane. |
| `global bootstrap`, import/export, service run, dashboard, registry state changes/doctor | None | Storage, filesystem and service administration remains local operator work. |
| Global Daily, Inbox, Today/Later, Send/Intake | None | No public route exists for these canceled lanes; MCP does not invent one. |

## Claim and authorization evidence

`project_work_claim` is advertised only for a principal with the explicit
Project binding plus Project-read and work-write grants. The caller cannot
choose the Boreal actor: the authenticated policy supplies it, and the adapter
selects that actor's configured internal credential. Boreal checks eligibility
and revision in its claim transaction, allocates the attempt/fence there, and
records the durable operation. An exact replay returns the existing result; a
changed payload under the same operation ID conflicts. `operation_status`
reads back the durable ID after an uncertain response. The ignored real-daemon
journey drops a claim reply, reads back the same durable ID, retries the exact
claim without creating another attempt, rejects a changed payload, and checks
that a second principal cannot claim the already-claimed work.

The tool inventory is filtered by effective token scopes and configured
project bindings. Every Project write names its target Project and uses the
existing service route; no caller-supplied actor or MCP request ID is treated
as authorization or durable write identity.
