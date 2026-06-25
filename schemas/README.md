# Schemas

These JSON schemas describe the durable record envelopes used by the TypeScript runtime. The TypeScript source in `packages/core/src/records.ts` is the implementation source for now; these files document the first external contract for future vault, import, and adapter work.

The current runtime types cover work, graph edges, evidence, verification, knowledge sources, claims, decisions, reservations, events, and projections.
