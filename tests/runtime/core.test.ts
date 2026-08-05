import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
  AGENT_DIRECTIVE_FAMILIES,
  AGENT_DIRECTIVE_PAYLOAD_FIELD_VALUE_TYPES,
  AGENT_DIRECTIVE_REGISTRY,
  AGENT_DIRECTIVE_REGISTRY_BY_FAMILY,
  AGENT_DIRECTIVE_REGISTRY_ENTRIES,
  AGENT_DIRECTIVE_REGISTRY_IDS,
  AGENT_DIRECTIVE_REGISTRY_SOURCE_PATH,
  AGENT_DIRECTIVE_REGISTRY_VERSION,
  AGENT_DIRECTIVE_SCHEMA_CONTRACTS,
  AGENT_DIRECTIVE_SCHEMA_IDS,
  BorealError,
  agentDirectiveBundleIssues,
  agentDirectiveBundleSchemaIssues,
  agentDirectiveDataIssues,
  agentDirectivePayloadFields,
  agentDirectivePayloadRegistryIssues,
  agentDirectiveRegistryEntriesByFamily,
  agentDirectiveRegistryIssues,
  assertAgentDirectiveBundle,
  assertAgentDirectiveRegistry,
  assertMcpResourcePathAllowed,
  assertMcpResourceRealPathAllowed,
  bindMcpProjectBoundary,
  canonicalJson,
  classifyBorealError,
  defineMcpToolContract,
  deterministicId,
  deriveProjectRegistryIdentity,
  detectSuspiciousUnicode,
  ENFORCEMENT_GAP_CODES,
  enforcementGapSchemaIssues,
  hashContent,
  isEnforcementGapCode,
  normalizeActorId,
  normalizeLabel,
  normalizeMachineString,
  normalizeSearchQuery,
  parseJsonlStrict,
  PUBLISHED_SCHEMA_CONTRACTS,
  PROJECT_REGISTRY_ROOT_ENV,
  PROJECT_REGISTRY_SCHEMA_ID,
  PROJECT_REGISTRY_SCHEMA_VERSION,
  borealReferenceRecordKind,
  projectRegistryEntryIdFromIdentity,
  projectRegistryDocumentSchemaIssues,
  randomId,
  readJsonFile,
  formatBorealReferenceUri,
  isBorealReferenceUri,
  parseBorealReferenceUri,
  resolveBorealReferenceUri,
  resolveProjectRegistryPaths,
  RUNTIME_SCHEMA_CONTRACTS,
  RUNTIME_SCHEMA_IDS,
  runtimeSnapshotSchemaIssues,
  safeParseJson,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleId,
  type AgentDirectiveId,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryVersion,
  type AgentDirectiveTemplateId,
  type AgentDirectiveVersion,
  type ContentHash,
  type EventId,
  type EvidenceId,
  type ProjectRegistryDocument,
  type VerificationId,
  type WorkId
} from "@boreal/core";

describe("core hashing and ids", () => {
  it("canonicalizes object keys before hashing", () => {
    const left = { b: 2, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, b: 2 };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(hashContent(left)).toBe(hashContent(right));
  });

  it("creates deterministic typed ids", () => {
    const first = deterministicId<WorkId>("work", { title: "Build runtime" });
    const second = deterministicId<WorkId>("work", { title: "Build runtime" });

    expect(first).toBe(second);
    expect(first).toMatch(/^bw_work_[a-f0-9]{16}$/);
  });

  it("creates random event ids for append-only event streams", () => {
    const first = randomId<EventId>("event");
    const second = randomId<EventId>("event");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^bw_event_[a-f0-9]{32}$/);
  });

  it("reports structured JSON parse failures", () => {
    expect(() => safeParseJson("{", { path: "state.json", schemaName: "boreal.file-store.v1" })).toThrow(BorealError);
    expect(() => safeParseJson("{", { path: "state.json", schemaName: "boreal.file-store.v1" })).toThrow(
      expect.objectContaining({
        code: "BOREAL_JSON_PARSE",
        details: expect.objectContaining({
          path: "state.json",
          schemaName: "boreal.file-store.v1"
        })
      })
    );
  });

  it("parses JSONL strictly with line-specific failures", () => {
    expect(parseJsonlStrict('{"a":1}\n{"b":2}\n', { expectedObject: true })).toEqual([{ a: 1 }, { b: 2 }]);
    expect(() => parseJsonlStrict('{"a":1}\n\n{"b":2}\n', { path: "records.jsonl" })).toThrow(
      expect.objectContaining({
        code: "BOREAL_JSON_PARSE",
        details: expect.objectContaining({
          path: "records.jsonl",
          line: 2
        })
      })
    );
    expect(() => parseJsonlStrict('{"a":1}\n[]\n', { path: "records.jsonl", expectedObject: true })).toThrow(
      expect.objectContaining({
        code: "BOREAL_JSON_PARSE",
        details: expect.objectContaining({
          path: "records.jsonl:2"
        })
      })
    );
  });

  it.each([
    {
      domain: "workflow",
      details: {
        ref: "workflows/40-work/closeot-work.md",
        normalizedRef: "40-work/closeot-work.md",
        didYouMean: [{ id: "boreal.workflow.closeout-work.v1", path: "40-work/closeout-work.md" }]
      },
      includes: ["workflow", "bwrk workflows list --json"],
      excludes: ["work item or queue"]
    },
    {
      domain: "summary",
      details: { summaryId: "bw_summary_0123456789abcdef" },
      includes: ["agent summary", "bw_summary_"],
      excludes: ["work item or queue"]
    },
    {
      domain: "evidence",
      details: { workId: "bw_work_0123456789abcdef", evidenceId: "bw_evidence_0123456789abcdef" },
      includes: ["evidence record", "bw_evidence_"],
      excludes: ["work item or queue"]
    },
    {
      domain: "lock",
      details: { lockPath: ".boreal/runtime/state.lock" },
      includes: ["runtime lock", "bwrk doctor --strict --json"],
      excludes: ["work item or queue"]
    },
    {
      domain: "work",
      details: { workId: "bw_work_0123456789abcdef" },
      includes: ["work item or reservation", "work item or queue"],
      excludes: ["agent summary"]
    }
  ])("returns $domain-specific not-found recovery text", ({ details, includes, excludes }) => {
    const recovery = classifyBorealError("BOREAL_NOT_FOUND", details).recovery.summary;

    for (const expected of includes) {
      expect(recovery).toContain(expected);
    }
    for (const unexpected of excludes) {
      expect(recovery).not.toContain(unexpected);
    }
  });

  it("uses explicit not-found domains before field-name inference", () => {
    const recovery = classifyBorealError("BOREAL_NOT_FOUND", { domain: "evidence" }).recovery.summary;

    expect(recovery).toContain("evidence record");
    expect(recovery).not.toContain("work item or queue");
  });

  it("keeps terminal work recovery text ahead of domain inference", () => {
    const recovery = classifyBorealError("BOREAL_NOT_FOUND", {
      workId: "bw_work_0123456789abcdef",
      closedBy: "agent",
      closedAt: "2026-01-01T00:00:00.000Z"
    }).recovery.summary;

    expect(recovery).toContain("already terminal");
    expect(recovery).toContain("closed by agent");
  });

  it("enforces JSON file size limits before parsing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "boreal-json-"));
    try {
      const path = join(dir, "large.json");
      await writeFile(path, JSON.stringify({ ok: true }), "utf8");
      await expect(readJsonFile(path, { maxBytes: 2 })).rejects.toMatchObject({
        code: "BOREAL_INVALID_INPUT"
      } satisfies Partial<BorealError>);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("normalizes machine-facing strings and rejects invisible unicode", () => {
    expect(normalizeMachineString("  Ｓｈｉｐ   runtime  ", "title")).toBe("Ship runtime");
    expect(normalizeLabel("  CLI  Work ")).toBe("cli work");
    expect(normalizeActorId(" Agent-A ")).toBe("agent-a");
    expect(normalizeSearchQuery("  content   hash  ")).toBe("content hash");

    const findings = detectSuspiciousUnicode("bad\u200btitle");
    expect(findings).toEqual([expect.objectContaining({ codePoint: "U+200B", kind: "invisible_format" })]);
    expect(() => normalizeMachineString("bad\u202etitle", "title")).toThrow(
      expect.objectContaining({ code: "BOREAL_UNSAFE_UNICODE" })
    );
  });

  it("validates safe agent directive bundles", () => {
    const bundle = agentDirectiveBundleFixture();

    expect(agentDirectiveBundleIssues(bundle)).toEqual([]);
    expect(agentDirectiveBundleSchemaIssues(bundle)).toEqual([]);
    expect(() => assertAgentDirectiveBundle(bundle)).not.toThrow();
    expect(agentDirectiveDataIssues(bundle.directives[0].data)).toEqual([]);
  });

  it("rejects unsafe agent directive bundle shapes", () => {
    const bundle = agentDirectiveBundleFixture();
    const knownRegistryIds = ["closeout.summary-required" as AgentDirectiveTemplateId];
    const missingInstruction = { ...bundle.directives[0] } as Record<string, unknown>;
    delete missingInstruction.instruction;

    expect(
      agentDirectiveBundleIssues({
        ...bundle,
        conflicts: [
          {
            directiveIds: ["closeout.summary-required", "git.checkpoint-required"],
            reason: "Prefer closeout summary after checkpoint",
            resolution: "registry_order",
            severity: "required"
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.conflicts[0].directiveIds[1]",
          message: "must reference a directive id from this bundle"
        })
      ])
    );

    expect(
      agentDirectiveBundleIssues(
        {
          ...bundle,
          directives: [
            {
              ...bundle.directives[0],
              registryId: "git.checkpoint-required"
            }
          ]
        },
        { knownRegistryIds }
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.directives[0].registryId",
          message: "must reference a known registry id"
        })
      ])
    );

    expect(
      agentDirectiveBundleIssues({
        ...bundle,
        directives: [
          {
            ...bundle.directives[0],
            severity: "urgent",
            audience: "bot",
            kind: "imperative"
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.directives[0].severity" }),
        expect.objectContaining({ path: "$.directives[0].audience" }),
        expect.objectContaining({ path: "$.directives[0].kind" })
      ])
    );

    expect(
      agentDirectiveBundleSchemaIssues({
        ...bundle,
        directives: [
          {
            ...bundle.directives[0],
            severity: "urgent"
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemaId: AGENT_DIRECTIVE_SCHEMA_IDS.agentDirectiveBundle,
          path: "$.directives[0].severity"
        })
      ])
    );

    expect(
      agentDirectiveBundleIssues({
        ...bundle,
        directives: [
          {
            ...bundle.directives[0],
            source: {
              ...bundle.directives[0].source,
              registryPath: "../memory/raw/index.jsonl"
            }
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.directives[0].source.registryPath",
          message: "must be a relative checked-in registry path"
        })
      ])
    );

    expect(
      agentDirectiveBundleIssues({
        ...bundle,
        directives: [
          {
            ...bundle.directives[0],
            data: {
              summary: "bad\u202esummary",
              count: Number.NaN
            }
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.directives[0].data.summary" }),
        expect.objectContaining({ path: "$.directives[0].data.count", message: "must be a finite number" })
      ])
    );

    expect(
      agentDirectiveBundleIssues({
        ...bundle,
        directives: [missingInstruction]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.directives[0].instruction",
          message: "must be a non-empty string"
        })
      ])
    );

    expect(() =>
      assertAgentDirectiveBundle({
        ...bundle,
        directives: [
          {
            ...bundle.directives[0],
            data: ["not", "an", "object"]
          }
        ]
      })
    ).toThrow(expect.objectContaining({ code: "BOREAL_INVALID_INPUT" }));
  });

  it("validates the static master agent directive registry", () => {
    expect(AGENT_DIRECTIVE_REGISTRY.version).toBe(AGENT_DIRECTIVE_REGISTRY_VERSION);
    expect(agentDirectiveRegistryIssues(AGENT_DIRECTIVE_REGISTRY)).toEqual([]);
    expect(agentDirectivePayloadRegistryIssues(AGENT_DIRECTIVE_REGISTRY)).toEqual([]);
    expect(() => assertAgentDirectiveRegistry(AGENT_DIRECTIVE_REGISTRY)).not.toThrow();

    expect(AGENT_DIRECTIVE_REGISTRY_ENTRIES).toBe(AGENT_DIRECTIVE_REGISTRY.entries);
    expect(new Set(AGENT_DIRECTIVE_REGISTRY_IDS).size).toBe(AGENT_DIRECTIVE_REGISTRY_IDS.length);
    expect(AGENT_DIRECTIVE_REGISTRY_IDS).toEqual(AGENT_DIRECTIVE_REGISTRY_ENTRIES.map((entry) => entry.id));

    let previousFamilyRank = -1;
    for (const entry of AGENT_DIRECTIVE_REGISTRY_ENTRIES) {
      const familyRank = AGENT_DIRECTIVE_FAMILIES.indexOf(entry.family);
      expect(familyRank).toBeGreaterThanOrEqual(previousFamilyRank);
      previousFamilyRank = familyRank;

      expect(entry.sourcePath).toBe(AGENT_DIRECTIVE_REGISTRY_SOURCE_PATH);
      expect(entry.lifecycle).toBe("active");
      expect(entry.instruction).not.toMatch(/\$\{|\{\{|\$[A-Za-z_]/u);
      const payloadFields = agentDirectivePayloadFields(entry.id);
      expect(payloadFields.length).toBeGreaterThan(0);

      const payloadFieldKeys = payloadFields.map((payloadField) => payloadField.key);
      expect(new Set(payloadFieldKeys).size).toBe(payloadFieldKeys.length);
      for (const payloadField of payloadFields) {
        expect(AGENT_DIRECTIVE_PAYLOAD_FIELD_VALUE_TYPES).toContain(payloadField.valueType);
        expect(payloadField.description.length).toBeGreaterThan(0);
      }
    }

    const grouped = agentDirectiveRegistryEntriesByFamily();
    expect(grouped).toEqual(AGENT_DIRECTIVE_REGISTRY_BY_FAMILY);
    for (const family of AGENT_DIRECTIVE_FAMILIES) {
      expect(grouped[family]).toEqual(AGENT_DIRECTIVE_REGISTRY_ENTRIES.filter((entry) => entry.family === family));
      expect(grouped[family].length).toBeGreaterThan(0);
    }
  });

  it("rejects unsafe static registry entries", () => {
    const invalidRegistry: AgentDirectiveRegistry = {
      ...AGENT_DIRECTIVE_REGISTRY,
      entries: [
        {
          ...AGENT_DIRECTIVE_REGISTRY.entries[0],
          instruction: "Use ${workTitle} as instruction.",
          sourcePath: "../memory/raw/index.jsonl",
          supersedes: ["missing.registry-entry" as AgentDirectiveTemplateId]
        },
        ...AGENT_DIRECTIVE_REGISTRY.entries.slice(1)
      ]
    };

    expect(agentDirectiveRegistryIssues(invalidRegistry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.entries[0].instruction", message: "must not contain interpolation markers" }),
        expect.objectContaining({ path: "$.entries[0].sourcePath", message: "must be a relative checked-in registry path" }),
        expect.objectContaining({ path: "$.entries[0].supersedes[0]", message: "must reference a registry entry id" })
      ])
    );
    expect(() => assertAgentDirectiveRegistry(invalidRegistry)).toThrow(
      expect.objectContaining({ code: "BOREAL_INVALID_INPUT" })
    );
  });

  it("reports schema validation issues for malformed runtime snapshots", () => {
    const issues = runtimeSnapshotSchemaIssues({
      workItems: [
        {
          meta: {
            id: "bw_work_deadbeefdead",
            schemaVersion: "boreal.runtime.v1",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            createdBy: {},
            updatedBy: {},
            sourceRefs: [],
            tags: []
          },
          kind: "task",
          title: "Invalid status",
          description: "",
          status: "not_ready",
          priority: "normal",
          acceptanceCriteria: [],
          labels: [],
          dependencyIds: [],
          evidenceIds: [],
          verificationIds: []
        }
      ],
      knowledgeSources: [
        {
          meta: runtimeMeta("bw_source_deadbeefdead"),
          kind: "unsupported",
          title: "Bad source",
          uri: "file://source",
          summary: ""
        }
      ],
      graphEdges: [
        {
          meta: runtimeMeta("bw_edge_deadbeefdead"),
          kind: "blocks",
          fromId: "bw_work_deadbeefdead",
          fromType: "work",
          toId: "bw_work_cafebabecafe",
          toType: "work",
          directed: "yes"
        }
      ],
      reservations: [
        {
          meta: runtimeMeta("bw_reservation_deadbeefdead"),
          workId: "not-a-work-id",
          agentId: "agent-a",
          status: "busy",
          reservedAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workItems[0].status",
          schemaId: "https://boreal.work/schemas/records/work-item.schema.json"
        }),
        expect.objectContaining({
          path: "knowledgeSources[0].kind",
          schemaId: "https://boreal.work/schemas/records/knowledge-source.schema.json"
        }),
        expect.objectContaining({
          path: "graphEdges[0].directed",
          schemaId: "https://boreal.work/schemas/records/graph-edge.schema.json"
        }),
        expect.objectContaining({
          path: "reservations[0].status",
          schemaId: "https://boreal.work/schemas/records/agent-reservation.schema.json"
        })
      ])
    );
  });

  it("accepts legacy work without required closeout gates and validates gate metadata", () => {
    const validWork = {
      meta: runtimeMeta("bw_work_deadbeefdead"),
      kind: "task",
      title: "Gate validation target",
      description: "",
      status: "ready",
      priority: "normal",
      acceptanceCriteria: [],
      labels: [],
      dependencyIds: [],
      evidenceIds: ["bw_evidence_deadbeefdead" as EvidenceId],
      verificationIds: ["bw_verification_deadbeefdead" as VerificationId],
      requiredCloseoutGates: [
        {
          id: "bw_gate_deadbeefdead",
          subjectType: "work",
          subjectId: "bw_work_deadbeefdead",
          kind: "review",
          scope: "self",
          status: "satisfied",
          requiredEvidenceKinds: ["review"],
          requiredOutcome: "passed",
          minEvidenceCount: 1,
          declaredCommand: "pnpm test -- runtime",
          expectedObservable: "passed",
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: { id: "agent-a", kind: "agent" },
          satisfiedBy: {
            evidenceIds: ["bw_evidence_deadbeefdead"],
            verificationIds: ["bw_verification_deadbeefdead"],
            agentSummaryIds: ["bw_summary_deadbeefdead"],
            commitShas: ["abc1234"],
            dirtyPathNotes: ["no_repo_changes: schema fixture"],
            directiveIds: ["closeout.summary-required"],
            acknowledgementIds: ["ack.closeout.summary-required"]
          }
        }
      ]
    };

    expect(runtimeSnapshotSchemaIssues({ workItems: [{ ...validWork, requiredCloseoutGates: undefined }] })).toEqual([]);
    expect(runtimeSnapshotSchemaIssues({ workItems: [validWork] })).toEqual([]);
    expect(
      runtimeSnapshotSchemaIssues({
        workItems: [
          {
            ...validWork,
            requiredCloseoutGates: [
              {
                ...validWork.requiredCloseoutGates[0],
                expectedObservable: ""
              }
            ]
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workItems[0].requiredCloseoutGates[0].expectedObservable",
          schemaId: RUNTIME_SCHEMA_IDS.workItem
        })
      ])
    );
    expect(
      runtimeSnapshotSchemaIssues({
        workItems: [
          {
            ...validWork,
            requiredCloseoutGates: [
              {
                ...validWork.requiredCloseoutGates[0],
                status: "forced",
                force: undefined
              }
            ]
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workItems[0].requiredCloseoutGates[0].force",
          schemaId: RUNTIME_SCHEMA_IDS.workItem
        })
      ])
    );
    expect(
      runtimeSnapshotSchemaIssues({
        workItems: [
          {
            ...validWork,
            requiredCloseoutGates: [
              {
                ...validWork.requiredCloseoutGates[0],
                satisfiedBy: {
                  ...validWork.requiredCloseoutGates[0].satisfiedBy,
                  directiveIds: ["not safe"]
                }
              }
            ]
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "workItems[0].requiredCloseoutGates[0].satisfiedBy.directiveIds[0]",
          schemaId: RUNTIME_SCHEMA_IDS.workItem
        })
      ])
    );
  });

  it("validates the published enforcement gap schema", () => {
    expect(ENFORCEMENT_GAP_CODES).toContain("gate.verification.unsatisfied");
    expect(isEnforcementGapCode("work.blocked.open-dependency")).toBe(true);
    expect(
      enforcementGapSchemaIssues({
        code: "gate.verification.unsatisfied",
        subjectType: "work",
        subjectId: "bw_work_deadbeefdead",
        targetId: "bw_work_cafebabecafe",
        data: {
          gateIds: ["bw_gate_deadbeefdead"],
          requiredEvidenceKinds: ["test"],
          minEvidenceCount: 1,
          declaredCommand: "pnpm test",
          expectedObservable: "passed"
        }
      })
    ).toEqual([]);
    expect(
      enforcementGapSchemaIssues({
        code: "gate.verification.maybe",
        subjectType: "work",
        subjectId: "bw_work_deadbeefdead",
        data: {
          blockerIds: ["not-a-work-id"]
        }
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.code", schemaId: RUNTIME_SCHEMA_IDS.enforcementGap }),
        expect.objectContaining({ path: "$.data.blockerIds[0]", schemaId: RUNTIME_SCHEMA_IDS.enforcementGap })
      ])
    );
  });

  it("validates reviewer heartbeat records", () => {
    const validHeartbeat = {
      meta: runtimeMeta("bw_heartbeat_deadbeefdead"),
      name: "review-pass",
      reviewerId: "reviewer-a",
      containerId: "bw_work_deadbeefdead",
      lastClosedAt: "2026-01-01T00:00:00.000Z",
      lastEventId: "bw_event_deadbeefdead",
      lastWorkId: "bw_work_feedbeefcafe",
      advancedAt: "2026-01-01T00:00:00.000Z"
    };

    expect(runtimeSnapshotSchemaIssues({ reviewerHeartbeats: [validHeartbeat] })).toEqual([]);
    expect(
      runtimeSnapshotSchemaIssues({
        reviewerHeartbeats: [
          {
            ...validHeartbeat,
            lastEventId: "not-an-event"
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "reviewerHeartbeats[0].lastEventId",
          schemaId: RUNTIME_SCHEMA_IDS.reviewerHeartbeat
        })
      ])
    );
  });

  it("validates directive acknowledgement records", () => {
    const validAcknowledgement = {
      meta: runtimeMeta("bw_acknowledgement_deadbeefdead"),
      directiveId: "closeout.summary-required",
      directiveVersion: "v1",
      directiveRegistryId: "closeout.summary-required",
      bundleSource: {
        bundleId: "bundle.agent.finish.deadbeefdead",
        registryVersion: "directives.v1",
        commandPath: "agent finish",
        envelopeSchema: "boreal.cli.agent.finish.v1",
        sourceSnapshotHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        generatedAt: "2026-01-01T00:00:00.000Z"
      },
      actor: { id: "agent-a", kind: "agent", displayName: "agent-a" },
      subjectType: "work",
      subjectId: "bw_work_deadbeefdead",
      subjectTitle: "Closeout target",
      commandPath: "agent finish",
      outcome: "satisfied",
      evidenceIds: ["bw_evidence_deadbeefdead"],
      agentSummaryIds: ["bw_summary_deadbeefdead"],
      verificationIds: ["bw_verification_deadbeefdead"],
      artifactUris: ["memory://agent-summaries/works/bw_work_deadbeefdead/bw_summary_deadbeefdead.md"],
      handoffIds: ["handoff.session.deadbeefdead"],
      acknowledgedAt: "2026-01-01T00:00:00.000Z"
    };

    expect(runtimeSnapshotSchemaIssues({ directiveAcknowledgements: [validAcknowledgement] })).toEqual([]);
    expect(
      runtimeSnapshotSchemaIssues({
        directiveAcknowledgements: [
          {
            ...validAcknowledgement,
            outcome: "deferred",
            reason: ""
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "directiveAcknowledgements[0].reason",
          schemaId: RUNTIME_SCHEMA_IDS.directiveAcknowledgementRecord
        })
      ])
    );
    expect(
      runtimeSnapshotSchemaIssues({
        directiveAcknowledgements: [
          {
            ...validAcknowledgement,
            evidenceIds: ["not-evidence"]
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "directiveAcknowledgements[0].evidenceIds[0]",
          schemaId: RUNTIME_SCHEMA_IDS.directiveAcknowledgementRecord
        })
      ])
    );
    expect(
      runtimeSnapshotSchemaIssues({
        directiveAcknowledgements: [
          {
            ...validAcknowledgement,
            verificationIds: ["not-verification"]
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "directiveAcknowledgements[0].verificationIds[0]",
          schemaId: RUNTIME_SCHEMA_IDS.directiveAcknowledgementRecord
        })
      ])
    );
  });

  it("resolves the machine-local project registry path without workspace scanning", () => {
    const storage = resolveProjectRegistryPaths({
      env: {},
      homeDir: "/fixture-home",
      platform: "darwin"
    });

    expect(storage).toEqual({
      scope: "machine-local",
      rootDir: "/fixture-home/Library/Application Support/Boreal",
      registryDir: "/fixture-home/Library/Application Support/Boreal/registry",
      registryFile: "/fixture-home/Library/Application Support/Boreal/registry/projects.json",
      lockDir: "/fixture-home/Library/Application Support/Boreal/registry/projects.lock"
    });

    expect(
      resolveProjectRegistryPaths({
        env: { [PROJECT_REGISTRY_ROOT_ENV]: "/tmp/boreal-registry" },
        homeDir: "/fixture-home",
        platform: "darwin"
      }).registryFile
    ).toBe("/tmp/boreal-registry/registry/projects.json");
  });

  it("validates project registry path boundaries", () => {
    const document = projectRegistryDocument();

    expect(projectRegistryDocumentSchemaIssues(document)).toEqual([]);

    const issues = projectRegistryDocumentSchemaIssues({
      ...document,
      entries: [
        {
          ...document.entries[0],
          borealDir: "/tmp/other/.boreal",
          memoryRoot: "/other/boreal-work-memory",
          installRoot: "/other/boreal-work-memory/.agents/skills",
          bwrkPin: {
            source: "node_modules",
            binPath: "/tmp/other/node_modules/.bin/bwrk",
            relativeBinPath: "node_modules/.bin/bwrk",
            packageName: "@boreal/cli"
          },
          skillInstallRoots: [
            {
              target: "codex",
              installRoot: "/other/boreal-work-memory/.agents/skills",
              skillRoot: "/other/boreal-work-memory/.agents/skills"
            }
          ]
        }
      ]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.entries[0].borealDir",
          schemaId: PROJECT_REGISTRY_SCHEMA_ID
        }),
        expect.objectContaining({
          path: "$.entries[0].memoryRoot",
          schemaId: PROJECT_REGISTRY_SCHEMA_ID
        }),
        expect.objectContaining({
          path: "$.entries[0].installRoot",
          schemaId: PROJECT_REGISTRY_SCHEMA_ID
        }),
        expect.objectContaining({
          path: "$.entries[0].bwrkPin.binPath",
          schemaId: PROJECT_REGISTRY_SCHEMA_ID
        }),
        expect.objectContaining({
          path: "$.entries[0].skillInstallRoots[0].installRoot",
          schemaId: PROJECT_REGISTRY_SCHEMA_ID
        }),
        expect.objectContaining({
          path: "$.entries[0].skillInstallRoots[0].skillRoot",
          schemaId: PROJECT_REGISTRY_SCHEMA_ID
        })
      ])
    );
  });

  it("derives stable project registry identities from config, git remote, then path", () => {
    const configIdentity = deriveProjectRegistryIdentity({
      projectRoot: "/repo/moved",
      projectConfig: {
        schemaVersion: "boreal.project-setup.v1",
        createdAt: "2026-01-01T00:00:00.000Z",
        projectRoot: "/repo/original",
        memoryRoot: "/repo/original/memory",
        memoryLayout: "in-repo",
        memoryGitMode: "shared",
        skillTargets: ["codex"],
        folderScoped: false
      },
      gitRemote: "git@example.invalid:org/project.git"
    });
    const movedConfigIdentity = deriveProjectRegistryIdentity({
      projectRoot: "/repo/renamed",
      projectConfig: {
        schemaVersion: "boreal.project-setup.v1",
        createdAt: "2026-01-01T00:00:00.000Z",
        projectRoot: "/repo/renamed",
        memoryRoot: "/repo/renamed/memory",
        memoryLayout: "in-repo",
        memoryGitMode: "shared",
        skillTargets: ["codex"],
        folderScoped: false
      }
    });
    const remoteIdentity = deriveProjectRegistryIdentity({
      projectRoot: "/repo/checkout-a",
      projectConfig: { schemaVersion: "legacy" },
      gitRemote: "git@example.invalid:org/project.git"
    });
    const movedRemoteIdentity = deriveProjectRegistryIdentity({
      projectRoot: "/repo/checkout-b",
      gitRemote: "git@example.invalid:org/project.git"
    });
    const pathIdentity = deriveProjectRegistryIdentity({ projectRoot: "/repo/checkout-a" });

    expect(configIdentity.strategy).toBe("project-config");
    expect(configIdentity).toEqual(movedConfigIdentity);
    expect(projectRegistryEntryIdFromIdentity(configIdentity)).toBe(projectRegistryEntryIdFromIdentity(movedConfigIdentity));
    expect(remoteIdentity.strategy).toBe("git-remote");
    expect(remoteIdentity).toEqual(movedRemoteIdentity);
    expect(pathIdentity.strategy).toBe("path");
    expect(pathIdentity).not.toEqual(remoteIdentity);
  });

  it("parses, formats, and classifies boreal reference URIs", () => {
    const uri = formatBorealReferenceUri({
      projectId: "project_deadbeefdead",
      recordId: "bw_work_deadbeefdead"
    });
    const parsed = parseBorealReferenceUri(uri);

    expect(uri).toBe("boreal://project_deadbeefdead/bw_work_deadbeefdead");
    expect(parsed).toEqual({
      ok: true,
      reference: {
        uri,
        projectId: "project_deadbeefdead",
        recordId: "bw_work_deadbeefdead",
        recordKind: "work"
      }
    });
    expect(isBorealReferenceUri(uri)).toBe(true);
    expect(borealReferenceRecordKind("bw_evidence_deadbeefdead")).toBe("evidence");

    expect(parseBorealReferenceUri(" boreal://project_deadbeefdead/bw_work_deadbeefdead")).toEqual(
      expect.objectContaining({ ok: false })
    );
    expect(parseBorealReferenceUri("boreal://Project/bw_work_deadbeefdead")).toEqual(expect.objectContaining({ ok: false }));
    expect(parseBorealReferenceUri("boreal://project/bad-id")).toEqual(expect.objectContaining({ ok: false }));
    expect(parseBorealReferenceUri("boreal://project/bw_unknown_deadbeefdead")).toEqual(expect.objectContaining({ ok: false }));
    expect(parseBorealReferenceUri("boreal://project/bw_work_deadbeefdead\u200b")).toEqual(expect.objectContaining({ ok: false }));
  });

  it("resolves boreal references through the registry without throwing for unresolved cases", async () => {
    const linked = projectRegistryDocument().entries[0];
    const archived = { ...linked, id: "archived-project", lifecycle: "archived" as const };
    const missing = { ...linked, id: "missing-project", lifecycle: "missing" as const };
    const registry = [linked, archived, missing];
    const readRecord = async (entry: typeof linked, reference: { readonly recordId: string }) =>
      entry.id === linked.id && reference.recordId === "bw_work_deadbeefdead"
        ? { id: reference.recordId, title: "Referenced work" }
        : undefined;

    await expect(
      resolveBorealReferenceUri({
        registry,
        uri: `boreal://${linked.id}/bw_work_deadbeefdead`,
        readRecord
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "resolved",
        record: { id: "bw_work_deadbeefdead", title: "Referenced work" }
      })
    );
    await expect(
      resolveBorealReferenceUri({
        registry,
        uri: `boreal://${linked.id}/bw_work_cafebabecafe`,
        readRecord
      })
    ).resolves.toEqual(expect.objectContaining({ status: "unresolved-missing-record" }));
    await expect(
      resolveBorealReferenceUri({
        registry,
        uri: "boreal://archived-project/bw_work_deadbeefdead",
        readRecord,
        lastKnownRollups: { "archived-project": { generatedAt: "2026-01-01T00:00:00.000Z" } }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "unresolved-unlinked",
        projectLifecycle: "archived",
        lastKnownRollup: { generatedAt: "2026-01-01T00:00:00.000Z" }
      })
    );
    await expect(
      resolveBorealReferenceUri({
        registry,
        uri: "boreal://missing-project/bw_work_deadbeefdead",
        readRecord
      })
    ).resolves.toEqual(expect.objectContaining({ status: "unresolved-missing-project", projectLifecycle: "missing" }));
    await expect(
      resolveBorealReferenceUri({
        registry,
        uri: "boreal://unknown-project/bw_work_deadbeefdead",
        readRecord
      })
    ).resolves.toEqual(expect.objectContaining({ status: "unresolved-missing-project" }));
    await expect(
      resolveBorealReferenceUri({
        registry,
        uri: "file://not-boreal",
        readRecord
      })
    ).resolves.toEqual(expect.objectContaining({ status: "invalid-uri" }));
  });

  it("accepts boreal references as source ref URIs", () => {
    const sourceRefUri = "boreal://project_deadbeefdead/bw_work_deadbeefdead";

    expect(
      runtimeSnapshotSchemaIssues({
        workItems: [
          {
            meta: { ...runtimeMeta("bw_work_cafebabecafe"), sourceRefs: [{ uri: sourceRefUri }] },
            kind: "task",
            title: "Cross-project source ref",
            description: "",
            status: "ready",
            priority: "normal",
            acceptanceCriteria: [],
            labels: [],
            dependencyIds: [],
            evidenceIds: [],
            verificationIds: []
          }
        ]
      })
    ).toEqual([]);
  });

  it("binds MCP resource access to one selected project per request", () => {
    const currentEntry = projectRegistryDocument().entries[0];
    const otherEntry = {
      ...currentEntry,
      id: "other-work",
      projectRoot: "/repo/other-work",
      memoryRoot: "/repo/other-work/memory",
      memoryLayout: "child" as const
    };
    const registryEntries = [currentEntry, otherEntry];
    const currentBoundary = bindMcpProjectBoundary({
      workspaceRoot: currentEntry.projectRoot,
      projectRoot: currentEntry.projectRoot,
      memoryRoot: currentEntry.memoryRoot,
      registryEntries
    });

    expect(currentBoundary).toEqual(
      expect.objectContaining({
        selectedExplicitly: false,
        workspaceRoot: "/repo/boreal-work",
        projectRoot: "/repo/boreal-work",
        memoryRoot: "/repo/boreal-work/memory",
        allowedRoots: ["/repo/boreal-work", "/repo/boreal-work/memory"],
        unselectedProjectRoots: ["/repo/other-work", "/repo/other-work/memory"]
      })
    );
    expect(() => assertMcpResourcePathAllowed(currentBoundary, "/repo/boreal-work/.boreal/runtime/state.json")).not.toThrow();
    expect(() => assertMcpResourcePathAllowed(currentBoundary, "/repo/boreal-work/memory/wiki/index.md")).not.toThrow();
    expect(() => assertMcpResourcePathAllowed(currentBoundary, "/repo/other-work/memory/wiki/index.md")).toThrow(
      expect.objectContaining({ code: "BOREAL_INVALID_INPUT" })
    );

    const selectedBoundary = bindMcpProjectBoundary({
      workspaceRoot: otherEntry.projectRoot,
      projectRoot: otherEntry.projectRoot,
      memoryRoot: otherEntry.memoryRoot,
      memoryLayout: otherEntry.memoryLayout,
      selectedProjectId: otherEntry.id,
      registryEntries
    });

    expect(selectedBoundary).toEqual(
      expect.objectContaining({
        selectedProjectId: "other-work",
        selectedExplicitly: true,
        workspaceRoot: "/repo/other-work",
        projectRoot: "/repo/other-work",
        memoryRoot: "/repo/other-work/memory"
      })
    );
    expect(() => assertMcpResourcePathAllowed(selectedBoundary, "/repo/other-work/memory/wiki/index.md")).not.toThrow();
    expect(() => assertMcpResourcePathAllowed(selectedBoundary, "/repo/boreal-work/memory/wiki/index.md")).toThrow(
      expect.objectContaining({ code: "BOREAL_INVALID_INPUT" })
    );
  });

  it("fails MCP binding when workspace and memory roots do not match the selected project", () => {
    const currentEntry = projectRegistryDocument().entries[0];
    const otherEntry = {
      ...currentEntry,
      id: "other-work",
      projectRoot: "/repo/other-work",
      memoryRoot: "/repo/other-work/memory"
    };
    const registryEntries = [currentEntry, otherEntry];

    expect(() =>
      bindMcpProjectBoundary({
        workspaceRoot: currentEntry.projectRoot,
        projectRoot: currentEntry.projectRoot,
        memoryRoot: currentEntry.memoryRoot,
        selectedProjectId: otherEntry.id,
        registryEntries
      })
    ).toThrow(expect.objectContaining({ code: "BOREAL_INVALID_INPUT" }));

    expect(() =>
      bindMcpProjectBoundary({
        workspaceRoot: "/repo/boreal-work",
        projectRoot: "/repo/other-work",
        memoryRoot: "/repo/other-work/memory",
        registryEntries
      })
    ).toThrow(expect.objectContaining({ code: "BOREAL_INVALID_INPUT" }));

    expect(() =>
      bindMcpProjectBoundary({
        workspaceRoot: "/repo/boreal-work",
        projectRoot: "/repo/boreal-work",
        memoryRoot: "/tmp/shared-memory",
        registryEntries
      })
    ).toThrow(expect.objectContaining({ code: "BOREAL_INVALID_INPUT" }));
  });

  it("separates safe MCP read tools from confirmed mutating command contracts", () => {
    const currentEntry = projectRegistryDocument().entries[0];
    const boundary = bindMcpProjectBoundary({
      workspaceRoot: currentEntry.projectRoot,
      projectRoot: currentEntry.projectRoot,
      memoryRoot: currentEntry.memoryRoot,
      registryEntries: [currentEntry]
    });

    expect(
      defineMcpToolContract(boundary, {
        id: "context.show",
        effects: ["read"]
      })
    ).toEqual(
      expect.objectContaining({
        id: "context.show",
        tier: "read",
        readOnly: true,
        requiresConfirmation: false,
        returnsOperationId: false
      })
    );

    expect(() =>
      defineMcpToolContract(boundary, {
        id: "work.reserve",
        effects: ["state"],
        requiresConfirmation: true,
        returnsOperationId: true
      })
    ).toThrow(expect.objectContaining({ code: "BOREAL_INVALID_INPUT" }));

    expect(() =>
      defineMcpToolContract(boundary, {
        id: "work.reserve",
        effects: ["state"],
        commandPreview: ["bwrk", "--workspace", "/repo/other-work", "work", "reserve", "bw_work_123", "--json"],
        requiresConfirmation: true,
        returnsOperationId: true
      })
    ).toThrow(expect.objectContaining({ code: "BOREAL_INVALID_INPUT" }));

    expect(() =>
      defineMcpToolContract(boundary, {
        id: "work.reserve",
        effects: ["state"],
        commandPreview: ["bwrk", "--workspace", currentEntry.projectRoot, "work", "reserve", "bw_work_123", "--json"],
        requiresConfirmation: true
      })
    ).toThrow(expect.objectContaining({ code: "BOREAL_INVALID_INPUT" }));

    expect(
      defineMcpToolContract(boundary, {
        id: "work.reserve",
        effects: ["state"],
        commandPreview: ["bwrk", "--workspace", currentEntry.projectRoot, "work", "reserve", "bw_work_123", "--json"],
        requiresConfirmation: true,
        returnsOperationId: true
      })
    ).toEqual(
      expect.objectContaining({
        id: "work.reserve",
        tier: "mutating",
        readOnly: false,
        requiresConfirmation: true,
        returnsOperationId: true,
        commandPreview: {
          argv: ["bwrk", "--workspace", "/repo/boreal-work", "work", "reserve", "bw_work_123", "--json"],
          workspaceRoot: "/repo/boreal-work"
        }
      })
    );
  });

  it("rejects MCP traversal, symlink escapes, stale configs, and wrong-repo memory access with security codes", async () => {
    const root = await mkdtemp(join(tmpdir(), "boreal-mcp-boundary-"));
    try {
      const projectRoot = join(root, "selected");
      const memoryRoot = join(projectRoot, "memory");
      const otherProjectRoot = join(root, "other");
      const otherMemoryRoot = join(otherProjectRoot, "memory");
      const externalRoot = join(root, "external");
      await mkdir(memoryRoot, { recursive: true });
      await mkdir(otherMemoryRoot, { recursive: true });
      await mkdir(externalRoot, { recursive: true });
      await writeFile(join(externalRoot, "secret.md"), "# external\n", "utf8");
      await symlink(externalRoot, join(memoryRoot, "external-link"), "dir");

      const currentEntry = {
        id: "selected",
        projectRoot,
        memoryRoot,
        memoryLayout: "in-repo" as const
      };
      const otherEntry = {
        id: "other",
        projectRoot: otherProjectRoot,
        memoryRoot: otherMemoryRoot,
        memoryLayout: "in-repo" as const
      };
      const boundary = bindMcpProjectBoundary({
        workspaceRoot: projectRoot,
        projectRoot,
        memoryRoot,
        registryEntries: [currentEntry, otherEntry]
      });

      expect(() => assertMcpResourcePathAllowed(boundary, join(otherMemoryRoot, "wiki/index.md"))).toThrow(
        expect.objectContaining({ code: "BOREAL_INVALID_INPUT" })
      );
      expect(() => assertMcpResourcePathAllowed(boundary, join(root, "outside.md"))).toThrow(
        expect.objectContaining({ code: "BOREAL_INVALID_INPUT" })
      );
      await expect(assertMcpResourceRealPathAllowed(boundary, join(memoryRoot, "external-link", "secret.md"))).rejects.toMatchObject({
        code: "BOREAL_INVALID_INPUT"
      });

      expect(() =>
        bindMcpProjectBoundary({
          workspaceRoot: projectRoot,
          projectRoot,
          memoryRoot: join(projectRoot, "stale-memory"),
          registryEntries: [currentEntry, otherEntry]
        })
      ).toThrow(expect.objectContaining({ code: "BOREAL_INVALID_INPUT" }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps every published schema file registered with a validator", async () => {
    const schemaFiles = await listSchemaFiles(new URL("../../schemas/", import.meta.url));
    const contracts = [...PUBLISHED_SCHEMA_CONTRACTS].sort((left, right) =>
      left.schemaPath.localeCompare(right.schemaPath)
    );
    const schemaIds = contracts.map((contract) => contract.schemaId);
    const schemaPaths = contracts.map((contract) => contract.schemaPath);

    expect(schemaPaths).toEqual(schemaFiles);
    expect(new Set(schemaIds).size).toBe(schemaIds.length);
    expect(new Set(schemaPaths).size).toBe(schemaPaths.length);
    expect(new Set(RUNTIME_SCHEMA_CONTRACTS.map((contract) => contract.schemaId))).toEqual(
      new Set(Object.values(RUNTIME_SCHEMA_IDS))
    );
    expect(new Set(AGENT_DIRECTIVE_SCHEMA_CONTRACTS.map((contract) => contract.schemaId))).toEqual(
      new Set(Object.values(AGENT_DIRECTIVE_SCHEMA_IDS))
    );
    expect(schemaIds).toContain(PROJECT_REGISTRY_SCHEMA_ID);
    expect(schemaIds).toContain(AGENT_DIRECTIVE_SCHEMA_IDS.agentDirectiveBundle);

    for (const contract of contracts) {
      const schema = safeParseJson(await readFile(new URL(`../../${contract.schemaPath}`, import.meta.url), "utf8"), {
        schemaName: contract.schemaId,
        expectedObject: true
      }) as { readonly $id?: string };

      expect(schema.$id).toBe(contract.schemaId);
    }
  });

  it("keeps published schema validators bound to their schema IDs", () => {
    for (const contract of PUBLISHED_SCHEMA_CONTRACTS) {
      const issues = contract.validator(null, "$");

      expect(issues.length).toBeGreaterThan(0);
      expect(new Set(issues.map((issue) => issue.schemaId))).toEqual(new Set([contract.schemaId]));
    }
  });

  it("routes runtime snapshot sections through registered schema validators", () => {
    const snapshot = Object.fromEntries(
      RUNTIME_SCHEMA_CONTRACTS.flatMap((contract) =>
        contract.runtimeSection === undefined ? [] : [[contract.runtimeSection, [{}]]]
      )
    );
    const issues = runtimeSnapshotSchemaIssues(snapshot);

    for (const contract of RUNTIME_SCHEMA_CONTRACTS) {
      if (contract.runtimeSection === undefined) {
        continue;
      }
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            schemaId: contract.schemaId,
            path: expect.stringContaining(`${contract.runtimeSection}[0]`)
          })
        ])
      );
    }
  });
});

function runtimeMeta(id: string): Record<string, unknown> {
  return {
    id,
    schemaVersion: "boreal.runtime.v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: { id: "agent-a", kind: "agent", displayName: "agent-a" },
    updatedBy: { id: "agent-a", kind: "agent", displayName: "agent-a" },
    sourceRefs: [],
    tags: []
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
        title: "Respond with closeout summary",
        instruction: "Respond to the user with the verified closeout summary in your own words.",
        triggerCodes: ["closeout.user-summary.required"],
        nextCommandTemplate: "bwrk summary show <subjectId> --json",
        data: {
          workId: "bw_work_deadbeefdead",
          evidenceIds: ["bw_evidence_deadbeefdead"],
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

function projectRegistryDocument(): ProjectRegistryDocument {
  return {
    schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
    storage: {
      scope: "machine-local",
      rootDir: "/fixture-home/Library/Application Support/Boreal",
      registryDir: "/fixture-home/Library/Application Support/Boreal/registry",
      registryFile: "/fixture-home/Library/Application Support/Boreal/registry/projects.json",
      lockDir: "/fixture-home/Library/Application Support/Boreal/registry/projects.lock"
    },
    entries: [
      {
        id: "boreal-work",
        identity: {
          strategy: "project-config",
          fingerprint: "sha256:registry-fixture"
        },
        lifecycle: "linked",
        display: {
          name: "Boreal Work",
          labels: ["runtime", "cli"]
        },
        projectRoot: "/repo/boreal-work",
        borealDir: "/repo/boreal-work/.boreal",
        runtimeDir: "/repo/boreal-work/.boreal/runtime",
        runtimeStateFile: "/repo/boreal-work/.boreal/runtime/state.json",
        projectConfigPath: "/repo/boreal-work/.boreal/project.json",
        memoryRoot: "/repo/boreal-work/memory",
        memoryBorealDir: "/repo/boreal-work/memory/.boreal",
        memoryLayout: "in-repo",
        memoryGitMode: "separate",
        installRoot: "/repo/boreal-work/.agents/skills",
        bwrkPin: {
          source: "node_modules",
          binPath: "/repo/boreal-work/node_modules/.bin/bwrk",
          relativeBinPath: "node_modules/.bin/bwrk",
          packageName: "@boreal/cli"
        },
        skillInstallRoots: [
          {
            target: "codex",
            installRoot: "/repo/boreal-work/.agents/skills",
            skillRoot: "/repo/boreal-work/.agents/skills"
          }
        ],
        skillTargets: ["codex"],
        folderScoped: false,
        source: "project-setup",
        addedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

async function listSchemaFiles(root: URL, prefix = "schemas"): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      if (entry.isDirectory()) {
        return listSchemaFiles(new URL(`${entry.name}/`, root), `${prefix}/${entry.name}`);
      }
      return entry.name.endsWith(".schema.json") ? [`${prefix}/${entry.name}`] : [];
    })
  );

  return nested.flat().sort();
}
