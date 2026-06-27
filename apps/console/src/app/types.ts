import type {
  DashboardHealthView,
  GlobalActivityView,
  GlobalHealthView,
  GlobalSearchView,
  GlobalSettingsView,
  GlobalWorkQueuesView,
  LockDashboardView,
  ProjectRegistryView,
  SprintBoardView,
  SyncDashboardView,
  WorkDashboardView
} from "@boreal/ui-model";

import type { SafeConsoleCommand } from "./commands.js";
import type { ConsoleRoute } from "./routes.js";

export type ConsoleDataMode = "fixture" | "live";

export interface ConsoleWorkspaceState {
  readonly projectName: string;
  readonly workspaceRoot: string;
  readonly memoryRoot?: string;
  readonly mode: ConsoleDataMode;
  readonly generatedAt: string;
  readonly stale: boolean;
  readonly warnings: readonly string[];
}

export interface ConsoleDataSet {
  readonly workspace: ConsoleWorkspaceState;
  readonly routes: readonly ConsoleRoute[];
  readonly registry: ProjectRegistryView;
  readonly globalQueues: GlobalWorkQueuesView;
  readonly globalSearch: GlobalSearchView;
  readonly globalActivity: GlobalActivityView;
  readonly globalHealth: GlobalHealthView;
  readonly globalSettings: GlobalSettingsView;
  readonly work: WorkDashboardView;
  readonly sprint: SprintBoardView;
  readonly health: DashboardHealthView;
  readonly sync: SyncDashboardView;
  readonly locks: LockDashboardView;
  readonly rawInbox: RawInboxView;
  readonly wikiExplorer: WikiExplorerView;
  readonly memoryActions: MemoryDashboardActionsView;
  readonly reports: ReportsView;
  readonly safeCommands: readonly SafeConsoleCommand[];
}

export interface ConsoleRenderOptions {
  readonly route?: string;
  readonly data: ConsoleDataSet;
  readonly includeDocument?: boolean;
}

export type RawProcessingStatus = "queued" | "linked";

export type RawPreviewStatus =
  | "available"
  | "empty"
  | "external"
  | "missing"
  | "outside_workspace"
  | "truncated"
  | "unsupported";

export type RawPreviewMediaType = "binary" | "directory" | "external" | "missing" | "none" | "text";

export interface RawSourceRowView {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly uri?: string;
  readonly summary?: string;
  readonly tags: readonly string[];
  readonly addedAt: string;
  readonly actorId: string;
  readonly contentHash: string;
  readonly sourceBacked: true;
  readonly immutable: true;
  readonly processingStatus: RawProcessingStatus;
  readonly linkedPageCount: number;
  readonly retrievalCommand: string;
  readonly previewCommand: string;
}

export interface RawSourcePreviewView {
  readonly status: RawPreviewStatus;
  readonly mediaType: RawPreviewMediaType;
  readonly message: string;
  readonly uri?: string;
  readonly path?: string;
  readonly body?: string;
  readonly bytes?: number;
  readonly totalBytes?: number;
  readonly maxBytes: number;
  readonly truncated: boolean;
}

export interface RawLinkedPageView {
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

export interface RawSourceDetailView extends RawSourceRowView {
  readonly linkedPages: readonly RawLinkedPageView[];
  readonly preview: RawSourcePreviewView;
}

export interface RawInboxView {
  readonly generatedAt: string;
  readonly rows: readonly RawSourceRowView[];
  readonly selected?: RawSourceDetailView;
  readonly ingestPlan?: RawIngestPlanView;
  readonly contradictionReview?: RawContradictionReviewView;
  readonly summary: {
    readonly total: number;
    readonly queued: number;
    readonly linked: number;
    readonly missingPreview: number;
    readonly unsupportedPreview: number;
  };
  readonly warnings: readonly string[];
}

export type ReportArtifactKind = "directory" | "html" | "image" | "json" | "markdown" | "text" | "other";

export interface ReportArtifactView {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind: ReportArtifactKind;
  readonly bytes: number;
  readonly updatedAt: string;
  readonly stale: boolean;
  readonly preview?: string;
  readonly openCommand: string;
}

export interface StaticReportExportView {
  readonly id: string;
  readonly title: string;
  readonly route: string;
  readonly outFile: string;
  readonly format: "html" | "markdown";
  readonly command: string;
  readonly stale: boolean;
  readonly summary: string;
}

export interface StaticKnowledgeReportView {
  readonly title: string;
  readonly generatedAt: string;
  readonly stale: boolean;
  readonly markdown: string;
  readonly commands: readonly string[];
  readonly summary: {
    readonly rawSources: number;
    readonly wikiPages: number;
    readonly claims: number;
    readonly decisions: number;
    readonly healthFindings: number;
  };
}

export interface ReportsView {
  readonly generatedAt: string;
  readonly artifacts: readonly ReportArtifactView[];
  readonly staticExports: readonly StaticReportExportView[];
  readonly knowledgeReport: StaticKnowledgeReportView;
  readonly summary: {
    readonly artifactCount: number;
    readonly staleArtifacts: number;
    readonly staticExportCount: number;
    readonly markdownArtifacts: number;
    readonly htmlArtifacts: number;
  };
  readonly warnings: readonly string[];
}

export type RawIngestMutationKind = "claim" | "decision" | "source" | "wiki" | "work";
export type RawIngestMutationStatus = "blocked" | "needs_input" | "planned";
export type RawIngestFindingSeverity = "info" | "warning" | "danger";
export type MemoryWorkflowActionKind = "add" | "reconcile" | "retrieve" | "update";

export interface MemoryWorkflowActionView {
  readonly id: string;
  readonly title: string;
  readonly kind: MemoryWorkflowActionKind;
  readonly skillName: string;
  readonly skillRef: string;
  readonly workflowPath: string;
  readonly workflowSourcePath: string;
  readonly workflowCommand: string;
  readonly summary: string;
}

export interface MemoryDashboardActionsView {
  readonly generatedAt: string;
  readonly actions: readonly MemoryWorkflowActionView[];
  readonly summary: {
    readonly total: number;
    readonly add: number;
    readonly update: number;
    readonly retrieve: number;
    readonly reconcile: number;
  };
  readonly warnings: readonly string[];
}

export interface RawIngestMutationView {
  readonly id: string;
  readonly kind: RawIngestMutationKind;
  readonly title: string;
  readonly summary: string;
  readonly status: RawIngestMutationStatus;
  readonly command: string;
  readonly workflowPath?: string;
  readonly workflowCommand?: string;
  readonly skillRef?: string;
  readonly sourceRefs: readonly string[];
  readonly additions: readonly string[];
  readonly contradictions: readonly string[];
}

export interface RawIngestFindingView {
  readonly id: string;
  readonly severity: RawIngestFindingSeverity;
  readonly title: string;
  readonly detail: string;
  readonly sourceRefs: readonly string[];
}

export interface RawIngestSourceLinkView {
  readonly label: string;
  readonly ref: string;
  readonly command?: string;
}

export interface RawIngestPlanView {
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly generatedAt: string;
  readonly mutations: readonly RawIngestMutationView[];
  readonly findings: readonly RawIngestFindingView[];
  readonly sourceLinks: readonly RawIngestSourceLinkView[];
  readonly applyCommands: readonly string[];
}

export type RawContradictionSeverity = "high" | "medium" | "low";
export type RawContradictionResolutionAction = "accept" | "reject" | "supersede";

export interface RawContradictionResolutionView {
  readonly action: RawContradictionResolutionAction;
  readonly label: string;
  readonly command: string;
  readonly auditTrail: string;
}

export interface RawContradictionConflictView {
  readonly id: string;
  readonly severity: RawContradictionSeverity;
  readonly title: string;
  readonly currentAssertion: string;
  readonly incomingAssertion: string;
  readonly sourceRefs: readonly string[];
  readonly evidenceLinks: readonly RawIngestSourceLinkView[];
  readonly resolutionCommands: readonly RawContradictionResolutionView[];
}

export interface RawContradictionReviewView {
  readonly generatedAt: string;
  readonly sourceId: string;
  readonly conflicts: readonly RawContradictionConflictView[];
  readonly summary: {
    readonly total: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
}

export type WikiTruthStatus = "accepted" | "draft" | "proposed" | "rejected" | "stale";
export type WikiSourceCoverageStatus = "covered" | "missing" | "partial" | "unbacked";
export type WikiHealthSeverity = "danger" | "warning";
export type WikiHealthTargetKind = "claim" | "page" | "source";
export type ObsidianFrontmatterStatus = "complete" | "partial" | "missing";
export type ObsidianLinkHealthStatus = "ok" | "warning" | "danger";
export type VaultDashboardLinkKind = "dashboard" | "raw" | "reports" | "wiki";

export interface WikiLinkedPageView {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly truthStatus: WikiTruthStatus;
}

export interface WikiKnowledgeSourceView {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly uri?: string;
}

export interface WikiClaimView {
  readonly id: string;
  readonly status: string;
  readonly statement: string;
  readonly sourceIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly evidenceCount: number;
  readonly reviewState: string;
  readonly updatedAt?: string;
}

export interface WikiDecisionView {
  readonly id: string;
  readonly status: string;
  readonly title: string;
  readonly context: string;
  readonly decision: string;
  readonly consequences: readonly string[];
  readonly sourceIds: readonly string[];
  readonly reviewState: string;
  readonly supersessionStatus?: string;
  readonly updatedAt?: string;
}

export interface WikiSourceCoverageView {
  readonly status: WikiSourceCoverageStatus;
  readonly sourceRefs: readonly string[];
  readonly coveredRefs: readonly string[];
  readonly missingRefs: readonly string[];
  readonly rawSources: readonly RawSourceRowView[];
  readonly runtimeSources: readonly WikiKnowledgeSourceView[];
}

export interface ObsidianPageLinkView {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly href: string;
  readonly obsidianUri?: string;
  readonly frontmatterStatus: ObsidianFrontmatterStatus;
  readonly frontmatterKeys: readonly string[];
  readonly linkHealthStatus: ObsidianLinkHealthStatus;
  readonly linkHealthDetail: string;
  readonly sourceCoverageStatus: WikiSourceCoverageStatus;
  readonly showCommand: string;
}

export interface VaultDashboardLinkView {
  readonly id: string;
  readonly title: string;
  readonly kind: VaultDashboardLinkKind;
  readonly path: string;
  readonly href: string;
  readonly obsidianUri?: string;
  readonly status: ObsidianLinkHealthStatus;
  readonly detail: string;
}

export interface VaultInvalidPathFindingView {
  readonly id: string;
  readonly path: string;
  readonly expectedKind: "directory" | "file";
  readonly doctorCode: "vault.structure";
  readonly severity: WikiHealthSeverity;
  readonly detail: string;
  readonly command: string;
}

export interface ObsidianCompatibilityView {
  readonly generatedAt: string;
  readonly memoryRoot?: string;
  readonly vaultName: string;
  readonly obsidianUriAvailable: boolean;
  readonly pages: readonly ObsidianPageLinkView[];
  readonly dashboardLinks: readonly VaultDashboardLinkView[];
  readonly invalidPathFindings: readonly VaultInvalidPathFindingView[];
  readonly summary: {
    readonly pages: number;
    readonly obsidianUris: number;
    readonly frontmatterComplete: number;
    readonly frontmatterPartial: number;
    readonly frontmatterMissing: number;
    readonly linkWarnings: number;
    readonly invalidPaths: number;
  };
  readonly warnings: readonly string[];
}

export interface WikiPageRowView {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly truthStatus: WikiTruthStatus;
  readonly claimStatus?: string;
  readonly sourceRefCount: number;
  readonly backlinkCount: number;
  readonly outboundLinkCount: number;
  readonly claimCount: number;
  readonly decisionCount: number;
  readonly sourceCoverageStatus: WikiSourceCoverageStatus;
  readonly showCommand: string;
}

export interface WikiPageDetailView extends WikiPageRowView {
  readonly sourceRefs: readonly string[];
  readonly outboundLinks: readonly string[];
  readonly backlinks: readonly WikiLinkedPageView[];
  readonly outboundPages: readonly WikiLinkedPageView[];
  readonly missingOutboundLinks: readonly string[];
  readonly sourceCoverage: WikiSourceCoverageView;
  readonly claims: readonly WikiClaimView[];
  readonly decisions: readonly WikiDecisionView[];
}

export interface WikiHealthFindingView {
  readonly id: string;
  readonly code: string;
  readonly doctorCode: "vault.health";
  readonly severity: WikiHealthSeverity;
  readonly title: string;
  readonly detail: string;
  readonly targetKind: WikiHealthTargetKind;
  readonly targetId: string;
  readonly href: string;
  readonly command: string;
}

export interface WikiExplorerView {
  readonly generatedAt: string;
  readonly rows: readonly WikiPageRowView[];
  readonly selected?: WikiPageDetailView;
  readonly importantPages: readonly WikiPageRowView[];
  readonly claims: readonly WikiClaimView[];
  readonly decisionTimeline: readonly WikiDecisionView[];
  readonly filters: {
    readonly claimStatuses: readonly string[];
    readonly decisionStatuses: readonly string[];
    readonly sourceIds: readonly string[];
  };
  readonly healthFindings: readonly WikiHealthFindingView[];
  readonly obsidian: ObsidianCompatibilityView;
  readonly summary: {
    readonly total: number;
    readonly accepted: number;
    readonly draft: number;
    readonly proposed: number;
    readonly stale: number;
    readonly unbacked: number;
    readonly missingSources: number;
  };
  readonly reviewSummary: {
    readonly claims: number;
    readonly acceptedClaims: number;
    readonly proposedClaims: number;
    readonly rejectedClaims: number;
    readonly staleClaims: number;
    readonly decisions: number;
    readonly acceptedDecisions: number;
    readonly proposedDecisions: number;
    readonly rejectedDecisions: number;
    readonly supersededDecisions: number;
  };
  readonly healthSummary: {
    readonly findings: number;
    readonly warnings: number;
    readonly dangers: number;
    readonly staleClaims: number;
    readonly orphanSources: number;
    readonly missingPageCoverage: number;
  };
  readonly warnings: readonly string[];
}
