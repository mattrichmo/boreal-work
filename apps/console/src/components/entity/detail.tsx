import type { ReactNode } from "react";
import type {
  DashboardFinding,
  WorkDirectiveAcknowledgementView,
  WorkDirectiveConflictView,
  WorkDirectiveItemView,
  WorkDirectiveLane,
  WorkDirectiveMissingRequiredView,
  WorkDirectiveNextStepView,
  WorkDirectiveSummaryView,
  WorkItemView
} from "@boreal/ui-model";

import { Badge, Card, EntityChip, LoadingSkeleton, Notice, type Tone } from "../foundation/index.js";
import type {
  RawContradictionConflictView,
  RawContradictionReviewView,
  RawIngestFindingView,
  RawIngestMutationView,
  RawIngestPlanView,
  RawInboxView,
  MemoryDashboardActionsView,
  MemoryWorkflowActionKind,
  MemoryWorkflowActionView,
  RawSourceDetailView,
  RawSourcePreviewView,
  RawSourceRowView,
  ObsidianFrontmatterStatus,
  ObsidianLinkHealthStatus,
  ObsidianPageLinkView,
  ReportArtifactView,
  ReportsView,
  StaticReportExportView,
  VaultDashboardLinkView,
  VaultInvalidPathFindingView,
  WikiExplorerView,
  WikiHealthFindingView,
  WikiHealthSeverity,
  WikiPageDetailView,
  WikiPageRowView,
  WikiSourceCoverageStatus,
  WikiTruthStatus
} from "../../app/types.js";

export interface ReferenceItem {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly href?: string;
  readonly status?: "ok" | "missing" | "stale";
}

export interface TimelineEvent {
  readonly id: string;
  readonly label: string;
  readonly at?: string;
  readonly actor?: string;
  readonly detail?: ReactNode;
}

export interface EntityDetailHeaderProps {
  readonly title: ReactNode;
  readonly kind: string;
  readonly status?: string;
  readonly labels?: readonly string[];
  readonly actions?: ReactNode;
}

export function EntityDetailHeader({ title, kind, status, labels = [], actions }: EntityDetailHeaderProps) {
  return (
    <header className="bw-entity-header">
      <div className="bw-entity-header__main">
        <EntityChip kind={kind} label={status ?? "open"} />
        <h1 className="bw-entity-header__title">{title}</h1>
        {labels.length > 0 ? (
          <div className="bw-entity-header__labels">
            {labels.map((label) => <Badge key={label}>{label}</Badge>)}
          </div>
        ) : null}
      </div>
      {actions ? <div className="bw-entity-header__actions">{actions}</div> : null}
    </header>
  );
}

export function SourceRefList({ refs }: { readonly refs: readonly ReferenceItem[] }) {
  if (refs.length === 0) return <Notice label="Sources">No source references are attached.</Notice>;
  return (
    <Card title="Sources">
      <ul className="bw-ref-list">
        {refs.map((ref) => (
          <li key={ref.id} className="bw-ref-list__item">
            <EntityChip kind={ref.kind} label={ref.label} />
            {ref.status ? <Badge tone={toneForStatus(ref.status)}>{ref.status}</Badge> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function EventTimelinePanel({ events }: { readonly events: readonly TimelineEvent[] }) {
  if (events.length === 0) return <LoadingSkeleton lines={3} />;
  return (
    <Card title="Timeline">
      <ol className="bw-timeline">
        {events.map((event) => (
          <li key={event.id} className="bw-timeline__event">
            <div className="bw-timeline__label">{event.label}</div>
            <div className="bw-timeline__meta">{[event.actor, event.at].filter(Boolean).join(" / ")}</div>
            {event.detail ? <div className="bw-timeline__detail">{event.detail}</div> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function VerificationPanel({ work }: { readonly work: WorkItemView }) {
  return (
    <Card title="Verification" eyebrow={work.id}>
      <div className="bw-verification">
        <Badge tone={work.verificationCount > 0 ? "success" : "warning"}>
          {work.verificationCount} verification{work.verificationCount === 1 ? "" : "s"}
        </Badge>
        <Badge tone={work.evidenceCount > 0 ? "success" : "warning"}>
          {work.evidenceCount} evidence item{work.evidenceCount === 1 ? "" : "s"}
        </Badge>
      </div>
    </Card>
  );
}

export function DependencyPanel({ work }: { readonly work: WorkItemView }) {
  const blockers = work.activeBlockerIds;
  return (
    <Card title="Dependencies">
      {blockers.length > 0 ? (
        blockers.map((id) => <EntityChip key={id} kind="blocker" label={id} />)
      ) : (
        <Notice tone="success" label="Clear">No active blockers.</Notice>
      )}
    </Card>
  );
}

export function LineagePanel({ work }: { readonly work: WorkItemView }) {
  return (
    <Card title="Lineage">
      <EntityChip kind={work.kind} label={work.id} />
      {work.dependencyIds.map((id) => <EntityChip key={id} kind="depends" label={id} />)}
    </Card>
  );
}

const DIRECTIVE_LANES: readonly { readonly id: WorkDirectiveLane; readonly label: string; readonly tone: Tone }[] = [
  { id: "blocking", label: "blocking", tone: "danger" },
  { id: "required", label: "required", tone: "warning" },
  { id: "advisory", label: "advisory", tone: "accent" }
];

export function DirectiveSummaryPanel({
  work,
  title = "Agent directives"
}: {
  readonly work: WorkItemView;
  readonly title?: string;
}) {
  const summary = work.directiveSummary;
  if (!summary || summary.total === 0) {
    return (
      <Card title={title} eyebrow={work.id}>
        <Notice label="Agent directives">No directive bundle data is available for this work item.</Notice>
      </Card>
    );
  }

  return (
    <Card title={title} eyebrow={`${summary.total} directive${summary.total === 1 ? "" : "s"}`}>
      <div className="bw-directive-summary" aria-label={`${work.title} directive obligations`}>
        <div className="bw-directive-summary__counts">
          <Badge tone={summary.blocking > 0 ? "danger" : "neutral"}>{summary.blocking} blocking</Badge>
          <Badge tone={summary.required > 0 ? "warning" : "neutral"}>{summary.required} required</Badge>
          <Badge tone={summary.advisory > 0 ? "accent" : "neutral"}>{summary.advisory} advisory</Badge>
          {summary.conflictCount > 0 ? <Badge tone="danger">{summary.conflictCount} conflicts</Badge> : null}
          {summary.missingRequiredCount > 0 ? <Badge tone="danger">{summary.missingRequiredCount} missing required</Badge> : null}
          {summary.acknowledgementCount > 0 ? <Badge tone="warning">{summary.acknowledgementCount} acknowledgements</Badge> : null}
          {summary.blockerIds.length > 0 ? <Badge tone="danger">{summary.blockerIds.length} blocker refs</Badge> : null}
          {summary.nextSteps.length > 0 ? <Badge tone="accent">{summary.nextSteps.length} next steps</Badge> : null}
        </div>
        <DirectiveObligationsPanel summary={summary} />
        {summary.safeCommands.length > 0 ? (
          <div className="bw-directive-source-commands" aria-label="Directive source commands">
            {summary.safeCommands.map((command) => <code key={command}>{command}</code>)}
          </div>
        ) : null}
        <div className="bw-directive-groups">
          {DIRECTIVE_LANES.map((lane) => {
            const items = summary.items.filter((item) => item.lane === lane.id);
            return items.length > 0 ? <DirectiveGroup key={lane.id} lane={lane} items={items} /> : null;
          })}
        </div>
      </div>
    </Card>
  );
}

function DirectiveObligationsPanel({ summary }: { readonly summary: WorkDirectiveSummaryView }) {
  const acknowledgementItems = summary.items.filter((item) => item.acknowledgement);
  if (
    summary.blockerIds.length === 0 &&
    summary.conflicts.length === 0 &&
    summary.missingRequired.length === 0 &&
    acknowledgementItems.length === 0 &&
    summary.nextSteps.length === 0
  ) {
    return null;
  }
  return (
    <div className="bw-directive-obligations">
      {summary.blockerIds.length > 0 ? (
        <section className="bw-directive-obligation bw-directive-obligation--danger" aria-label="Required blockers">
          <header>
            <strong>Required blockers</strong>
            <Badge tone="danger">{summary.blockerIds.length}</Badge>
          </header>
          <div className="bw-directive-row__ids">
            {summary.blockerIds.map((id) => <EntityChip key={id} kind="blocker" label={id} />)}
          </div>
        </section>
      ) : null}
      {summary.conflicts.length > 0 ? (
        <section className="bw-directive-obligation bw-directive-obligation--danger" aria-label="Directive conflicts">
          <header>
            <strong>Directive conflicts</strong>
            <Badge tone="danger">{summary.conflicts.length}</Badge>
          </header>
          <div className="bw-directive-list">
            {summary.conflicts.map((conflict) => <DirectiveConflictRow key={conflict.id} conflict={conflict} />)}
          </div>
        </section>
      ) : null}
      {summary.missingRequired.length > 0 ? (
        <section className="bw-directive-obligation bw-directive-obligation--danger" aria-label="Missing required directive data">
          <header>
            <strong>Missing required directive data</strong>
            <Badge tone="danger">{summary.missingRequired.length}</Badge>
          </header>
          <div className="bw-directive-list">
            {summary.missingRequired.map((missing) => <DirectiveMissingRequiredRow key={missing.id} missing={missing} />)}
          </div>
        </section>
      ) : null}
      {acknowledgementItems.length > 0 ? (
        <section className="bw-directive-obligation" aria-label="Directive acknowledgements">
          <header>
            <strong>Directive acknowledgements</strong>
            <Badge tone="warning">{acknowledgementItems.length}</Badge>
          </header>
          <div className="bw-directive-list">
            {acknowledgementItems.map((item) => (
              <DirectiveAcknowledgementRow key={item.id} itemId={item.id} acknowledgement={item.acknowledgement!} />
            ))}
          </div>
        </section>
      ) : null}
      {summary.nextSteps.length > 0 ? (
        <section className="bw-directive-obligation" aria-label="Safe next workflow commands">
          <header>
            <strong>Safe next workflow commands</strong>
            <Badge tone="accent">{summary.nextSteps.length}</Badge>
          </header>
          <div className="bw-directive-list">
            {summary.nextSteps.map((step) => <DirectiveNextStepRow key={step.id} step={step} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DirectiveAcknowledgementRow({
  itemId,
  acknowledgement
}: {
  readonly itemId: string;
  readonly acknowledgement: WorkDirectiveAcknowledgementView;
}) {
  return (
    <article className="bw-directive-mini-row bw-directive-mini-row--required">
      <div className="bw-directive-row__header">
        <div>
          <strong>{itemId}</strong>
          <span>{acknowledgement.message}</span>
        </div>
        <Badge tone="warning">acknowledgement</Badge>
      </div>
      <div className="bw-directive-row__meta">
        <Badge tone="warning">before {acknowledgement.requiredBefore}</Badge>
        {acknowledgement.evidenceKind ? <Badge>{acknowledgement.evidenceKind}</Badge> : null}
      </div>
    </article>
  );
}

function DirectiveConflictRow({ conflict }: { readonly conflict: WorkDirectiveConflictView }) {
  return (
    <article className={`bw-directive-mini-row bw-directive-mini-row--${conflict.lane}`}>
      <div className="bw-directive-row__header">
        <div>
          <strong>{conflict.resolution}</strong>
          <span>{conflict.reason}</span>
        </div>
        <Badge tone={directiveLaneTone(conflict.lane)}>{conflict.severity}</Badge>
      </div>
      <div className="bw-directive-row__meta">
        {conflict.resolvedDirectiveId ? <Badge tone="success">resolved {conflict.resolvedDirectiveId}</Badge> : null}
        {conflict.directiveIds.map((id) => <Badge key={id}>{id}</Badge>)}
      </div>
    </article>
  );
}

function DirectiveMissingRequiredRow({ missing }: { readonly missing: WorkDirectiveMissingRequiredView }) {
  return (
    <article className="bw-directive-mini-row bw-directive-mini-row--required">
      <div className="bw-directive-row__header">
        <div>
          <strong>{missing.registryId}</strong>
          <span>{missing.message}</span>
        </div>
        <Badge tone="danger">missing</Badge>
      </div>
      <div className="bw-directive-row__meta">
        <Badge tone="warning">{missing.requirement}</Badge>
        {missing.family ? <Badge>{missing.family}</Badge> : null}
        {missing.subjectType ? <Badge>{missing.subjectType}</Badge> : null}
        {missing.subjectId ? <Badge>{missing.subjectId}</Badge> : null}
      </div>
    </article>
  );
}

function DirectiveNextStepRow({ step }: { readonly step: WorkDirectiveNextStepView }) {
  return (
    <article className={`bw-directive-mini-row bw-directive-mini-row--${step.lane}`}>
      <div className="bw-directive-row__header">
        <div>
          <strong>{step.title}</strong>
          <span>{step.reason}</span>
        </div>
        <Badge tone={directiveLaneTone(step.lane)}>{step.lane}</Badge>
      </div>
      {step.workflowRef ? <code>{step.workflowRef}</code> : null}
      {step.command ? <code>{step.command}</code> : null}
      {step.relatedIds.length > 0 ? (
        <div className="bw-directive-row__ids">
          {step.relatedIds.map((id) => <EntityChip key={id} kind="related" label={id} />)}
        </div>
      ) : null}
    </article>
  );
}

function DirectiveGroup({
  lane,
  items
}: {
  readonly lane: { readonly id: WorkDirectiveLane; readonly label: string; readonly tone: Tone };
  readonly items: readonly WorkDirectiveItemView[];
}) {
  return (
    <section className={`bw-directive-group bw-directive-group--${lane.id}`} aria-label={`${lane.label} directives`}>
      <header className="bw-directive-group__header">
        <strong>{lane.label} directives</strong>
        <Badge tone={lane.tone}>{items.length}</Badge>
      </header>
      <div className="bw-directive-list">
        {items.map((item) => <DirectiveRow key={item.id} item={item} />)}
      </div>
    </section>
  );
}

function DirectiveRow({ item }: { readonly item: WorkDirectiveItemView }) {
  return (
    <article className={`bw-directive-row bw-directive-row--${item.lane}`}>
      <div className="bw-directive-row__header">
        <div>
          <strong>{item.title}</strong>
          <span>{item.id}</span>
        </div>
        <Badge tone={directiveLaneTone(item.lane)}>{item.lane}</Badge>
      </div>
      <div className="bw-directive-row__meta">
        <Badge>{item.registryId}</Badge>
        <Badge>{item.severity}</Badge>
        {item.blocksCloseout ? <Badge tone="danger">blocks closeout</Badge> : null}
        {item.acknowledgement ? <Badge tone="warning">acknowledgement before {item.acknowledgement.requiredBefore}</Badge> : null}
        {item.family ? <Badge>{item.family}</Badge> : null}
        {item.kind ? <Badge>{item.kind}</Badge> : null}
      </div>
      <p>{item.reason}</p>
      {item.acknowledgement ? <p>{item.acknowledgement.message}</p> : null}
      {item.workflowRef ? <code>{item.workflowRef}</code> : null}
      {item.recoveryWorkflow ? <code>{item.recoveryWorkflow}</code> : null}
      {item.nextCommand && item.nextCommand !== item.sourceCommand ? <code>{item.nextCommand}</code> : null}
      {item.requiredInputs.length > 0 ? (
        <div className="bw-directive-row__meta" aria-label="Required directive inputs">
          {item.requiredInputs.map((input) => <Badge key={input}>{input}</Badge>)}
        </div>
      ) : null}
      {item.relatedIds.length > 0 ? (
        <div className="bw-directive-row__ids" aria-label="Related records">
          {item.relatedIds.map((id) => <EntityChip key={id} kind="related" label={id} />)}
        </div>
      ) : null}
      {item.sourceCommand ? <code>{item.sourceCommand}</code> : null}
    </article>
  );
}

function directiveLaneTone(lane: WorkDirectiveLane): Tone {
  switch (lane) {
    case "blocking":
      return "danger";
    case "required":
      return "warning";
    case "advisory":
      return "accent";
  }
}

export function HealthFindingList({ findings }: { readonly findings: readonly DashboardFinding[] }) {
  if (findings.length === 0) return <Notice tone="success" label="Health">No findings.</Notice>;
  return (
    <Card title="Findings">
      <ul className="bw-finding-list">
        {findings.map((finding) => (
          <li key={finding.code} className="bw-finding-list__item">
            <Badge tone={toneForFinding(finding.severity)}>{finding.severity}</Badge>
            <div>
              <div className="bw-finding-list__title">{finding.title}</div>
              <div className="bw-finding-list__message">{finding.message}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function WorkItemDetailPage({ work }: { readonly work: WorkItemView }) {
  return (
    <article className="bw-work-detail">
      <EntityDetailHeader title={work.title} kind={work.kind} status={work.status} labels={work.labels} />
      <VerificationPanel work={work} />
      <DirectiveSummaryPanel work={work} />
      <DependencyPanel work={work} />
      <LineagePanel work={work} />
    </article>
  );
}

export function RawSourcePreview({ title, body }: { readonly title: string; readonly body?: string }) {
  return (
    <Card title={title} eyebrow="Raw source">
      {body ? <pre className="bw-raw-preview">{body}</pre> : <Notice label="Empty">No preview available.</Notice>}
    </Card>
  );
}

function selectionHref(routePath: string, key: string, value: string): string {
  const [path, rest = ""] = (routePath || "/").split("?");
  const params = new URLSearchParams(rest.split("#")[0]);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

export function RawInboxPanel({ view, routePath = "/" }: { readonly view: RawInboxView; readonly routePath?: string }) {
  return (
    <Card title="Raw inbox" eyebrow={`${view.summary.total} source${view.summary.total === 1 ? "" : "s"}`}>
      <div className="bw-raw-summary" aria-label="Raw inbox summary">
        <Badge tone="neutral">{view.summary.queued} queued</Badge>
        <Badge tone="success">{view.summary.linked} linked</Badge>
        <Badge tone={view.summary.missingPreview > 0 ? "warning" : "neutral"}>{view.summary.missingPreview} missing previews</Badge>
        <Badge tone={view.summary.unsupportedPreview > 0 ? "warning" : "neutral"}>
          {view.summary.unsupportedPreview} unsupported previews
        </Badge>
      </div>
      {view.warnings.length > 0 ? (
        <Notice tone="warning" label="Raw inbox">
          {view.warnings.join(" ")}
        </Notice>
      ) : null}
      {view.rows.length === 0 ? (
        <Notice label="Raw inbox">No raw sources are present in the configured vault.</Notice>
      ) : (
        <table className="bw-work-table bw-raw-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>URI</th>
              <th>Retrieve</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <RawInboxRow key={row.id} row={row} routePath={routePath} selected={row.id === view.selected?.id} />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function RawAssetPreviewPanel({ source }: { readonly source?: RawSourceDetailView }) {
  if (!source) {
    return (
      <Card title="Source preview" eyebrow="Raw asset">
        <Notice label="Empty">Select a raw source to inspect its preview and retrieval command.</Notice>
      </Card>
    );
  }
  const preview = source.preview;
  return (
    <Card title={source.title} eyebrow="Source preview">
      <div className="bw-raw-preview-meta">
        <Badge tone={toneForRawStatus(source.processingStatus)}>{source.processingStatus}</Badge>
        <Badge>{source.kind}</Badge>
        <Badge tone="success">{source.sourceBacked ? "source-backed" : "unbacked"}</Badge>
        <Badge tone="success">{source.immutable ? "immutable" : "mutable"}</Badge>
      </div>
      <RawPreviewBody preview={preview} />
      <div className="bw-raw-commands">
        <div>
          <span>Retrieve</span>
          <code>{source.retrievalCommand}</code>
        </div>
        <div>
          <span>Preview</span>
          <code>{source.previewCommand}</code>
        </div>
      </div>
      {source.linkedPages.length > 0 ? (
        <ul className="bw-ref-list">
          {source.linkedPages.map((page) => (
            <li key={`${page.id}:${page.path}`} className="bw-ref-list__item">
              <EntityChip kind="wiki" label={page.title} />
              <span>{page.path}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Notice label="Processing">No wiki page links this source yet.</Notice>
      )}
    </Card>
  );
}

export function RawIngestPlanPanel({ plan }: { readonly plan?: RawIngestPlanView }) {
  if (!plan) {
    return (
      <Card title="Ingest plan" eyebrow="Review before write">
        <Notice label="Empty">Select a raw source to generate proposed memory mutations.</Notice>
      </Card>
    );
  }
  return (
    <Card title="Ingest plan" eyebrow={plan.sourceTitle}>
      <div className="bw-raw-source-links">
        {plan.sourceLinks.map((link) => (
          <div key={`${link.label}:${link.ref}`}>
            <span>{link.label}</span>
            <code>{link.ref}</code>
            {link.command ? <code>{link.command}</code> : null}
          </div>
        ))}
      </div>
      <div className="bw-ingest-commands">
        {plan.applyCommands.length === 0 ? (
          <Notice tone="warning" label="Workflows">All proposed mutations need review before opening a workflow action.</Notice>
        ) : (
          plan.applyCommands.map((command) => (
            <div key={command}>
              <span>Open workflow</span>
              <code>{command}</code>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export function RawDiffReviewPanel({ plan }: { readonly plan?: RawIngestPlanView }) {
  if (!plan) {
    return (
      <Card title="Diff review" eyebrow="Planned mutations">
        <Notice label="Empty">No ingest plan is available.</Notice>
      </Card>
    );
  }
  return (
    <Card title="Diff review" eyebrow={`${plan.mutations.length} mutation${plan.mutations.length === 1 ? "" : "s"}`}>
      <div className="bw-ingest-findings">
        {plan.findings.map((finding) => <RawIngestFinding key={finding.id} finding={finding} />)}
      </div>
      <div className="bw-ingest-mutations">
        {plan.mutations.map((mutation) => <RawIngestMutation key={mutation.id} mutation={mutation} />)}
      </div>
    </Card>
  );
}

export function RawContradictionReviewPanel({ review }: { readonly review?: RawContradictionReviewView }) {
  if (!review) {
    return (
      <Card title="Contradictions" eyebrow="Resolution review">
        <Notice label="Empty">No contradiction review is available.</Notice>
      </Card>
    );
  }
  return (
    <Card title="Contradictions" eyebrow={`${review.summary.total} conflict${review.summary.total === 1 ? "" : "s"}`}>
      <div className="bw-contradiction-summary">
        <Badge tone={review.summary.high > 0 ? "danger" : "neutral"}>{review.summary.high} high</Badge>
        <Badge tone={review.summary.medium > 0 ? "warning" : "neutral"}>{review.summary.medium} medium</Badge>
        <Badge tone="neutral">{review.summary.low} low</Badge>
      </div>
      <div className="bw-contradiction-list">
        {review.conflicts.map((conflict) => <RawContradictionConflict key={conflict.id} conflict={conflict} />)}
      </div>
    </Card>
  );
}

export function WikiExplorerPanel({ view, routePath = "/" }: { readonly view: WikiExplorerView; readonly routePath?: string }) {
  return (
    <Card title="Wiki explorer" eyebrow={`${view.summary.total} page${view.summary.total === 1 ? "" : "s"}`}>
      <div className="bw-wiki-summary" aria-label="Wiki summary">
        <Badge tone={view.summary.accepted > 0 ? "success" : "neutral"}>{view.summary.accepted} accepted</Badge>
        <Badge tone={view.summary.draft > 0 ? "warning" : "neutral"}>{view.summary.draft} draft</Badge>
        <Badge tone={view.summary.proposed > 0 ? "warning" : "neutral"}>{view.summary.proposed} proposed</Badge>
        <Badge tone={view.summary.missingSources > 0 ? "danger" : "neutral"}>{view.summary.missingSources} source gaps</Badge>
      </div>
      {view.warnings.length > 0 ? <Notice tone="warning" label="Wiki">{view.warnings.join(" ")}</Notice> : null}
      {view.rows.length === 0 ? (
        <Notice label="Wiki">No wiki pages are present in the configured vault.</Notice>
      ) : (
        <table className="bw-work-table bw-wiki-table">
          <thead>
            <tr>
              <th>Page</th>
              <th>Truth</th>
              <th>Coverage</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <WikiExplorerRow
                key={`${row.id}:${row.slug}`}
                row={row}
                routePath={routePath}
                selected={(row.id || row.slug) === (view.selected?.id || view.selected?.slug)}
              />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function KnowledgeHealthPanel({ view }: { readonly view: WikiExplorerView }) {
  return (
    <Card title="Knowledge health" eyebrow={`${view.healthSummary.findings} finding${view.healthSummary.findings === 1 ? "" : "s"}`}>
      <div className="bw-wiki-summary" aria-label="Knowledge health summary">
        <Badge tone={view.healthSummary.warnings > 0 ? "warning" : "neutral"}>{view.healthSummary.warnings} warnings</Badge>
        <Badge tone={view.healthSummary.dangers > 0 ? "danger" : "neutral"}>{view.healthSummary.dangers} dangers</Badge>
        <Badge tone={view.healthSummary.staleClaims > 0 ? "warning" : "neutral"}>{view.healthSummary.staleClaims} stale claims</Badge>
        <Badge tone={view.healthSummary.orphanSources > 0 ? "warning" : "neutral"}>{view.healthSummary.orphanSources} orphan sources</Badge>
        <Badge tone={view.healthSummary.missingPageCoverage > 0 ? "danger" : "neutral"}>
          {view.healthSummary.missingPageCoverage} page coverage
        </Badge>
      </div>
      {view.healthFindings.length === 0 ? (
        <Notice tone="success" label="Knowledge health">No stale assertions, orphan sources, or missing page coverage.</Notice>
      ) : (
        <div className="bw-knowledge-health">
          {view.healthFindings.map((finding) => <KnowledgeHealthFinding key={finding.id} finding={finding} />)}
        </div>
      )}
    </Card>
  );
}

export function WikiPageDetailPanel({ page }: { readonly page?: WikiPageDetailView }) {
  if (!page) {
    return (
      <Card title="Page detail" eyebrow="Wiki">
        <Notice label="Empty">Select a wiki page to inspect backlinks, outbound links, claims, decisions, and source coverage.</Notice>
      </Card>
    );
  }
  return (
    <Card title={page.title} eyebrow="Page detail">
      <div className="bw-wiki-summary">
        <Badge tone={toneForWikiTruth(page.truthStatus)}>{page.truthStatus}</Badge>
        <Badge tone={toneForCoverage(page.sourceCoverageStatus)}>{page.sourceCoverageStatus}</Badge>
        <Badge>{page.sourceRefCount} sources</Badge>
        <Badge>{page.backlinkCount} backlinks</Badge>
      </div>
      <div className="bw-raw-commands">
        <div>
          <span>Show</span>
          <code>{page.showCommand}</code>
        </div>
        <div>
          <span>Path</span>
          <code>{page.path}</code>
        </div>
      </div>
      <WikiLinkList title="Backlinks" pages={page.backlinks} empty="No structured backlinks target this page." />
      <WikiLinkList title="Outbound pages" pages={page.outboundPages} empty="No outbound wiki links resolve to known pages." />
      {page.missingOutboundLinks.length > 0 ? (
        <Notice tone="warning" label="Missing links">{page.missingOutboundLinks.join(", ")}</Notice>
      ) : null}
    </Card>
  );
}

export function WikiSourceCoveragePanel({ page }: { readonly page?: WikiPageDetailView }) {
  if (!page) {
    return (
      <Card title="Source coverage" eyebrow="Wiki">
        <Notice label="Empty">No wiki page is selected.</Notice>
      </Card>
    );
  }
  const coverage = page.sourceCoverage;
  return (
    <Card title="Source coverage" eyebrow={page.title}>
      <div className="bw-wiki-summary">
        <Badge tone={toneForCoverage(coverage.status)}>{coverage.status}</Badge>
        <Badge>{coverage.coveredRefs.length} covered</Badge>
        <Badge tone={coverage.missingRefs.length > 0 ? "danger" : "neutral"}>{coverage.missingRefs.length} missing</Badge>
      </div>
      <div className="bw-wiki-coverage">
        <div>
          <span>Source refs</span>
          <code>{coverage.sourceRefs.length > 0 ? coverage.sourceRefs.join(", ") : "none"}</code>
        </div>
        <div>
          <span>Raw sources</span>
          <code>{coverage.rawSources.length > 0 ? coverage.rawSources.map((source) => source.id).join(", ") : "none"}</code>
        </div>
        <div>
          <span>Runtime sources</span>
          <code>{coverage.runtimeSources.length > 0 ? coverage.runtimeSources.map((source) => source.id).join(", ") : "none"}</code>
        </div>
        <div>
          <span>Missing refs</span>
          <code>{coverage.missingRefs.length > 0 ? coverage.missingRefs.join(", ") : "none"}</code>
        </div>
      </div>
    </Card>
  );
}

export function WikiClaimsPanel({ page }: { readonly page?: WikiPageDetailView }) {
  if (!page) {
    return (
      <Card title="Claims and decisions" eyebrow="Wiki">
        <Notice label="Empty">No wiki page is selected.</Notice>
      </Card>
    );
  }
  return (
    <Card title="Claims and decisions" eyebrow={page.title}>
      <div className="bw-wiki-records">
        {page.claims.length === 0 ? <Notice label="Claims">No runtime claims reference this page's structured sources.</Notice> : null}
        {page.claims.map((claim) => (
          <div key={claim.id}>
            <Badge tone={toneForWikiTruth(claim.status)}>{claim.status}</Badge>
            <strong>{claim.statement}</strong>
            <span>{claim.sourceIds.join(", ")}</span>
          </div>
        ))}
        {page.decisions.length === 0 ? <Notice label="Decisions">No runtime decisions reference this page's structured sources.</Notice> : null}
        {page.decisions.map((decision) => (
          <div key={decision.id}>
            <Badge tone={toneForWikiTruth(decision.status)}>{decision.status}</Badge>
            <strong>{decision.title}</strong>
            <p>{decision.decision}</p>
            <span>{decision.sourceIds.join(", ")}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ClaimsTablePanel({ view, statusFilter, sourceFilter }: {
  readonly view: WikiExplorerView;
  readonly statusFilter?: string;
  readonly sourceFilter?: string;
}) {
  const claims = view.claims.filter((claim) =>
    (!statusFilter || claim.status === statusFilter) &&
    (!sourceFilter || claim.sourceIds.includes(sourceFilter))
  );
  return (
    <Card title="Claims table" eyebrow={`${claims.length} visible`}>
      <div className="bw-wiki-summary" aria-label="Claim status summary">
        <Badge tone="success">{view.reviewSummary.acceptedClaims} accepted</Badge>
        <Badge tone="warning">{view.reviewSummary.proposedClaims} proposed</Badge>
        <Badge tone="danger">{view.reviewSummary.rejectedClaims} rejected</Badge>
        <Badge tone="danger">{view.reviewSummary.staleClaims} stale</Badge>
      </div>
      <FilterLinks
        label="Claim filters"
        statuses={view.filters.claimStatuses}
        statusParam="claimStatus"
        sourceIds={view.filters.sourceIds}
        activeStatus={statusFilter}
        activeSource={sourceFilter}
      />
      {claims.length === 0 ? (
        <Notice label="Claims">No claims match the selected filters.</Notice>
      ) : (
        <table className="bw-work-table bw-wiki-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Statement</th>
              <th>Evidence</th>
              <th>Sources</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.id}>
                <td><Badge tone={toneForWikiTruth(claim.status)}>{claim.status}</Badge></td>
                <td>
                  <strong>{claim.statement}</strong>
                  <span>{claim.id}</span>
                </td>
                <td>
                  <span>{claim.evidenceCount} evidence</span>
                  <span>{claim.evidenceIds.join(", ") || "none"}</span>
                </td>
                <td><code>{claim.sourceIds.join(", ") || "none"}</code></td>
                <td><Badge tone={toneForReviewState(claim.reviewState)}>{claim.reviewState}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function KnowledgeDecisionTimelinePanel({ view, statusFilter, sourceFilter }: {
  readonly view: WikiExplorerView;
  readonly statusFilter?: string;
  readonly sourceFilter?: string;
}) {
  const decisions = view.decisionTimeline.filter((decision) =>
    (!statusFilter || decision.status === statusFilter) &&
    (!sourceFilter || decision.sourceIds.includes(sourceFilter))
  );
  return (
    <Card title="Decision timeline" eyebrow={`${decisions.length} visible`}>
      <div className="bw-wiki-summary" aria-label="Decision status summary">
        <Badge tone="success">{view.reviewSummary.acceptedDecisions} accepted</Badge>
        <Badge tone="warning">{view.reviewSummary.proposedDecisions} proposed</Badge>
        <Badge tone="danger">{view.reviewSummary.rejectedDecisions} rejected</Badge>
        <Badge tone="danger">{view.reviewSummary.supersededDecisions} superseded</Badge>
      </div>
      <FilterLinks
        label="Decision filters"
        statuses={view.filters.decisionStatuses}
        statusParam="decisionStatus"
        sourceIds={view.filters.sourceIds}
        activeStatus={statusFilter}
        activeSource={sourceFilter}
      />
      <div className="bw-decision-timeline">
        {decisions.length === 0 ? <Notice label="Decisions">No decisions match the selected filters.</Notice> : null}
        {decisions.map((decision) => (
          <article key={decision.id} className="bw-decision-event">
            <header>
              <div>
                <strong>{decision.title}</strong>
                <span>{decision.updatedAt ?? decision.id}</span>
              </div>
              <Badge tone={toneForWikiTruth(decision.status)}>{decision.status}</Badge>
            </header>
            <p>{decision.context || "No context recorded."}</p>
            <blockquote>{decision.decision}</blockquote>
            <dl className="bw-ingest-diff">
              <div>
                <dt>Consequences</dt>
                <dd>{decision.consequences.length > 0 ? decision.consequences.join(" ") : "none"}</dd>
              </div>
              <div>
                <dt>Sources</dt>
                <dd>{decision.sourceIds.join(", ") || "none"}</dd>
              </div>
              <div>
                <dt>Review</dt>
                <dd>{decision.reviewState}{decision.supersessionStatus ? ` / ${decision.supersessionStatus}` : ""}</dd>
              </div>
            </dl>
            <div className="bw-wiki-coverage">
              {decision.sourceIds.length === 0 ? (
                <div>
                  <span>Source drilldown</span>
                  <code>none</code>
                </div>
              ) : decision.sourceIds.map((sourceId) => (
                <div key={`${decision.id}:${sourceId}`}>
                  <span>Source drilldown</span>
                  <code>{`bwrk decision list --source ${sourceId} --json`}</code>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </Card>
  );
}

export function ReportsBrowserPanel({ view }: { readonly view: ReportsView }) {
  return (
    <Card title="Reports browser" eyebrow={`${view.summary.artifactCount} artifact${view.summary.artifactCount === 1 ? "" : "s"}`}>
      <div className="bw-wiki-summary" aria-label="Reports summary">
        <Badge tone="neutral">{view.summary.markdownArtifacts} markdown</Badge>
        <Badge tone="neutral">{view.summary.htmlArtifacts} html</Badge>
        <Badge tone={view.summary.staleArtifacts > 0 ? "warning" : "success"}>{view.summary.staleArtifacts} stale</Badge>
        <Badge tone="neutral">{view.summary.staticExportCount} exports</Badge>
      </div>
      {view.warnings.length > 0 ? <Notice tone="warning" label="Reports">{view.warnings.join(" ")}</Notice> : null}
      {view.artifacts.length === 0 ? (
        <Notice label="Reports">No stored report artifacts are present under .boreal/results.</Notice>
      ) : (
        <table className="bw-work-table bw-report-table">
          <thead>
            <tr>
              <th>Artifact</th>
              <th>Kind</th>
              <th>Freshness</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {view.artifacts.map((artifact) => <ReportArtifactRow key={artifact.id} artifact={artifact} />)}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function StaticExportsPanel({ view }: { readonly view: ReportsView }) {
  return (
    <Card title="Static exports" eyebrow={`${view.staticExports.length} reproducible command${view.staticExports.length === 1 ? "" : "s"}`}>
      <div className="bw-report-export-list">
        {view.staticExports.map((item) => <StaticExportCard key={item.id} item={item} />)}
      </div>
    </Card>
  );
}

export function StaticKnowledgeReportPanel({ view }: { readonly view: ReportsView }) {
  const report = view.knowledgeReport;
  return (
    <Card title={report.title} eyebrow={report.generatedAt}>
      <div className="bw-wiki-summary" aria-label="Static knowledge report summary">
        <Badge tone="neutral">{report.summary.rawSources} raw</Badge>
        <Badge tone="neutral">{report.summary.wikiPages} pages</Badge>
        <Badge tone="neutral">{report.summary.claims} claims</Badge>
        <Badge tone="neutral">{report.summary.decisions} decisions</Badge>
        <Badge tone={report.summary.healthFindings > 0 ? "warning" : "success"}>{report.summary.healthFindings} health</Badge>
        <Badge tone={report.stale ? "warning" : "success"}>{report.stale ? "stale" : "fresh"}</Badge>
      </div>
      {report.stale ? <Notice tone="warning" label="Static report">Generated state is stale; rerun an export command before sharing.</Notice> : null}
      <div className="bw-report-commands">
        {report.commands.map((command) => (
          <div key={command}>
            <span>Reproduce</span>
            <code>{command}</code>
          </div>
        ))}
      </div>
      <pre className="bw-raw-preview">{report.markdown}</pre>
    </Card>
  );
}

export function MemoryWorkflowActionsPanel({ view }: { readonly view: MemoryDashboardActionsView }) {
  return (
    <Card title="Memory workflow actions" eyebrow={`${view.summary.total} workflow-backed action${view.summary.total === 1 ? "" : "s"}`}>
      <div className="bw-wiki-summary" aria-label="Memory workflow action summary">
        <Badge tone="neutral">{view.summary.add} add</Badge>
        <Badge tone="neutral">{view.summary.update} update</Badge>
        <Badge tone="neutral">{view.summary.retrieve} retrieve</Badge>
        <Badge tone="neutral">{view.summary.reconcile} reconcile</Badge>
      </div>
      {view.warnings.length > 0 ? <Notice tone="warning" label="Workflows">{view.warnings.join(" ")}</Notice> : null}
      <table className="bw-work-table bw-workflow-action-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Skill adapter</th>
            <th>Workflow source</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {view.actions.map((action) => <MemoryWorkflowActionRow key={action.id} action={action} />)}
        </tbody>
      </table>
    </Card>
  );
}

export function ObsidianCompatibilityPanel({ view }: { readonly view: WikiExplorerView }) {
  const obsidian = view.obsidian;
  return (
    <Card title="Obsidian compatibility" eyebrow={obsidian.vaultName}>
      <div className="bw-wiki-summary" aria-label="Obsidian compatibility summary">
        <Badge tone={obsidian.obsidianUriAvailable ? "success" : "neutral"}>
          {obsidian.summary.obsidianUris} Obsidian URI{obsidian.summary.obsidianUris === 1 ? "" : "s"}
        </Badge>
        <Badge tone={obsidian.summary.frontmatterComplete > 0 ? "success" : "neutral"}>{obsidian.summary.frontmatterComplete} complete frontmatter</Badge>
        <Badge tone={obsidian.summary.frontmatterPartial > 0 ? "warning" : "neutral"}>{obsidian.summary.frontmatterPartial} partial</Badge>
        <Badge tone={obsidian.summary.frontmatterMissing > 0 ? "danger" : "neutral"}>{obsidian.summary.frontmatterMissing} missing</Badge>
        <Badge tone={obsidian.summary.linkWarnings > 0 ? "warning" : "success"}>{obsidian.summary.linkWarnings} link warnings</Badge>
        <Badge tone={obsidian.summary.invalidPaths > 0 ? "danger" : "success"}>{obsidian.summary.invalidPaths} invalid paths</Badge>
      </div>
      {obsidian.warnings.map((warning) => <Notice key={warning} tone="warning" label="Obsidian">{warning}</Notice>)}
      {obsidian.invalidPathFindings.length > 0 ? (
        <div className="bw-obsidian-invalid">
          {obsidian.invalidPathFindings.map((finding) => <VaultInvalidPathFinding key={finding.id} finding={finding} />)}
        </div>
      ) : null}
      {obsidian.pages.length === 0 ? (
        <Notice label="Obsidian">No wiki pages are present in the configured vault.</Notice>
      ) : (
        <table className="bw-work-table bw-obsidian-table">
          <thead>
            <tr>
              <th>Page</th>
              <th>Frontmatter</th>
              <th>Link health</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {obsidian.pages.map((page) => <ObsidianPageRow key={page.id} page={page} />)}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function VaultDashboardLinksPanel({ view }: { readonly view: WikiExplorerView }) {
  const obsidian = view.obsidian;
  return (
    <Card title="Vault dashboard links" eyebrow={`${obsidian.dashboardLinks.length} link${obsidian.dashboardLinks.length === 1 ? "" : "s"}`}>
      <div className="bw-vault-link-grid">
        {obsidian.dashboardLinks.map((link) => <VaultDashboardLink key={link.id} link={link} />)}
      </div>
    </Card>
  );
}

function KnowledgeHealthFinding({ finding }: { readonly finding: WikiHealthFindingView }) {
  return (
    <article className="bw-health-finding">
      <header className="bw-health-finding__header">
        <div>
          <strong>{finding.title}</strong>
          <span>{finding.targetKind}: {finding.targetId}</span>
        </div>
        <Badge tone={toneForWikiHealth(finding.severity)}>{finding.severity}</Badge>
      </header>
      <p>{finding.detail}</p>
      <dl className="bw-ingest-diff">
        <div>
          <dt>Dashboard code</dt>
          <dd>{finding.code}</dd>
        </div>
        <div>
          <dt>Doctor code</dt>
          <dd>{finding.doctorCode}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{finding.targetKind}</dd>
        </div>
      </dl>
      <div className="bw-health-finding__actions">
        <a className="bw-filter-links__item" href={finding.href}>Open {finding.targetKind}</a>
        <code>{finding.command}</code>
      </div>
    </article>
  );
}

function MemoryWorkflowActionRow({ action }: { readonly action: MemoryWorkflowActionView }) {
  return (
    <tr>
      <td>
        <strong>{action.title}</strong>
        <span>{action.summary}</span>
      </td>
      <td>
        <Badge tone={toneForMemoryAction(action.kind)}>{action.kind}</Badge>
        <code>{action.skillRef}</code>
        <span>{action.skillName}</span>
      </td>
      <td>
        <strong>{action.workflowPath}</strong>
        <span>{action.workflowSourcePath}</span>
      </td>
      <td><code>{action.workflowCommand}</code></td>
    </tr>
  );
}

function ObsidianPageRow({ page }: { readonly page: ObsidianPageLinkView }) {
  return (
    <tr>
      <td>
        <strong>{page.title}</strong>
        <span>{page.path}</span>
        <code>{page.showCommand}</code>
      </td>
      <td>
        <Badge tone={toneForObsidianFrontmatter(page.frontmatterStatus)}>{page.frontmatterStatus}</Badge>
        <span>{page.frontmatterKeys.length > 0 ? page.frontmatterKeys.join(", ") : "no frontmatter keys"}</span>
      </td>
      <td>
        <Badge tone={toneForObsidianHealth(page.linkHealthStatus)}>{page.linkHealthStatus}</Badge>
        <span>{page.linkHealthDetail}</span>
      </td>
      <td>
        <div className="bw-vault-link-actions">
          <a className="bw-filter-links__item" href={page.href}>Console</a>
          {page.obsidianUri ? <a className="bw-filter-links__item" href={page.obsidianUri}>Obsidian URI</a> : <span>No Obsidian URI</span>}
        </div>
      </td>
    </tr>
  );
}

function VaultDashboardLink({ link }: { readonly link: VaultDashboardLinkView }) {
  return (
    <article className="bw-vault-link">
      <header>
        <div>
          <strong>{link.title}</strong>
          <span>{link.path}</span>
        </div>
        <Badge tone={toneForObsidianHealth(link.status)}>{link.status}</Badge>
      </header>
      <p>{link.detail}</p>
      <div className="bw-vault-link-actions">
        <a className="bw-filter-links__item" href={link.href}>Console</a>
        {link.obsidianUri ? <a className="bw-filter-links__item" href={link.obsidianUri}>Obsidian URI</a> : <span>No Obsidian URI</span>}
      </div>
    </article>
  );
}

function VaultInvalidPathFinding({ finding }: { readonly finding: VaultInvalidPathFindingView }) {
  return (
    <article className="bw-health-finding">
      <header className="bw-health-finding__header">
        <div>
          <strong>Invalid vault path</strong>
          <span>{finding.path}</span>
        </div>
        <Badge tone={toneForWikiHealth(finding.severity)}>{finding.severity}</Badge>
      </header>
      <p>{finding.detail}</p>
      <dl className="bw-ingest-diff">
        <div>
          <dt>Doctor code</dt>
          <dd>{finding.doctorCode}</dd>
        </div>
        <div>
          <dt>Expected</dt>
          <dd>{finding.expectedKind}</dd>
        </div>
      </dl>
      <code>{finding.command}</code>
    </article>
  );
}

function ReportArtifactRow({ artifact }: { readonly artifact: ReportArtifactView }) {
  return (
    <tr>
      <td>
        <strong>{artifact.title}</strong>
        <span>{artifact.path}</span>
        {artifact.preview ? <pre className="bw-report-preview">{artifact.preview}</pre> : null}
      </td>
      <td>
        <Badge tone="neutral">{artifact.kind}</Badge>
        <span>{formatBytes(artifact.bytes)}</span>
      </td>
      <td>
        <Badge tone={artifact.stale ? "warning" : "success"}>{artifact.stale ? "stale" : "fresh"}</Badge>
        <span>{artifact.updatedAt}</span>
      </td>
      <td><code>{artifact.openCommand}</code></td>
    </tr>
  );
}

function StaticExportCard({ item }: { readonly item: StaticReportExportView }) {
  return (
    <article className="bw-report-export">
      <header>
        <div>
          <strong>{item.title}</strong>
          <span>{item.outFile}</span>
        </div>
        <Badge tone={item.stale ? "warning" : "success"}>{item.stale ? "stale" : "fresh"}</Badge>
      </header>
      <p>{item.summary}</p>
      <dl className="bw-ingest-diff">
        <div>
          <dt>Route</dt>
          <dd>{item.route}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{item.format}</dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>{item.outFile}</dd>
        </div>
      </dl>
      <code>{item.command}</code>
    </article>
  );
}

function RawInboxRow({ row, routePath, selected }: { readonly row: RawSourceRowView; readonly routePath: string; readonly selected: boolean }) {
  return (
    <tr className={selected ? "bw-row--selected" : undefined} aria-current={selected ? "true" : undefined}>
      <td>
        <a className="bw-row-select" href={selectionHref(routePath, "source", row.id)}>{row.title}</a>
        <span>{row.id}</span>
        {row.summary ? <p className="bw-raw-table__summary">{row.summary}</p> : null}
      </td>
      <td>
        <div className="bw-raw-table__status">
          <Badge tone={toneForRawStatus(row.processingStatus)}>{row.processingStatus}</Badge>
          <Badge>{row.kind}</Badge>
          <Badge tone="success">{row.immutable ? "immutable" : "mutable"}</Badge>
          <span>{row.linkedPageCount} linked page{row.linkedPageCount === 1 ? "" : "s"}</span>
        </div>
      </td>
      <td>{row.uri ? <code>{row.uri}</code> : <span>No local URI</span>}</td>
      <td><code>{row.retrievalCommand}</code></td>
    </tr>
  );
}

function WikiExplorerRow({ row, routePath, selected }: { readonly row: WikiPageRowView; readonly routePath: string; readonly selected: boolean }) {
  return (
    <tr className={selected ? "bw-row--selected" : undefined} aria-current={selected ? "true" : undefined}>
      <td>
        <a className="bw-row-select" href={selectionHref(routePath, "page", row.id || row.slug)}>{row.title}</a>
        <span>{row.path}</span>
      </td>
      <td>
        <Badge tone={toneForWikiTruth(row.truthStatus)}>{row.truthStatus}</Badge>
      </td>
      <td>
        <div className="bw-raw-table__status">
          <Badge tone={toneForCoverage(row.sourceCoverageStatus)}>{row.sourceCoverageStatus}</Badge>
          <span>{row.sourceRefCount} source ref{row.sourceRefCount === 1 ? "" : "s"}</span>
          <span>{row.claimCount} claim{row.claimCount === 1 ? "" : "s"}</span>
          <span>{row.decisionCount} decision{row.decisionCount === 1 ? "" : "s"}</span>
        </div>
      </td>
      <td>
        <span>{row.backlinkCount} back / {row.outboundLinkCount} out</span>
      </td>
    </tr>
  );
}

function WikiLinkList({ title, pages, empty }: {
  readonly title: string;
  readonly pages: WikiPageDetailView["backlinks"];
  readonly empty: string;
}) {
  return pages.length > 0 ? (
    <div className="bw-wiki-links">
      <strong>{title}</strong>
      <ul className="bw-ref-list">
        {pages.map((page) => (
          <li key={`${title}:${page.id}:${page.slug}`} className="bw-ref-list__item">
            <EntityChip kind="wiki" label={page.title} />
            <Badge tone={toneForWikiTruth(page.truthStatus)}>{page.truthStatus}</Badge>
          </li>
        ))}
      </ul>
    </div>
  ) : <Notice label={title}>{empty}</Notice>;
}

function FilterLinks({ label, statuses, statusParam, sourceIds, activeStatus, activeSource }: {
  readonly label: string;
  readonly statuses: readonly string[];
  readonly statusParam: "claimStatus" | "decisionStatus";
  readonly sourceIds: readonly string[];
  readonly activeStatus?: string;
  readonly activeSource?: string;
}) {
  return (
    <div className="bw-filter-links" aria-label={label}>
      {statuses.map((status) => (
        <a
          key={`${statusParam}:${status}`}
          className={activeStatus === status ? "bw-filter-links__item bw-filter-links__item--active" : "bw-filter-links__item"}
          href={`/knowledge?${statusParam}=${encodeURIComponent(status)}${activeSource ? `&source=${encodeURIComponent(activeSource)}` : ""}`}
        >
          {status}
        </a>
      ))}
      {sourceIds.map((sourceId) => (
        <a
          key={`source:${sourceId}`}
          className={activeSource === sourceId ? "bw-filter-links__item bw-filter-links__item--active" : "bw-filter-links__item"}
          href={`/knowledge?source=${encodeURIComponent(sourceId)}${activeStatus ? `&${statusParam}=${encodeURIComponent(activeStatus)}` : ""}`}
        >
          {sourceId}
        </a>
      ))}
    </div>
  );
}

function RawContradictionConflict({ conflict }: { readonly conflict: RawContradictionConflictView }) {
  return (
    <div className="bw-contradiction">
      <header>
        <div>
          <strong>{conflict.title}</strong>
          <span>{conflict.sourceRefs.join(", ")}</span>
        </div>
        <Badge tone={toneForContradiction(conflict.severity)}>{conflict.severity}</Badge>
      </header>
      <dl className="bw-contradiction-assertions">
        <div>
          <dt>Current assertion</dt>
          <dd>{conflict.currentAssertion}</dd>
        </div>
        <div>
          <dt>Incoming assertion</dt>
          <dd>{conflict.incomingAssertion}</dd>
        </div>
      </dl>
      <div className="bw-contradiction-evidence">
        {conflict.evidenceLinks.map((link) => (
          <div key={`${conflict.id}:${link.label}:${link.ref}`}>
            <span>{link.label}</span>
            <code>{link.ref}</code>
            {link.command ? <code>{link.command}</code> : null}
          </div>
        ))}
      </div>
      <div className="bw-contradiction-resolutions">
        {conflict.resolutionCommands.map((resolution) => (
          <div key={`${conflict.id}:${resolution.action}`}>
            <strong>{resolution.label}</strong>
            <p>{resolution.auditTrail}</p>
            <code>{resolution.command}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function RawIngestFinding({ finding }: { readonly finding: RawIngestFindingView }) {
  return (
    <div className="bw-ingest-finding">
      <Badge tone={toneForIngestFinding(finding.severity)}>{finding.severity}</Badge>
      <div>
        <strong>{finding.title}</strong>
        <p>{finding.detail}</p>
        <span>{finding.sourceRefs.join(", ")}</span>
      </div>
    </div>
  );
}

function RawIngestMutation({ mutation }: { readonly mutation: RawIngestMutationView }) {
  return (
    <div className="bw-ingest-mutation">
      <header>
        <div>
          <strong>{mutation.title}</strong>
          <span>{mutation.kind}</span>
        </div>
        <Badge tone={toneForIngestStatus(mutation.status)}>{mutation.status}</Badge>
      </header>
      <p>{mutation.summary}</p>
      <dl className="bw-ingest-diff">
        {mutation.workflowPath ? (
          <div>
            <dt>Workflow</dt>
            <dd>{mutation.workflowPath}</dd>
          </div>
        ) : null}
        {mutation.skillRef ? (
          <div>
            <dt>Skill</dt>
            <dd>{mutation.skillRef}</dd>
          </div>
        ) : null}
        <div>
          <dt>Additions</dt>
          <dd>{mutation.additions.length > 0 ? mutation.additions.join(", ") : "none"}</dd>
        </div>
        <div>
          <dt>Review flags</dt>
          <dd>{mutation.contradictions.length > 0 ? mutation.contradictions.join(" ") : "none"}</dd>
        </div>
        <div>
          <dt>Sources</dt>
          <dd>{mutation.sourceRefs.join(", ")}</dd>
        </div>
      </dl>
      <code>{mutation.workflowCommand ?? mutation.command}</code>
    </div>
  );
}

function RawPreviewBody({ preview }: { readonly preview: RawSourcePreviewView }) {
  const detail = [preview.path, preview.bytes !== undefined && preview.totalBytes !== undefined ? `${preview.bytes}/${preview.totalBytes} bytes` : undefined]
    .filter(Boolean)
    .join(" / ");
  return (
    <div className="bw-raw-preview-panel">
      <div className="bw-raw-preview-panel__status">
        <Badge tone={toneForPreview(preview.status)}>{preview.status}</Badge>
        <Badge>{preview.mediaType}</Badge>
        {preview.truncated ? <Badge tone="warning">truncated</Badge> : null}
      </div>
      <Notice tone={toneForPreview(preview.status)} label="Preview">{preview.message}</Notice>
      {detail ? <div className="bw-raw-preview-panel__detail">{detail}</div> : null}
      {preview.body ? <pre className="bw-raw-preview">{preview.body}</pre> : null}
    </div>
  );
}

export function WikiPageDetailPage({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <article className="bw-wiki-page">
      <EntityDetailHeader title={title} kind="wiki" status="draft" />
      <Card>{children}</Card>
    </article>
  );
}

function toneForStatus(status: NonNullable<ReferenceItem["status"]>): Tone {
  if (status === "ok") return "success";
  if (status === "missing") return "danger";
  return "warning";
}

function toneForRawStatus(status: RawSourceRowView["processingStatus"]): Tone {
  return status === "linked" ? "success" : "warning";
}

function toneForPreview(status: RawSourcePreviewView["status"]): Tone {
  if (status === "available") return "success";
  if (status === "missing" || status === "outside_workspace") return "danger";
  if (status === "truncated" || status === "unsupported" || status === "external") return "warning";
  return "neutral";
}

function toneForIngestStatus(status: RawIngestMutationView["status"]): Tone {
  if (status === "planned") return "success";
  if (status === "blocked") return "danger";
  return "warning";
}

function toneForIngestFinding(severity: RawIngestFindingView["severity"]): Tone {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

function toneForContradiction(severity: RawContradictionConflictView["severity"]): Tone {
  if (severity === "high") return "danger";
  if (severity === "medium") return "warning";
  return "neutral";
}

function toneForWikiTruth(status: WikiTruthStatus | string): Tone {
  if (status === "accepted") return "success";
  if (status === "rejected" || status === "stale") return "danger";
  if (status === "proposed" || status === "draft") return "warning";
  return "neutral";
}

function toneForCoverage(status: WikiSourceCoverageStatus): Tone {
  if (status === "covered") return "success";
  if (status === "missing") return "danger";
  if (status === "partial" || status === "unbacked") return "warning";
  return "neutral";
}

function toneForReviewState(status: string): Tone {
  if (status === "accepted") return "success";
  if (status === "rejected" || status === "stale" || status === "superseded" || status === "needs_refresh") return "danger";
  if (status === "needs_review" || status === "proposed") return "warning";
  return "neutral";
}

function toneForWikiHealth(severity: WikiHealthSeverity): Tone {
  return severity === "danger" ? "danger" : "warning";
}

function toneForObsidianFrontmatter(status: ObsidianFrontmatterStatus): Tone {
  if (status === "complete") return "success";
  if (status === "missing") return "danger";
  return "warning";
}

function toneForObsidianHealth(status: ObsidianLinkHealthStatus): Tone {
  if (status === "ok") return "success";
  if (status === "danger") return "danger";
  return "warning";
}

function toneForMemoryAction(kind: MemoryWorkflowActionKind): Tone {
  if (kind === "add") return "success";
  if (kind === "update") return "warning";
  if (kind === "reconcile") return "danger";
  return "neutral";
}

function toneForFinding(severity: DashboardFinding["severity"]): Tone {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
