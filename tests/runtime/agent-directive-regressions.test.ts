import { describe, expect, it } from "vitest";

import {
  AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
  AGENT_DIRECTIVE_REGISTRY,
  AGENT_DIRECTIVE_REGISTRY_IDS,
  agentDirectiveBundleIssues,
  agentDirectiveRegistryIssues,
  type AgentDirective,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleId,
  type AgentDirectiveId,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryEntry,
  type AgentDirectiveRegistryVersion,
  type AgentDirectiveTemplateId,
  type AgentDirectiveVersion,
  type ContentHash
} from "@boreal/core";

describe("agent directive safety regressions", () => {
  it("rejects dynamic instruction interpolation in trusted registry entries", () => {
    const invalidRegistry = registryWithEntry(0, {
      instruction: "Please summarize ${summary} using {{workTitle}} and $operatorNotes."
    });

    expect(agentDirectiveRegistryIssues(invalidRegistry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.entries[0].instruction",
          message: "must not contain interpolation markers"
        })
      ])
    );
  });

  it("rejects duplicate registry entry ids", () => {
    const invalidRegistry: AgentDirectiveRegistry = {
      ...AGENT_DIRECTIVE_REGISTRY,
      entries: [
        AGENT_DIRECTIVE_REGISTRY.entries[0],
        {
          ...AGENT_DIRECTIVE_REGISTRY.entries[1],
          id: AGENT_DIRECTIVE_REGISTRY.entries[0].id
        },
        ...AGENT_DIRECTIVE_REGISTRY.entries.slice(2)
      ]
    };

    expect(agentDirectiveRegistryIssues(invalidRegistry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.entries",
          message: "registry entry ids must be unique"
        })
      ])
    );
  });

  it("rejects invalid registry replacement and lifecycle metadata", () => {
    const invalidRegistry: AgentDirectiveRegistry = {
      ...AGENT_DIRECTIVE_REGISTRY,
      entries: [
        {
          ...AGENT_DIRECTIVE_REGISTRY.entries[0],
          defaultLifecycle: "satisfied",
          lifecycle: "satisfied",
          supersedes: [AGENT_DIRECTIVE_REGISTRY.entries[0].id]
        },
        {
          ...AGENT_DIRECTIVE_REGISTRY.entries[1],
          supersedes: [AGENT_DIRECTIVE_REGISTRY.entries[2].id]
        },
        ...AGENT_DIRECTIVE_REGISTRY.entries.slice(2)
      ]
    };

    expect(agentDirectiveRegistryIssues(invalidRegistry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.entries[0].lifecycle",
          message: "must not use runtime terminal lifecycle for registry entries"
        }),
        expect.objectContaining({
          path: "$.entries[0].supersedes[0]",
          message: "must not reference itself"
        }),
        expect.objectContaining({
          path: "$.entries[1].supersedes[0]",
          message: "must reference a superseded registry entry"
        })
      ])
    );
  });

  it("rejects non-active registry lifecycle defaults that would emit as active", () => {
    const invalidRegistry = registryWithEntry(0, {
      lifecycle: "blocked",
      defaultLifecycle: "active"
    });

    expect(agentDirectiveRegistryIssues(invalidRegistry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.entries[0].defaultLifecycle",
          message: "must not be active for a non-active registry entry"
        })
      ])
    );
  });

  it("rejects directive bundles that emit removed registry ids", () => {
    const bundle = bundleFixture({
      registryId: "removed.closeout-summary" as AgentDirectiveTemplateId
    });

    expect(agentDirectiveBundleIssues(bundle, { knownRegistryIds: AGENT_DIRECTIVE_REGISTRY_IDS })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.directives[0].registryId",
          message: "must reference a known registry id"
        })
      ])
    );
  });

  it("rejects deprecated registry entry use without migration metadata", () => {
    const supersededRegistryEntries = registryEntriesWithId("closeout.summary-required" as AgentDirectiveTemplateId, {
      lifecycle: "superseded",
      defaultLifecycle: "superseded"
    });
    const bundle = bundleFixture({
      lifecycle: "superseded"
    });

    expect(agentDirectiveBundleIssues(bundle, { knownRegistryEntries: supersededRegistryEntries })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.deprecations",
          message: "must include deprecation metadata for superseded directive emission"
        })
      ])
    );
  });

  it("rejects deprecated registry entry use emitted as an active directive", () => {
    const supersededRegistryEntries = registryEntriesWithId("closeout.summary-required" as AgentDirectiveTemplateId, {
      lifecycle: "superseded",
      defaultLifecycle: "superseded"
    });

    expect(agentDirectiveBundleIssues(bundleFixture(), { knownRegistryEntries: supersededRegistryEntries })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.directives[0].lifecycle",
          message: "must be superseded when emitting a superseded registry entry"
        })
      ])
    );
  });

  it("allows deprecated registry entry use when migration metadata is explicit", () => {
    const supersededRegistryEntries = registryEntriesWithId("closeout.summary-required" as AgentDirectiveTemplateId, {
      lifecycle: "superseded",
      defaultLifecycle: "superseded"
    });
    const supersededDirective = bundleDirectiveFixture({
      lifecycle: "superseded"
    });
    const replacementDirective = bundleDirectiveFixture({
      id: "directive.closeout-replacement" as AgentDirectiveId,
      registryId: "verification.evidence-required" as AgentDirectiveTemplateId,
      family: "verification",
      kind: "obligation",
      title: "Attach passed verification evidence",
      instruction: "Run the required validation command and attach passed verification evidence before closeout."
    });
    const bundle: AgentDirectiveBundle = {
      ...bundleFixture(),
      directives: [supersededDirective, replacementDirective],
      deprecations: [
        {
          directiveId: supersededDirective.id,
          deprecatedBy: replacementDirective.id,
          reason: "Migrated to a current verification directive."
        }
      ]
    };

    expect(agentDirectiveBundleIssues(bundle, { knownRegistryEntries: supersededRegistryEntries })).toEqual([]);
  });
});

function registryWithEntry(
  index: number,
  overrides: Partial<AgentDirectiveRegistryEntry>
): AgentDirectiveRegistry {
  return {
    ...AGENT_DIRECTIVE_REGISTRY,
    entries: registryEntriesWithEntry(index, overrides)
  };
}

function registryEntriesWithEntry(
  index: number,
  overrides: Partial<AgentDirectiveRegistryEntry>
): readonly AgentDirectiveRegistryEntry[] {
  return AGENT_DIRECTIVE_REGISTRY.entries.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, ...overrides } : entry
  );
}

function registryEntriesWithId(
  id: AgentDirectiveTemplateId,
  overrides: Partial<AgentDirectiveRegistryEntry>
): readonly AgentDirectiveRegistryEntry[] {
  return AGENT_DIRECTIVE_REGISTRY.entries.map((entry) => (entry.id === id ? { ...entry, ...overrides } : entry));
}

function bundleFixture(overrides: Partial<AgentDirective> = {}): AgentDirectiveBundle {
  return {
    meta: {
      id: "bundle.closeout-summary" as AgentDirectiveBundleId,
      schemaVersion: AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
      registryVersion: "directives.v1" as AgentDirectiveRegistryVersion,
      generatedAt: "2026-01-01T00:00:00.000Z",
      commandPath: "agent finish",
      envelopeSchema: "boreal.cli.agent.finish.v1"
    },
    directives: [bundleDirectiveFixture(overrides)],
    conflicts: [],
    deprecations: [],
    missingRequired: []
  };
}

function bundleDirectiveFixture(overrides: Partial<AgentDirective> = {}): AgentDirective {
  return {
    id: "directive.closeout-summary" as AgentDirectiveId,
    registryId: "closeout.summary-required" as AgentDirectiveTemplateId,
    version: "v1" as AgentDirectiveVersion,
    family: "closeout",
    severity: "required",
    audience: "agent",
    kind: "summary",
    lifecycle: "active",
    title: "Respond with closeout summary",
    instruction: "Respond to the user with the verified closeout summary in your own words.",
    data: {
      subjectId: "bw_work_deadbeefdead",
      summaryUri: "memory://agent-summaries/works/bw_work_deadbeefdead/bw_summary_deadbeefdead.md"
    },
    source: {
      registryVersion: "directives.v1" as AgentDirectiveRegistryVersion,
      registryPath: "packages/core/src/agent-directive-registry.ts",
      selectedBy: ["closeout.final-summary"],
      snapshotHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as ContentHash
    },
    subject: {
      type: "work",
      id: "bw_work_deadbeefdead",
      title: "Close work"
    },
    appliesTo: {
      commandPaths: ["agent finish", "work close"],
      subjectTypes: ["work"],
      workStatuses: ["in_progress"]
    },
    blocksCloseout: true,
    acknowledgement: {
      requiredBefore: "close",
      evidenceKind: "note",
      message: "A final user-facing closeout summary is required before close."
    },
    ...overrides
  };
}
