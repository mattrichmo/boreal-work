-- Ordered additive completion contract. The historical v2/v3 schema checksums
-- remain unchanged; migrations.rs journals this exact payload independently.
CREATE TABLE boreal_submission (
  submission_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL CHECK (fence > 0),
  entity_revision INTEGER NOT NULL CHECK (entity_revision >= 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  source_version_id TEXT NOT NULL,
  config_identity TEXT NOT NULL CHECK (trim(config_identity) <> ''),
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  profile_digest TEXT NOT NULL,
  summary_id TEXT NOT NULL REFERENCES summary(summary_id),
  summary_digest TEXT NOT NULL,
  receipt_ids_json TEXT NOT NULL,
  sealed_at TEXT NOT NULL,
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (project_id, source_version_id) REFERENCES source_version(project_id, source_version_id),
  FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  FOREIGN KEY (profile_id, profile_version) REFERENCES acceptance_profile(profile_id, version),
  UNIQUE (project_id, work_id, attempt_id, fence, proof_revision, summary_id, receipt_ids_json)
);
CREATE INDEX boreal_submission_subject ON boreal_submission(project_id, work_id, proof_revision);
CREATE TABLE boreal_review_event (
  review_event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES boreal_submission(submission_id),
  gate_id TEXT NOT NULL,
  reviewer_actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved','rejected','returned','revoked')),
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE INDEX boreal_review_event_subject ON boreal_review_event(project_id, submission_id, gate_id);
CREATE TABLE boreal_accepted_outcome (
  outcome_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES boreal_submission(submission_id),
  close_intent_id TEXT NOT NULL UNIQUE REFERENCES close_intent(close_intent_id),
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  accepted_at TEXT NOT NULL,
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE INDEX boreal_accepted_outcome_subject ON boreal_accepted_outcome(project_id, work_id, proof_revision);
CREATE TABLE boreal_outcome_invalidation (
  outcome_id TEXT NOT NULL REFERENCES boreal_accepted_outcome(outcome_id),
  operation_id TEXT NOT NULL REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  invalidated_at TEXT NOT NULL,
  PRIMARY KEY (outcome_id, operation_id)
);
CREATE TABLE boreal_policy_exception (
  exception_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gate','dependency')),
  target_id TEXT NOT NULL CHECK (trim(target_id) <> ''),
  predecessor_id TEXT,
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  subject_revision INTEGER NOT NULL CHECK (subject_revision >= 0),
  predecessor_revision INTEGER,
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  expires_at_ms INTEGER CHECK (expires_at_ms IS NULL OR expires_at_ms >= 0),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (project_id, predecessor_id) REFERENCES work_item(project_id, work_id),
  CHECK ((kind = 'dependency') = (predecessor_id IS NOT NULL)),
  CHECK ((kind = 'dependency') = (predecessor_revision IS NOT NULL))
);
CREATE INDEX boreal_policy_exception_subject ON boreal_policy_exception(project_id, work_id, proof_revision, kind);
CREATE TABLE boreal_exception_revocation (
  exception_id TEXT PRIMARY KEY REFERENCES boreal_policy_exception(exception_id),
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  revoked_at TEXT NOT NULL
);
CREATE TABLE boreal_reopen_impact (
  operation_id TEXT NOT NULL REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  dependent_id TEXT NOT NULL,
  prior_proof_revision INTEGER NOT NULL,
  next_proof_revision INTEGER NOT NULL CHECK (next_proof_revision > prior_proof_revision),
  created_at TEXT NOT NULL,
  PRIMARY KEY (operation_id, dependent_id),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (project_id, dependent_id) REFERENCES work_item(project_id, work_id)
);
CREATE TABLE boreal_work_schedule (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  not_before_at_ms INTEGER CHECK (not_before_at_ms IS NULL OR not_before_at_ms >= 0),
  due_at_ms INTEGER CHECK (due_at_ms IS NULL OR due_at_ms >= 0),
  target_start_at_ms INTEGER CHECK (target_start_at_ms IS NULL OR target_start_at_ms >= 0),
  target_end_at_ms INTEGER CHECK (target_end_at_ms IS NULL OR target_end_at_ms >= 0),
  PRIMARY KEY (project_id, work_id),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
-- Historical policy and proof bodies are immutable. Clearing a summary's
-- current pointer is a projection change, not permission to edit its content.
CREATE TRIGGER boreal_profile_immutable_update BEFORE UPDATE ON acceptance_profile
WHEN OLD.definition_json <> '{}' OR EXISTS (
  SELECT 1 FROM boreal_pinned_requirement p
  WHERE p.profile_id = OLD.profile_id AND p.profile_version = OLD.version
)
BEGIN SELECT RAISE(ABORT, 'acceptance_profile_immutable'); END;
CREATE TRIGGER boreal_profile_immutable_delete BEFORE DELETE ON acceptance_profile
BEGIN SELECT RAISE(ABORT, 'acceptance_profile_immutable'); END;
CREATE TRIGGER boreal_summary_body_immutable BEFORE UPDATE ON summary
WHEN NEW.summary_id IS NOT OLD.summary_id OR NEW.work_id IS NOT OLD.work_id
 OR NEW.attempt_id IS NOT OLD.attempt_id OR NEW.fence IS NOT OLD.fence
 OR NEW.subject_ref IS NOT OLD.subject_ref OR NEW.source_version_id IS NOT OLD.source_version_id
 OR NEW.config_identity IS NOT OLD.config_identity OR NEW.profile_id IS NOT OLD.profile_id
 OR NEW.profile_version IS NOT OLD.profile_version OR NEW.body_digest IS NOT OLD.body_digest
 OR NEW.body_size IS NOT OLD.body_size OR NEW.created_at IS NOT OLD.created_at
 OR NEW.current > OLD.current
BEGIN SELECT RAISE(ABORT, 'summary_body_immutable'); END;
CREATE TRIGGER boreal_summary_immutable_delete BEFORE DELETE ON summary
BEGIN SELECT RAISE(ABORT, 'summary_body_immutable'); END;
CREATE TRIGGER boreal_review_immutable_update BEFORE UPDATE ON review
BEGIN SELECT RAISE(ABORT, 'review_immutable'); END;
CREATE TRIGGER boreal_review_immutable_delete BEFORE DELETE ON review
BEGIN SELECT RAISE(ABORT, 'review_immutable'); END;
CREATE TRIGGER boreal_operation_immutable_update BEFORE UPDATE ON operation
BEGIN SELECT RAISE(ABORT, 'operation_immutable'); END;
CREATE TRIGGER boreal_operation_immutable_delete BEFORE DELETE ON operation
BEGIN SELECT RAISE(ABORT, 'operation_immutable'); END;
-- Every new canonical work row receives an independent entity and proof cursor.
-- Existing rows retain their entity cursor; initial proof cursors come from the
-- already persisted requirement generation, never a historical 'complete'.
INSERT OR IGNORE INTO boreal_entity_revision(project_id, work_id, entity_revision, proof_revision, updated_at)
SELECT w.project_id, w.work_id, 1,
       COALESCE((SELECT MAX(p.proof_revision) FROM boreal_pinned_requirement p
                 WHERE p.project_id = w.project_id AND p.work_id = w.work_id), 1), w.updated_at
FROM work_item w;
UPDATE boreal_entity_revision SET proof_revision = COALESCE(
  (SELECT MAX(p.proof_revision) FROM boreal_pinned_requirement p
   WHERE p.project_id = boreal_entity_revision.project_id AND p.work_id = boreal_entity_revision.work_id), 1)
WHERE proof_revision = 0;
CREATE TRIGGER boreal_work_identity_insert AFTER INSERT ON work_item
BEGIN
  INSERT INTO boreal_entity_revision(project_id, work_id, entity_revision, proof_revision, updated_at)
  VALUES (NEW.project_id, NEW.work_id, 1, 1, NEW.updated_at);
END;
CREATE TRIGGER boreal_work_identity_update AFTER UPDATE OF parent_id, lifecycle, dispatch_policy, priority,
 title, description, acceptance_profile_id, acceptance_profile_version, source_version_id, retry_not_before ON work_item
WHEN NEW.parent_id IS NOT OLD.parent_id OR NEW.lifecycle IS NOT OLD.lifecycle
 OR NEW.dispatch_policy IS NOT OLD.dispatch_policy OR NEW.priority IS NOT OLD.priority
 OR NEW.title IS NOT OLD.title OR NEW.description IS NOT OLD.description
 OR NEW.acceptance_profile_id IS NOT OLD.acceptance_profile_id
 OR NEW.acceptance_profile_version IS NOT OLD.acceptance_profile_version
 OR NEW.source_version_id IS NOT OLD.source_version_id OR NEW.retry_not_before IS NOT OLD.retry_not_before
BEGIN
  UPDATE boreal_entity_revision SET entity_revision = entity_revision + 1, updated_at = NEW.updated_at
  WHERE project_id = NEW.project_id AND work_id = NEW.work_id;
END;
CREATE TRIGGER boreal_submission_immutable_update BEFORE UPDATE ON boreal_submission
BEGIN SELECT RAISE(ABORT, 'boreal_submission_immutable'); END;
CREATE TRIGGER boreal_submission_immutable_delete BEFORE DELETE ON boreal_submission
BEGIN SELECT RAISE(ABORT, 'boreal_submission_immutable'); END;
CREATE TRIGGER boreal_review_event_immutable_update BEFORE UPDATE ON boreal_review_event
BEGIN SELECT RAISE(ABORT, 'boreal_review_event_immutable'); END;
CREATE TRIGGER boreal_review_event_immutable_delete BEFORE DELETE ON boreal_review_event
BEGIN SELECT RAISE(ABORT, 'boreal_review_event_immutable'); END;
CREATE TRIGGER boreal_accepted_outcome_immutable_update BEFORE UPDATE ON boreal_accepted_outcome
BEGIN SELECT RAISE(ABORT, 'boreal_accepted_outcome_immutable'); END;
CREATE TRIGGER boreal_accepted_outcome_immutable_delete BEFORE DELETE ON boreal_accepted_outcome
BEGIN SELECT RAISE(ABORT, 'boreal_accepted_outcome_immutable'); END;
CREATE TRIGGER boreal_outcome_invalidation_immutable_update BEFORE UPDATE ON boreal_outcome_invalidation
BEGIN SELECT RAISE(ABORT, 'boreal_outcome_invalidation_immutable'); END;
CREATE TRIGGER boreal_outcome_invalidation_immutable_delete BEFORE DELETE ON boreal_outcome_invalidation
BEGIN SELECT RAISE(ABORT, 'boreal_outcome_invalidation_immutable'); END;
CREATE TRIGGER boreal_policy_exception_immutable_update BEFORE UPDATE ON boreal_policy_exception
BEGIN SELECT RAISE(ABORT, 'boreal_policy_exception_immutable'); END;
CREATE TRIGGER boreal_policy_exception_immutable_delete BEFORE DELETE ON boreal_policy_exception
BEGIN SELECT RAISE(ABORT, 'boreal_policy_exception_immutable'); END;
CREATE TRIGGER boreal_exception_revocation_immutable_update BEFORE UPDATE ON boreal_exception_revocation
BEGIN SELECT RAISE(ABORT, 'boreal_exception_revocation_immutable'); END;
CREATE TRIGGER boreal_exception_revocation_immutable_delete BEFORE DELETE ON boreal_exception_revocation
BEGIN SELECT RAISE(ABORT, 'boreal_exception_revocation_immutable'); END;
CREATE TRIGGER boreal_reopen_impact_immutable_update BEFORE UPDATE ON boreal_reopen_impact
BEGIN SELECT RAISE(ABORT, 'boreal_reopen_impact_immutable'); END;
CREATE TRIGGER boreal_reopen_impact_immutable_delete BEFORE DELETE ON boreal_reopen_impact
BEGIN SELECT RAISE(ABORT, 'boreal_reopen_impact_immutable'); END;
