import type { ProjectRegistryView, WorkDashboardView } from "@boreal/ui-model";
import type { ReactNode } from "react";

import { Card, MetricCard, Notice } from "../foundation/index.js";
import { SprintWorkTable } from "../sprint/index.js";

export function AppShell({ sidebar, children }: { readonly sidebar: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="bw-app-shell">
      <aside className="bw-app-shell__sidebar">{sidebar}</aside>
      <main className="bw-app-shell__main">{children}</main>
    </div>
  );
}

export function GlobalOverviewMetrics({ view }: { readonly view: ProjectRegistryView }) {
  return (
    <div className="bw-global-metrics">
      <MetricCard label="Projects" value={view.summary.totalProjects} />
      <MetricCard label="Ready" value={view.summary.readyWorkCount} />
      <MetricCard label="Blocked" value={view.summary.blockedWorkCount} tone={view.summary.blockedWorkCount > 0 ? "warning" : "success"} />
      <MetricCard label="Reservations" value={view.summary.activeReservationCount} />
    </div>
  );
}

export function GlobalReadyQueue({ view }: { readonly view: WorkDashboardView }) {
  const ready = view.queues.find((queue) => queue.id === "ready");
  return (
    <Card title="Ready queue">
      {ready && ready.items.length > 0 ? <SprintWorkTable items={ready.items} /> : <Notice tone="success">No ready work.</Notice>}
    </Card>
  );
}

export interface SearchResultRow {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
}

export function GlobalSearchResults({ results }: { readonly results: readonly SearchResultRow[] }) {
  return (
    <Card title="Search results">
      {results.length > 0 ? (
        <ol className="bw-search-results">
          {results.map((result) => (
            <li key={result.id}>
              <strong>{result.title}</strong>
              {result.summary ? <p>{result.summary}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <Notice>No matches.</Notice>
      )}
    </Card>
  );
}

export function CommandPalette({ commands }: { readonly commands: readonly SearchResultRow[] }) {
  return (
    <section className="bw-command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <GlobalSearchResults results={commands} />
    </section>
  );
}
