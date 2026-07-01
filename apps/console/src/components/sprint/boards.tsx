import type { ReactNode } from "react";
import type { SprintBoardView, WorkDashboardView, WorkItemView } from "@boreal/ui-model";

import { Badge, Button, Card, cx, MetricCard, Notice, type Tone } from "../foundation/index.js";

export type SprintViewMode = "kanban" | "table" | "dependency" | "timeline" | "progress";

export const SPRINT_VIEW_MODES: readonly { readonly id: SprintViewMode; readonly label: string }[] = [
  { id: "kanban", label: "Kanban" },
  { id: "table", label: "Table" },
  { id: "dependency", label: "Dependency" },
  { id: "timeline", label: "Timeline" },
  { id: "progress", label: "Progress" }
];

export function isSprintViewMode(value: string | null | undefined): value is SprintViewMode {
  return SPRINT_VIEW_MODES.some((mode) => mode.id === value);
}

export function ViewModeTabs({ active, routePath }: { readonly active: SprintViewMode; readonly routePath: string }) {
  return (
    <nav className="bw-view-tabs" aria-label="Sprint views">
      {SPRINT_VIEW_MODES.map((mode) => (
        <a
          key={mode.id}
          className={cx("bw-view-tabs__tab", active === mode.id && "bw-view-tabs__tab--active")}
          href={sprintViewHref(routePath, mode.id)}
          aria-current={active === mode.id ? "page" : undefined}
        >
          {mode.label}
        </a>
      ))}
    </nav>
  );
}

export function SprintHeader({ view }: { readonly view?: SprintBoardView }) {
  if (!view) {
    return (
      <header className="bw-sprint-header bw-sprint-header--empty">
        <div className="bw-sprint-header__main">
          <div className="bw-sprint-header__status">
            <Badge tone="warning">No sprint</Badge>
          </div>
          <h1>No active sprint</h1>
          <p>Select or activate a sprint to populate the board.</p>
        </div>
        <div className="bw-sprint-header__metrics">
          <MetricCard label="Phases" value={0} />
          <MetricCard label="Tasks" value={0} />
          <MetricCard label="Active blockers" value={0} />
          <MetricCard label="Active agents" value={0} />
        </div>
      </header>
    );
  }

  const statusTone = sprintStatusTone(view.sprint.status);
  const closeoutLabel = view.sprint.status === "closed"
    ? "Closed sprint"
    : view.summary.activeBlockerCount > 0
      ? "Blocked"
      : view.summary.needsVerification > 0
        ? "Needs verification"
        : "Open";

  return (
    <header className="bw-sprint-header">
      <div className="bw-sprint-header__main">
        <div className="bw-sprint-header__status">
          <Badge tone="accent">Sprint</Badge>
          <Badge tone={statusTone}>{view.sprint.status}</Badge>
          <Badge tone={view.summary.activeBlockerCount > 0 ? "warning" : "success"}>{closeoutLabel}</Badge>
        </div>
        <h1>{view.sprint.title}</h1>
        <p>{view.sprint.id}</p>
        <div className="bw-sprint-header__details">
          <span>{view.summary.phaseCount} phases</span>
          <span>{view.summary.taskCount} tasks</span>
          <span>{view.summary.activeReservations} active agents</span>
          {view.generatedAt ? <span>Updated {view.generatedAt}</span> : null}
        </div>
      </div>
      <div className="bw-sprint-header__metrics">
        <MetricCard label="Phases" value={view.summary.phaseCount} />
        <MetricCard label="Tasks" value={view.summary.taskCount} />
        <MetricCard label="Active blockers" value={view.summary.activeBlockerCount} tone={view.summary.activeBlockerCount > 0 ? "warning" : "success"} />
        <MetricCard label="Active agents" value={view.summary.activeReservations} />
      </div>
    </header>
  );
}

export function SprintScopeSummary({ view }: { readonly view?: SprintBoardView }) {
  if (!view) {
    return (
      <Card title="Scope summary" eyebrow="No active sprint">
        <Notice tone="warning">No sprint scope is available.</Notice>
      </Card>
    );
  }

  const closedPhases = view.phases.filter((phase) => phase.status === "closed").length;
  const evidenceTotal = view.lanes.flatMap((lane) => lane.items).reduce((total, item) => total + item.evidenceCount, 0);
  const verificationTotal = view.lanes.flatMap((lane) => lane.items).reduce((total, item) => total + item.verificationCount, 0);
  const closeoutTone = view.sprint.status === "closed" ? "success" : view.summary.activeBlockerCount > 0 ? "warning" : "accent";

  return (
    <Card title="Scope summary" eyebrow={`${view.summary.total} scoped records`}>
      <div className="bw-scope-summary">
        <div className="bw-scope-summary__grid">
          <ScopeStat label="Phase progress" value={`${closedPhases}/${view.summary.phaseCount}`} />
          <ScopeStat label="Tasks" value={view.summary.taskCount} />
          <ScopeStat label="Evidence" value={evidenceTotal} />
          <ScopeStat label="Verification" value={verificationTotal} />
          <ScopeStat label="Active agents" value={view.summary.activeReservations} />
          <ScopeStat label="Closeout" value={view.sprint.status === "closed" ? "closed" : "open"} tone={closeoutTone} />
        </div>
        <div className="bw-scope-summary__phases" aria-label="Sprint phases">
          {view.phases.length > 0 ? view.phases.map((phase) => <PhaseRow key={phase.id} phase={phase} />) : <Notice>No phases in scope.</Notice>}
        </div>
      </div>
    </Card>
  );
}

function ScopeStat({ label, value, tone = "neutral" }: { readonly label: string; readonly value: string | number; readonly tone?: "neutral" | "accent" | "success" | "warning" | "danger" }) {
  return (
    <div className={`bw-scope-stat bw-scope-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PhaseRow({ phase }: { readonly phase: WorkItemView }) {
  return (
    <div className="bw-scope-phase">
      <div className="bw-scope-phase__main">
        <strong>{phase.title}</strong>
        <span>{phase.id}</span>
      </div>
      <div className="bw-scope-phase__meta">
        <Badge tone={sprintStatusTone(phase.status)}>{phase.status}</Badge>
        <Badge tone={phase.activeBlockerIds.length > 0 ? "warning" : "success"}>{phase.activeBlockerIds.length} blockers</Badge>
        <Badge>{phase.evidenceCount} evidence</Badge>
        <Badge>{phase.verificationCount} verified</Badge>
      </div>
    </div>
  );
}

export function SprintKanbanCard({ item }: { readonly item: WorkItemView }) {
  const blockerCount = item.activeBlockerIds.length;
  const dependencyCount = item.dependencyIds.length;
  const visibleLabels = item.labels.slice(0, 4);
  const hiddenLabelCount = Math.max(item.labels.length - visibleLabels.length, 0);
  const ariaFacts = [
    `${formatWorkStatus(item.status)} status`,
    `${item.priority} priority`,
    `${blockerCount} active blockers`,
    `${item.evidenceCount} evidence`,
    `${item.verificationCount} verifications`,
    item.activeReservationId ? "reserved" : "unreserved"
  ];

  return (
    <article
      className={cx(
        "bw-kanban-card",
        `bw-kanban-card--${item.status}`,
        blockerCount > 0 && "bw-kanban-card--blocked",
        item.activeReservationId && "bw-kanban-card--reserved"
      )}
      aria-label={`${item.title}. ${ariaFacts.join(". ")}.`}
    >
      <div className="bw-kanban-card__header">
        <div className="bw-kanban-card__identity">
          <strong className="bw-kanban-card__title">{item.title}</strong>
          <span className="bw-kanban-card__id">{item.id}</span>
        </div>
        <Badge tone={priorityTone(item.priority)}>{item.priority}</Badge>
      </div>
      <div className="bw-kanban-card__state" aria-label="Work state">
        <Badge tone={sprintStatusTone(item.status)}>{formatWorkStatus(item.status)}</Badge>
        {blockerCount > 0 ? <Badge tone="warning">{blockerCount} blockers</Badge> : <Badge tone="success">unblocked</Badge>}
        {item.activeReservationId ? <Badge tone="accent" title={item.activeReservationId}>reserved</Badge> : null}
      </div>
      <DirectiveBadgeStrip item={item} />
      <dl className="bw-kanban-card__facts" aria-label="Work facts">
        <div>
          <dt>Kind</dt>
          <dd>{item.kind}</dd>
        </div>
        <div>
          <dt>{item.activeReservation ? "Owner" : "Deps"}</dt>
          <dd>{item.activeReservation?.agentId || dependencyCount}</dd>
        </div>
        <div>
          <dt>{item.activeReservation ? "TTL" : "Evidence"}</dt>
          <dd>{item.activeReservation ? reservationTtl(item.activeReservation.expiresAt) : item.evidenceCount}</dd>
        </div>
        <div>
          <dt>Verified</dt>
          <dd>{item.verificationCount}</dd>
        </div>
      </dl>
      {visibleLabels.length > 0 ? (
        <div className="bw-kanban-card__labels" aria-label="Labels">
          {visibleLabels.map((label) => <Badge key={label}>{label}</Badge>)}
          {hiddenLabelCount > 0 ? <Badge>+{hiddenLabelCount} labels</Badge> : null}
        </div>
      ) : null}
      {item.contextSummary ? <p className="bw-kanban-card__summary">{item.contextSummary}</p> : null}
    </article>
  );
}

export function SprintKanbanBoard({ view }: { readonly view: SprintBoardView }) {
  return (
    <section className="bw-kanban" aria-label={`${view.sprint.title} board`}>
      {view.lanes.map((lane) => (
        <div key={lane.id} className={cx("bw-kanban__column", `bw-kanban__column--${lane.id}`)} aria-label={`${lane.title}: ${lane.count} items`}>
          <div className="bw-kanban__column-title">
            <span>{lane.title}</span>
            <Badge tone={laneTone(lane.id)}>{lane.count}</Badge>
          </div>
          <div className="bw-kanban__items">
            {lane.items.length > 0 ? lane.items.map((item) => <SprintKanbanCard key={item.id} item={item} />) : <Notice>No work.</Notice>}
          </div>
        </div>
      ))}
    </section>
  );
}

export function SprintDashboardActions({ view, routePath }: { readonly view: SprintBoardView; readonly routePath: string }) {
  const items = sprintBoardItems(view);
  const readyItems = items.filter((item) => item.status === "ready");
  const activeItems = items.filter((item) => item.activeReservationId || item.status === "in_progress" || item.status === "reserved");
  const verifiableItems = items.filter((item) => item.evidenceCount > 0 && item.status !== "closed" && item.status !== "cancelled");
  const closeableItems = items.filter((item) => item.status !== "closed" && item.status !== "cancelled");
  return (
    <Card title="Sprint actions" eyebrow="confirmed commands">
      <div className="bw-sprint-actions">
        <ActionForm title="Claim" commandId="work.reserve" returnTo={routePath} items={readyItems}>
          <label className="bw-field-label">
            <span>Owner</span>
            <input className="bw-input" name="agentId" placeholder="agent id" required />
          </label>
          <label className="bw-field-label">
            <span>TTL</span>
            <input className="bw-input" name="ttl" defaultValue="2h" />
          </label>
          <label className="bw-field-label bw-sprint-actions__wide">
            <span>Purpose</span>
            <input className="bw-input" name="purpose" defaultValue="Claim from Boreal Console" />
          </label>
        </ActionForm>
        <ActionForm title="Release" commandId="work.release" returnTo={routePath} items={activeItems} />
        <ActionForm title="Renew" commandId="work.renew" returnTo={routePath} items={activeItems}>
          <label className="bw-field-label">
            <span>TTL</span>
            <input className="bw-input" name="ttl" defaultValue="2h" required />
          </label>
        </ActionForm>
        <ActionForm title="Verify" commandId="work.verify" returnTo={routePath} items={verifiableItems}>
          <label className="bw-field-label">
            <span>Evidence</span>
            <input className="bw-input" name="evidenceId" placeholder="bw_evidence_..." required />
          </label>
          <label className="bw-field-label">
            <span>Verdict</span>
            <select className="bw-input" name="verdict" defaultValue="passed">
              <option value="passed">passed</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label className="bw-field-label bw-sprint-actions__wide">
            <span>Notes</span>
            <input className="bw-input" name="notes" />
          </label>
        </ActionForm>
        <ActionForm title="Close" commandId="work.close" returnTo={routePath} items={closeableItems}>
          <label className="bw-field-label bw-sprint-actions__wide">
            <span>Reason</span>
            <input className="bw-input" name="reason" required />
          </label>
        </ActionForm>
        <form className="bw-sprint-action" method="post" action="/api/commands/sync.refresh">
          <input type="hidden" name="returnTo" value={routePath} />
          <div className="bw-sprint-action__header">
            <strong>Refresh</strong>
            <Badge tone="warning">mutates</Badge>
          </div>
          <label className="bw-command-confirm">
            <input name="confirm" value="yes" type="checkbox" required />
            <span>Confirm</span>
          </label>
          <Button type="submit" variant="primary">Run</Button>
        </form>
      </div>
    </Card>
  );
}

export function SprintReviewQueues({ view, routePath }: { readonly view: SprintBoardView; readonly routePath: string }) {
  const verificationItems = sprintBoardItems(view).filter(needsVerificationReview);
  return (
    <Card title="Sprint review" eyebrow={`${verificationItems.length} verification rows`}>
      <div className="bw-sprint-review">
        <section className="bw-review-queue" aria-label="Verification queue">
          <div className="bw-review-queue__header">
            <strong>Verification queue</strong>
            <Badge tone={verificationItems.length > 0 ? "warning" : "success"}>{verificationItems.length}</Badge>
          </div>
          <div className="bw-review-items">
            {verificationItems.length > 0 ? verificationItems.map((item) => (
              <article key={item.id} className="bw-review-item">
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.id}</span>
                </div>
                <div className="bw-review-item__meta">
                  <Badge tone={sprintStatusTone(item.status)}>{formatWorkStatus(item.status)}</Badge>
                  <Badge>{item.evidenceCount} evidence</Badge>
                  <Badge>{item.verificationCount} verified</Badge>
                </div>
              </article>
            )) : <Notice tone="success">No verification work.</Notice>}
          </div>
        </section>
        <form className="bw-review-queue bw-discovery-form" method="post" action="/api/commands/work.create">
          <input type="hidden" name="returnTo" value={routePath} />
          <input type="hidden" name="kind" value="task" />
          <div className="bw-review-queue__header">
            <strong>Promote discovery</strong>
            <Badge tone="warning">mutates</Badge>
          </div>
          <label className="bw-field-label">
            <span>Source</span>
            <input className="bw-input" name="sourceRef" placeholder="raw/source id or URI" required />
          </label>
          <label className="bw-field-label">
            <span>Title</span>
            <input className="bw-input" name="title" required />
          </label>
          <label className="bw-field-label">
            <span>Description</span>
            <input className="bw-input" name="description" />
          </label>
          <div className="bw-discovery-form__row">
            <label className="bw-field-label">
              <span>Priority</span>
              <select className="bw-input" name="priority" defaultValue="normal">
                <option value="low">low</option>
                <option value="normal">normal</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <label className="bw-field-label">
              <span>Label</span>
              <input className="bw-input" name="label" defaultValue="discovery" />
            </label>
          </div>
          <label className="bw-field-label">
            <span>Acceptance</span>
            <input className="bw-input" name="acceptance" defaultValue="Source context is preserved." />
          </label>
          <label className="bw-command-confirm">
            <input name="ready" value="yes" type="checkbox" defaultChecked />
            <span>Ready</span>
          </label>
          <label className="bw-command-confirm">
            <input name="confirm" value="yes" type="checkbox" required />
            <span>Confirm</span>
          </label>
          <Button type="submit" variant="primary">Run</Button>
        </form>
      </div>
    </Card>
  );
}

function ActionForm({
  title,
  commandId,
  returnTo,
  items,
  children
}: {
  readonly title: string;
  readonly commandId: string;
  readonly returnTo: string;
  readonly items: readonly WorkItemView[];
  readonly children?: ReactNode;
}) {
  const disabled = items.length === 0;
  return (
    <form className="bw-sprint-action" method="post" action={`/api/commands/${commandId}`}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="bw-sprint-action__header">
        <strong>{title}</strong>
        <Badge tone={disabled ? "neutral" : "warning"}>{items.length}</Badge>
      </div>
      <label className="bw-field-label bw-sprint-actions__wide">
        <span>Work</span>
        <select className="bw-input" name="workId" required disabled={disabled}>
          {items.length > 0 ? items.map((item) => (
            <option key={item.id} value={item.id}>{item.title}</option>
          )) : <option value="">No work</option>}
        </select>
      </label>
      {children}
      <label className="bw-command-confirm">
        <input name="confirm" value="yes" type="checkbox" required disabled={disabled} />
        <span>Confirm</span>
      </label>
      <Button type="submit" variant="primary" disabled={disabled}>Run</Button>
    </form>
  );
}

function needsVerificationReview(item: WorkItemView): boolean {
  if (item.status === "needs_verification") {
    return true;
  }
  if (item.status === "closed" || item.status === "verified" || item.status === "cancelled") {
    return false;
  }
  return item.evidenceCount > item.verificationCount;
}

export function SprintBoardTable({ view }: { readonly view: SprintBoardView }) {
  const items = sprintBoardItems(view);
  return (
    <Card title="Dense sprint table" eyebrow={`${items.length} scoped rows`}>
      <table className="bw-work-table bw-sprint-table">
        <thead>
          <tr>
            <th>Work</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Blocking</th>
            <th>Directives</th>
            <th>Evidence</th>
            <th>Labels</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.title}</strong>
                <span>{item.id}</span>
              </td>
              <td><Badge tone={sprintStatusTone(item.status)}>{formatWorkStatus(item.status)}</Badge></td>
              <td><Badge tone={priorityTone(item.priority)}>{item.priority}</Badge></td>
              <td>
                <span>{item.activeBlockerIds.length} active</span>
                <span>{item.dependencyIds.length} deps</span>
              </td>
              <td><DirectiveBadgeStrip item={item} emptyLabel="none" /></td>
              <td>
                <span>{item.evidenceCount} evidence</span>
                <span>{item.verificationCount} verified</span>
              </td>
              <td>
                <div className="bw-sprint-table__labels">
                  {item.labels.length > 0 ? item.labels.slice(0, 3).map((label) => <Badge key={label}>{label}</Badge>) : <span>none</span>}
                  {item.labels.length > 3 ? <Badge>+{item.labels.length - 3}</Badge> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function SprintDependencyView({ view }: { readonly view: SprintBoardView }) {
  const items = sprintBoardItems(view);
  const byId = new Map(items.map((item) => [item.id, item]));
  const cycles = dependencyCycles(items);
  const rows = items.filter((item) => item.dependencyIds.length > 0 || item.activeBlockerIds.length > 0);

  return (
    <Card title="Dependency diagnostics" eyebrow={`${rows.length} linked rows`}>
      <div className="bw-dependency-view">
        {cycles.length > 0 ? (
          <Notice tone="danger" label="Dependency cycle">
            {cycles.map((cycle) => cycle.join(" -> ")).join("; ")}
          </Notice>
        ) : (
          <Notice tone="success" label="Cycles">No scoped dependency cycles.</Notice>
        )}
        <div className="bw-dependency-list" aria-label="Sprint dependencies">
          {rows.length > 0 ? rows.map((item) => <DependencyRow key={item.id} item={item} byId={byId} />) : <Notice tone="success">No scoped dependencies or active blockers.</Notice>}
        </div>
      </div>
    </Card>
  );
}

export function SprintTimelineView({ view }: { readonly view: SprintBoardView }) {
  return (
    <Card title="Timeline review" eyebrow="status sequence">
      <ol className="bw-sprint-timeline" aria-label="Sprint status timeline">
        {view.lanes.map((lane) => (
          <li key={lane.id} className={cx("bw-sprint-timeline__step", `bw-sprint-timeline__step--${lane.id}`)}>
            <div className="bw-sprint-timeline__header">
              <Badge tone={laneTone(lane.id)}>{lane.count}</Badge>
              <strong>{lane.title}</strong>
            </div>
            <div className="bw-sprint-timeline__items">
              {lane.items.length > 0 ? lane.items.map((item) => (
                <div key={item.id} className="bw-sprint-timeline__item">
                  <span>{item.title}</span>
                  <Badge tone={sprintStatusTone(item.status)}>{formatWorkStatus(item.status)}</Badge>
                </div>
              )) : <span>No work.</span>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function SprintBoardProgressView({ view }: { readonly view: SprintBoardView }) {
  const total = Math.max(view.summary.total, 1);
  const complete = view.summary.closed + view.summary.verified;
  const completePercent = Math.round((complete / total) * 100);
  return (
    <Card title="Sprint progress" eyebrow={`${completePercent}% complete`}>
      <div className="bw-sprint-progress">
        <div className="bw-progress-grid">
          <MetricCard label="Ready" value={view.summary.ready} />
          <MetricCard label="In progress" value={view.summary.inProgress} />
          <MetricCard label="Blocked" value={view.summary.blocked} tone={view.summary.blocked > 0 ? "warning" : "success"} />
          <MetricCard label="Complete" value={complete} tone={complete === view.summary.total ? "success" : "accent"} />
        </div>
        <div className="bw-sprint-progress__bars" aria-label="Lane progress">
          {view.lanes.map((lane) => (
            <label key={lane.id} className="bw-sprint-progress__bar">
              <span>{lane.title}</span>
              <progress max={total} value={lane.count}>{lane.count}</progress>
              <strong>{lane.count}</strong>
            </label>
          ))}
        </div>
      </div>
    </Card>
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
          <th>Directives</th>
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.title}</td>
            <td>{item.status}</td>
            <td>{item.priority}</td>
            <td><DirectiveBadgeStrip item={item} emptyLabel="none" /></td>
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

function sprintStatusTone(status: WorkItemView["status"]): Tone {
  switch (status) {
    case "closed":
    case "verified":
      return "success";
    case "blocked":
    case "needs_verification":
      return "warning";
    case "cancelled":
      return "danger";
    case "in_progress":
    case "reserved":
      return "accent";
    case "draft":
    case "ready":
      return "neutral";
  }
}

function DirectiveBadgeStrip({ item, emptyLabel }: { readonly item: WorkItemView; readonly emptyLabel?: string }) {
  const summary = item.directiveSummary;
  if (!summary || summary.total === 0) {
    return emptyLabel ? <span className="bw-directive-badges bw-directive-badges--empty">{emptyLabel}</span> : null;
  }
  return (
    <div className="bw-directive-badges" aria-label={`${summary.total} directives for ${item.title}`}>
      {summary.blocked > 0 ? <Badge tone="danger">{summary.blocked} blocked directives</Badge> : null}
      {summary.required > 0 ? <Badge tone="warning">{summary.required} required directives</Badge> : null}
      {summary.recommended > 0 ? <Badge tone="accent">{summary.recommended} recommended directives</Badge> : null}
      {summary.informational > 0 ? <Badge tone="neutral">{summary.informational} informational directives</Badge> : null}
      {summary.conflictCount > 0 ? <Badge tone="danger">{summary.conflictCount} directive conflicts</Badge> : null}
      {summary.missingRequiredCount > 0 ? <Badge tone="danger">{summary.missingRequiredCount} missing required</Badge> : null}
      {summary.acknowledgementCount > 0 ? <Badge tone="warning">{summary.acknowledgementCount} acknowledgements</Badge> : null}
      {summary.blockerIds.length > 0 ? <Badge tone="danger">{summary.blockerIds.length} blocker refs</Badge> : null}
      {summary.nextSteps.length > 0 ? <Badge tone="accent">{summary.nextSteps.length} next steps</Badge> : null}
      {summary.safeCommands.length > 0 ? <Badge>{summary.safeCommands.length} safe commands</Badge> : null}
    </div>
  );
}

function DependencyRow({ item, byId }: { readonly item: WorkItemView; readonly byId: ReadonlyMap<string, WorkItemView> }) {
  const missingActiveBlockers = item.activeBlockerIds.filter((id) => !byId.has(id));
  return (
    <article className="bw-dependency-row">
      <div className="bw-dependency-row__main">
        <strong>{item.title}</strong>
        <span>{item.id}</span>
      </div>
      <div className="bw-dependency-row__meta">
        <Badge tone={sprintStatusTone(item.status)}>{formatWorkStatus(item.status)}</Badge>
        <Badge tone={item.activeBlockerIds.length > 0 ? "warning" : "success"}>{item.activeBlockerIds.length} active blockers</Badge>
        {missingActiveBlockers.length > 0 ? <Badge tone="danger">{missingActiveBlockers.length} stale blocker refs</Badge> : null}
      </div>
      <div className="bw-dependency-row__links">
        <DependencyLinkList title="Depends on" ids={item.dependencyIds} byId={byId} />
        <DependencyLinkList title="Active blockers" ids={item.activeBlockerIds} byId={byId} />
      </div>
    </article>
  );
}

function DependencyLinkList({ title, ids, byId }: { readonly title: string; readonly ids: readonly string[]; readonly byId: ReadonlyMap<string, WorkItemView> }) {
  return (
    <div className="bw-dependency-row__link-list">
      <span>{title}</span>
      {ids.length > 0 ? ids.map((id) => {
        const target = byId.get(id);
        return (
          <Badge key={id} tone={target ? sprintStatusTone(target.status) : "danger"} title={target?.title ?? "Missing scoped work"}>
            {id}
          </Badge>
        );
      }) : <Badge tone="success">none</Badge>}
    </div>
  );
}

function sprintBoardItems(view: SprintBoardView): readonly WorkItemView[] {
  return view.lanes.flatMap((lane) => lane.items);
}

function dependencyCycles(items: readonly WorkItemView[]): readonly string[][] {
  const ids = new Set(items.map((item) => item.id));
  const graph = new Map(items.map((item) => [item.id, item.dependencyIds.filter((id) => ids.has(id))]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();

  const visit = (id: string) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      cycles.set([...new Set(cycle)].sort().join("|"), cycle);
      return;
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    stack.push(id);
    for (const dependencyId of graph.get(id) ?? []) {
      visit(dependencyId);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const item of items) {
    visit(item.id);
  }

  return [...cycles.values()];
}

function laneTone(laneId: SprintBoardView["lanes"][number]["id"]): Tone {
  switch (laneId) {
    case "closed":
    case "verified":
      return "success";
    case "blocked":
    case "needs_verification":
      return "warning";
    case "cancelled":
      return "danger";
    case "in_progress":
      return "accent";
    case "draft":
    case "ready":
      return "neutral";
  }
}

function sprintViewHref(routePath: string, mode: SprintViewMode): string {
  const hashParts = routePath.split("#", 2);
  const withoutHash = hashParts[0] ?? "";
  const hash = hashParts[1];
  const queryParts = withoutHash.split("?", 2);
  const pathname = queryParts[0] ?? "/sprint";
  const query = queryParts[1] ?? "";
  const params = new URLSearchParams(query);
  params.set("view", mode);
  const nextQuery = params.toString();
  return `${pathname || "/sprint"}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

function priorityTone(priority: WorkItemView["priority"]): Tone {
  switch (priority) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "normal":
      return "accent";
    case "low":
      return "neutral";
  }
}

function formatWorkStatus(status: WorkItemView["status"]): string {
  return status.replace(/_/g, " ");
}

function reservationTtl(expiresAt: string | undefined): string {
  if (!expiresAt) {
    return "open";
  }
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) {
    return expiresAt;
  }
  const diffMs = timestamp - Date.now();
  if (diffMs <= 0) {
    return "expired";
  }
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.ceil(hours / 24)}d`;
}
