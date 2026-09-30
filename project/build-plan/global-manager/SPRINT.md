# Global manager implementation sprint — 2026-09-30

User-authorized extension to the existing production baseline; preserve existing
uncommitted work. Read project/README.md, project/build-plan/README.md,
MASTER_PLAN.md, AGENT_HANDOFF.md and project/GLOBAL_MANAGER.md. The legacy
v1/docs/product/GLOBAL_MANAGER_DESIGN.md is read-only behavioral reference.

## Vertical handoffs and exclusive writes

G1 — Luna backend: crates/domain/src/global_manager.rs and module export;
crates/store/src/global_manager.rs and module export;
crates/application/src/global_manager.rs and module export; new global backend
tests. Own independent schema, transactional revisions/audit/idempotency,
configurable statuses/categories, hierarchy/dependencies, project/folder links,
notes, snapshot, and backup/export/import. Existing unfinished global files
must be examined and corrected; do not ship their non-atomic writes.

G2 — Luna adapters: crates/cli/src/global_commands.rs, new global_service.rs,
new global_dashboard.rs, targeted main.rs/command_registry.rs wiring and new
CLI global tests; crates/protocol/src/global_manager.rs and its module export.
Own cwd-independent global resolution, parser/catalog,
CLI use cases through application, versioned Unix service and managed dashboard.
Do not edit existing project service or dashboard modules unless unavoidable.

G3 — Luna global TUI: apps/global-tui/** only. Own actual separate full-screen
and line UI, service transport, project/board/list/notes workflows and tests.
No SQL, CLI refresh subprocess or legacy imports.

Coordinator: integration fixes after owners finish, installation/release
packaging/docs, end-to-end acceptance and regression checks. Do not touch
canonical live state or overwrite existing project bindings. Tests isolate
global state using BOREAL_GLOBAL_ROOT.

## Shared boundary

GlobalManagerApplication::open(path) and execute(command: &str,
payload: &serde_json::Value, operation: &str) -> Result<serde_json::Value,
GlobalManagerError>. revision() -> Result<u64, ...> retained. Command strings
are space-separated logical paths without global prefix, e.g. project add,
todo add, workflow status add, snapshot, export, import. Payload uses snake_case;
IDs are id/project_id/item_id/status_id as appropriate. snapshot returns
projects/items/notes/statuses/relationships/associations, revision, schema_version.
Every mutation must atomically persist changes, revision and audit; replaying
an operation with identical request returns its prior result, changed input
conflicts. Optional expected_revision rejects stale mutations.

Service: reuse existing framed outer request {request_id,payload}; inner
{api_version:"2",schema_version:"boreal.global.request.v1",operation_id,
command,payload}. Response outer {request_id,payload:<standard v2 Envelope>};
envelope data is execute result, schema_version boreal.protocol.envelope.v1.
TUI transport validates outer/inner correlation and versions; reads snapshot,
uses same application commands for mutations, never retries unknown mutations.

Dashboard: bwrk dashboard global [--json] selects global exclusively; JSON is
snapshot, interactive launches global service and global TUI. bwrk global
service run --socket PATH supports standalone tests. No user init prerequisite.

## Acceptance

Fresh isolated bootstrap; folderless Life plus structured business project;
custom statuses and semantic completion/cancellation; hierarchy/dependency
cycle rejection; CLI/service/TUI parity; revision conflicts and operation replay;
linked existing project identity and genuine service progress with outages;
install/reinstall preservation; separate release assets; backup round-trip;
local project dashboard unchanged. Record remaining limits honestly.
