import type { SprintBoardView, WorkDashboardView, WorkItemView } from "@boreal/ui-model";

import { Badge, Card, MetricCard, Notice } from "../foundation/index.js";

export function SprintHeader({ view }: { readonly view: SprintBoardView }) {
  return (
    <header className="bw-sprint-header">
      <div>
        <Badge tone="accent">Sprint</Badge>
        <h1>{view.sprint.title}</h1>
      </div>
      <div className="bw-sprint-header__metrics">
        <MetricCard label="Tasks" value={view.summary.taskCount} />
        <MetricCard label="Blocked" value={view.summary.blocked} tone={view.summary.blocked > 0 ? "warning" : "success"} />
        <MetricCard label="Closed" value={view.summary.closed} />
      </div>
    </header>
  );
}

export function SprintKanbanCard({ item }: { readonly item: WorkItemView }) {
  return (
    <article className="bw-kanban-card">
      <div className="bw-kanban-card__title">{item.title}</div>
      <div className="bw-kanban-card__meta">
        <Badge>{item.priority}</Badge>
        <Badge tone={item.activeBlockerIds.length > 0 ? "warning" : "neutral"}>{item.status}</Badge>
      </div>
    </article>
  );
}

export function SprintKanbanBoard({ view }: { readonly view: SprintBoardView }) {
  return (
    <section className="bw-kanban" aria-label={`${view.sprint.title} board`}>
      {view.lanes.map((lane) => (
        <div key={lane.id} className="bw-kanban__column">
          <div className="bw-kanban__column-title">
            <span>{lane.title}</span>
            <Badge>{lane.count}</Badge>
          </div>
          {lane.items.length > 0 ? lane.items.map((item) => <SprintKanbanCard key={item.id} item={item} />) : <Notice>No work.</Notice>}
        </div>
      ))}
    </section>
  );
}

export function SprintWorkTable({ items }: { readonly items: readonly WorkItemView[] }) {
  return (
    <table className="bw-work-table">
      <thead>
        <tr>
          <th>Work</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.title}</td>
            <td>{item.status}</td>
            <td>{item.priority}</td>
            <td>{item.evidenceCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SprintProgressPanel({ view }: { readonly view: WorkDashboardView }) {
  return (
    <Card title="Progress">
      <div className="bw-progress-grid">
        <MetricCard label="Ready" value={view.summary.ready} />
        <MetricCard label="In progress" value={view.summary.inProgress} />
        <MetricCard label="Needs verification" value={view.summary.needsVerification} />
        <MetricCard label="Closed" value={view.summary.closed} />
      </div>
    </Card>
  );
}
