import { createElement } from "../apps/tui/node_modules/react/index.js";
import { renderToString } from "../apps/tui/node_modules/ink/build/index.js";
import { buildSprintBoardView, type WorkItemView } from "../packages/ui-model/src/index.js";
import { KeyHints, TopBar } from "../apps/tui/src/ui.js";
import { SprintBoardRoute } from "../apps/tui/src/routes/sprint-board.js";

const width = 100;
const height = 30;
const work = (id: string, title: string, status: WorkItemView["status"], priority: WorkItemView["priority"]): WorkItemView => ({
  id, title, kind: "task", status, priority, labels: ["runtime"], dependencyIds: [], activeBlockerIds: [], blockedBy: [], evidenceCount: 1, verificationCount: 0, requiredCloseoutGates: []
});
const sprint: WorkItemView = { ...work("sprint-demo", "Dashboard cleanup sprint", "in_progress", "high"), kind: "sprint" };
const items = [
  work("task-1", "Define dashboard information hierarchy", "verified", "high"),
  work("task-2", "Implement dependency aware sprint scope", "in_progress", "high"),
  work("task-3", "Add bounded terminal rendering", "ready", "normal"),
  work("task-4", "Review refresh and stale states", "blocked", "normal"),
  work("task-5", "Document operator keyboard flow", "needs_verification", "normal"),
  work("task-6", "Capture final visual smoke evidence", "draft", "low")
];
const board = buildSprintBoardView({ sprint, work: items.map((item) => item.status === "blocked" ? { ...item, activeBlockerIds: ["task-6"] } : item) });
const body = { sprints: [{ view: sprint, scopeCount: items.length, active: true }], activeSprintId: sprint.id, selectedSprintId: sprint.id, board, assignedWorkIds: ["task-1", "task-2", "task-3", "task-4"], dependencyWorkIds: ["task-5", "task-6"] };

const rendered = [
  renderToString(createElement(TopBar, { crumbs: ["repo", "Dashboard cleanup sprint"], right: "Auto 30s", width }), { columns: width, rows: height }),
  renderToString(createElement(SprintBoardRoute, { body, cursor: 1, width: width - 2, height: height - 4 }), { columns: width - 2, rows: height - 4 }),
  renderToString(createElement(KeyHints, { hints: [{ keys: "↑↓/jk", label: "move" }, { keys: "⏎", label: "open" }, { keys: "f", label: "view" }, { keys: "r", label: "refresh" }, { keys: "?", label: "help" }], width }), { columns: width, rows: height })
].join("\n");
const clean = rendered.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "");
const rows = clean.split(/\r?\n/).slice(0, height);
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const lineHeight = 18;
const textRows = rows.map((row, index) => {
  const selected = row.includes("▸");
  return `<text x="18" y="${30 + index * lineHeight}" class="${selected ? "selected" : ""}">${escape(row)}</text>`;
}).join("");
process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="560" viewBox="0 0 1200 560"><rect width="1200" height="560" fill="#0c100d"/><style>text{font:16px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#c0cec5;white-space:pre}.selected{fill:#82e69a;font-weight:700}</style>${textRows}</svg>\n`);
