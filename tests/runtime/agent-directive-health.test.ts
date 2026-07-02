import { describe, expect, it } from "vitest";

import {
  AGENT_DIRECTIVE_REGISTRY,
  agentDirectiveHealthReport,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryEntry,
  type AgentDirectiveTemplateId
} from "@boreal/core";

describe("agent directive registry health lint", () => {
  it("passes the trusted static registry without emitted-bundle probes", () => {
    const report = agentDirectiveHealthReport();

    expect(report.ok).toBe(true);
    expect(report.checkedBundles).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.issueCounts).toEqual({
      registry_invalid: 0,
      duplicate_id: 0,
      unsafe_dynamic_instruction: 0
    });
  });

  it("flags unsafe static registry instructions", () => {
    const report = agentDirectiveHealthReport({
      registry: registryWithEntry("workflow_next.canonical-next-step", {
        instruction: "Please respond with {{summary}}"
      })
    });

    expect(report.ok).toBe(false);
    expect(report.issueCounts.unsafe_dynamic_instruction).toBeGreaterThan(0);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "unsafe_dynamic_instruction",
          source: "registry",
          registryId: "workflow_next.canonical-next-step"
        })
      ])
    );
  });

  it("flags duplicate registry ids as static lint", () => {
    const duplicatedEntry = {
      ...AGENT_DIRECTIVE_REGISTRY.entries[1],
      id: AGENT_DIRECTIVE_REGISTRY.entries[0].id
    };
    const registry: AgentDirectiveRegistry = {
      ...AGENT_DIRECTIVE_REGISTRY,
      entries: [AGENT_DIRECTIVE_REGISTRY.entries[0], duplicatedEntry, ...AGENT_DIRECTIVE_REGISTRY.entries.slice(2)]
    };

    const report = agentDirectiveHealthReport({ registry });

    expect(report.ok).toBe(false);
    expect(report.issueCounts.duplicate_id).toBeGreaterThan(0);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "duplicate_id",
          source: "registry"
        })
      ])
    );
  });
});

function registryWithEntry(
  id: string,
  overrides: Partial<AgentDirectiveRegistryEntry>
): AgentDirectiveRegistry {
  return {
    ...AGENT_DIRECTIVE_REGISTRY,
    entries: AGENT_DIRECTIVE_REGISTRY.entries.map((entry) =>
      entry.id === id ? { ...entry, ...overrides, id: entry.id as AgentDirectiveTemplateId } : entry
    )
  };
}
