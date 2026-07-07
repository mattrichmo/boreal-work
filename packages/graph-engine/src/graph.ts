import {
  createRecordMeta,
  deterministicId,
  type ActorRef,
  type EdgeKind,
  type GraphEdge,
  type GraphEdgeId,
  type IsoTimestamp,
  withContentHash
} from "@boreal/core";

export interface CreateGraphEdgeInput {
  readonly kind: EdgeKind;
  readonly fromProjectId?: string;
  readonly fromId: string;
  readonly fromType: string;
  readonly toProjectId?: string;
  readonly toId: string;
  readonly toType: string;
  readonly directed?: boolean;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
  readonly tags?: readonly string[];
}

type GraphEdgeIdentityInput = Pick<
  CreateGraphEdgeInput,
  "kind" | "fromProjectId" | "fromId" | "fromType" | "toProjectId" | "toId" | "toType"
> & {
  readonly directed?: boolean;
};

export interface GraphTraversalOptions {
  readonly localProjectId?: string;
}

export interface GraphPathOptions extends GraphTraversalOptions {
  readonly startProjectId?: string;
  readonly targetProjectId?: string;
}

export interface GraphCycleOptions extends GraphTraversalOptions {
  readonly proposedFromProjectId?: string;
  readonly proposedToProjectId?: string;
}

export function makeGraphEdgeId(input: GraphEdgeIdentityInput): GraphEdgeId {
  return deterministicId<GraphEdgeId>("edge", {
    kind: input.kind,
    fromProjectId: input.fromProjectId,
    fromId: input.fromId,
    fromType: input.fromType,
    toProjectId: input.toProjectId,
    toId: input.toId,
    toType: input.toType,
    directed: input.directed ?? true
  });
}

export function createGraphEdge(input: CreateGraphEdgeInput): GraphEdge {
  const directed = input.directed ?? true;
  const id = makeGraphEdgeId({ ...input, directed });
  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor,
      tags: input.tags
    }),
    kind: input.kind,
    ...(input.fromProjectId ? { fromProjectId: input.fromProjectId } : {}),
    fromId: input.fromId,
    fromType: input.fromType,
    ...(input.toProjectId ? { toProjectId: input.toProjectId } : {}),
    toId: input.toId,
    toType: input.toType,
    directed
  });
}

export function hasPath(edges: readonly GraphEdge[], startId: string, targetId: string, options: GraphPathOptions = {}): boolean {
  const adjacency = buildAdjacency(edges, options);
  const seen = new Set<string>();
  const targetKey = endpointKey(targetId, options.targetProjectId, options.localProjectId);
  const queue = [endpointKey(startId, options.startProjectId, options.localProjectId)];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next)) {
      continue;
    }
    if (next === targetKey) {
      return true;
    }
    seen.add(next);
    queue.push(...(adjacency.get(next) ?? []));
  }

  return false;
}

export function wouldCreateCycle(
  existingEdges: readonly GraphEdge[],
  proposedFromId: string,
  proposedToId: string,
  options: GraphCycleOptions = {}
): boolean {
  return hasPath(existingEdges, proposedToId, proposedFromId, {
    localProjectId: options.localProjectId,
    startProjectId: options.proposedToProjectId,
    targetProjectId: options.proposedFromProjectId
  });
}

export function buildAdjacency(edges: readonly GraphEdge[], options: GraphTraversalOptions = {}): Map<string, readonly string[]> {
  const nextById = new Map<string, string[]>();
  for (const edge of edges) {
    const fromKey = endpointKey(edge.fromId, edge.fromProjectId, options.localProjectId);
    const toKey = endpointKey(edge.toId, edge.toProjectId, options.localProjectId);
    if (!edge.directed) {
      addEdge(nextById, toKey, fromKey);
    }
    addEdge(nextById, fromKey, toKey);
  }
  return nextById;
}

function endpointKey(id: string, projectId: string | undefined, localProjectId: string | undefined): string {
  const resolvedProjectId = projectId ?? localProjectId;
  return resolvedProjectId ? `${resolvedProjectId}:${id}` : id;
}

function addEdge(adjacency: Map<string, string[]>, fromId: string, toId: string): void {
  const current = adjacency.get(fromId) ?? [];
  current.push(toId);
  adjacency.set(fromId, current);
}
