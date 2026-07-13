import { hashContent } from "./hash.js";
import type { ContentHash } from "./ids.js";
import type { WorkItem } from "./records.js";

/** Stable work-contract revision. Lifecycle, evidence, verification, and gate-satisfaction writes do not change it. */
export function workRevisionContentHash(work: WorkItem): ContentHash {
  return hashContent({
    id: work.meta.id,
    kind: work.kind,
    title: work.title,
    description: work.description,
    priority: work.priority,
    acceptanceCriteria: work.acceptanceCriteria,
    labels: work.labels,
    binding: work.binding,
    parentId: work.parentId,
    dependencyIds: work.dependencyIds,
    requiredCloseoutGates: (work.requiredCloseoutGates ?? []).map((gate) => ({
      id: gate.id,
      subjectType: gate.subjectType,
      subjectId: gate.subjectId,
      kind: gate.kind,
      scope: gate.scope,
      requiredEvidenceKinds: gate.requiredEvidenceKinds,
      requiredOutcome: gate.requiredOutcome,
      minEvidenceCount: gate.minEvidenceCount,
      declaredCommand: gate.declaredCommand,
      expectedObservable: gate.expectedObservable,
      requiredTrustLevels: gate.requiredTrustLevels,
      requireCurrentRevision: gate.requireCurrentRevision,
      requireCurrentGitHead: gate.requireCurrentGitHead
    }))
  });
}
