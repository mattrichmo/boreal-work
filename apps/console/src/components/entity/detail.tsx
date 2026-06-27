import type { ReactNode } from "react";
import type { DashboardFinding, WorkItemView } from "@boreal/ui-model";

import { Badge, Card, EntityChip, LoadingSkeleton, Notice, type Tone } from "../foundation/index.js";

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

function toneForFinding(severity: DashboardFinding["severity"]): Tone {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}
