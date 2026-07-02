import { describe, expect, it } from "vitest";

import {
  AGENT_DIRECTIVE_REGISTRY,
  agentDirectivePayloadFields,
  agentDirectiveRegistryIssues,
  assertAgentDirectiveRegistry,
  type AgentDirectivePayloadFieldValueType,
  type AgentDirectiveDataValue
} from "@boreal/core";

import {
  AGENT_DIRECTIVE_GOLDEN_CASES,
  REQUIRED_AGENT_DIRECTIVE_GOLDEN_SCENARIOS
} from "../fixtures/agent-directive-goldens.ts";

describe("agent directive golden fixtures", () => {
  const registryEntriesById = new Map(AGENT_DIRECTIVE_REGISTRY.entries.map((entry) => [entry.id, entry]));

  it("keeps the static registry valid for golden scenario checks", () => {
    expect(agentDirectiveRegistryIssues(AGENT_DIRECTIVE_REGISTRY)).toEqual([]);
    expect(() => assertAgentDirectiveRegistry(AGENT_DIRECTIVE_REGISTRY)).not.toThrow();
  });

  it("covers every required golden directive scenario", () => {
    const scenarios = new Set(AGENT_DIRECTIVE_GOLDEN_CASES.map((goldenCase) => goldenCase.scenario));

    expect(scenarios.size).toBe(AGENT_DIRECTIVE_GOLDEN_CASES.length);
    for (const requiredScenario of REQUIRED_AGENT_DIRECTIVE_GOLDEN_SCENARIOS) {
      expect(scenarios.has(requiredScenario)).toBe(true);
    }
  });

  it("aligns each golden fixture with its static registry entry", () => {
    for (const goldenCase of AGENT_DIRECTIVE_GOLDEN_CASES) {
      const registryEntry = registryEntriesById.get(goldenCase.registryId);
      expect(registryEntry, goldenCase.name).toBeDefined();
      if (!registryEntry) {
        continue;
      }

      expect(registryEntry.family).toBe(goldenCase.family);
      expect(registryEntry.title).toBe(goldenCase.expected.title);
      expect(registryEntry.severity).toBe(goldenCase.expected.severity);
      expect(registryEntry.kind).toBe(goldenCase.expected.kind);
      expect(Boolean(registryEntry.blocksCloseout)).toBe(goldenCase.expected.blocksCloseout);
      expect(registryEntry.triggerCodes).toEqual(goldenCase.expected.triggerCodes);
      expect(registryEntry.nextCommandTemplate).toBe(goldenCase.expected.nextCommandTemplate);

      const payloadFields = agentDirectivePayloadFields(registryEntry.id);
      const requiredKeys = payloadFields
        .filter((payloadField) => payloadField.required)
        .map((payloadField) => payloadField.key);
      const optionalKeys = payloadFields
        .filter((payloadField) => !payloadField.required)
        .map((payloadField) => payloadField.key);

      expect(goldenCase.expected.requiredKeys).toEqual(requiredKeys);
      expect(goldenCase.expected.optionalKeys).toEqual(optionalKeys);
    }
  });

  it("uses only known typed data keys and satisfies required data", () => {
    for (const goldenCase of AGENT_DIRECTIVE_GOLDEN_CASES) {
      const registryEntry = registryEntriesById.get(goldenCase.registryId);
      expect(registryEntry, goldenCase.name).toBeDefined();
      if (!registryEntry) {
        continue;
      }

      const payloadFields = agentDirectivePayloadFields(registryEntry.id);
      const payloadFieldsByKey = new Map(payloadFields.map((payloadField) => [payloadField.key, payloadField]));
      const fixtureKeys = Object.keys(goldenCase.data);

      for (const payloadField of payloadFields) {
        if (payloadField.required) {
          expect(goldenCase.data, goldenCase.name).toHaveProperty(payloadField.key);
        }
      }

      for (const key of fixtureKeys) {
        const payloadField = payloadFieldsByKey.get(key);
        expect(payloadField, `${goldenCase.name}:${key}`).toBeDefined();
        if (!payloadField) {
          continue;
        }
        expect(matchesRequirementType(goldenCase.data[key], payloadField.valueType), `${goldenCase.name}:${key}`).toBe(
          true
        );
      }
    }
  });

  it("keeps trusted instructions static and separate from fixture data", () => {
    for (const goldenCase of AGENT_DIRECTIVE_GOLDEN_CASES) {
      const registryEntry = registryEntriesById.get(goldenCase.registryId);
      expect(registryEntry, goldenCase.name).toBeDefined();
      if (!registryEntry) {
        continue;
      }

      expect(registryEntry.instruction).not.toMatch(/\$\{|\{\{|\$[A-Za-z_]/u);
      for (const dynamicValue of dynamicFixtureStrings(goldenCase.data)) {
        expect(registryEntry.instruction).not.toContain(dynamicValue);
      }
    }
  });
});

function matchesRequirementType(
  value: AgentDirectiveDataValue | undefined,
  requirementType: AgentDirectivePayloadFieldValueType
): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  switch (requirementType) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "content_hash":
      return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
    case "id":
      return typeof value === "string" && /^bw_[a-z]+_[a-f0-9]{12,32}$/u.test(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return typeof value === "object" && !Array.isArray(value);
    case "string":
      return typeof value === "string" && value.length > 0;
    case "timestamp":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value);
    case "uri":
      return typeof value === "string" && /^[a-z][a-z0-9+.-]*:\/\//u.test(value);
  }
}

function dynamicFixtureStrings(value: AgentDirectiveDataValue): readonly string[] {
  const strings: string[] = [];
  collectFixtureStrings(value, strings);
  return strings.filter(
    (candidate) =>
      candidate.includes("bw_") ||
      candidate.includes("://") ||
      candidate.startsWith("/") ||
      /^sha256:[a-f0-9]{64}$/u.test(candidate) ||
      /^[a-f0-9]{40}$/u.test(candidate)
  );
}

function collectFixtureStrings(value: AgentDirectiveDataValue, strings: string[]): void {
  if (typeof value === "string") {
    strings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFixtureStrings(item, strings);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectFixtureStrings(item, strings);
    }
  }
}
