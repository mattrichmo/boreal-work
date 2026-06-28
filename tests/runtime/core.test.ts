import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BorealError,
  assertMcpResourcePathAllowed,
  assertMcpResourceRealPathAllowed,
  bindMcpProjectBoundary,
  canonicalJson,
  defineMcpToolContract,
  deterministicId,
  detectSuspiciousUnicode,
  hashContent,
  normalizeActorId,
  normalizeLabel,
  normalizeMachineString,
  normalizeSearchQuery,
  parseJsonlStrict,
  PUBLISHED_SCHEMA_CONTRACTS,
  PROJECT_REGISTRY_ROOT_ENV,
  PROJECT_REGISTRY_SCHEMA_ID,
  PROJECT_REGISTRY_SCHEMA_VERSION,
  projectRegistryDocumentSchemaIssues,
  randomId,
  readJsonFile,
  resolveProjectRegistryPaths,
  RUNTIME_SCHEMA_CONTRACTS,
  RUNTIME_SCHEMA_IDS,
  runtimeSnapshotSchemaIssues,
  safeParseJson,
  type EventId,
  type ProjectRegistryDocument,
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

  it("resolves the machine-local project registry path without workspace scanning", () => {
    const storage = resolveProjectRegistryPaths({
      env: {},
      homeDir: "/Users/alice",
      platform: "darwin"
    });

    expect(storage).toEqual({
      scope: "machine-local",
      rootDir: "/Users/alice/Library/Application Support/Boreal",
      registryDir: "/Users/alice/Library/Application Support/Boreal/registry",
      registryFile: "/Users/alice/Library/Application Support/Boreal/registry/projects.json",
      lockDir: "/Users/alice/Library/Application Support/Boreal/registry/projects.lock"
    });

    expect(
      resolveProjectRegistryPaths({
        env: { [PROJECT_REGISTRY_ROOT_ENV]: "/tmp/boreal-registry" },
        homeDir: "/Users/alice",
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
    expect(schemaIds).toContain(PROJECT_REGISTRY_SCHEMA_ID);

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

function projectRegistryDocument(): ProjectRegistryDocument {
  return {
    schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
    storage: {
      scope: "machine-local",
      rootDir: "/Users/alice/Library/Application Support/Boreal",
      registryDir: "/Users/alice/Library/Application Support/Boreal/registry",
      registryFile: "/Users/alice/Library/Application Support/Boreal/registry/projects.json",
      lockDir: "/Users/alice/Library/Application Support/Boreal/registry/projects.lock"
    },
    entries: [
      {
        id: "boreal-work",
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
