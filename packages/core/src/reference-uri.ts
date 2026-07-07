import { isBorealId, type BorealId, type EntityPrefix } from "./ids.js";
import type { ProjectRegistryDocument, ProjectRegistryEntry, ProjectRegistryLifecycleState } from "./project-registry.js";
import { normalizeMachineString } from "./string-safety.js";

export const BOREAL_REFERENCE_URI_SCHEME = "boreal";

export type BorealReferenceRecordKind = EntityPrefix;

export interface BorealReference {
  readonly uri: string;
  readonly projectId: string;
  readonly recordId: BorealId;
  readonly recordKind: BorealReferenceRecordKind;
}

export type BorealReferenceUriParseResult =
  | {
      readonly ok: true;
      readonly reference: BorealReference;
    }
  | {
      readonly ok: false;
      readonly uri: string;
      readonly reason: string;
    };

export type BorealReferenceResolution<TRecord = unknown, TRollup = unknown> =
  | {
      readonly status: "resolved";
      readonly reference: BorealReference;
      readonly project: ProjectRegistryEntry;
      readonly record: TRecord;
    }
  | {
      readonly status: "unresolved-unlinked";
      readonly reference: BorealReference;
      readonly project: ProjectRegistryEntry;
      readonly projectLifecycle: Extract<ProjectRegistryLifecycleState, "archived" | "paused">;
      readonly lastKnownRollup?: TRollup;
    }
  | {
      readonly status: "unresolved-missing-project";
      readonly reference: BorealReference;
      readonly project?: ProjectRegistryEntry;
      readonly projectLifecycle?: Extract<ProjectRegistryLifecycleState, "missing">;
      readonly lastKnownRollup?: TRollup;
    }
  | {
      readonly status: "unresolved-missing-record";
      readonly reference: BorealReference;
      readonly project: ProjectRegistryEntry;
      readonly lastKnownRollup?: TRollup;
    }
  | {
      readonly status: "invalid-uri";
      readonly uri: string;
      readonly reason: string;
    };

export interface ResolveBorealReferenceUriOptions<TRecord = unknown, TRollup = unknown> {
  readonly registry: ProjectRegistryDocument | readonly ProjectRegistryEntry[];
  readonly uri: string;
  readonly readRecord: (
    project: ProjectRegistryEntry,
    reference: BorealReference
  ) => TRecord | undefined | null | Promise<TRecord | undefined | null>;
  readonly lastKnownRollups?: Readonly<Record<string, TRollup | undefined>>;
}

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const BOREAL_REFERENCE_URI_PATTERN = /^boreal:\/\/([^/?#]+)\/([^/?#]+)$/u;
const BOREAL_ID_KIND_PATTERN = /^bw_([a-z][a-z0-9_]*)_[a-f0-9]{12,64}$/u;
const BOREAL_RECORD_KINDS = new Set<BorealReferenceRecordKind>([
  "acknowledgement",
  "agent",
  "summary",
  "claim",
  "decision",
  "edge",
  "event",
  "evidence",
  "gate",
  "heartbeat",
  "operation",
  "page",
  "projection",
  "reservation",
  "source",
  "verification",
  "work"
]);

export function formatBorealReferenceUri(input: {
  readonly projectId: string;
  readonly recordId: BorealId | string;
}): string {
  const reference = validateBorealReferenceParts(input.projectId, input.recordId);
  return reference.uri;
}

export function parseBorealReferenceUri(uri: string): BorealReferenceUriParseResult {
  let normalized: string;
  try {
    normalized = normalizeMachineString(uri, "boreal reference uri");
  } catch (error) {
    return {
      ok: false,
      uri,
      reason: error instanceof Error ? error.message : "invalid boreal reference uri"
    };
  }

  if (normalized !== uri) {
    return {
      ok: false,
      uri,
      reason: "boreal reference uri must already be normalized"
    };
  }

  const match = BOREAL_REFERENCE_URI_PATTERN.exec(uri);
  if (!match) {
    return {
      ok: false,
      uri,
      reason: "boreal reference uri must match boreal://<project-id>/<record-id>"
    };
  }

  try {
    return {
      ok: true,
      reference: validateBorealReferenceParts(match[1] ?? "", match[2] ?? "")
    };
  } catch (error) {
    return {
      ok: false,
      uri,
      reason: error instanceof Error ? error.message : "invalid boreal reference uri"
    };
  }
}

export function isBorealReferenceUri(uri: string): boolean {
  return parseBorealReferenceUri(uri).ok;
}

export function borealReferenceRecordKind(recordId: string): BorealReferenceRecordKind | undefined {
  if (!isBorealId(recordId)) {
    return undefined;
  }
  const kind = BOREAL_ID_KIND_PATTERN.exec(recordId)?.[1] as BorealReferenceRecordKind | undefined;
  return kind && BOREAL_RECORD_KINDS.has(kind) ? kind : undefined;
}

export async function resolveBorealReferenceUri<TRecord = unknown, TRollup = unknown>(
  options: ResolveBorealReferenceUriOptions<TRecord, TRollup>
): Promise<BorealReferenceResolution<TRecord, TRollup>> {
  const parsed = parseBorealReferenceUri(options.uri);
  if (!parsed.ok) {
    return {
      status: "invalid-uri",
      uri: options.uri,
      reason: parsed.reason
    };
  }

  const reference = parsed.reference;
  const project = registryEntries(options.registry).find((entry) => entry.id === reference.projectId);
  const lastKnownRollup = options.lastKnownRollups?.[reference.projectId];

  if (!project) {
    return {
      status: "unresolved-missing-project",
      reference,
      lastKnownRollup
    };
  }

  if (project.lifecycle === "missing") {
    return {
      status: "unresolved-missing-project",
      reference,
      project,
      projectLifecycle: "missing",
      lastKnownRollup
    };
  }

  if (project.lifecycle === "archived" || project.lifecycle === "paused") {
    return {
      status: "unresolved-unlinked",
      reference,
      project,
      projectLifecycle: project.lifecycle,
      lastKnownRollup
    };
  }

  const record = await options.readRecord(project, reference);
  if (record === undefined || record === null) {
    return {
      status: "unresolved-missing-record",
      reference,
      project,
      lastKnownRollup
    };
  }

  return {
    status: "resolved",
    reference,
    project,
    record
  };
}

function validateBorealReferenceParts(projectId: string, recordId: string): BorealReference {
  const normalizedProjectId = normalizeMachineString(projectId, "boreal project id");
  const normalizedRecordId = normalizeMachineString(recordId, "boreal record id");
  if (normalizedProjectId !== projectId || normalizedRecordId !== recordId) {
    throw new TypeError("boreal reference parts must already be normalized");
  }
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new TypeError("boreal project id must use only lowercase letters, numbers, dots, dashes, or underscores");
  }
  if (!isBorealId(recordId)) {
    throw new TypeError("boreal record id must be a Boreal runtime id");
  }
  const recordKind = borealReferenceRecordKind(recordId);
  if (!recordKind) {
    throw new TypeError("boreal record id prefix is not a known Boreal record kind");
  }

  return {
    uri: `${BOREAL_REFERENCE_URI_SCHEME}://${projectId}/${recordId}`,
    projectId,
    recordId,
    recordKind
  };
}

function registryEntries(registry: ProjectRegistryDocument | readonly ProjectRegistryEntry[]): readonly ProjectRegistryEntry[] {
  return "schemaVersion" in registry ? registry.entries : registry;
}
