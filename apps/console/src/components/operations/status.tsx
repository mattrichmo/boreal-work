import type { DashboardHealthView, LockDashboardView, SyncDashboardView } from "@boreal/ui-model";
import type { ReactNode } from "react";

import { Badge, Card, MetricCard, Notice } from "../foundation/index.js";
import { HealthFindingList } from "../entity/index.js";

export function DashboardHealthPanel({ view }: { readonly view: DashboardHealthView }) {
  return (
    <Card title={view.title}>
      <div className="bw-health-summary">
        <MetricCard label="Errors" value={view.summary.errors} tone={view.summary.errors > 0 ? "danger" : "success"} />
        <MetricCard label="Warnings" value={view.summary.warnings} tone={view.summary.warnings > 0 ? "warning" : "success"} />
        <MetricCard label="Fixable" value={view.summary.fixableActions} />
      </div>
      <HealthFindingList findings={view.findings} />
    </Card>
  );
}

export function SyncStatusPanel({ view }: { readonly view: SyncDashboardView }) {
  return (
    <Card title="Sync status" eyebrow={view.workspaceRoot}>
      <div className="bw-sync-grid">
        <MetricCard label="Vault" value={state(view.vaultOk)} tone={view.vaultOk ? "success" : "danger"} />
        <MetricCard label="Ledgers" value={state(view.ledgersOk)} tone={view.ledgersOk ? "success" : "danger"} />
        <MetricCard label="Search" value={state(view.searchIndexOk)} tone={view.searchIndexOk ? "success" : "danger"} />
        <MetricCard label="Git" value={state(view.gitOk)} tone={view.gitOk ? "success" : "danger"} />
      </div>
    </Card>
  );
}

export function LockStatusPanel({ view }: { readonly view: LockDashboardView }) {
  return (
    <Card title="Locks" eyebrow={view.workspaceRoot}>
      {view.locks.length > 0 ? (
        <ul className="bw-lock-list">
          {view.locks.map((lock) => (
            <li key={`${lock.domain}:${lock.path}`}>
              <Badge tone={lock.status === "clear" ? "success" : "warning"}>{lock.status}</Badge>
              <span>{lock.domain}</span>
              <code>{lock.path}</code>
            </li>
          ))}
        </ul>
      ) : (
        <Notice tone="success">No locks.</Notice>
      )}
    </Card>
  );
}

export interface EventStreamRow {
  readonly id: string;
  readonly type: string;
  readonly actor?: string;
  readonly at?: string;
}

export function EventStreamTable({ rows }: { readonly rows: readonly EventStreamRow[] }) {
  return (
    <table className="bw-event-table">
      <thead>
        <tr>
          <th>Event</th>
          <th>Actor</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.type}</td>
            <td>{row.actor ?? "system"}</td>
            <td>{row.at ?? "unknown"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DiffViewer({ before, after }: { readonly before: string; readonly after: string }) {
  return (
    <div className="bw-diff-viewer">
      <pre>{before}</pre>
      <pre>{after}</pre>
    </div>
  );
}

export function InspectorPanel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <Card title={title}>{children}</Card>;
}

function state(ok: boolean): string {
  return ok ? "ok" : "needs attention";
}
