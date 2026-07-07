import type {
  GlobalActivityActorKind,
  GlobalActivityView,
  GlobalBoardColumnId,
  GlobalBoardRailId,
  GlobalBoardView,
  GlobalHealthAction,
  GlobalHealthCategory,
  GlobalHealthView,
  GlobalSearchView,
  GlobalSettingsView,
  GlobalWorkQueueId,
  GlobalWorkQueuesView,
  ProjectRegistryView,
  WorkDashboardView,
  WorkItemView
} from "@boreal/ui-model";
import type { ReactNode } from "react";

import { Button, Card, FieldLabel, MetricCard, Notice, TextInput } from "../foundation/index.js";
import { Badge, cx, type Tone } from "../foundation/index.js";
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
      <MetricCard label="Open work" value={view.summary.openWorkCount} />
      <MetricCard label="Ready" value={view.summary.readyWorkCount} />
      <MetricCard label="Blocked" value={view.summary.blockedWorkCount} tone={view.summary.blockedWorkCount > 0 ? "warning" : "success"} />
      <MetricCard label="Reservations" value={view.summary.activeReservationCount} />
      <MetricCard label="Stale" value={view.summary.staleProjects} tone={view.summary.staleProjects > 0 ? "warning" : "success"} />
    </div>
  );
}

export function BucketOverviewGrid({ view }: { readonly view: ProjectRegistryView }) {
  return (
    <Card title="Project buckets" eyebrow={`${view.entries.length} registered`}>
      {view.entries.length > 0 ? (
        <div className="bw-bucket-grid">
          {view.entries.map((entry) => (
            <article key={entry.id} className="bw-bucket">
              <header className="bw-bucket__header">
                <div>
                  <h4>{entry.name}</h4>
                  <p>{entry.projectRoot}</p>
                </div>
                <Badge tone={healthTone(entry.health)}>{entry.health}</Badge>
              </header>
              <dl className="bw-bucket__metrics">
                <div>
                  <dt>Open</dt>
                  <dd>{entry.openWorkCount}</dd>
                </div>
                <div>
                  <dt>Ready</dt>
                  <dd>{entry.readyWorkCount}</dd>
                </div>
                <div>
                  <dt>Blocked</dt>
                  <dd>{entry.blockedWorkCount}</dd>
                </div>
                <div>
                  <dt>Reservations</dt>
                  <dd>{entry.activeReservationCount}</dd>
                </div>
              </dl>
              <div className="bw-bucket__meta">
                <Badge tone={entry.syncFreshness === "fresh" ? "success" : "warning"}>{entry.syncFreshness}</Badge>
                <Badge>{entry.lifecycle}</Badge>
                {entry.lastSeenAt ? <Badge tone={entry.stale ? "warning" : "success"}>{entry.lastSeenAt}</Badge> : null}
                <Badge>{entry.memoryGitMode}</Badge>
                <Badge>{entry.memoryLayout}</Badge>
              </div>
              <a className="bw-bucket__link" href={`/repo?project=${encodeURIComponent(entry.id)}`}>
                Open project dashboard
              </a>
            </article>
          ))}
        </div>
      ) : (
        <Notice tone="warning">No registered projects are available.</Notice>
      )}
    </Card>
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

export function GlobalBoard({ view, routePath = "/" }: { readonly view: GlobalBoardView; readonly routePath?: string }) {
  return (
    <Card
      title="Global board"
      eyebrow={`${view.summary.lanes} lanes / ${view.summary.totalWork} work rows`}
      actions={
        <div className="bw-global-board__status">
          <Badge tone={view.summary.missingLanes > 0 ? "danger" : "success"}>{view.summary.missingLanes} missing</Badge>
          <Badge tone={view.summary.staleLanes > 0 ? "warning" : "success"}>{view.summary.staleLanes} stale</Badge>
        </div>
      }
    >
      <div className="bw-global-board">
        <div
          className="bw-global-board-refusal"
          data-bw-board-refusal
          hidden
          aria-live="polite"
          aria-atomic="true"
        />
        <div className="bw-global-board__rails">
          {view.rails.map((rail) => (
            <section key={rail.id} className="bw-global-board-rail" aria-label={rail.title}>
              <header className="bw-global-board-rail__header">
                <strong>{rail.title}</strong>
                <Badge tone={railTone(rail.id)}>{rail.count}</Badge>
              </header>
              {rail.items.length > 0 ? (
                <div className="bw-global-board-rail__items">
                  {rail.items.map((item) => (
                    <article key={item.id} className="bw-global-board-rail__item">
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                      </div>
                      <div className="bw-global-board-rail__meta">
                        <Badge>{item.projectName}</Badge>
                        <Badge tone={item.tone}>{item.status}</Badge>
                      </div>
                      {item.command ? <code>{item.command}</code> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <Notice tone="success">{rail.emptyLabel}</Notice>
              )}
            </section>
          ))}
        </div>

        <div className="bw-global-board__lanes">
          {view.lanes.map((lane) => (
            <article
              key={lane.id}
              className={cx(
                "bw-global-board-lane",
                `bw-global-board-lane--${lane.lifecycle}`,
                (lane.stale || lane.syncFreshness === "stale") && "bw-global-board-lane--stale"
              )}
            >
              <header className="bw-global-board-lane__header">
                <div className="bw-global-board-lane__identity">
                  <strong>{lane.projectName}</strong>
                  <code>{lane.projectRoot}</code>
                </div>
                <div className="bw-global-board-lane__badges">
                  <Badge>{lane.kind}</Badge>
                  <Badge tone={lifecycleTone(lane.lifecycle)}>{lane.lifecycle}</Badge>
                  <Badge tone={healthTone(lane.health)}>{lane.health}</Badge>
                  <Badge tone={lane.stale || lane.syncFreshness === "stale" ? "warning" : "success"}>{lane.stalenessLabel}</Badge>
                  {lane.findingCount > 0 ? <Badge tone="warning">{lane.findingCount} findings</Badge> : null}
                </div>
              </header>
              <div className="bw-global-board-lane__metrics">
                <MetricCard label="Open" value={lane.openWork} />
                <MetricCard label="Ready" value={lane.readyWork} />
                <MetricCard label="Blocked" value={lane.blockedWork} tone={lane.blockedWork > 0 ? "warning" : "success"} />
              </div>
              <div className="bw-global-board-lane__columns">
                {lane.columns.map((column) => (
                  <section
                    key={column.id}
                    className={cx(
                      "bw-global-board-column",
                      `bw-global-board-column--${column.id}`,
                      !isDroppableGlobalBoardColumn(column.id) && "bw-global-board-column--locked"
                    )}
                    aria-label={column.title}
                    aria-disabled={isDroppableGlobalBoardColumn(column.id) ? undefined : true}
                    data-bw-drop-column={column.id}
                    data-bw-droppable={isDroppableGlobalBoardColumn(column.id) ? "true" : "false"}
                  >
                    <header className="bw-global-board-column__header">
                      <span>{column.title}</span>
                      <Badge tone={boardColumnTone(column.id)}>{column.count}</Badge>
                    </header>
                    {column.items.length > 0 ? (
                      <div className="bw-global-board-column__items">
                        {column.items.map((item) => (
                          <article
                            key={item.id}
                            className={cx("bw-global-board-card", `bw-global-board-card--${item.columnId}`)}
                            draggable={isDraggableGlobalBoardCard(item) ? true : undefined}
                            data-bw-board-card
                            data-work-id={item.work.id}
                            data-work-title={item.work.title}
                            data-project-root={item.projectRoot}
                            data-current-column={item.columnId}
                          >
                            <div className="bw-global-board-card__main">
                              <strong>{item.work.title}</strong>
                              <span>{item.work.id}</span>
                            </div>
                            <div className="bw-global-board-card__meta">
                              <Badge tone={boardColumnTone(item.columnId)}>{item.work.status}</Badge>
                              <Badge>{item.work.priority}</Badge>
                              {item.work.activeBlockerIds.length > 0 ? <span>{item.work.activeBlockerIds.length} blockers</span> : null}
                              {item.hasBorealReferences ? <Badge tone="accent">{item.borealReferenceCount} refs</Badge> : null}
                              <GlobalDirectiveBadges work={item.work} />
                            </div>
                            {item.claimCommand ? <code>{item.claimCommand}</code> : null}
                            <GlobalBoardCardActions item={item} routePath={routePath} />
                          </article>
                        ))}
                      </div>
                    ) : (
                      <span className="bw-global-board-column__empty">No rows</span>
                    )}
                  </section>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </Card>
  );
}

function GlobalBoardCardActions({
  item,
  routePath
}: {
  readonly item: GlobalBoardView["lanes"][number]["columns"][number]["items"][number];
  readonly routePath: string;
}) {
  const canReserve = item.columnId === "ready";
  const canRelease = item.columnId === "in_progress";
  const canClose = item.columnId !== "closed" && item.columnId !== "verified";
  if (!canReserve && !canRelease && !canClose) {
    return null;
  }
  return (
    <div className="bw-global-board-card__actions" data-bw-board-actions>
      {canReserve ? (
        <GlobalBoardCommandForm
          action="/api/commands/work.reserve"
          routePath={routePath}
          item={item}
          fields={{
            agentId: "console",
            purpose: "Console board drag"
          }}
        >
          <Button type="submit" variant="secondary">Reserve</Button>
        </GlobalBoardCommandForm>
      ) : null}
      {canRelease ? (
        <GlobalBoardCommandForm action="/api/commands/work.release" routePath={routePath} item={item}>
          <Button type="submit" variant="secondary">Release</Button>
        </GlobalBoardCommandForm>
      ) : null}
      {canClose ? (
        <GlobalBoardCommandForm
          action="/api/commands/work.close"
          routePath={routePath}
          item={item}
          fields={{
            reason: "Closed from global board"
          }}
        >
          <Button type="submit" variant="ghost">Close</Button>
        </GlobalBoardCommandForm>
      ) : null}
    </div>
  );
}

function GlobalBoardCommandForm({
  action,
  routePath,
  item,
  fields = {},
  children
}: {
  readonly action: string;
  readonly routePath: string;
  readonly item: GlobalBoardView["lanes"][number]["columns"][number]["items"][number];
  readonly fields?: Readonly<Record<string, string>>;
  readonly children: ReactNode;
}) {
  return (
    <form method="post" action={action} data-bw-board-command-form>
      <input type="hidden" name="returnTo" value={routePath} />
      <input type="hidden" name="confirm" value="yes" />
      <input type="hidden" name="workId" value={item.work.id} />
      <input type="hidden" name="projectRoot" value={item.projectRoot} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  );
}

function isDroppableGlobalBoardColumn(columnId: GlobalBoardColumnId): boolean {
  return columnId === "ready" || columnId === "in_progress" || columnId === "closed";
}

function isDraggableGlobalBoardCard(item: GlobalBoardView["lanes"][number]["columns"][number]["items"][number]): boolean {
  return item.columnId !== "closed" && item.columnId !== "verified";
}

export function GlobalWorkQueues({ view }: { readonly view: GlobalWorkQueuesView }) {
  return (
    <Card title="Global queues" eyebrow={`${view.summary.total} project-scoped rows`}>
      <div className="bw-global-queues">
        {view.queues.map((queue) => (
          <section key={queue.id} className="bw-global-queue" aria-label={queue.title}>
            <header className="bw-global-queue__header">
              <strong>{queue.title}</strong>
              <Badge tone={queueTone(queue.id)}>{queue.count}</Badge>
            </header>
            {queue.items.length > 0 ? (
              <div className="bw-global-queue__items">
                {queue.items.map((item) => (
                  <article key={item.id} className="bw-global-queue__row">
                    <div className="bw-global-queue__main">
                      <strong>{item.work.title}</strong>
                      <div className="bw-global-queue__meta">
                        <Badge>{item.projectName}</Badge>
                        <span>{item.work.id}</span>
                        <span>{item.projectRoot}</span>
                      </div>
                      <div className="bw-global-queue__meta">
                        <Badge tone={queueTone(queue.id)}>{item.work.status}</Badge>
                        <Badge>{item.work.priority}</Badge>
                        {item.work.activeBlockerIds.length > 0 ? (
                          <span>{item.work.activeBlockerIds.length} blockers</span>
                        ) : null}
                        {item.work.evidenceCount > 0 || item.work.verificationCount > 0 ? (
                          <span>{item.work.evidenceCount} evidence / {item.work.verificationCount} verification</span>
                        ) : null}
                        <GlobalDirectiveBadges work={item.work} />
                      </div>
                    </div>
                    {item.claimCommand ? (
                      <div className="bw-global-queue__command">
                        <span>Claim command</span>
                        <code>{item.claimCommand}</code>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <Notice tone="success">No {queue.title.toLowerCase()} work.</Notice>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}

function GlobalDirectiveBadges({ work }: { readonly work: WorkItemView }) {
  const summary = work.directiveSummary;
  if (!summary || summary.total === 0) {
    return null;
  }
  return (
    <span className="bw-global-queue__directives">
      {summary.blocking > 0 ? <Badge tone="danger">{summary.blocking} blocking directives</Badge> : null}
      {summary.required > 0 ? <Badge tone="warning">{summary.required} required directives</Badge> : null}
      {summary.advisory > 0 ? <Badge tone="accent">{summary.advisory} advisory directives</Badge> : null}
      {summary.conflictCount > 0 ? <Badge tone="danger">{summary.conflictCount} directive conflicts</Badge> : null}
      {summary.missingRequiredCount > 0 ? <Badge tone="danger">{summary.missingRequiredCount} missing required</Badge> : null}
      {summary.acknowledgementCount > 0 ? <Badge tone="warning">{summary.acknowledgementCount} acknowledgements</Badge> : null}
      {summary.nextSteps.length > 0 ? <Badge tone="accent">{summary.nextSteps.length} next steps</Badge> : null}
    </span>
  );
}

export function GlobalSearchPanel({ view }: { readonly view: GlobalSearchView }) {
  return (
    <Card title="Global search" eyebrow={view.query}>
      {view.results.length > 0 ? (
        <ol className="bw-global-search">
          {view.results.map((result) => (
            <li key={result.id} className="bw-global-search__row">
              <div>
                <strong>{result.title}</strong>
                {result.summary ? <p>{result.summary}</p> : null}
              </div>
              <div className="bw-global-search__meta">
                <Badge>{result.projectName}</Badge>
                <Badge tone="accent">{result.sourceKind}</Badge>
                <span>{result.recordId}</span>
                <span>{result.score.toFixed(1)}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Notice>No search results.</Notice>
      )}
    </Card>
  );
}

export function ActorActivityPanel({ view }: { readonly view: GlobalActivityView }) {
  return (
    <Card title="Actor activity" eyebrow={`${view.summary.total} recent operations`}>
      <div className="bw-activity-summary">
        <MetricCard label="Human" value={view.summary.human} />
        <MetricCard label="Agent" value={view.summary.agent} />
        <MetricCard label="System" value={view.summary.system} />
        <MetricCard label="Failed" value={view.summary.failed} tone={view.summary.failed > 0 ? "danger" : "success"} />
      </div>
      {view.items.length > 0 ? (
        <ol className="bw-activity-list">
          {view.items.map((item) => (
            <li key={item.id} className="bw-activity-row">
              <div className="bw-activity-row__main">
                <strong>{item.commandPath}</strong>
                <span>{item.finishedAt}</span>
              </div>
              <div className="bw-activity-row__meta">
                <Badge>{item.projectName}</Badge>
                <Badge tone={actorTone(item.actorKind)}>{item.actorKind}</Badge>
                <span>{item.actorId}</span>
                <Badge tone={item.status === "failed" ? "danger" : "success"}>{item.status}</Badge>
                {item.stateChanged ? <Badge tone="warning">state</Badge> : null}
                {item.generatedArtifactsChanged ? <Badge tone="accent">generated</Badge> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Notice>No recent activity.</Notice>
      )}
    </Card>
  );
}

export function GlobalHealthSummaryPanel({ view }: { readonly view: GlobalHealthView }) {
  return (
    <Card title="Global health" eyebrow={`${view.summary.totalProjects} projects`}>
      <div className="bw-global-health-summary">
        <MetricCard label="Healthy" value={view.summary.healthyProjects} tone={view.summary.errorProjects > 0 ? "warning" : "success"} />
        <MetricCard label="Warnings" value={view.summary.warnings} tone={view.summary.warnings > 0 ? "warning" : "success"} />
        <MetricCard label="Errors" value={view.summary.errors} tone={view.summary.errors > 0 ? "danger" : "success"} />
        <MetricCard label="Fixable" value={view.summary.fixableActions} />
      </div>
      <div className="bw-global-health-projects">
        {view.projects.map((project) => (
          <article key={project.projectId} className="bw-global-health-project">
            <div>
              <strong>{project.projectName}</strong>
              <code>{project.projectRoot}</code>
            </div>
            <div className="bw-global-health-project__meta">
              <Badge tone={healthTone(project.health)}>{project.health}</Badge>
              <Badge tone={project.syncFreshness === "fresh" ? "success" : "warning"}>{project.syncFreshness}</Badge>
              {project.findingCount > 0 ? <Badge tone="warning">{project.findingCount} findings</Badge> : <Badge tone="success">clear</Badge>}
            </div>
          </article>
        ))}
      </div>
    </Card>
  );
}

export function GlobalDriftPanel({ view }: { readonly view: GlobalHealthView }) {
  return (
    <Card title="Drift findings" eyebrow={`${view.summary.findings} scoped findings`}>
      {view.driftGroups.length > 0 ? (
        <div className="bw-drift-groups">
          {view.driftGroups.map((group) => (
            <section key={group.category} className="bw-drift-group" aria-label={group.title}>
              <header className="bw-drift-group__header">
                <strong>{group.title}</strong>
                <Badge tone={categoryTone(group.category)}>{group.count}</Badge>
              </header>
              <div className="bw-drift-list">
                {group.findings.map((finding) => (
                  <article key={finding.id} className="bw-drift-row">
                    <div className="bw-drift-row__main">
                      <strong>{finding.code}</strong>
                      <p>{finding.message}</p>
                    </div>
                    <div className="bw-drift-row__meta">
                      <Badge>{finding.projectName}</Badge>
                      <Badge tone={finding.severity === "error" ? "danger" : "warning"}>{finding.severity}</Badge>
                      <code>{finding.projectRoot}</code>
                      {finding.sourcePath !== finding.projectRoot ? <code>{finding.sourcePath}</code> : null}
                    </div>
                    {finding.actions.length > 0 ? (
                      <div className="bw-drift-actions">
                        {finding.actions.map((action) => (
                          <ScopedAction key={`${finding.id}:${action.label}:${action.command ?? "manual"}`} action={action} />
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Notice tone="success">No drift findings.</Notice>
      )}
    </Card>
  );
}

export function GlobalSettingsPanel({ view, routePath }: { readonly view: GlobalSettingsView; readonly routePath: string }) {
  return (
    <Card title="Project settings" eyebrow={`${view.projects.length} configured projects`}>
      <form className="bw-settings-add" method="post" action={view.addProjectAction}>
        <input type="hidden" name="returnTo" value={routePath} />
        <TextInput label="Project root" name="projectRoot" placeholder="/absolute/path/to/project" required />
        <label className="bw-command-confirm">
          <input name="confirm" value="yes" type="checkbox" required />
          <span>Confirm</span>
        </label>
        <Button type="submit" variant="primary">Validate and add</Button>
      </form>

      <div className="bw-settings-modes">
        {view.memoryModes.map((mode) => (
          <article key={mode.id} className="bw-settings-mode">
            <header>
              <strong>{mode.label}</strong>
              <Badge tone={mode.id === "shared" ? "warning" : "success"}>{mode.id}</Badge>
            </header>
            <p>{mode.description}</p>
            <span>{mode.risk}</span>
          </article>
        ))}
      </div>

      <div className="bw-settings-projects">
        {view.projects.map((project) => (
          <form key={project.projectId} className="bw-settings-project" method="post" action={view.applySetupAction}>
            <input type="hidden" name="returnTo" value={routePath} />
            <input type="hidden" name="projectId" value={project.projectId} />
            <header className="bw-settings-project__header">
              <div>
                <strong>{project.projectName}</strong>
                <span>{project.source ?? "registry"}</span>
              </div>
              <Badge tone={healthTone(project.health)}>{project.health}</Badge>
            </header>
            <div className="bw-settings-grid">
              <TextInput label="Project root" name="projectRoot" defaultValue={project.projectRoot} required />
              <TextInput label="Memory root" name="memoryRoot" defaultValue={project.memoryRoot} required />
              <SelectField label="Memory layout" name="memoryLayout" defaultValue={project.memoryLayout} options={["in-repo", "child", "sibling"]} />
              <SelectField
                label="Memory Git"
                name="memoryGitMode"
                defaultValue={project.memoryGitMode}
                options={view.memoryModes.map((mode) => mode.id)}
              />
              <TextInput label="Memory remote" name="memoryRemote" defaultValue={project.memoryRemote ?? ""} placeholder="git@example.com:team/memory.git" />
            </div>
            <div className="bw-settings-commands">
              <CommandPreview label="Validate" command={project.validateCommand} />
              <CommandPreview label="Import setup" command={project.importSetupCommand} />
              <CommandPreview label="Apply setup" command={project.applySetupCommand} />
            </div>
            <div className="bw-settings-actions">
              <label className="bw-command-confirm">
                <input name="confirm" value="yes" type="checkbox" required />
                <span>Confirm</span>
              </label>
              <Button type="submit" variant="secondary" formAction={view.importSetupAction}>Validate and import</Button>
              <Button type="submit" variant="primary">Validate and apply setup</Button>
            </div>
          </form>
        ))}
      </div>
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

function healthTone(health: string): Tone {
  if (health === "ok") {
    return "success";
  }
  if (health === "error" || health === "missing") {
    return "danger";
  }
  return "warning";
}

function lifecycleTone(lifecycle: string): Tone {
  if (lifecycle === "linked") {
    return "success";
  }
  if (lifecycle === "missing") {
    return "danger";
  }
  return "warning";
}

function boardColumnTone(columnId: GlobalBoardColumnId): Tone {
  if (columnId === "ready" || columnId === "verified") {
    return "success";
  }
  if (columnId === "blocked" || columnId === "needs_verification" || columnId === "draft") {
    return "warning";
  }
  if (columnId === "in_progress") {
    return "accent";
  }
  return "neutral";
}

function railTone(railId: GlobalBoardRailId): Tone {
  return railId === "inbox" ? "warning" : "success";
}

function queueTone(queueId: GlobalWorkQueueId): Tone {
  if (queueId === "ready") {
    return "success";
  }
  if (queueId === "blocked") {
    return "warning";
  }
  return "accent";
}

function actorTone(kind: GlobalActivityActorKind): Tone {
  if (kind === "human") {
    return "success";
  }
  if (kind === "agent") {
    return "accent";
  }
  if (kind === "system") {
    return "warning";
  }
  return "neutral";
}

function categoryTone(category: GlobalHealthCategory): Tone {
  if (category === "lock" || category === "setup" || category === "registry") {
    return "warning";
  }
  if (category === "sync" || category === "search" || category === "ledger") {
    return "accent";
  }
  if (category === "git" || category === "vault") {
    return "danger";
  }
  return "neutral";
}

function ScopedAction({ action }: { readonly action: GlobalHealthAction }) {
  return (
    <div className="bw-drift-action">
      <div className="bw-drift-action__meta">
        <Badge tone={action.requiresConfirmation ? "warning" : "success"}>
          {action.requiresConfirmation ? "confirm" : "read"}
        </Badge>
        <span>{action.label}</span>
      </div>
      {action.command ? <code>{action.command}</code> : null}
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options
}: {
  readonly label: string;
  readonly name: string;
  readonly defaultValue: string;
  readonly options: readonly string[];
}) {
  return (
    <div className="bw-field">
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <select id={name} name={name} className="bw-input" defaultValue={defaultValue}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

function CommandPreview({ label, command }: { readonly label: string; readonly command: string }) {
  return (
    <div className="bw-settings-command">
      <span>{label}</span>
      <code>{command}</code>
    </div>
  );
}
