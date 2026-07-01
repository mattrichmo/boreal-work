import type { Brand, ContentHash } from "./ids.js";
import type { IsoTimestamp } from "./time.js";

export const AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION = "boreal.agent-directives.v1";

export type AgentDirectiveId = Brand<string, "AgentDirectiveId">;
export type AgentDirectiveBundleId = Brand<string, "AgentDirectiveBundleId">;
export type AgentDirectiveTemplateId = Brand<string, "AgentDirectiveTemplateId">;
export type AgentDirectiveVersion = Brand<string, "AgentDirectiveVersion">;
export type AgentDirectiveRegistryVersion = Brand<string, "AgentDirectiveRegistryVersion">;

export type AgentDirectiveFamily =
  | "closeout"
  | "git"
  | "sprint"
  | "phase"
  | "container"
  | "handoff"
  | "doctor"
  | "blocked"
  | "workflow_next"
  | "verification"
  | "review"
  | "audit"
  | "memory";

export type AgentDirectiveSeverity = "info" | "action" | "required" | "blocking";
export type AgentDirectiveAudience = "agent" | "operator" | "reviewer";
export type AgentDirectiveKind = "obligation" | "next_step" | "warning" | "recovery" | "summary" | "acknowledgement";
export type AgentDirectiveLifecycle = "proposed" | "active" | "satisfied" | "acknowledged" | "superseded" | "blocked";

export type AgentDirectiveSubjectType =
  | "work"
  | "sprint"
  | "phase"
  | "milestone"
  | "project"
  | "session"
  | "workspace"
  | "command";

export type AgentDirectiveDataPrimitive = string | number | boolean | null;
export type AgentDirectiveDataValue =
  | AgentDirectiveDataPrimitive
  | readonly AgentDirectiveDataValue[]
  | { readonly [key: string]: AgentDirectiveDataValue };
export type AgentDirectiveData = { readonly [key: string]: AgentDirectiveDataValue };

export interface AgentDirectiveSource {
  readonly registryVersion: AgentDirectiveRegistryVersion;
  readonly registryPath: string;
  readonly selectedBy: readonly string[];
  readonly snapshotHash?: ContentHash;
}

export interface AgentDirectiveSubject {
  readonly type: AgentDirectiveSubjectType;
  readonly id?: string;
  readonly title?: string;
}

export interface AgentDirectiveAppliesTo {
  readonly commandPaths: readonly string[];
  readonly subjectTypes?: readonly AgentDirectiveSubjectType[];
  readonly workStatuses?: readonly string[];
  readonly labels?: readonly string[];
  readonly gates?: readonly string[];
}

export interface AgentDirectiveAcknowledgementRequirement {
  readonly requiredBefore: "close" | "release" | "force_gate" | "handoff" | "none";
  readonly evidenceKind?: "command" | "review" | "artifact" | "note";
  readonly message: string;
}

export interface AgentDirective {
  readonly id: AgentDirectiveId;
  readonly registryId: AgentDirectiveTemplateId;
  readonly version: AgentDirectiveVersion;
  readonly family: AgentDirectiveFamily;
  readonly severity: AgentDirectiveSeverity;
  readonly audience: AgentDirectiveAudience;
  readonly kind: AgentDirectiveKind;
  readonly lifecycle: AgentDirectiveLifecycle;
  readonly title: string;
  readonly instruction: string;
  readonly data: AgentDirectiveData;
  readonly source: AgentDirectiveSource;
  readonly subject?: AgentDirectiveSubject;
  readonly appliesTo: AgentDirectiveAppliesTo;
  readonly supersedes?: readonly AgentDirectiveId[];
  readonly blocksCloseout?: boolean;
  readonly acknowledgement?: AgentDirectiveAcknowledgementRequirement;
}

export type AgentDirectiveConflictResolution =
  | "highest_severity_wins"
  | "blocking_wins"
  | "registry_order"
  | "manual_review";

export interface AgentDirectiveConflict {
  readonly directiveIds: readonly AgentDirectiveId[];
  readonly reason: string;
  readonly resolution: AgentDirectiveConflictResolution;
  readonly resolvedDirectiveId?: AgentDirectiveId;
  readonly severity: AgentDirectiveSeverity;
}

export interface AgentDirectiveDeprecation {
  readonly directiveId: AgentDirectiveId;
  readonly deprecatedBy?: AgentDirectiveId;
  readonly reason: string;
}

export interface AgentDirectiveMissingRequiredEntry {
  readonly registryId?: AgentDirectiveTemplateId;
  readonly family: AgentDirectiveFamily;
  readonly subject?: AgentDirectiveSubject;
  readonly requirement: string;
  readonly message: string;
}

export interface AgentDirectiveTemplate {
  readonly id: AgentDirectiveTemplateId;
  readonly version: AgentDirectiveVersion;
  readonly family: AgentDirectiveFamily;
  readonly severity: AgentDirectiveSeverity;
  readonly audience: AgentDirectiveAudience;
  readonly kind: AgentDirectiveKind;
  readonly title: string;
  readonly instruction: string;
  readonly defaultLifecycle: AgentDirectiveLifecycle;
  readonly appliesTo: AgentDirectiveAppliesTo;
  readonly blocksCloseout?: boolean;
  readonly acknowledgement?: AgentDirectiveAcknowledgementRequirement;
}

export interface AgentDirectiveBundleMetadata {
  readonly id?: AgentDirectiveBundleId;
  readonly schemaVersion: typeof AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION;
  readonly registryVersion: AgentDirectiveRegistryVersion;
  readonly generatedAt: IsoTimestamp;
  readonly commandPath: string;
  readonly envelopeSchema?: string;
  readonly sourceSnapshotHash?: ContentHash;
}

export interface AgentDirectiveBundle {
  readonly meta: AgentDirectiveBundleMetadata;
  readonly directives: readonly AgentDirective[];
  readonly conflicts: readonly AgentDirectiveConflict[];
  readonly deprecations: readonly AgentDirectiveDeprecation[];
  readonly missingRequired: readonly AgentDirectiveMissingRequiredEntry[];
}
