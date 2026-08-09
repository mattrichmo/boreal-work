import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface JsonEnvelope<T> {
  readonly ok: boolean;
  readonly data: T;
}

interface TemplateRunPayload {
  readonly runId: string;
  readonly rootId?: string;
  readonly created: readonly Array<{
    readonly key: string;
    readonly workId: string;
    readonly title: string;
    readonly kind: string;
    readonly status: string;
    readonly binding?: {
      readonly workflowRef?: string;
      readonly outputContract?: string;
      readonly templateRunId?: string;
    };
  }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("work-structure templates", () => {
  it("validates, runs independent template instances, and surfaces bindings in handoffs", async () => {
    const rootDir = await createTestWorkspace("boreal-template-run-");
    await runCli(rootDir, ["init", "--json"]);

    const validation = parseData<{ readonly ok: boolean; readonly nodeCount: number; readonly edgeCount: number }>(
      (await runCli(rootDir, ["template", "validate", "bug-finding-mission", "--var", "target=CLI", "--json"])).stdout
    );
    expect(validation).toEqual(expect.objectContaining({ ok: true, nodeCount: 7, edgeCount: 3 }));

    const first = parseData<TemplateRunPayload>(
      (await runCli(rootDir, ["template", "run", "bug-finding-mission", "--var", "target=CLI", "--json"])).stdout
    );
    const second = parseData<TemplateRunPayload>(
      (await runCli(rootDir, ["template", "run", "bug-finding-mission", "--var", "target=API", "--json"])).stdout
    );

    expect(first.runId).not.toBe(second.runId);
    expect(first.rootId).toMatch(/^bw_work_/);
    expect(second.rootId).toMatch(/^bw_work_/);
    expect(new Set(first.created.map((node) => node.workId)).size).toBe(first.created.length);
    expect(first.created.map((node) => node.workId)).not.toEqual(second.created.map((node) => node.workId));

    const auditTask = first.created.find((node) => node.key === "audit-pass");
    expect(auditTask).toEqual(
      expect.objectContaining({
        status: "ready",
        binding: expect.objectContaining({
          workflowRef: "workflows/40-work/discovery-to-work.md",
          templateRunId: first.runId
        })
      })
    );

    const shown = parseData<{ readonly binding?: { readonly workflowRef?: string; readonly templateRunId?: string } }>(
      (await runCli(rootDir, ["work", "show", String(auditTask?.workId), "--json"])).stdout
    );
    expect(shown.binding).toEqual(
      expect.objectContaining({
        workflowRef: "workflows/40-work/discovery-to-work.md",
        templateRunId: first.runId
      })
    );

    const handoff = parseData<{ readonly work?: { readonly binding?: { readonly workflowRef?: string; readonly templateRunId?: string } } }>(
      (await runCli(rootDir, ["agent", "start", String(auditTask?.workId), "--agent", "template-agent", "--no-branch", "--json"])).stdout
    );
    expect(handoff.work?.binding).toEqual(
      expect.objectContaining({
        workflowRef: "workflows/40-work/discovery-to-work.md",
        templateRunId: first.runId
      })
    );
  });

  it("rejects unknown placeholders, invalid kinds, and dependency cycles with typed errors", async () => {
    const rootDir = await createTestWorkspace("boreal-template-invalid-");
    const unknownPlaceholder = join(rootDir, "unknown-placeholder.yaml");
    const invalidKind = join(rootDir, "invalid-kind.yaml");
    const cycle = join(rootDir, "cycle.yaml");
    const unreconciled = join(rootDir, "unreconciled.yaml");
    await writeFile(
      unknownPlaceholder,
      [
        'schemaVersion: "boreal.work-template.v1"',
        'id: "unknown-placeholder"',
        'version: "1"',
        "variables:",
        "nodes:",
        '  - key: "task"',
        '    kind: "task"',
        '    title: "{{missing}} task"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      invalidKind,
      [
        'schemaVersion: "boreal.work-template.v1"',
        'id: "invalid-kind"',
        'version: "1"',
        "variables:",
        "nodes:",
        '  - key: "task"',
        '    kind: "phase"',
        '    title: "Bad kind"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      cycle,
      [
        'schemaVersion: "boreal.work-template.v1"',
        'id: "cycle"',
        'version: "1"',
        "variables:",
        "nodes:",
        '  - key: "a"',
        '    kind: "task"',
        '    title: "A"',
        '  - key: "b"',
        '    kind: "task"',
        '    title: "B"',
        "edges:",
        '  - dependent: "a"',
        '    dependency: "b"',
        '  - dependent: "b"',
        '    dependency: "a"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      unreconciled,
      [
        'schemaVersion: "boreal.work-template.v1"',
        'id: "unreconciled"',
        'version: "1"',
        "variables:",
        "nodes:",
        '  - key: "audit"',
        '    kind: "task"',
        '    title: "Audit"',
        '    findingProducer: true'
      ].join("\n"),
      "utf8"
    );

    await expectTemplateError(rootDir, unknownPlaceholder, "template.unknown_placeholder");
    await expectTemplateError(rootDir, invalidKind, "template.invalid_kind");
    await expectTemplateError(rootDir, cycle, "template.dependency_cycle");
    await expectTemplateError(rootDir, unreconciled, "template.reconciliation_missing");
  });

  it("captures an existing work subtree into a valid YAML template", async () => {
    const rootDir = await createTestWorkspace("boreal-template-capture-");
    await runCli(rootDir, ["init", "--json"]);
    const parent = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Capture Acme Mission", "--kind", "milestone", "--json"])).stdout
    );
    const child = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Audit Acme", "--kind", "task", "--acceptance", "Acme is checked", "--json"])).stdout
    );
    await runCli(rootDir, ["dep", "add", parent.meta.id, child.meta.id, "--json"]);

    const out = join(rootDir, "templates", "work-structures", "captured.yaml");
    const capture = parseData<{ readonly templateId: string; readonly nodeCount: number; readonly path: string }>(
      (await runCli(rootDir, ["template", "capture", parent.meta.id, "--out", out, "--var", "target=Acme", "--json"])).stdout
    );
    expect(capture.templateId).toBe("capture-acme-mission");
    expect(capture.nodeCount).toBe(2);
    expect(await readFile(capture.path, "utf8")).toContain("{{target}}");

    const validation = parseData<{ readonly ok: boolean; readonly nodeCount: number }>(
      (await runCli(rootDir, ["template", "validate", out, "--var", "target=Acme", "--json"])).stdout
    );
    expect(validation).toEqual(expect.objectContaining({ ok: true, nodeCount: 2 }));
  });
});

async function expectTemplateError(rootDir: string, templatePath: string, code: string): Promise<void> {
  const result = await runCli(rootDir, ["template", "validate", templatePath, "--json"], { expectExitCode: 2 });
  const payload = JSON.parse(result.stderr) as { readonly code: string; readonly details?: { readonly issues?: readonly Array<{ readonly code: string }> } };
  expect(payload.code).toBe("BOREAL_INVALID_INPUT");
  expect(payload.details?.issues?.map((issue) => issue.code)).toContain(code);
}

async function createTestWorkspace(prefix: string): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(rootDir);
  return rootDir;
}

async function runCli(
  cwd: string,
  argv: readonly string[],
  options: { readonly expectExitCode?: number } = {}
): Promise<CommandRun> {
  let stdout = "";
  let stderr = "";
  const output: CliOutput = {
    write(text) {
      stdout += text;
    },
    error(text) {
      stderr += text;
    }
  };
  const exitCode = await main([...argv], output, cwd);
  expect(exitCode).toBe(options.expectExitCode ?? 0);
  if ((options.expectExitCode ?? 0) === 0) {
    expect(stderr).toBe("");
  }
  return { exitCode, stdout, stderr };
}

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope.data;
}
