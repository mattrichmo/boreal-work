import { describe, expect, it } from "vitest";

import {
  AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleId,
  type AgentDirectiveId,
  type AgentDirectiveRegistryVersion,
  type AgentDirectiveTemplateId,
  type AgentDirectiveVersion,
  type ContentHash
} from "@boreal/core";
import { InMemoryBorealStore } from "@boreal/storage";

import { buildExportDocument, type ExportDocument } from "../../apps/cli/src/import-export.ts";
import type { CliContext } from "../../apps/cli/src/context.ts";

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
});

function testContext(): CliContext {
  return {
    workspaceRoot: "/repo/boreal-work",
    store: new InMemoryBorealStore()
  } as unknown as CliContext;
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
