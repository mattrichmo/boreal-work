-- Add a typed progress event without changing existing historical audit rows.
-- The completion runner executes this entire migration under BEGIN IMMEDIATE.
DROP TRIGGER audit_append_only_update;
DROP TRIGGER audit_append_only_delete;
DROP INDEX audit_revision;
ALTER TABLE audit_event RENAME TO boreal_audit_before_checkpoint;
CREATE TABLE audit_event (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('work.created','work.published','work.closed','work.blocked','work.paused','work.resumed','work.cancelled','work.reopened','attempt.claimed','attempt.accepted','attempt.started','attempt.checkpoint','attempt.submitted','attempt.released','attempt.failed','attempt.expiry_pending','attempt.expired','evidence.verifier.admitted','expiry.resolved','lease.renewed','receipt.recorded','receipt.rejected','review.accepted','review.rejected','close.requested','close.completed','gate.satisfied','hold.resolved','repair.correction','repair.supersession')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('work','attempt','receipt','review','gate','hold','dependency','summary','operation','project')),
  subject_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  session_id TEXT REFERENCES session(session_id),
  fence INTEGER CHECK (fence IS NULL OR fence > 0),
  as_of TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (project_id, revision)
);
INSERT INTO audit_event SELECT * FROM boreal_audit_before_checkpoint;
DROP TABLE boreal_audit_before_checkpoint;
CREATE INDEX audit_revision ON audit_event(project_id, revision);
CREATE TRIGGER audit_append_only_update BEFORE UPDATE ON audit_event BEGIN
 SELECT RAISE(ABORT,'audit_is_append_only'); END;
CREATE TRIGGER audit_append_only_delete BEFORE DELETE ON audit_event BEGIN
 SELECT RAISE(ABORT,'audit_is_append_only'); END;
-- The v1 guard intentionally permitted filling an unused legacy {} placeholder.
-- Canonical v2 treats even that row as history; repair must create a new version.
-- Add, rather than replace, the old guard so previous migration checksums hold.
CREATE TRIGGER boreal_profile_strict_immutable_update BEFORE UPDATE ON acceptance_profile
BEGIN SELECT RAISE(ABORT,'acceptance_profile_version_immutable'); END;
