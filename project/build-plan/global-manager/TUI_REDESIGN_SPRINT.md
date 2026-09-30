# Global TUI redesign sprint — 2026-09-30

User dispatch: use Luna subagents to fix the audit and deliver a full global
project-management TUI. Read project/README.md, project/build-plan/README.md,
MASTER_PLAN.md, AGENT_HANDOFF.md, GLOBAL_MANAGER.md and TUI_AUDIT.md before
implementation. Preserve unrelated work in this shared dirty workspace.

## Disjoint vertical handoffs

- U1 model/layout: new `apps/global-tui/src/model.ts`, `view.ts`, and
  `tests/model-view.test.mjs`. Own GlobalController, scope/routes/selection,
  portfolio/inbox/todos/planning/archive/history/notes/linked views, adaptive
  navigation/work/inspector composition, true board column/card navigation,
  hierarchy/dependency display, freshness and visible selection at all sizes.
- U2 interaction: new `apps/global-tui/src/interaction.ts`, `forms.ts`,
  `tests/interaction.test.mjs`, `README.md` and `src/terminal/**`. Own input,
  full-screen and line interface, keyboard focus/palette/help, labeled forms,
  searchable pickers, multiline notes, editing/order/archive restore/relationships,
  contextual help and live polling with safe shutdown. Suitable low-level
  terminal primitives were copied from the project TUI as a reusable base;
  global layout and product interactions must be independently designed.
- U3 API/recovery: `apps/global-tui/src/client.ts`,
  `tests/client-recovery.test.mjs`, Rust global application/domain/store modules
  and focused tests, CLI global commands/service/registry targeted changes.
  Own complete uncertain-response freeze/readback, typed richer snapshot/history,
  unarchive and backend capability gaps, and generic CLI flag integration.
- Coordinator: `interface.ts` compatibility facade, `entrypoint.ts`, Node shims,
  old-test adaptation, installation/release/docs, final realistic terminal and
  service qualification. No agent edits the other lane's files.

## Shared TypeScript contract

`model.ts` exports GlobalController and Route. Keep the existing constructor,
snapshot/route/selected/projectId/searchQuery, refresh/mutate/resolveUnknownOperation,
projects/activeProject/statuses/items/rows/selectedRow/moveSelection/selectProject/
clampSelection APIs compatible. Add methods/state for richer navigation and
stable selection; U1 and U2 communicate additions directly before depending on
them. Model state may expose focus and inspector/tab/modal data for view to
render, but rendering never performs I/O. `view.ts` exports render(controller,
width=100,height=40):string. `interaction.ts` exports runInteractive,
runLineInterface, KeyTerminal. KeyTerminal onData takes string|Uint8Array so its
streaming key decoder preserves UTF-8 boundaries. `interface.ts` reexports these
APIs for existing tests and entrypoint. New routes include overview, projects,
board, list, todos, notes, workflow, links, planning, archive, history, inbox.

Service and authority contracts remain those in SPRINT.md. Support unarchive
for project/item/note through shared application rules, never UI-local state.
History should be meaningful human activity; source history remains retained.
Polling must coalesce, respect mutations/modal editing, indicate sample freshness,
preserve selection and never retry a write. A linked-workspace drill-down may
expose a safe handoff request to the coordinator; do not spawn arbitrary commands
from record text.

## Exit criteria

Every audit finding receives a tested disposition. Exercise Life/business,
50+ items, 8+ statuses, multiline notes, Unicode/paste/split input, nested
milestones/tasks, multiple links, restore/history/reorder, external updates,
conflicts and uncertain writes. Validate narrow and wide real terminal views.
Build the separate release assets, verify a real installed package and update
the user's installation. Do not stop at subagent implementation handoffs.
