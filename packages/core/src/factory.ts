import { hashContent } from "./hash.js";
import type { ContentHash } from "./ids.js";
import { BOREAL_SCHEMA_VERSION, type ActorRef, type RecordMeta, type SourceRef } from "./records.js";
import { normalizeActorId, normalizeLabels } from "./string-safety.js";
import type { IsoTimestamp } from "./time.js";

export interface RecordMetaInput<TId extends string> {
  readonly id: TId;
  readonly now: IsoTimestamp;
  readonly actor: ActorRef;
  readonly sourceRefs?: readonly SourceRef[];
  readonly tags?: readonly string[];
}

export function createRecordMeta<TId extends string>(input: RecordMetaInput<TId>): RecordMeta<TId> {
  const actor = normalizeActorRef(input.actor);
  return {
    id: input.id,
    schemaVersion: BOREAL_SCHEMA_VERSION,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: actor,
    updatedBy: actor,
    sourceRefs: input.sourceRefs ?? [],
    tags: normalizeLabels(input.tags ?? [])
  };
}

export function withContentHash<TRecord extends { readonly meta: RecordMeta<string> }>(record: TRecord): TRecord {
  const contentHash = hashRecord(record);
  return {
    ...record,
    meta: {
      ...record.meta,
      contentHash
    }
  };
}

export function touchRecord<TRecord extends { readonly meta: RecordMeta<string> }>(
  record: TRecord,
  now: IsoTimestamp,
  actor: ActorRef
): TRecord {
  const normalizedActor = normalizeActorRef(actor);
  return withContentHash({
    ...record,
    meta: {
      ...record.meta,
      updatedAt: now,
      updatedBy: normalizedActor
    }
  });
}

function hashRecord(record: { readonly meta: RecordMeta<string> }): ContentHash {
  return hashContent({
    ...record,
    meta: {
      ...record.meta,
      contentHash: undefined
    }
  });
}

function normalizeActorRef(actor: ActorRef): ActorRef {
  const id = normalizeActorId(String(actor.id));
  return {
    ...actor,
    id,
    displayName: actor.displayName ?? id
  };
}
