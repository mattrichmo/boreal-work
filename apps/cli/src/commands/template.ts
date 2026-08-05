import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import {
  BorealError,
  assertPathInside,
  hashContent,
  normalizeLabel,
  nowIso,
  withContentHash,
  type GraphEdge,
  type SourceRef,
  type WorkBinding,
  type WorkId,
  type WorkItem,
  type WorkKind,
  type WorkPriority
} from "@boreal/core";
import {
  addBlockingDependency as addBlockingDependencyDomain,
  createWorkItem,
  markWorkReady,
  type RequiredCloseoutGateInput
} from "@boreal/work-engine";

import { flagValue, flagValues, hasFlag, type ParsedArgs } from "../args.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import type { CliContext } from "../context.js";
import type { CommandResult } from "./shared.js";
import { getWorkflowAsset, resolveWorkflowAssetRoots } from "../workflow-assets.js";

const TEMPLATE_SCHEMA_VERSION = "boreal.work-template.v1";
const TEMPLATE_DIR = "work-structures";
const VARIABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/gu;
const VALID_KINDS = new Set<WorkKind>(["issue", "task", "sprint", "milestone"]);
const VALID_PRIORITIES = new Set<WorkPriority>(["low", "normal", "high", "critical"]);

interface WorkTemplate {
  readonly schemaVersion: string;
  readonly id: string;
  readonly version: string;
  readonly title?: string;
  readonly description?: string;
  readonly variables: readonly TemplateVariable[];
  readonly nodes: readonly TemplateNode[];
  readonly edges: readonly TemplateEdge[];
}

interface TemplateVariable {
  readonly name: string;
  readonly description?: string;
  readonly default?: string;
  readonly required: boolean;
}

interface TemplateNode {
  readonly key: string;
  readonly kind: WorkKind;
  readonly title: string;
  readonly description?: string;
  readonly priority?: WorkPriority;
  readonly labels: readonly string[];
  readonly acceptance: readonly string[];
  readonly gates: readonly RequiredCloseoutGateInput[];
  readonly binding?: TemplateBinding;
  readonly children: readonly TemplateNode[];
}

interface TemplateBinding {
  readonly workflowRef?: string;
  readonly outputContract?: string;
  readonly command?: string;
}

interface TemplateEdge {
  readonly dependent: string;
  readonly dependency: string;
}

interface LoadedTemplate {
  readonly template: WorkTemplate;
  readonly path: string;
  readonly relativePath: string;
}

interface TemplateValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

interface FlatNode {
  readonly node: TemplateNode;
  readonly parentKey?: string;
}

interface CreatedTemplateNode {
  readonly key: string;
  readonly workId: WorkId;
  readonly title: string;
  readonly kind: WorkKind;
  readonly status: WorkItem["status"];
  readonly parentKey?: string;
  readonly binding?: WorkBinding;
}

export async function templateCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const rows = await listTemplateSummaries(context);
      output.write(json ? formatRecord(rows, true) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const loaded = await loadTemplate(context, requiredPositional(rest, 0, "template reference"));
      const validation = await validateLoadedTemplate(context, loaded, variableValuesFromArgs(args), { requireResolvedVariables: false });
      const result = templateShowResult(loaded, validation);
      output.write(json ? formatRecord(result, true) : formatTemplateShow(result));
      return { exitCode: 0 };
    }
    case "validate": {
      const loaded = await loadTemplate(context, requiredPositional(rest, 0, "template reference"));
      const validation = await validateLoadedTemplate(context, loaded, variableValuesFromArgs(args), {
        requireResolvedVariables: flagValues(args, "var").length > 0
      });
      if (!validation.ok) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Work template validation failed", {
          template: loaded.relativePath,
          issues: validation.issues,
          domain: "template"
        });
      }
      output.write(json ? formatRecord(validation, true) : formatTemplateValidation(validation));
      return { exitCode: 0 };
    }
    case "run": {
      const loaded = await loadTemplate(context, requiredPositional(rest, 0, "template reference"));
      const variables = variableValuesFromArgs(args);
      const validation = await validateLoadedTemplate(context, loaded, variables, { requireResolvedVariables: true });
      if (!validation.ok) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Work template validation failed", {
          template: loaded.relativePath,
          issues: validation.issues,
          domain: "template"
        });
      }
      const plan = buildInstantiationPlan(loaded.template, variables);
      if (hasFlag(args, "dry-run")) {
        output.write(json ? formatRecord(plan, true) : formatTemplateRun(plan));
        return { exitCode: 0 };
      }
      const result = await instantiateTemplate(context, loaded, plan);
      output.write(json ? formatRecord(result, true) : formatTemplateRun(result));
      return { exitCode: 0 };
    }
    case "capture": {
      const workRef = requiredPositional(rest, 0, "work reference");
      const out = flagValue(args, "out");
      if (!out) {
        throw new BorealError("BOREAL_INVALID_INPUT", "template capture requires --out");
      }
      const workId = await context.runtime.resolveWorkReference(workRef);
      const result = await captureTemplate(context, workId, out, variableValuesFromArgs(args), hasFlag(args, "overwrite"));
      output.write(json ? formatRecord(result, true) : formatCaptureResult(result));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown template command: ${action ?? ""}`);
  }
}

async function listTemplateSummaries(context: CliContext): Promise<readonly Record<string, string | number>[] > {
  const files = await listTemplateFiles(context);
  const rows: Record<string, string | number>[] = [];
  for (const file of files) {
    const loaded = await readTemplateFile(context, file);
    rows.push({
      id: loaded.template.id,
      version: loaded.template.version,
      title: loaded.template.title ?? loaded.template.id,
      nodes: flattenNodes(loaded.template.nodes).length,
      path: loaded.relativePath
    });
  }
  return rows.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function templateShowResult(loaded: LoadedTemplate, validation: Awaited<ReturnType<typeof validateLoadedTemplate>>) {
  return {
    schemaVersion: "boreal.cli.template.show.v1",
    path: loaded.relativePath,
    template: loaded.template,
    validation
  };
}

async function validateLoadedTemplate(
  context: CliContext,
  loaded: LoadedTemplate,
  variables: ReadonlyMap<string, string>,
  options: { readonly requireResolvedVariables: boolean }
): Promise<{
  readonly schemaVersion: string;
  readonly ok: boolean;
  readonly templateId: string;
  readonly version: string;
  readonly path: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly variables: readonly string[];
  readonly missingVariables: readonly string[];
  readonly issues: readonly TemplateValidationIssue[];
}> {
  const issues = await validateTemplate(context, loaded.template, loaded.relativePath, variables, options);
  const declared = new Set(loaded.template.variables.map((variable) => variable.name));
  const missingVariables = loaded.template.variables
    .filter((variable) => variable.required && !variables.has(variable.name) && variable.default === undefined)
    .map((variable) => variable.name);
  return {
    schemaVersion: "boreal.cli.template.validate.v1",
    ok: issues.length === 0,
    templateId: loaded.template.id,
    version: loaded.template.version,
    path: loaded.relativePath,
    nodeCount: flattenNodes(loaded.template.nodes).length,
    edgeCount: loaded.template.edges.length,
    variables: [...declared].sort(),
    missingVariables,
    issues
  };
}

async function validateTemplate(
  context: CliContext,
  template: WorkTemplate,
  path: string,
  providedVariables: ReadonlyMap<string, string>,
  options: { readonly requireResolvedVariables: boolean }
): Promise<readonly TemplateValidationIssue[]> {
  const issues: TemplateValidationIssue[] = [];
  const variableNames = new Set<string>();
  const flatNodes = flattenNodes(template.nodes);
  const nodeKeys = new Set<string>();

  if (template.schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
    issues.push(issue("template.schema_version", "$.schemaVersion", `schemaVersion must be ${TEMPLATE_SCHEMA_VERSION}`));
  }
  if (!template.id) {
    issues.push(issue("template.id", "$.id", "id is required"));
  }
  if (!template.version) {
    issues.push(issue("template.version", "$.version", "version is required"));
  }
  for (const variable of template.variables) {
    if (!VARIABLE_PATTERN.test(variable.name)) {
      issues.push(issue("template.variable_name", `$.variables.${variable.name}`, "variable names must match /^[A-Za-z][A-Za-z0-9_]*$/"));
    }
    if (variableNames.has(variable.name)) {
      issues.push(issue("template.duplicate_variable", `$.variables.${variable.name}`, "duplicate variable"));
    }
    variableNames.add(variable.name);
  }
  for (const key of providedVariables.keys()) {
    if (!variableNames.has(key)) {
      issues.push(issue("template.unknown_var", `--var ${key}`, "provided variable is not declared by the template"));
    }
  }
  for (const missing of template.variables.filter((variable) => variable.required && !providedVariables.has(variable.name) && variable.default === undefined)) {
    if (options.requireResolvedVariables) {
      issues.push(issue("template.missing_var", `$.variables.${missing.name}`, "required variable has no --var value or default"));
    }
  }
  for (const entry of flatNodes) {
    const nodePath = `$.nodes.${entry.node.key}`;
    if (nodeKeys.has(entry.node.key)) {
      issues.push(issue("template.duplicate_node", nodePath, "duplicate node key"));
    }
    nodeKeys.add(entry.node.key);
    if (!VALID_KINDS.has(entry.node.kind)) {
      issues.push(issue("template.invalid_kind", `${nodePath}.kind`, `kind must be one of ${[...VALID_KINDS].join(", ")}`));
    }
    if (entry.node.priority && !VALID_PRIORITIES.has(entry.node.priority)) {
      issues.push(issue("template.invalid_priority", `${nodePath}.priority`, `priority must be one of ${[...VALID_PRIORITIES].join(", ")}`));
    }
    validatePlaceholders(entry.node.title, `${nodePath}.title`, variableNames, issues);
    validatePlaceholders(entry.node.description ?? "", `${nodePath}.description`, variableNames, issues);
    for (const [index, label] of entry.node.labels.entries()) {
      validatePlaceholders(label, `${nodePath}.labels[${index}]`, variableNames, issues);
    }
    for (const [index, criterion] of entry.node.acceptance.entries()) {
      validatePlaceholders(criterion, `${nodePath}.acceptance[${index}]`, variableNames, issues);
    }
    for (const [index, gate] of entry.node.gates.entries()) {
      validatePlaceholders(gate.declaredCommand ?? "", `${nodePath}.gates[${index}].declaredCommand`, variableNames, issues);
      validatePlaceholders(gate.expectedObservable ?? "", `${nodePath}.gates[${index}].expectedObservable`, variableNames, issues);
    }
    if (entry.node.binding) {
      await validateBinding(context, entry.node.binding, `${nodePath}.binding`, issues);
    }
  }
  for (const [index, edge] of template.edges.entries()) {
    if (!nodeKeys.has(edge.dependent)) {
      issues.push(issue("template.unknown_edge_node", `$.edges[${index}].dependent`, `unknown dependent node ${edge.dependent}`));
    }
    if (!nodeKeys.has(edge.dependency)) {
      issues.push(issue("template.unknown_edge_node", `$.edges[${index}].dependency`, `unknown dependency node ${edge.dependency}`));
    }
    if (edge.dependent === edge.dependency) {
      issues.push(issue("template.self_edge", `$.edges[${index}]`, "a node cannot depend on itself"));
    }
  }
  for (const cycle of dependencyCycles(flatNodes, template.edges)) {
    issues.push(issue("template.dependency_cycle", "$.edges", `dependency cycle: ${cycle.join(" -> ")}`));
  }
  if (options.requireResolvedVariables && issues.length === 0) {
    const substituted = buildSubstitutionMap(template, providedVariables);
    for (const entry of flatNodes) {
      const node = substituteNode(entry.node, substituted);
      validateNoPlaceholders(node.title, `$.nodes.${entry.node.key}.title`, issues);
      validateNoPlaceholders(node.description ?? "", `$.nodes.${entry.node.key}.description`, issues);
      for (const [index, label] of node.labels.entries()) {
        validateNoPlaceholders(label, `$.nodes.${entry.node.key}.labels[${index}]`, issues);
      }
      for (const [index, criterion] of node.acceptance.entries()) {
        validateNoPlaceholders(criterion, `$.nodes.${entry.node.key}.acceptance[${index}]`, issues);
      }
      for (const [index, gate] of node.gates.entries()) {
        validateNoPlaceholders(gate.declaredCommand ?? "", `$.nodes.${entry.node.key}.gates[${index}].declaredCommand`, issues);
        validateNoPlaceholders(gate.expectedObservable ?? "", `$.nodes.${entry.node.key}.gates[${index}].expectedObservable`, issues);
      }
    }
  }
  return issues.map((entry) => ({ ...entry, path: `${path}:${entry.path}` }));
}

async function validateBinding(
  context: CliContext,
  binding: TemplateBinding,
  path: string,
  issues: TemplateValidationIssue[]
): Promise<void> {
  const bindingKinds = [binding.workflowRef, binding.outputContract, binding.command].filter(Boolean);
  if (bindingKinds.length !== 1) {
    issues.push(issue("template.binding_shape", path, "binding must set exactly one of workflow, contract, or command"));
    return;
  }
  if (binding.workflowRef) {
    try {
      await getWorkflowAsset(binding.workflowRef, { workspaceRoot: context.workspaceRoot });
    } catch {
      issues.push(issue("template.unknown_workflow", `${path}.workflow`, `unknown workflow ${binding.workflowRef}`));
    }
  }
  if (binding.outputContract) {
    const roots = resolveWorkflowAssetRoots({ workspaceRoot: context.workspaceRoot });
    const contractPath = join(roots.templatesRoot, `${binding.outputContract}.md`);
    if (!existsSync(contractPath)) {
      issues.push(issue("template.unknown_output_contract", `${path}.contract`, `unknown output contract ${binding.outputContract}`));
    }
  }
}

function validatePlaceholders(
  value: string,
  path: string,
  declaredVariables: ReadonlySet<string>,
  issues: TemplateValidationIssue[]
): void {
  for (const placeholder of placeholdersIn(value)) {
    if (!declaredVariables.has(placeholder)) {
      issues.push(issue("template.unknown_placeholder", path, `placeholder {{${placeholder}}} is not declared in variables`));
    }
  }
}

function validateNoPlaceholders(value: string, path: string, issues: TemplateValidationIssue[]): void {
  const placeholders = placeholdersIn(value);
  if (placeholders.length > 0) {
    issues.push(issue("template.unresolved_placeholder", path, `unresolved placeholders: ${placeholders.map((name) => `{{${name}}}`).join(", ")}`));
  }
}

function issue(code: string, path: string, message: string): TemplateValidationIssue {
  return { code, path, message };
}

function buildInstantiationPlan(template: WorkTemplate, providedVariables: ReadonlyMap<string, string>) {
  const variables = buildSubstitutionMap(template, providedVariables);
  const flatNodes = flattenNodes(template.nodes);
  const plannedNodes = flatNodes.map((entry) => ({
    key: entry.node.key,
    parentKey: entry.parentKey,
    kind: entry.node.kind,
    title: substituteString(entry.node.title, variables),
    description: substituteString(entry.node.description ?? "", variables),
    priority: entry.node.priority ?? "normal",
    labels: entry.node.labels.map((label) => substituteString(label, variables)),
    acceptance: entry.node.acceptance.map((criterion) => substituteString(criterion, variables)),
    gates: entry.node.gates.map((gate) => substituteGate(gate, variables)),
    binding: entry.node.binding ? substituteBinding(entry.node.binding, variables) : undefined
  }));
  const runId = templateRunId(template, variables);
  return {
    schemaVersion: "boreal.cli.template.run.plan.v1",
    template: {
      id: template.id,
      version: template.version
    },
    runId,
    variables: Object.fromEntries([...variables.entries()].sort(([left], [right]) => left.localeCompare(right))),
    rootKey: plannedNodes[0]?.key,
    nodes: plannedNodes,
    edges: template.edges
  };
}

async function instantiateTemplate(
  context: CliContext,
  loaded: LoadedTemplate,
  plan: ReturnType<typeof buildInstantiationPlan>
): Promise<{
  readonly schemaVersion: string;
  readonly template: { readonly id: string; readonly version: string; readonly path: string };
  readonly runId: string;
  readonly rootId?: WorkId;
  readonly created: readonly CreatedTemplateNode[];
  readonly edgeCount: number;
}> {
  const sourceRef: SourceRef = {
    uri: `template://${loaded.template.id}@${loaded.template.version}`,
    label: loaded.template.title ?? loaded.template.id
  };
  const now = nowIso();
  const actor = context.actor;
  const created = await context.store.write(async (writer) => {
    const existingWork = await writer.listWorkItems();
    const existingEdges = await writer.listGraphEdges();
    const existingIds = new Set(existingWork.map((work) => work.meta.id));
    const workByKey = new Map<string, WorkItem>();
    const workById = new Map<string, WorkItem>(existingWork.map((work) => [work.meta.id, work]));
    const edges: GraphEdge[] = [...existingEdges];
    const edgeIds = new Set(edges.map((edge) => edge.meta.id));

    for (const node of plan.nodes) {
      const parentId = node.parentKey ? workByKey.get(node.parentKey)?.meta.id : undefined;
      if (node.parentKey && !parentId) {
        throw new BorealError("BOREAL_INVARIANT", "Template parent was not created before child", { node: node.key, parentKey: node.parentKey });
      }
      const binding = node.binding
        ? {
            ...node.binding,
            templateNodeKey: node.key,
            templateId: loaded.template.id,
            templateVersion: loaded.template.version,
            templateRunId: plan.runId
          }
        : undefined;
      const baseWork = createUniqueWorkItem(existingIds, {
        title: node.title,
        description: node.description,
        kind: node.kind,
        priority: node.priority,
        labels: [
          ...node.labels,
          `template:${loaded.template.id}`,
          `template-version:${loaded.template.version}`,
          `template-run:${plan.runId}`
        ],
        acceptanceCriteria: node.acceptance,
        requiredCloseoutGates: node.gates,
        parentId,
        sourceRefs: [sourceRef],
        binding,
        actor,
        now
      });
      const work = binding ? withContentHash({ ...baseWork, binding }) : baseWork;
      workByKey.set(node.key, work);
      workById.set(work.meta.id, work);
      existingIds.add(work.meta.id);
    }

    const addDependency = (dependentKey: string, dependencyKey: string): void => {
      const blockedWork = workByKey.get(dependentKey);
      const blockingWork = workByKey.get(dependencyKey);
      if (!blockedWork || !blockingWork) {
        throw new BorealError("BOREAL_INVARIANT", "Template dependency references an unknown created node", {
          dependentKey,
          dependencyKey
        });
      }
      const dependencies = blockedWork.dependencyIds
        .map((dependencyId) => workById.get(dependencyId))
        .filter((work): work is WorkItem => Boolean(work));
      const result = addBlockingDependencyDomain({
        blockedWork,
        blockingWork,
        dependencies,
        existingEdges: edges,
        policy: context.runtime.policy,
        actor,
        now
      });
      workByKey.set(dependentKey, result.blockedWork);
      workById.set(result.blockedWork.meta.id, result.blockedWork);
      if (!edgeIds.has(result.edge.meta.id)) {
        edges.push(result.edge);
        edgeIds.add(result.edge.meta.id);
      }
    };

    for (const node of plan.nodes) {
      if (node.parentKey) {
        addDependency(node.parentKey, node.key);
      }
    }
    for (const edge of plan.edges) {
      addDependency(edge.dependent, edge.dependency);
    }

    for (const [key, work] of [...workByKey.entries()]) {
      const dependencies = work.dependencyIds
        .map((dependencyId) => workById.get(dependencyId))
        .filter((dependency): dependency is WorkItem => Boolean(dependency));
      const ready = markWorkReady(work, dependencies, now, actor);
      workByKey.set(key, ready);
      workById.set(ready.meta.id, ready);
    }

    for (const work of workByKey.values()) {
      await writer.putWorkItem(work);
    }
    for (const edge of edges.filter((edge) => !existingEdges.some((existing) => existing.meta.id === edge.meta.id))) {
      await writer.putGraphEdge(edge);
    }

    return {
      created: plan.nodes.map((node) => {
        const work = workByKey.get(node.key)!;
        return {
          key: node.key,
          workId: work.meta.id,
          title: work.title,
          kind: work.kind,
          status: work.status,
          parentKey: node.parentKey,
          binding: work.binding
        };
      }),
      edgeCount: edges.length - existingEdges.length
    };
  });

  return {
    schemaVersion: "boreal.cli.template.run.v1",
    template: {
      id: loaded.template.id,
      version: loaded.template.version,
      path: loaded.relativePath
    },
    runId: plan.runId,
    rootId: created.created[0]?.workId,
    created: created.created,
    edgeCount: created.edgeCount
  };
}

function createUniqueWorkItem(
  existingIds: ReadonlySet<WorkId>,
  input: Parameters<typeof createWorkItem>[0]
): WorkItem {
  for (let nonce = 0; nonce < 10_000; nonce += 1) {
    const work = createWorkItem({ ...input, nonce });
    if (!existingIds.has(work.meta.id)) {
      return work;
    }
  }
  throw new BorealError("BOREAL_CONFLICT", "Could not allocate a unique work id for template node");
}

async function captureTemplate(
  context: CliContext,
  rootId: WorkId,
  out: string,
  variables: ReadonlyMap<string, string>,
  overwrite: boolean
): Promise<{ readonly schemaVersion: string; readonly path: string; readonly templateId: string; readonly nodeCount: number; readonly edgeCount: number }> {
  const outPath = resolve(context.cwd, out);
  assertPathInside(context.workspaceRoot, outPath);
  if (existsSync(outPath) && !overwrite) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Output file already exists; pass --overwrite to replace it", { path: outPath });
  }
  const template = await context.store.read(async (reader) => {
    const workItems = await reader.listWorkItems();
    const graphEdges = await reader.listGraphEdges();
    const byId = new Map(workItems.map((work) => [work.meta.id, work]));
    const root = byId.get(rootId);
    if (!root) {
      throw new BorealError("BOREAL_NOT_FOUND", "Work item not found", { workId: rootId, domain: "work" });
    }
    const childrenByParent = childrenByParentIdOrDependency(workItems, graphEdges);
    const seen = new Set<WorkId>();
    const node = captureNode(root, childrenByParent, byId, variables, seen);
    const nodeIds = new Set([...seen]);
    const keyById = new Map<WorkId, string>();
    collectCapturedKeys(node, keyById);
    const edges = graphEdges
      .filter((edge) => edge.kind === "blocks" && nodeIds.has(edge.fromId as WorkId) && nodeIds.has(edge.toId as WorkId))
      .filter((edge) => !isHierarchyEdge(edge, byId))
      .map((edge) => ({
        dependent: keyById.get(edge.toId as WorkId) ?? String(edge.toId),
        dependency: keyById.get(edge.fromId as WorkId) ?? String(edge.fromId)
      }));
    return {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      id: slugify(root.title),
      version: "1",
      title: replaceVariables(root.title, variables),
      description: replaceVariables(root.description, variables),
      variables: [...variables.keys()].map((name) => ({ name, required: true })),
      nodes: [node],
      edges
    } satisfies WorkTemplate;
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${templateToYaml(template)}\n`, "utf8");
  return {
    schemaVersion: "boreal.cli.template.capture.v1",
    path: outPath,
    templateId: template.id,
    nodeCount: flattenNodes(template.nodes).length,
    edgeCount: template.edges.length
  };
}

function captureNode(
  work: WorkItem,
  childrenByParent: ReadonlyMap<WorkId, readonly WorkId[]>,
  byId: ReadonlyMap<WorkId, WorkItem>,
  variables: ReadonlyMap<string, string>,
  seen: Set<WorkId>
): TemplateNode {
  seen.add(work.meta.id);
  const children = (childrenByParent.get(work.meta.id) ?? [])
    .map((childId) => byId.get(childId))
    .filter((child): child is WorkItem => child !== undefined)
    .filter((child) => !seen.has(child.meta.id))
    .map((child) => captureNode(child, childrenByParent, byId, variables, seen));
  return {
    key: uniqueCapturedKey(work.title, work.meta.id, seen.size),
    kind: work.kind,
    title: replaceVariables(work.title, variables),
    description: replaceVariables(work.description, variables),
    priority: work.priority === "normal" ? undefined : work.priority,
    labels: work.labels.map((label) => replaceVariables(label, variables)),
    acceptance: work.acceptanceCriteria.map((criterion) => replaceVariables(criterion, variables)),
    gates: (work.requiredCloseoutGates ?? []).map((gate) => ({
      kind: gate.kind,
      scope: gate.scope,
      requiredEvidenceKinds: gate.requiredEvidenceKinds,
      minEvidenceCount: gate.minEvidenceCount,
      declaredCommand: gate.declaredCommand,
      expectedObservable: gate.expectedObservable
    })),
    binding: work.binding
      ? {
          workflowRef: replaceVariables(work.binding.workflowRef ?? "", variables) || undefined,
          outputContract: replaceVariables(work.binding.outputContract ?? "", variables) || undefined,
          command: replaceVariables(work.binding.command ?? "", variables) || undefined
        }
      : undefined,
    children
  };
}

function childrenByParentIdOrDependency(
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): ReadonlyMap<WorkId, readonly WorkId[]> {
  const byParent = new Map<WorkId, WorkId[]>();
  for (const work of workItems) {
    if (work.parentId) {
      const current = byParent.get(work.parentId) ?? [];
      current.push(work.meta.id);
      byParent.set(work.parentId, current);
    }
  }
  if (byParent.size > 0) {
    return byParent;
  }
  for (const edge of graphEdges) {
    if (edge.kind !== "blocks" || edge.fromType !== "work" || edge.toType !== "work") {
      continue;
    }
    const current = byParent.get(edge.toId as WorkId) ?? [];
    current.push(edge.fromId as WorkId);
    byParent.set(edge.toId as WorkId, current);
  }
  return byParent;
}

function isHierarchyEdge(edge: GraphEdge, byId: ReadonlyMap<WorkId, WorkItem>): boolean {
  const child = byId.get(edge.fromId as WorkId);
  return child?.parentId === edge.toId;
}

function collectCapturedKeys(node: TemplateNode, keyById: Map<WorkId, string>): void {
  const id = node.key.match(/bw_work_[a-f0-9]+$/u)?.[0] as WorkId | undefined;
  if (id) {
    keyById.set(id, node.key);
  }
  for (const child of node.children) {
    collectCapturedKeys(child, keyById);
  }
}

function uniqueCapturedKey(title: string, id: WorkId, index: number): string {
  return `${slugify(title) || "node"}-${String(index).padStart(2, "0")}-${id}`;
}

function variableValuesFromArgs(args: ParsedArgs): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const entry of flagValues(args, "var")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new BorealError("BOREAL_INVALID_INPUT", "--var must be formatted as name=value", { value: entry });
    }
    const key = entry.slice(0, separator).trim();
    if (!VARIABLE_PATTERN.test(key)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "--var name is invalid", { key });
    }
    values.set(key, entry.slice(separator + 1));
  }
  return values;
}

function buildSubstitutionMap(template: WorkTemplate, provided: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const variable of template.variables) {
    if (provided.has(variable.name)) {
      values.set(variable.name, provided.get(variable.name) ?? "");
    } else if (variable.default !== undefined) {
      values.set(variable.name, variable.default);
    }
  }
  return values;
}

function substituteNode(node: TemplateNode, variables: ReadonlyMap<string, string>): TemplateNode {
  return {
    ...node,
    title: substituteString(node.title, variables),
    description: node.description ? substituteString(node.description, variables) : undefined,
    labels: node.labels.map((label) => substituteString(label, variables)),
    acceptance: node.acceptance.map((criterion) => substituteString(criterion, variables)),
    gates: node.gates.map((gate) => substituteGate(gate, variables)),
    binding: node.binding ? substituteBinding(node.binding, variables) : undefined,
    children: node.children.map((child) => substituteNode(child, variables))
  };
}

function substituteGate(gate: RequiredCloseoutGateInput, variables: ReadonlyMap<string, string>): RequiredCloseoutGateInput {
  return {
    ...gate,
    declaredCommand: gate.declaredCommand ? substituteString(gate.declaredCommand, variables) : undefined,
    expectedObservable: gate.expectedObservable ? substituteString(gate.expectedObservable, variables) : undefined
  };
}

function substituteBinding(binding: TemplateBinding, variables: ReadonlyMap<string, string>): TemplateBinding {
  return {
    workflowRef: binding.workflowRef ? substituteString(binding.workflowRef, variables) : undefined,
    outputContract: binding.outputContract ? substituteString(binding.outputContract, variables) : undefined,
    command: binding.command ? substituteString(binding.command, variables) : undefined
  };
}

function substituteString(value: string, variables: ReadonlyMap<string, string>): string {
  return value.replace(PLACEHOLDER_PATTERN, (_match, name: string) => variables.get(name) ?? `{{${name}}}`);
}

function replaceVariables(value: string, variables: ReadonlyMap<string, string>): string {
  let result = value;
  for (const [name, concrete] of variables.entries()) {
    if (!concrete) {
      continue;
    }
    result = result.replace(new RegExp(escapeRegExp(concrete), "gu"), `{{${name}}}`);
  }
  return result;
}

function placeholdersIn(value: string): readonly string[] {
  const names = new Set<string>();
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1]) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function flattenNodes(nodes: readonly TemplateNode[], parentKey?: string): readonly FlatNode[] {
  return nodes.flatMap((node) => [{ node, parentKey }, ...flattenNodes(node.children, node.key)]);
}

function dependencyCycles(flatNodes: readonly FlatNode[], edges: readonly TemplateEdge[]): readonly string[][] {
  const adjacency = new Map<string, string[]>();
  for (const entry of flatNodes) {
    adjacency.set(entry.node.key, []);
    if (entry.parentKey) {
      adjacency.set(entry.node.key, [...(adjacency.get(entry.node.key) ?? []), entry.parentKey]);
    }
  }
  for (const edge of edges) {
    adjacency.set(edge.dependency, [...(adjacency.get(edge.dependency) ?? []), edge.dependent]);
  }
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (key: string): void => {
    if (visiting.has(key)) {
      cycles.push(stack.slice(stack.indexOf(key)).concat(key));
      return;
    }
    if (visited.has(key)) {
      return;
    }
    visiting.add(key);
    stack.push(key);
    for (const next of adjacency.get(key) ?? []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of adjacency.keys()) {
    visit(key);
  }
  return cycles;
}

async function loadTemplate(context: CliContext, ref: string): Promise<LoadedTemplate> {
  const direct = await directTemplateFile(context, ref);
  if (direct) {
    return readTemplateFile(context, direct);
  }
  const files = await listTemplateFiles(context);
  const loaded = await Promise.all(files.map((file) => readTemplateFile(context, file)));
  const matches = loaded.filter((candidate) => templateMatchesRef(candidate, ref));
  if (matches.length === 1 && matches[0]) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new BorealError("BOREAL_CONFLICT", "Template reference is ambiguous", {
      ref,
      candidates: matches.map((candidate) => candidate.relativePath)
    });
  }
  throw new BorealError("BOREAL_NOT_FOUND", "Work template not found", {
    ref,
    didYouMean: loaded.slice(0, 5).map((candidate) => ({ id: candidate.template.id, path: candidate.relativePath })),
    domain: "template"
  });
}

function templateMatchesRef(candidate: LoadedTemplate, ref: string): boolean {
  const withoutExt = candidate.relativePath.replace(/\.(ya?ml|json)$/u, "");
  return (
    candidate.template.id === ref ||
    `${candidate.template.id}@${candidate.template.version}` === ref ||
    candidate.relativePath === ref ||
    withoutExt === ref ||
    basename(withoutExt) === ref
  );
}

async function directTemplateFile(context: CliContext, ref: string): Promise<string | undefined> {
  const candidates = [resolve(context.cwd, ref), resolve(context.workspaceRoot, ref)];
  for (const candidate of candidates) {
    if (existsSync(candidate) && (await stat(candidate)).isFile()) {
      return candidate;
    }
  }
  return undefined;
}

async function listTemplateFiles(context: CliContext): Promise<readonly string[]> {
  const roots = resolveWorkflowAssetRoots({ workspaceRoot: context.workspaceRoot });
  const dir = join(roots.templatesRoot, TEMPLATE_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  return recursiveTemplateFiles(dir);
}

async function recursiveTemplateFiles(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return recursiveTemplateFiles(path);
      }
      return entry.isFile() && [".yaml", ".yml", ".json"].includes(extname(path)) ? [path] : [];
    })
  );
  return files.flat().sort();
}

async function readTemplateFile(context: CliContext, path: string): Promise<LoadedTemplate> {
  const roots = resolveWorkflowAssetRoots({ workspaceRoot: context.workspaceRoot });
  const text = await readFile(path, "utf8");
  const template = normalizeTemplate(parseYamlOrJson(text, path), path);
  return {
    template,
    path,
    relativePath: path.startsWith(roots.assetRoot) ? relative(roots.assetRoot, path) : path
  };
}

function normalizeTemplate(value: unknown, path: string): WorkTemplate {
  const record = requireRecord(value, path);
  const variables = arrayValue(record.variables).map((entry, index) => normalizeVariable(entry, `${path}.variables[${index}]`));
  const nodes = arrayValue(record.nodes).map((entry, index) => normalizeNode(entry, `${path}.nodes[${index}]`));
  const edges = arrayValue(record.edges).map((entry, index) => normalizeEdge(entry, `${path}.edges[${index}]`));
  return {
    schemaVersion: stringValue(record.schemaVersion ?? record.schema_version, `${path}.schemaVersion`),
    id: stringValue(record.id, `${path}.id`),
    version: String(record.version ?? ""),
    title: optionalString(record.title, `${path}.title`),
    description: optionalString(record.description, `${path}.description`),
    variables,
    nodes,
    edges
  };
}

function normalizeVariable(value: unknown, path: string): TemplateVariable {
  const record = requireRecord(value, path);
  return {
    name: stringValue(record.name, `${path}.name`),
    description: optionalString(record.description, `${path}.description`),
    default: optionalScalarString(record.default),
    required: booleanValue(record.required, true)
  };
}

function normalizeNode(value: unknown, path: string): TemplateNode {
  const record = requireRecord(value, path);
  return {
    key: stringValue(record.key, `${path}.key`),
    kind: stringValue(record.kind, `${path}.kind`) as WorkKind,
    title: stringValue(record.title, `${path}.title`),
    description: optionalString(record.description, `${path}.description`),
    priority: optionalString(record.priority, `${path}.priority`) as WorkPriority | undefined,
    labels: stringArray(record.labels),
    acceptance: stringArray(record.acceptance ?? record.acceptanceCriteria),
    gates: arrayValue(record.gates).map((entry, index) => normalizeGate(entry, `${path}.gates[${index}]`)),
    binding: record.binding === undefined ? undefined : normalizeBinding(record.binding, `${path}.binding`),
    children: arrayValue(record.children).map((entry, index) => normalizeNode(entry, `${path}.children[${index}]`))
  };
}

function normalizeBinding(value: unknown, path: string): TemplateBinding {
  const record = requireRecord(value, path);
  return {
    workflowRef: optionalString(record.workflow ?? record.workflowRef, `${path}.workflow`),
    outputContract: optionalString(record.contract ?? record.outputContract, `${path}.contract`),
    command: optionalString(record.command, `${path}.command`)
  };
}

function normalizeGate(value: unknown, path: string): RequiredCloseoutGateInput {
  const record = requireRecord(value, path);
  return {
    kind: stringValue(record.kind, `${path}.kind`) as RequiredCloseoutGateInput["kind"],
    scope: optionalString(record.scope, `${path}.scope`) as RequiredCloseoutGateInput["scope"],
    requiredEvidenceKinds: stringArray(record.requiredEvidenceKinds ?? record.required_evidence_kinds) as RequiredCloseoutGateInput["requiredEvidenceKinds"],
    minEvidenceCount: numberValue(record.minEvidenceCount ?? record.min_evidence_count),
    declaredCommand: optionalString(record.declaredCommand ?? record.declared_command, `${path}.declaredCommand`),
    expectedObservable: optionalString(record.expectedObservable ?? record.expected_observable, `${path}.expectedObservable`)
  };
}

function normalizeEdge(value: unknown, path: string): TemplateEdge {
  const record = requireRecord(value, path);
  return {
    dependent: stringValue(record.dependent ?? record.blocked ?? record.to, `${path}.dependent`),
    dependency: stringValue(record.dependency ?? record.dependsOn ?? record.blocker ?? record.from, `${path}.dependency`)
  };
}

function parseYamlOrJson(text: string, path: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as unknown;
  }
  return new YamlSubsetParser(text, path).parse();
}

class YamlSubsetParser {
  readonly #lines: readonly YamlLine[];
  readonly #path: string;

  constructor(text: string, path: string) {
    this.#path = path;
    this.#lines = text
      .split("\n")
      .map((raw, index) => ({ raw, index: index + 1, indent: raw.match(/^ */u)?.[0].length ?? 0, text: raw.trimEnd() }))
      .filter((line) => line.text.trim().length > 0 && !line.text.trimStart().startsWith("#"));
  }

  parse(): unknown {
    if (this.#lines.length === 0) {
      return {};
    }
    return this.#parseBlock(0, this.#lines[0]?.indent ?? 0).value;
  }

  #parseBlock(index: number, indent: number): { readonly value: unknown; readonly next: number } {
    const line = this.#lines[index];
    if (!line || line.indent < indent) {
      return { value: {}, next: index };
    }
    if (line.indent !== indent) {
      this.#fail(line, `expected indentation ${indent}`);
    }
    return line.text.trimStart().startsWith("- ")
      ? this.#parseArray(index, indent)
      : this.#parseObject(index, indent);
  }

  #parseObject(index: number, indent: number): { readonly value: Record<string, unknown>; readonly next: number } {
    const result: Record<string, unknown> = {};
    let cursor = index;
    while (cursor < this.#lines.length) {
      const line = this.#lines[cursor]!;
      if (line.indent < indent) {
        break;
      }
      if (line.indent > indent) {
        this.#fail(line, "unexpected nested indentation");
      }
      if (line.text.trimStart().startsWith("- ")) {
        break;
      }
      const { key, rest } = this.#parseKeyValue(line);
      if (rest === "") {
        const nextLine = this.#lines[cursor + 1];
        if (!nextLine || nextLine.indent <= indent) {
          result[key] = [];
          cursor += 1;
        } else {
          const nested = this.#parseBlock(cursor + 1, nextLine.indent);
          result[key] = nested.value;
          cursor = nested.next;
        }
      } else {
        result[key] = parseScalar(rest);
        cursor += 1;
      }
    }
    return { value: result, next: cursor };
  }

  #parseArray(index: number, indent: number): { readonly value: unknown[]; readonly next: number } {
    const result: unknown[] = [];
    let cursor = index;
    while (cursor < this.#lines.length) {
      const line = this.#lines[cursor]!;
      if (line.indent < indent) {
        break;
      }
      if (line.indent !== indent || !line.text.trimStart().startsWith("- ")) {
        break;
      }
      const rest = line.text.trimStart().slice(2).trim();
      if (rest === "") {
        const nextLine = this.#lines[cursor + 1];
        if (!nextLine || nextLine.indent <= indent) {
          result.push(null);
          cursor += 1;
        } else {
          const nested = this.#parseBlock(cursor + 1, nextLine.indent);
          result.push(nested.value);
          cursor = nested.next;
        }
        continue;
      }
      const inline = /^([A-Za-z0-9_-]+):(.*)$/u.exec(rest);
      if (inline) {
        const item: Record<string, unknown> = {};
        item[inline[1] ?? ""] = parseScalar((inline[2] ?? "").trim());
        let next = cursor + 1;
        const nextLine = this.#lines[next];
        if (nextLine && nextLine.indent > indent) {
          const continuation = this.#parseObject(next, nextLine.indent);
          Object.assign(item, continuation.value);
          next = continuation.next;
        }
        result.push(item);
        cursor = next;
        continue;
      }
      result.push(parseScalar(rest));
      cursor += 1;
    }
    return { value: result, next: cursor };
  }

  #parseKeyValue(line: YamlLine): { readonly key: string; readonly rest: string } {
    const match = /^ *([A-Za-z0-9_-]+):(.*)$/u.exec(line.text);
    if (!match) {
      this.#fail(line, "expected key: value");
    }
    return { key: match?.[1] ?? "", rest: (match?.[2] ?? "").trim() };
  }

  #fail(line: YamlLine, message: string): never {
    throw new BorealError("BOREAL_INVALID_INPUT", "Unsupported work-template YAML", {
      path: this.#path,
      line: line.index,
      message,
      text: line.raw
    });
  }
}

interface YamlLine {
  readonly raw: string;
  readonly index: number;
  readonly indent: number;
  readonly text: string;
}

function parseScalar(value: string): unknown {
  if (value === "") {
    return "";
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    return body ? splitCommaSeparated(body).map((entry) => parseScalar(entry.trim())) : [];
  }
  if (value.startsWith('"')) {
    return JSON.parse(value) as string;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/gu, "'");
  }
  if (/^-?\d+$/u.test(value)) {
    return Number(value);
  }
  return value;
}

function splitCommaSeparated(value: string): readonly string[] {
  const entries: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (char === "," && !quote) {
      entries.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  entries.push(current);
  return entries;
}

function templateToYaml(template: WorkTemplate): string {
  return [
    `schemaVersion: ${yamlScalar(template.schemaVersion)}`,
    `id: ${yamlScalar(template.id)}`,
    `version: ${yamlScalar(template.version)}`,
    template.title ? `title: ${yamlScalar(template.title)}` : undefined,
    template.description ? `description: ${yamlScalar(template.description)}` : undefined,
    "variables:",
    ...template.variables.flatMap((variable) => [
      `  - name: ${yamlScalar(variable.name)}`,
      variable.description ? `    description: ${yamlScalar(variable.description)}` : undefined,
      variable.default !== undefined ? `    default: ${yamlScalar(variable.default)}` : undefined,
      `    required: ${variable.required ? "true" : "false"}`
    ]),
    "nodes:",
    ...template.nodes.flatMap((node) => nodeToYaml(node, 2)),
    "edges:",
    ...template.edges.flatMap((edge) => [`  - dependent: ${yamlScalar(edge.dependent)}`, `    dependency: ${yamlScalar(edge.dependency)}`])
  ].filter((line): line is string => line !== undefined).join("\n");
}

function nodeToYaml(node: TemplateNode, indent: number): readonly string[] {
  const pad = " ".repeat(indent);
  const childPad = " ".repeat(indent + 2);
  return [
    `${pad}- key: ${yamlScalar(node.key)}`,
    `${childPad}kind: ${yamlScalar(node.kind)}`,
    `${childPad}title: ${yamlScalar(node.title)}`,
    node.description ? `${childPad}description: ${yamlScalar(node.description)}` : undefined,
    node.priority ? `${childPad}priority: ${yamlScalar(node.priority)}` : undefined,
    `${childPad}labels:`,
    ...node.labels.map((label) => `${childPad}  - ${yamlScalar(label)}`),
    `${childPad}acceptance:`,
    ...node.acceptance.map((criterion) => `${childPad}  - ${yamlScalar(criterion)}`),
    ...(node.gates.length > 0 ? [`${childPad}gates:`, ...node.gates.flatMap((gate) => gateToYaml(gate, indent + 4))] : []),
    ...(node.binding ? bindingToYaml(node.binding, indent + 2) : []),
    ...(node.children.length > 0 ? [`${childPad}children:`, ...node.children.flatMap((child) => nodeToYaml(child, indent + 4))] : [])
  ].filter((line): line is string => line !== undefined);
}

function gateToYaml(gate: RequiredCloseoutGateInput, indent: number): readonly string[] {
  const pad = " ".repeat(indent);
  const childPad = " ".repeat(indent + 2);
  return [
    `${pad}- kind: ${yamlScalar(gate.kind)}`,
    gate.scope ? `${childPad}scope: ${yamlScalar(gate.scope)}` : undefined,
    gate.declaredCommand ? `${childPad}declaredCommand: ${yamlScalar(gate.declaredCommand)}` : undefined,
    gate.expectedObservable ? `${childPad}expectedObservable: ${yamlScalar(gate.expectedObservable)}` : undefined
  ].filter((line): line is string => line !== undefined);
}

function bindingToYaml(binding: TemplateBinding, indent: number): readonly string[] {
  const pad = " ".repeat(indent);
  return [
    `${pad}binding:`,
    binding.workflowRef ? `${pad}  workflow: ${yamlScalar(binding.workflowRef)}` : undefined,
    binding.outputContract ? `${pad}  contract: ${yamlScalar(binding.outputContract)}` : undefined,
    binding.command ? `${pad}  command: ${yamlScalar(binding.command)}` : undefined
  ].filter((line): line is string => line !== undefined);
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Expected object in work template", { path });
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): readonly string[] {
  return arrayValue(value).map((entry) => String(entry));
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Expected string in work template", { path });
  }
  return String(value);
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return stringValue(value, path);
}

function optionalScalarString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function numberValue(value: unknown): number | undefined {
  return value === undefined || value === null || value === "" ? undefined : Number(value);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : value === undefined ? fallback : String(value) !== "false";
}

function requiredPositional(values: readonly string[], index: number, label: string): string {
  const value = values[index];
  if (!value) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} is required`);
  }
  return value;
}

function templateRunId(template: WorkTemplate, variables: ReadonlyMap<string, string>): string {
  return `run-${hashContent({
    template: template.id,
    version: template.version,
    variables: Object.fromEntries([...variables.entries()].sort(([left], [right]) => left.localeCompare(right))),
    now: nowIso(),
    entropy: Math.random()
  }).slice(7, 23)}`;
}

function slugify(value: string): string {
  return normalizeLabel(value).replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 64) || "template";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function formatTemplateShow(result: ReturnType<typeof templateShowResult>): string {
  return [
    `Template: ${result.template.id}@${result.template.version}`,
    `Path: ${result.path}`,
    `Nodes: ${result.validation.nodeCount}`,
    `Edges: ${result.validation.edgeCount}`,
    `Validation: ${result.validation.ok ? "passed" : "failed"}`
  ].join("\n") + "\n";
}

function formatTemplateValidation(result: Awaited<ReturnType<typeof validateLoadedTemplate>>): string {
  return `Template validation ${result.ok ? "passed" : "failed"}: ${result.templateId}@${result.version} (${result.nodeCount} nodes, ${result.edgeCount} edges)\n`;
}

function formatTemplateRun(result: { readonly runId: string; readonly nodes?: readonly unknown[]; readonly created?: readonly CreatedTemplateNode[] }): string {
  const rows = "created" in result && result.created ? result.created : [];
  return [`Template run: ${result.runId}`, rows.length > 0 ? table(rows.map((row) => ({ key: row.key, id: row.workId, kind: row.kind, status: row.status, title: row.title }))) : ""].join("\n");
}

function formatCaptureResult(result: { readonly path: string; readonly templateId: string; readonly nodeCount: number; readonly edgeCount: number }): string {
  return `Captured template ${result.templateId} to ${result.path} (${result.nodeCount} nodes, ${result.edgeCount} edges)\n`;
}
