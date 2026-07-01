import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
  hashContent,
  nowIso,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleId,
  type AgentDirectiveId,
  type AgentDirectiveRegistryVersion,
  type AgentDirectiveTemplateId,
  type AgentDirectiveVersion,
  type ContentHash,
  type WorkItem
} from "@boreal/core";
import { InMemoryBorealStore } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";

import { buildExportDocument, importJson, type ExportDocument } from "../../apps/cli/src/import-export.ts";
import type { CliContext } from "../../apps/cli/src/context.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("import/export agent directive carriers", () => {
  it("carries directive bundles without adding them to runtime snapshot state", async () => {
    const document = await buildExportDocument(testContext(), {
      agentDirectives: [agentDirectiveBundleFixture()]
    });
    const typedDocument: ExportDocument = document;

    expect(typedDocument.agentDirectives).toEqual([agentDirectiveBundleFixture()]);
    expect(typedDocument.state).not.toHaveProperty("agentDirectives");
    expect(typedDocument.recordCounts).not.toHaveProperty("agentDirectives");
  });

  it("rejects malformed directive bundles before they enter export documents", async () => {
    const bundle = agentDirectiveBundleFixture();
    const invalidBundle = {
      ...bundle,
      directives: [
        {
          ...bundle.directives[0],
          severity: "urgent"
        }
      ]
    } as unknown as AgentDirectiveBundle;

    await expect(buildExportDocument(testContext(), { agentDirectives: [invalidBundle] })).rejects.toMatchObject({
      code: "BOREAL_INVALID_INPUT",
      message: "agentDirectives failed schema validation"
    });
  });

  it("preserves closeout gate directive and acknowledgement links through export documents", async () => {
    const store = new InMemoryBorealStore();
    const directiveIds = ["closeout.summary-required" as AgentDirectiveId];
    const acknowledgementIds = ["ack.closeout.summary-required"];
    await store.write((writer) =>
      writer.putWorkItem(closeoutGateLinkedWork({ directiveIds, acknowledgementIds }))
    );

    const document = await buildExportDocument(testContext(store), {
      agentDirectives: [agentDirectiveBundleFixture()]
    });
    const gate = document.state.workItems[0]?.requiredCloseoutGates?.[0];

    expect(gate?.satisfiedBy).toEqual(
      expect.objectContaining({
        directiveIds,
        acknowledgementIds
      })
    );
    expect(document.agentDirectives?.[0]?.directives[0]?.acknowledgement).toEqual(
      expect.objectContaining({ requiredBefore: "close" })
    );
  });

  it("rejects dangling closeout gate directive links on export and import", async () => {
    const directiveIds = ["missing.directive" as AgentDirectiveId];
    const store = new InMemoryBorealStore();
    await store.write((writer) => writer.putWorkItem(closeoutGateLinkedWork({ directiveIds })));

    await expect(
      buildExportDocument(testContext(store), {
        agentDirectives: [agentDirectiveBundleFixture()]
      })
    ).rejects.toMatchObject({
      code: "BOREAL_INVALID_INPUT",
      message: "Snapshot has dangling required gate directive reference",
      details: expect.objectContaining({ missing: directiveIds })
    });

    const document = await buildExportDocument(testContext(store));
    const dir = await mkdtemp(join(tmpdir(), "boreal-import-export-directives-"));
    tempDirs.push(dir);
    const path = join(dir, "invalid-directive-export.json");
    await writeFile(
      path,
      `${JSON.stringify(
        {
          ...document,
          agentDirectives: [agentDirectiveBundleFixture()],
          contentHash: hashContent(document.state)
        },
        null,
        2
      )}\n`
    );

    await expect(importJson(testContext(new InMemoryBorealStore(), dir), "invalid-directive-export.json")).rejects.toMatchObject({
      code: "BOREAL_INVALID_INPUT",
      message: "Snapshot has dangling required gate directive reference",
      details: expect.objectContaining({ missing: directiveIds })
    });
  });
});

function testContext(store = new InMemoryBorealStore(), workspaceRoot = "/repo/boreal-work"): CliContext {
  return {
    workspaceRoot,
    store
  } as unknown as CliContext;
}

function closeoutGateLinkedWork(input: {
  readonly directiveIds: readonly AgentDirectiveId[];
  readonly acknowledgementIds?: readonly string[];
}): WorkItem {
  const now = nowIso(new Date("2026-01-01T00:00:00.000Z"));
  const work = createWorkItem({
    title: "Directive-linked gate target",
    requiredCloseoutGates: [{ kind: "review" }],
    actor: { id: "agent-a", kind: "agent" },
    now
  });
  const gate = work.requiredCloseoutGates?.[0];
  if (!gate) {
    throw new Error("expected required gate fixture");
  }
  return {
    ...work,
    status: "closed",
    requiredCloseoutGates: [
      {
        ...gate,
        status: "satisfied",
        satisfiedBy: {
          evidenceIds: [],
          verificationIds: [],
          agentSummaryIds: [],
          commitShas: [],
          dirtyPathNotes: [],
          directiveIds: input.directiveIds,
          ...(input.acknowledgementIds ? { acknowledgementIds: input.acknowledgementIds } : {})
        }
      }
    ]
  };
}

function agentDirectiveBundleFixture(): AgentDirectiveBundle {
  return {
    meta: {
      id: "bundle.closeout-summary" as AgentDirectiveBundleId,
      schemaVersion: AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
      registryVersion: "directives.v1" as AgentDirectiveRegistryVersion,
      generatedAt: "2026-01-01T00:00:00.000Z",
      commandPath: "agent finish",
      envelopeSchema: "boreal.cli.agent.finish.v1"
    },
    directives: [
      {
        id: "closeout.summary-required" as AgentDirectiveId,
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
          workId: "bw_work_deadbeefdead",
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
        }
      }
    ],
    conflicts: [],
    deprecations: [],
    missingRequired: []
  };
}
