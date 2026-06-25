import { hashContent } from "./hash.js";
import type { ContentHash } from "./ids.js";
import { BOREAL_SCHEMA_VERSION, type ActorRef, type RecordMeta, type SourceRef } from "./records.js";
import type { IsoTimestamp } from "./time.js";

export interface RecordMetaInput<TId extends string> {
  readonly id: TId;
  readonly now: IsoTimestamp;
  readonly actor: ActorRef;
  readonly sourceRefs?: readonly SourceRef[];
  readonly tags?: readonly string[];
}

export function createRecordMeta<TId extends string>(input: RecordMetaInput<TId>): RecordMeta<TId> {
  return {
    id: input.id,
    schemaVersion: BOREAL_SCHEMA_VERSION,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.actor,
    updatedBy: input.actor,
    sourceRefs: input.sourceRefs ?? [],
    tags: input.tags ?? []
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
  return withContentHash({
    ...record,
    meta: {
      ...record.meta,
      updatedAt: now,
      updatedBy: actor
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

