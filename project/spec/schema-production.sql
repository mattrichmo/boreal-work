-- Boreal production schema: the canonical v2 base plus the v3 work model.
-- This artifact is executed by the production migration runner.

-- Boreal v2 persistence fixture: boreal.sqlite/2.
-- One local project database; application mutations use short WAL transactions.
PRAGMA foreign_keys = ON;

CREATE TABLE project (
  project_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 2),
  status_contract_version TEXT NOT NULL CHECK (status_contract_version = 'boreal.work-status/2'),
  project_revision INTEGER NOT NULL DEFAULT 0 CHECK (project_revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE actor (
  actor_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('agent','reviewer','operator','publisher')),
  credential_ref TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE session (
  session_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  harness_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','ended','unknown')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK ((state = 'ended') = (ended_at IS NOT NULL))
);

CREATE TABLE source_version (
  source_version_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  origin TEXT NOT NULL,
  access_scope TEXT NOT NULL CHECK (access_scope IN ('project','private')),
  content_digest TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
  captured_at TEXT NOT NULL,
  parser_identity TEXT NOT NULL,
  availability TEXT NOT NULL CHECK (availability IN ('available','missing','quarantined')),
  citation_json TEXT NOT NULL,
  UNIQUE (project_id, source_version_id)
);

CREATE TABLE acceptance_profile (
  profile_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  policy_digest TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, version)
);

CREATE TABLE work_item (
  work_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  kind TEXT NOT NULL CHECK (kind IN ('milestone','sprint','task')),
  parent_id TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle IN ('draft','open','closed','cancelled')),
  dispatch_policy TEXT NOT NULL DEFAULT 'automatic' CHECK (dispatch_policy IN ('automatic','operator_only','paused')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0 AND priority <= 255),
  retry_not_before TEXT,
  acceptance_profile_id TEXT NOT NULL,
  acceptance_profile_version INTEGER NOT NULL,
  source_version_id TEXT REFERENCES source_version(source_version_id),
  due_at TEXT,
  title TEXT NOT NULL CHECK (title <> ''),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (acceptance_profile_id, acceptance_profile_version)
    REFERENCES acceptance_profile(profile_id, version),
  FOREIGN KEY (project_id, parent_id)
    REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (project_id, source_version_id)
    REFERENCES source_version(project_id, source_version_id),
  UNIQUE (project_id, work_id),
  CHECK (parent_id IS NULL OR parent_id <> work_id)
);
CREATE INDEX work_item_project ON work_item(project_id, lifecycle, dispatch_policy);
CREATE INDEX work_item_project_id ON work_item(project_id, work_id);
CREATE INDEX work_item_parent ON work_item(parent_id);

CREATE TRIGGER work_parent_kind_guard BEFORE INSERT ON work_item
WHEN NEW.parent_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM work_item existing
             WHERE existing.work_id = NEW.parent_id AND existing.project_id = NEW.project_id)
 AND NOT EXISTS (
  SELECT 1 FROM work_item parent
  WHERE parent.project_id = NEW.project_id
    AND parent.work_id = NEW.parent_id
    AND ((parent.kind = 'milestone' AND NEW.kind = 'sprint')
      OR (parent.kind = 'sprint' AND NEW.kind = 'task'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_parent_kind');
END;

CREATE TRIGGER work_parent_kind_guard_update BEFORE UPDATE OF parent_id, kind ON work_item
WHEN NEW.parent_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM work_item existing
             WHERE existing.work_id = NEW.parent_id AND existing.project_id = NEW.project_id)
 AND NOT EXISTS (
  SELECT 1 FROM work_item parent
  WHERE parent.project_id = NEW.project_id
    AND parent.work_id = NEW.parent_id
    AND ((parent.kind = 'milestone' AND NEW.kind = 'sprint')
      OR (parent.kind = 'sprint' AND NEW.kind = 'task'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_parent_kind');
END;

CREATE TRIGGER work_parent_retype_guard BEFORE UPDATE OF kind ON work_item
WHEN EXISTS (
  SELECT 1 FROM work_item child
  WHERE child.project_id = NEW.project_id
    AND child.parent_id = NEW.work_id
    AND NOT (
      (NEW.kind = 'milestone' AND child.kind = 'sprint')
      OR (NEW.kind = 'sprint' AND child.kind = 'task')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_parent_kind');
END;

CREATE TABLE dependency (
  project_id TEXT NOT NULL REFERENCES project(project_id),
  prerequisite_id TEXT NOT NULL,
  dependent_id TEXT NOT NULL,
  satisfaction_policy TEXT NOT NULL DEFAULT 'closed_only'
    CHECK (satisfaction_policy IN ('closed_only','explicit_exception')),
  policy_version TEXT NOT NULL DEFAULT 'edge/1',
  exception_reason TEXT,
  approved_by TEXT REFERENCES actor(actor_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, prerequisite_id, dependent_id),
  FOREIGN KEY (project_id, prerequisite_id) REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (project_id, dependent_id) REFERENCES work_item(project_id, work_id),
  CHECK (prerequisite_id <> dependent_id),
  CHECK (satisfaction_policy = 'closed_only'
         OR (exception_reason IS NOT NULL AND approved_by IS NOT NULL))
);
CREATE INDEX dependency_dependent ON dependency(dependent_id);

CREATE TRIGGER dependency_no_cycle BEFORE INSERT ON dependency
WHEN EXISTS (
  WITH RECURSIVE reachable(work_id) AS (
    SELECT NEW.dependent_id
    UNION
    SELECT d.dependent_id
    FROM dependency d
    JOIN reachable r ON r.work_id = d.prerequisite_id
    WHERE d.project_id = NEW.project_id
  )
  SELECT 1 FROM reachable WHERE work_id = NEW.prerequisite_id
)
BEGIN
  SELECT RAISE(ABORT, 'dependency_cycle');
END;

CREATE TABLE attempt (
  attempt_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  harness_id TEXT NOT NULL,
  session_id TEXT REFERENCES session(session_id),
  fence INTEGER NOT NULL CHECK (fence > 0),
  current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0,1)),
  state TEXT NOT NULL CHECK (state IN ('claimed','accepted','running','verifying','expiry_pending','completed','failed','released','expired','cancelled')),
  claimed_at TEXT NOT NULL,
  accepted_at TEXT,
  lease_deadline TEXT NOT NULL,
  max_attempt_deadline TEXT NOT NULL,
  last_heartbeat_at TEXT,
  last_checkpoint_at TEXT,
  review_required_after_expiry INTEGER NOT NULL DEFAULT 1 CHECK (review_required_after_expiry IN (0,1)),
  stop_requested_at TEXT,
  stop_acknowledged_at TEXT,
  terminal_at TEXT,
  terminal_reason TEXT,
  source_version_id TEXT REFERENCES source_version(source_version_id),
  config_identity TEXT NOT NULL,
  binary_identity TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 2),
  CHECK (max_attempt_deadline > claimed_at),
  CHECK (lease_deadline >= claimed_at),
  CHECK ((current = 1 AND state IN ('claimed','accepted','running','verifying','expiry_pending'))
         OR (current = 0 AND state IN ('completed','failed','released','expired','cancelled'))),
  CHECK (state IN ('claimed','expiry_pending','expired','released','failed','cancelled') OR accepted_at IS NOT NULL)
);
CREATE UNIQUE INDEX attempt_current_work ON attempt(work_id) WHERE current = 1;
CREATE UNIQUE INDEX attempt_current_session ON attempt(session_id) WHERE current = 1 AND session_id IS NOT NULL;
CREATE UNIQUE INDEX attempt_fence ON attempt(work_id, fence);
CREATE INDEX attempt_expiry ON attempt(state, lease_deadline, max_attempt_deadline);

CREATE TABLE reservation (
  reservation_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL CHECK (fence > 0),
  state TEXT NOT NULL CHECK (state IN ('active','released','expired')),
  lease_deadline TEXT NOT NULL,
  renewed_at TEXT,
  renewal_count INTEGER NOT NULL DEFAULT 0 CHECK (renewal_count >= 0),
  released_at TEXT,
  CHECK ((state = 'active') = (released_at IS NULL))
);
CREATE UNIQUE INDEX reservation_current_work ON reservation(work_id) WHERE state = 'active';

CREATE TABLE work_hold (
  hold_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  reason_code TEXT NOT NULL CHECK (trim(reason_code) <> ''),
  actor_id TEXT REFERENCES actor(actor_id),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES actor(actor_id),
  resolution_reason TEXT,
  CHECK (resolved_at IS NULL OR resolved_by IS NOT NULL),
  CHECK (resolved_at IS NULL OR resolution_reason IS NOT NULL)
);
CREATE INDEX work_hold_active ON work_hold(work_id) WHERE resolved_at IS NULL;
CREATE INDEX attempt_work_current ON attempt(work_id, current, attempt_id);
CREATE INDEX attempt_session_current ON attempt(session_id, current, attempt_id);

CREATE TABLE gate (
  gate_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('checkpoint','verification','review','audit','operator_approval','summary')),
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','satisfied','waived','failed')),
  subject_ref TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id, profile_version) REFERENCES acceptance_profile(profile_id, version),
  UNIQUE (work_id, profile_id, profile_version, kind, subject_ref)
);
CREATE INDEX gate_work_state ON gate(work_id, state);

CREATE TABLE checkpoint (
  checkpoint_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress','blocker','validation_input')),
  subject_ref TEXT NOT NULL,
  source_version_id TEXT REFERENCES source_version(source_version_id),
  output_digest TEXT,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence)
);

CREATE TABLE receipt (
  receipt_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  gate_id TEXT REFERENCES gate(gate_id),
  executable TEXT NOT NULL,
  argv_json TEXT NOT NULL,
  cwd TEXT NOT NULL,
  exit_code INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  source_version_id TEXT REFERENCES source_version(source_version_id),
  config_identity TEXT NOT NULL,
  environment_fingerprint TEXT NOT NULL,
  output_digest TEXT,
  output_ref TEXT,
  subject_json TEXT NOT NULL,
  coverage_json TEXT NOT NULL,
  attestation TEXT NOT NULL CHECK (attestation IN ('boreal_witnessed','external_attested','self_reported','unknown')),
  result TEXT NOT NULL CHECK (result IN ('passed','failed','rejected','unknown','stale')),
  rejection_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  UNIQUE (operation_id),
  CHECK (ended_at >= started_at),
  CHECK ((result = 'rejected') = (rejection_code IS NOT NULL))
);
CREATE INDEX receipt_subject ON receipt(work_id, attempt_id, fence, result);

-- External command execution has a lifecycle separate from receipt
-- persistence.  An operation is admitted here before any process can be
-- launched.  Incomplete entries are intentionally fail-closed: a retry reads
-- the journal and must reconcile the unknown outcome instead of launching the
-- command a second time.
CREATE TABLE evidence_execution (
  operation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL CHECK (fence > 0),
  gate_id TEXT NOT NULL REFERENCES gate(gate_id),
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  session_id TEXT REFERENCES session(session_id),
  request_digest TEXT NOT NULL,
  artifact_ref TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('admitted','running','exited','receipt_committed','unknown')),
  admitted_at TEXT NOT NULL,
  started_at TEXT,
  exited_at TEXT,
  exit_code INTEGER,
  receipt_id TEXT REFERENCES receipt(receipt_id),
  failure_code TEXT,
  FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  CHECK (state <> 'running' OR started_at IS NOT NULL),
  CHECK (state NOT IN ('exited','receipt_committed') OR exited_at IS NOT NULL),
  CHECK (state <> 'receipt_committed' OR receipt_id IS NOT NULL)
);
CREATE INDEX evidence_execution_subject
  ON evidence_execution(work_id, attempt_id, fence, state);

CREATE TABLE review (
  review_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL,
  gate_id TEXT REFERENCES gate(gate_id),
  reviewer_actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
  reason TEXT NOT NULL,
  source_version_id TEXT REFERENCES source_version(source_version_id),
  policy_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence)
);

CREATE TABLE summary (
  summary_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL,
  subject_ref TEXT NOT NULL,
  source_version_id TEXT REFERENCES source_version(source_version_id),
  config_identity TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  body_digest TEXT NOT NULL,
  body_size INTEGER NOT NULL CHECK (body_size > 0 AND body_size <= 65536),
  current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0,1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  FOREIGN KEY (profile_id, profile_version) REFERENCES acceptance_profile(profile_id, version)
);
CREATE UNIQUE INDEX summary_current_work ON summary(work_id) WHERE current = 1;

CREATE TABLE close_intent (
  close_intent_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  source_version_id TEXT REFERENCES source_version(source_version_id),
  config_identity TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  summary_id TEXT REFERENCES summary(summary_id),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','invalidated','finalized','rejected')),
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  invalidated_at TEXT,
  invalidation_code TEXT,
  FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  FOREIGN KEY (profile_id, profile_version) REFERENCES acceptance_profile(profile_id, version),
  CHECK (state <> 'invalidated' OR (invalidated_at IS NOT NULL AND invalidation_code IS NOT NULL)),
  CHECK (state <> 'finalized' OR finalized_at IS NOT NULL)
);
CREATE UNIQUE INDEX close_intent_open_work ON close_intent(work_id) WHERE state = 'open';

CREATE TABLE operation (
  operation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  command TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  session_id TEXT REFERENCES session(session_id),
  expected_revision INTEGER,
  attempt_id TEXT,
  fence INTEGER,
  request_digest TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('changed','unchanged','rejected','conflict','busy','failed','unknown')),
  result_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (operation_id, request_digest)
);

CREATE TABLE audit_event (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('work.created','work.published','work.closed','work.blocked','work.paused','work.resumed','work.cancelled','work.reopened','attempt.claimed','attempt.accepted','attempt.started','attempt.submitted','attempt.released','attempt.failed','attempt.expiry_pending','attempt.expired','evidence.verifier.admitted','expiry.resolved','lease.renewed','receipt.recorded','receipt.rejected','review.accepted','review.rejected','close.requested','close.completed','gate.satisfied','hold.resolved','repair.correction','repair.supersession')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('work','attempt','receipt','review','gate','hold','dependency','summary','operation','project')),
  subject_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  session_id TEXT REFERENCES session(session_id),
  fence INTEGER CHECK (fence IS NULL OR fence > 0),
  as_of TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (project_id, revision)
);
CREATE INDEX audit_revision ON audit_event(project_id, revision);

CREATE TABLE memory_publication (
  publication_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  memory_entry_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL REFERENCES source_version(source_version_id),
  state TEXT NOT NULL CHECK (state IN ('draft','publishing','published','failed')),
  manifest_path TEXT NOT NULL,
  git_revision TEXT,
  content_digest TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE blob (
  blob_digest TEXT PRIMARY KEY,
  byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
  media_type TEXT NOT NULL,
  path TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

-- Evidence and audit are historical facts, not mutable status projections.
CREATE TRIGGER receipt_append_only_update BEFORE UPDATE ON receipt BEGIN
  SELECT RAISE(ABORT, 'receipt_append_only');
END;
CREATE TRIGGER receipt_append_only_delete BEFORE DELETE ON receipt BEGIN
  SELECT RAISE(ABORT, 'receipt_append_only');
END;
CREATE TRIGGER audit_append_only_update BEFORE UPDATE ON audit_event BEGIN
  SELECT RAISE(ABORT, 'audit_append_only');
END;
CREATE TRIGGER audit_append_only_delete BEFORE DELETE ON audit_event BEGIN
  SELECT RAISE(ABORT, 'audit_append_only');
END;

CREATE TRIGGER review_no_self_review BEFORE INSERT ON review
WHEN EXISTS (
  SELECT 1 FROM attempt
  WHERE attempt_id = NEW.attempt_id AND actor_id = NEW.reviewer_actor_id
)
BEGIN
  SELECT RAISE(ABORT, 'reviewer_cannot_review_own_attempt');
END;

-- Set only after every object above has been created successfully. The store
-- applies this file inside a transaction for fresh databases.
-- Boreal v2 additive work-model extension: boreal.work-model/3.
--
-- This is an additive migration artifact.  It requires a complete schema-v2
-- database and leaves every schema-v2 table, trigger, and column unchanged.
-- The store applies it transactionally and reopens it with explicit v3
-- contract validation; project rows retain their schema-2 compatibility
-- version while the database user_version records the installed extension.
--
-- The v3 tables deliberately use their own names.  This keeps the existing
-- v2 WorkItem/Dependency semantics available for compatibility and gives the
-- application a reviewable projection into the stricter model:
--
--   work_node_v3 + work_dependency_v3  decomposition and task graph
--   cycle_*_v3                         scheduled/recurring planning
--   intake_*_v3 + promotion             non-work project inbox/provenance
--   container_disposition_v3            append-only container closeout facts


CREATE TABLE work_model_v3_meta (
  schema_id TEXT PRIMARY KEY CHECK (schema_id = 'boreal.work-model'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 3),
  base_schema_version INTEGER NOT NULL CHECK (base_schema_version = 2),
  contract_version TEXT NOT NULL CHECK (contract_version = 'boreal.work-model/3'),
  created_at TEXT NOT NULL CHECK (trim(created_at) <> '')
);

INSERT INTO work_model_v3_meta (
  schema_id, schema_version, base_schema_version, contract_version, created_at
) VALUES (
  'boreal.work-model', 3, 2, 'boreal.work-model/3', 'schema-migration'
);

-- A v3 node is an explicit decomposition projection over an existing v2
-- work_item.  Sprints are intentionally absent: cycles below schedule work,
-- while milestones and tasks express containment.
CREATE TABLE work_node_v3 (
  work_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  decomposition_kind TEXT NOT NULL
    CHECK (decomposition_kind IN ('milestone','task')),
  execution_mode TEXT NOT NULL
    CHECK (execution_mode IN ('direct','container')),
  parent_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, work_id),
  FOREIGN KEY (project_id, work_id)
    REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (project_id, parent_id)
    REFERENCES work_node_v3(project_id, work_id),
  CHECK (
    (decomposition_kind = 'milestone' AND execution_mode = 'container')
    OR decomposition_kind = 'task'
  ),
  CHECK (parent_id IS NULL OR parent_id <> work_id)
);

CREATE TRIGGER work_node_v3_kind_guard BEFORE INSERT ON work_node_v3
WHEN NOT EXISTS (
  SELECT 1
  FROM work_item
  WHERE project_id = NEW.project_id
    AND work_id = NEW.work_id
    AND kind = NEW.decomposition_kind
)
BEGIN
  SELECT RAISE(ABORT, 'work_node_v3_kind_mismatch');
END;

CREATE TRIGGER work_node_v3_parent_guard BEFORE INSERT ON work_node_v3
WHEN NEW.parent_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM work_node_v3 parent
   WHERE parent.project_id = NEW.project_id
     AND parent.work_id = NEW.parent_id
     AND (
       parent.decomposition_kind = 'milestone'
       OR (
         parent.decomposition_kind = 'task'
         AND parent.execution_mode = 'container'
       )
     )
 )
BEGIN
  SELECT RAISE(ABORT, 'work_node_v3_invalid_parent');
END;

CREATE TRIGGER work_node_v3_no_cycle BEFORE INSERT ON work_node_v3
WHEN NEW.parent_id IS NOT NULL
 AND EXISTS (
   WITH RECURSIVE ancestors(work_id) AS (
     SELECT NEW.parent_id
     UNION
     SELECT node.parent_id
     FROM work_node_v3 node
     JOIN ancestors ON ancestors.work_id = node.work_id
     WHERE node.project_id = NEW.project_id
       AND node.parent_id IS NOT NULL
   )
   SELECT 1 FROM ancestors WHERE work_id = NEW.work_id
 )
BEGIN
  SELECT RAISE(ABORT, 'work_node_v3_hierarchy_cycle');
END;

CREATE TRIGGER work_node_v3_identity_guard
BEFORE UPDATE OF project_id, work_id
ON work_node_v3
BEGIN
  SELECT RAISE(ABORT, 'work_node_v3_identity_immutable');
END;

CREATE TRIGGER work_node_v3_kind_update_guard
BEFORE UPDATE OF decomposition_kind, execution_mode ON work_node_v3
WHEN NOT EXISTS (
  SELECT 1
  FROM work_item
  WHERE project_id = NEW.project_id
    AND work_id = NEW.work_id
    AND kind = NEW.decomposition_kind
)
OR (NEW.decomposition_kind = 'milestone' AND NEW.execution_mode <> 'container')
OR EXISTS (
  SELECT 1
  FROM work_node_v3 child
  WHERE child.project_id = NEW.project_id
    AND child.parent_id = NEW.work_id
    AND NOT (
      NEW.decomposition_kind = 'milestone'
      OR (
        NEW.decomposition_kind = 'task'
        AND NEW.execution_mode = 'container'
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'work_node_v3_invalid_retype');
END;

CREATE TRIGGER work_node_v3_parent_update_guard
BEFORE UPDATE OF project_id, parent_id ON work_node_v3
WHEN NEW.parent_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM work_node_v3 parent
   WHERE parent.project_id = NEW.project_id
     AND parent.work_id = NEW.parent_id
     AND (
       parent.decomposition_kind = 'milestone'
       OR (
         parent.decomposition_kind = 'task'
         AND parent.execution_mode = 'container'
       )
     )
 )
BEGIN
  SELECT RAISE(ABORT, 'work_node_v3_invalid_parent');
END;

CREATE TRIGGER work_node_v3_no_cycle_update
BEFORE UPDATE OF project_id, work_id, parent_id ON work_node_v3
WHEN NEW.parent_id IS NOT NULL
 AND EXISTS (
   WITH RECURSIVE ancestors(work_id) AS (
     SELECT NEW.parent_id
     UNION
     SELECT node.parent_id
     FROM work_node_v3 node
     JOIN ancestors ON ancestors.work_id = node.work_id
     WHERE node.project_id = NEW.project_id
       AND node.parent_id IS NOT NULL
   )
   SELECT 1 FROM ancestors WHERE work_id = NEW.work_id
 )
BEGIN
  SELECT RAISE(ABORT, 'work_node_v3_hierarchy_cycle');
END;

-- Production identity, recovery and external-effect seams are installed by
-- the canonical schema rather than lazily during a lifecycle mutation.
CREATE TABLE boreal_database_identity (
  identity_id INTEGER PRIMARY KEY CHECK (identity_id = 1),
  database_instance_id TEXT NOT NULL CHECK (trim(database_instance_id) <> ''),
  restore_epoch INTEGER NOT NULL CHECK (restore_epoch > 0),
  created_at TEXT NOT NULL CHECK (trim(created_at) <> ''),
  updated_at TEXT NOT NULL CHECK (trim(updated_at) <> '')
);
CREATE TABLE boreal_project_identity (
  project_id TEXT PRIMARY KEY REFERENCES project(project_id),
  database_instance_id TEXT NOT NULL CHECK (trim(database_instance_id) <> ''),
  restore_epoch INTEGER NOT NULL CHECK (restore_epoch > 0),
  canonical_root TEXT NOT NULL CHECK (trim(canonical_root) <> ''),
  canonical_worktree TEXT NOT NULL CHECK (trim(canonical_worktree) <> ''),
  binding_digest TEXT NOT NULL CHECK (trim(binding_digest) <> ''),
  bound_at TEXT NOT NULL CHECK (trim(bound_at) <> ''),
  updated_at TEXT NOT NULL CHECK (trim(updated_at) <> '')
);
CREATE TABLE boreal_entity_revision (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  entity_revision INTEGER NOT NULL CHECK (entity_revision >= 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision >= 0),
  updated_at TEXT NOT NULL CHECK (trim(updated_at) <> ''),
  PRIMARY KEY (project_id, work_id),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE TABLE boreal_attempt_fence_identity (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL CHECK (fence > 0),
  database_instance_id TEXT NOT NULL CHECK (trim(database_instance_id) <> ''),
  restore_epoch INTEGER NOT NULL CHECK (restore_epoch > 0),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  recorded_at TEXT NOT NULL CHECK (trim(recorded_at) <> ''),
  PRIMARY KEY (project_id, attempt_id, fence),
  UNIQUE (project_id, work_id, fence),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id),
  FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence)
);
CREATE TABLE boreal_operation_identity (
  operation_id TEXT PRIMARY KEY REFERENCES operation(operation_id),
  project_id TEXT NOT NULL REFERENCES project(project_id),
  database_instance_id TEXT NOT NULL CHECK (trim(database_instance_id) <> ''),
  restore_epoch INTEGER NOT NULL CHECK (restore_epoch > 0),
  state TEXT NOT NULL CHECK (state IN ('current', 'invalidated')),
  invalidated_at TEXT,
  invalidation_code TEXT,
  CHECK ((state = 'current') = (invalidated_at IS NULL AND invalidation_code IS NULL)),
  CHECK (state = 'invalidated' OR invalidated_at IS NULL)
);
CREATE TABLE boreal_revision_migration (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  legacy_snapshot_revision INTEGER NOT NULL CHECK (legacy_snapshot_revision >= 0),
  entity_revision INTEGER NOT NULL CHECK (entity_revision >= 0),
  proof_revision INTEGER NOT NULL CHECK (proof_revision >= 0),
  disposition TEXT NOT NULL CHECK (trim(disposition) <> ''),
  provenance_json TEXT NOT NULL CHECK (trim(provenance_json) <> ''),
  migrated_at TEXT NOT NULL CHECK (trim(migrated_at) <> ''),
  PRIMARY KEY (project_id, work_id),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id)
);
CREATE INDEX boreal_attempt_fence_subject
  ON boreal_attempt_fence_identity(project_id, work_id, attempt_id, fence);
CREATE INDEX boreal_operation_identity_scope
  ON boreal_operation_identity(project_id, restore_epoch, state);

CREATE TABLE boreal_recovery_obligation (
  obligation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT REFERENCES attempt(attempt_id),
  fence INTEGER CHECK (fence IS NULL OR fence > 0),
  reason TEXT NOT NULL CHECK (reason IN
    ('expired','stop_unknown','resource_unknown','failed','cancel_requested')),
  state TEXT NOT NULL CHECK (state IN ('unresolved','resolved','superseded')),
  resource_state TEXT NOT NULL CHECK
    (resource_state IN ('active','release_pending','unknown','released')),
  owner_actor_id TEXT,
  next_action TEXT NOT NULL CHECK (trim(next_action) <> ''),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_id TEXT,
  CHECK (state = 'unresolved' OR
         (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_id IS NOT NULL)),
  CHECK (attempt_id IS NOT NULL OR fence IS NULL)
);
CREATE INDEX boreal_recovery_unresolved
  ON boreal_recovery_obligation(project_id, obligation_id)
  WHERE state = 'unresolved';
CREATE TABLE boreal_recovery_decision (
  decision_id TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL REFERENCES boreal_recovery_obligation(obligation_id),
  project_id TEXT NOT NULL REFERENCES project(project_id),
  actor_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (trim(outcome) <> ''),
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  resource_state TEXT NOT NULL CHECK
    (resource_state IN ('active','release_pending','unknown','released')),
  created_at TEXT NOT NULL
);
CREATE INDEX boreal_recovery_decision_subject
  ON boreal_recovery_decision(project_id, obligation_id, created_at, decision_id);
CREATE TABLE boreal_resource_reservation (
  reservation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  work_id TEXT NOT NULL REFERENCES work_item(work_id),
  attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  fence INTEGER NOT NULL CHECK (fence > 0),
  resource_key TEXT NOT NULL CHECK (trim(resource_key) <> ''),
  resource_kind TEXT NOT NULL CHECK (trim(resource_kind) <> ''),
  state TEXT NOT NULL CHECK
    (state IN ('active','release_pending','unknown','released')),
  owner_actor_id TEXT NOT NULL CHECK (trim(owner_actor_id) <> ''),
  created_at TEXT NOT NULL,
  release_requested_at TEXT,
  released_at TEXT,
  release_ack_id TEXT,
  CHECK (state = 'active' OR release_requested_at IS NOT NULL),
  CHECK (state <> 'released' OR (released_at IS NOT NULL AND release_ack_id IS NOT NULL))
);
CREATE UNIQUE INDEX boreal_resource_live_key
  ON boreal_resource_reservation(project_id, resource_key)
  WHERE state IN ('active','release_pending','unknown');
CREATE INDEX boreal_resource_attempt
  ON boreal_resource_reservation(project_id, attempt_id, fence);
CREATE TABLE boreal_resource_release_event (
  event_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES boreal_resource_reservation(reservation_id),
  project_id TEXT NOT NULL REFERENCES project(project_id),
  state TEXT NOT NULL CHECK (state IN ('requested','acknowledged')),
  actor_id TEXT NOT NULL,
  evidence_ref TEXT NOT NULL CHECK (trim(evidence_ref) <> ''),
  created_at TEXT NOT NULL
);
CREATE INDEX boreal_resource_release_subject
  ON boreal_resource_release_event(project_id, reservation_id, created_at, event_id);
CREATE TRIGGER boreal_recovery_decision_append_only_update
BEFORE UPDATE ON boreal_recovery_decision
BEGIN
  SELECT RAISE(ABORT, 'recovery_decision_append_only');
END;
CREATE TRIGGER boreal_recovery_decision_append_only_delete
BEFORE DELETE ON boreal_recovery_decision
BEGIN
  SELECT RAISE(ABORT, 'recovery_decision_append_only');
END;
CREATE UNIQUE INDEX attempt_current_work_owner
  ON attempt(work_id) WHERE current = 1;
CREATE UNIQUE INDEX attempt_current_session_owner
  ON attempt(session_id) WHERE current = 1 AND session_id IS NOT NULL;

CREATE TABLE boreal_external_job (
  job_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  subject_type TEXT NOT NULL CHECK (trim(subject_type) <> ''),
  subject_id TEXT NOT NULL CHECK (trim(subject_id) <> ''),
  kind TEXT NOT NULL CHECK (trim(kind) <> ''),
  request_digest TEXT NOT NULL CHECK (trim(request_digest) <> ''),
  stage TEXT NOT NULL CHECK (stage IN
    ('registered','admitted','running','side_effect_started',
     'side_effect_finished','readback_required','committed','rejected',
     'failed','cancel_requested','reconciled')),
  side_effect_ref TEXT,
  source_identity TEXT,
  config_identity TEXT,
  actor_id TEXT NOT NULL CHECK (trim(actor_id) <> ''),
  session_id TEXT,
  started_at TEXT,
  deadline TEXT,
  result_digest TEXT,
  reconciliation_state TEXT NOT NULL CHECK (trim(reconciliation_state) <> ''),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX boreal_external_job_project_stage
  ON boreal_external_job(project_id, stage, job_id);
CREATE INDEX boreal_external_job_readback
  ON boreal_external_job(project_id, operation_id)
  WHERE stage IN ('side_effect_started','side_effect_finished','readback_required');
CREATE TRIGGER boreal_external_job_identity_guard
BEFORE UPDATE OF job_id, operation_id, project_id, subject_type, subject_id,
  kind, request_digest, source_identity, config_identity, actor_id,
  session_id, deadline, created_at ON boreal_external_job
BEGIN
  SELECT RAISE(ABORT, 'external_job_identity_append_only');
END;

-- A pinned requirement snapshot is immutable policy for one project/work
-- proof revision. It is separate from gate observations: deleting or
-- quarantining an observation cannot delete the requirement it was meant to
-- satisfy. The normalized child rows retain stable gate identities while the
-- header's canonical JSON preserves the complete resolved declaration set,
-- including an intentional empty set.
CREATE TABLE boreal_pinned_requirement (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('task','container')),
  profile_id TEXT NOT NULL CHECK (trim(profile_id) <> ''),
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  profile_digest TEXT NOT NULL CHECK (trim(profile_digest) <> ''),
  provenance_json TEXT NOT NULL CHECK (trim(provenance_json) <> ''),
  declarations_json TEXT NOT NULL CHECK (trim(declarations_json) <> ''),
  resolved_digest TEXT NOT NULL CHECK (trim(resolved_digest) <> ''),
  pinned_at TEXT NOT NULL CHECK (trim(pinned_at) <> ''),
  PRIMARY KEY (project_id, work_id, proof_revision),
  UNIQUE (project_id, work_id, proof_revision, resolved_digest),
  FOREIGN KEY (project_id, work_id)
    REFERENCES work_item(project_id, work_id)
);

CREATE TABLE boreal_pinned_requirement_gate (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  proof_revision INTEGER NOT NULL CHECK (proof_revision > 0),
  requirement_id TEXT NOT NULL CHECK (trim(requirement_id) <> ''),
  gate_id TEXT NOT NULL CHECK (trim(gate_id) <> ''),
  kind TEXT NOT NULL CHECK (trim(kind) <> ''),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('task','container')),
  profile_id TEXT NOT NULL CHECK (trim(profile_id) <> ''),
  profile_version INTEGER NOT NULL CHECK (profile_version > 0),
  profile_digest TEXT NOT NULL CHECK (trim(profile_digest) <> ''),
  provenance_json TEXT NOT NULL CHECK (trim(provenance_json) <> ''),
  declaration_json TEXT NOT NULL CHECK (trim(declaration_json) <> ''),
  PRIMARY KEY (project_id, work_id, proof_revision, requirement_id),
  UNIQUE (project_id, work_id, proof_revision, gate_id, kind),
  FOREIGN KEY (project_id, work_id, proof_revision)
    REFERENCES boreal_pinned_requirement(project_id, work_id, proof_revision)
);

CREATE INDEX boreal_pinned_requirement_project
  ON boreal_pinned_requirement(project_id, work_id, proof_revision);

CREATE TRIGGER boreal_pinned_requirement_immutable_update
  BEFORE UPDATE ON boreal_pinned_requirement
BEGIN
  SELECT RAISE(ABORT, 'pinned_requirement_immutable');
END;
CREATE TRIGGER boreal_pinned_requirement_immutable_delete
  BEFORE DELETE ON boreal_pinned_requirement
BEGIN
  SELECT RAISE(ABORT, 'pinned_requirement_immutable');
END;
CREATE TRIGGER boreal_pinned_requirement_gate_immutable_update
  BEFORE UPDATE ON boreal_pinned_requirement_gate
BEGIN
  SELECT RAISE(ABORT, 'pinned_requirement_gate_immutable');
END;
CREATE TRIGGER boreal_pinned_requirement_gate_immutable_delete
  BEFORE DELETE ON boreal_pinned_requirement_gate
BEGIN
  SELECT RAISE(ABORT, 'pinned_requirement_gate_immutable');
END;

-- The v3 dependency graph is task-only and never treats a container or cycle
-- as an executable prerequisite.  The original v2 dependency table remains
-- available for legacy compatibility during migration.
CREATE TABLE work_dependency_v3 (
  project_id TEXT NOT NULL REFERENCES project(project_id),
  prerequisite_work_id TEXT NOT NULL,
  dependent_work_id TEXT NOT NULL,
  policy TEXT NOT NULL DEFAULT 'closed_only'
    CHECK (policy IN ('closed_only','explicit_exception')),
  exception_reason TEXT,
  approved_by TEXT REFERENCES actor(actor_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, prerequisite_work_id, dependent_work_id),
  FOREIGN KEY (project_id, prerequisite_work_id)
    REFERENCES work_node_v3(project_id, work_id),
  FOREIGN KEY (project_id, dependent_work_id)
    REFERENCES work_node_v3(project_id, work_id),
  CHECK (prerequisite_work_id <> dependent_work_id),
  CHECK (
    policy = 'closed_only'
    OR (trim(COALESCE(exception_reason, '')) <> '' AND approved_by IS NOT NULL)
  )
);

CREATE INDEX work_dependency_v3_dependent
  ON work_dependency_v3(project_id, dependent_work_id);

CREATE TRIGGER work_dependency_v3_direct_guard
BEFORE INSERT ON work_dependency_v3
WHEN EXISTS (
  SELECT 1
  FROM work_node_v3 node
  WHERE node.project_id = NEW.project_id
    AND node.work_id IN (NEW.prerequisite_work_id, NEW.dependent_work_id)
    AND NOT (
      node.decomposition_kind = 'task'
      AND node.execution_mode = 'direct'
    )
)
BEGIN
  SELECT RAISE(ABORT, 'work_dependency_v3_requires_direct_tasks');
END;

CREATE TRIGGER work_dependency_v3_no_cycle
BEFORE INSERT ON work_dependency_v3
WHEN EXISTS (
  WITH RECURSIVE reachable(work_id) AS (
    SELECT NEW.dependent_work_id
    UNION
    SELECT dependency.dependent_work_id
    FROM work_dependency_v3 dependency
    JOIN reachable
      ON reachable.work_id = dependency.prerequisite_work_id
    WHERE dependency.project_id = NEW.project_id
  )
  SELECT 1 FROM reachable WHERE work_id = NEW.prerequisite_work_id
)
BEGIN
  SELECT RAISE(ABORT, 'work_dependency_v3_cycle');
END;

-- Calendar planning is a separate object from execution deadlines.  A series
-- owns versioned recurrence templates; each materialized cycle stores the
-- resolved local/UTC/timezone facts so later tzdb changes cannot rewrite
-- history.
CREATE TABLE cycle_series_v3 (
  series_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  name TEXT NOT NULL CHECK (trim(name) <> ''),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active','paused','retired')),
  timezone TEXT NOT NULL CHECK (trim(timezone) <> ''),
  tzdb_identity TEXT NOT NULL CHECK (trim(tzdb_identity) <> ''),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, series_id)
);

CREATE TABLE cycle_template_v3 (
  template_version_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  series_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  effective_from_slot_ordinal INTEGER NOT NULL CHECK (effective_from_slot_ordinal >= 0),
  interval_weeks INTEGER NOT NULL CHECK (interval_weeks > 0),
  anchor_local_date TEXT NOT NULL CHECK (trim(anchor_local_date) <> ''),
  anchor_local_time TEXT NOT NULL CHECK (trim(anchor_local_time) <> ''),
  anchor_weekday INTEGER NOT NULL CHECK (anchor_weekday BETWEEN 1 AND 7),
  recurrence_end_kind TEXT NOT NULL
    CHECK (recurrence_end_kind IN ('never','count','until_local_date')),
  recurrence_end_count INTEGER,
  recurrence_end_local_date TEXT,
  name_pattern TEXT NOT NULL CHECK (trim(name_pattern) <> ''),
  goal_template TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL CHECK (trim(timezone) <> ''),
  tzdb_identity TEXT NOT NULL CHECK (trim(tzdb_identity) <> ''),
  gap_policy TEXT NOT NULL CHECK (gap_policy IN ('next_valid')),
  fold_policy TEXT NOT NULL CHECK (fold_policy IN ('earlier_offset','later_offset')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, series_id)
    REFERENCES cycle_series_v3(project_id, series_id),
  UNIQUE (project_id, template_version_id),
  UNIQUE (project_id, series_id, version),
  UNIQUE (project_id, series_id, effective_from_slot_ordinal),
  CHECK (
    (recurrence_end_kind = 'never'
      AND recurrence_end_count IS NULL
      AND recurrence_end_local_date IS NULL)
    OR (recurrence_end_kind = 'count'
      AND recurrence_end_count > 0
      AND recurrence_end_local_date IS NULL)
    OR (recurrence_end_kind = 'until_local_date'
      AND recurrence_end_count IS NULL
      AND trim(COALESCE(recurrence_end_local_date, '')) <> '')
  )
);

CREATE TABLE cycle_template_weekday_v3 (
  project_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  FOREIGN KEY (project_id, template_version_id)
    REFERENCES cycle_template_v3(project_id, template_version_id),
  PRIMARY KEY (project_id, template_version_id, weekday)
);

CREATE TABLE cycle_v3 (
  cycle_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  series_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL,
  slot_ordinal INTEGER NOT NULL CHECK (slot_ordinal >= 0),
  slot_key TEXT NOT NULL,
  name TEXT NOT NULL CHECK (trim(name) <> ''),
  goal TEXT NOT NULL DEFAULT '',
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('planned','active','completed','cancelled')),
  scheduled_start_utc_ms INTEGER NOT NULL,
  scheduled_end_utc_ms INTEGER,
  scheduled_start_local TEXT NOT NULL,
  scheduled_start_utc_offset_minutes INTEGER NOT NULL
    CHECK (scheduled_start_utc_offset_minutes BETWEEN -1440 AND 1440),
  timezone TEXT NOT NULL CHECK (trim(timezone) <> ''),
  tzdb_identity TEXT NOT NULL CHECK (trim(tzdb_identity) <> ''),
  gap_policy TEXT NOT NULL CHECK (gap_policy IN ('next_valid')),
  fold_policy TEXT NOT NULL CHECK (fold_policy IN ('earlier_offset','later_offset')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id, series_id)
    REFERENCES cycle_series_v3(project_id, series_id),
  FOREIGN KEY (project_id, template_version_id)
    REFERENCES cycle_template_v3(project_id, template_version_id),
  UNIQUE (project_id, cycle_id),
  UNIQUE (project_id, series_id, slot_ordinal),
  CHECK (slot_key = 'boreal.cycle-slot/1/' || series_id || '/' || slot_ordinal),
  CHECK (scheduled_end_utc_ms IS NULL OR scheduled_end_utc_ms > scheduled_start_utc_ms)
);

CREATE TABLE cycle_assignment_v3 (
  assignment_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  cycle_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('planned','committed','removed','completed','carried_over')),
  activation_policy TEXT NOT NULL
    CHECK (activation_policy IN ('at_cycle_start','immediate','explicit_not_before')),
  activation_at_utc_ms INTEGER,
  predecessor_id TEXT,
  successor_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id, cycle_id) REFERENCES cycle_v3(project_id, cycle_id),
  FOREIGN KEY (project_id, work_id) REFERENCES work_node_v3(project_id, work_id),
  UNIQUE (project_id, assignment_id),
  UNIQUE (project_id, cycle_id, work_id),
  CHECK ((activation_policy = 'explicit_not_before') = (activation_at_utc_ms IS NOT NULL)),
  CHECK (predecessor_id IS NULL OR predecessor_id <> assignment_id),
  CHECK (successor_id IS NULL OR successor_id <> assignment_id)
);

CREATE INDEX cycle_assignment_v3_live_work
  ON cycle_assignment_v3(project_id, work_id)
  WHERE state IN ('planned','committed');

CREATE TRIGGER cycle_assignment_v3_direct_guard
BEFORE INSERT ON cycle_assignment_v3
WHEN EXISTS (
  SELECT 1
  FROM work_node_v3 node
  WHERE node.project_id = NEW.project_id
    AND node.work_id = NEW.work_id
    AND NOT (
      node.decomposition_kind = 'task'
      AND node.execution_mode = 'direct'
    )
)
BEGIN
  SELECT RAISE(ABORT, 'cycle_assignment_v3_requires_direct_task');
END;

CREATE TRIGGER cycle_assignment_v3_terminal_guard
BEFORE INSERT ON cycle_assignment_v3
WHEN NEW.state IN ('planned','committed')
 AND EXISTS (
   SELECT 1 FROM cycle_v3 cycle
   WHERE cycle.project_id = NEW.project_id
     AND cycle.cycle_id = NEW.cycle_id
     AND cycle.lifecycle IN ('completed','cancelled')
 )
BEGIN
  SELECT RAISE(ABORT, 'cycle_assignment_v3_terminal_cycle');
END;

-- Intake is intentionally not a work_item.  Its status is derived from
-- lifecycle and revisit_at_utc_ms; it can later be promoted with a bound
-- content revision/digest into work, a source version, or a memory draft.
CREATE TABLE intake_bucket_v3 (
  bucket_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  name TEXT NOT NULL CHECK (trim(name) <> ''),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, bucket_id)
);

CREATE TABLE intake_item_v3 (
  intake_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  bucket_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note','discovery','question','revisit')),
  lifecycle TEXT NOT NULL
    CHECK (lifecycle IN ('captured','triaged','deferred','resolved','archived')),
  content TEXT NOT NULL CHECK (length(content) > 0),
  content_revision INTEGER NOT NULL CHECK (content_revision > 0),
  content_digest TEXT NOT NULL CHECK (trim(content_digest) <> ''),
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revisit_at_utc_ms INTEGER,
  FOREIGN KEY (project_id, bucket_id)
    REFERENCES intake_bucket_v3(project_id, bucket_id),
  UNIQUE (project_id, intake_id),
  CHECK (lifecycle <> 'deferred' OR revisit_at_utc_ms IS NOT NULL)
);

CREATE TRIGGER intake_item_v3_revision_guard
BEFORE UPDATE ON intake_item_v3
WHEN NEW.content_revision <> OLD.content_revision
  OR NEW.content IS NOT OLD.content
  OR NEW.content_digest IS NOT OLD.content_digest
BEGIN
  SELECT CASE
    WHEN NEW.content_revision <> OLD.content_revision + 1
      OR (NEW.content IS NOT OLD.content AND NEW.content_digest = OLD.content_digest)
    THEN RAISE(ABORT, 'intake_item_v3_revision_digest_mismatch')
  END;
END;

CREATE TABLE intake_promotion_v3 (
  promotion_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  intake_id TEXT NOT NULL,
  intake_revision INTEGER NOT NULL CHECK (intake_revision > 0),
  intake_digest TEXT NOT NULL CHECK (trim(intake_digest) <> ''),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('draft_work','source_version','memory_draft')),
  target_id TEXT NOT NULL CHECK (trim(target_id) <> ''),
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, intake_id)
    REFERENCES intake_item_v3(project_id, intake_id),
  UNIQUE (project_id, intake_id, intake_revision, target_kind, target_id)
);

CREATE TRIGGER intake_promotion_v3_current_provenance
BEFORE INSERT ON intake_promotion_v3
WHEN NOT EXISTS (
  SELECT 1
  FROM intake_item_v3 item
  WHERE item.project_id = NEW.project_id
    AND item.intake_id = NEW.intake_id
    AND item.content_revision = NEW.intake_revision
    AND item.content_digest = NEW.intake_digest
)
BEGIN
  SELECT RAISE(ABORT, 'intake_promotion_v3_stale_provenance');
END;

CREATE TRIGGER intake_promotion_v3_append_only_update
BEFORE UPDATE ON intake_promotion_v3
BEGIN
  SELECT RAISE(ABORT, 'intake_promotion_v3_append_only');
END;

CREATE TRIGGER intake_promotion_v3_append_only_delete
BEFORE DELETE ON intake_promotion_v3
BEGIN
  SELECT RAISE(ABORT, 'intake_promotion_v3_append_only');
END;

-- Container closeout is a fact stream.  A new disposition supersedes the
-- current fact by reference; no old row is updated or deleted.  The current
-- row is the chain tip (the row not referenced by a later supersedes_id).
CREATE TABLE container_disposition_v3 (
  disposition_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(project_id),
  container_work_id TEXT NOT NULL,
  descendant_work_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('accepted_closed','accepted_cancelled','deferred','replaced')),
  descendant_revision INTEGER NOT NULL CHECK (descendant_revision >= 0),
  descendant_outcome_digest TEXT NOT NULL CHECK (trim(descendant_outcome_digest) <> ''),
  replacement_work_id TEXT,
  reason TEXT,
  supersedes_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, container_work_id)
    REFERENCES work_node_v3(project_id, work_id),
  FOREIGN KEY (project_id, descendant_work_id)
    REFERENCES work_node_v3(project_id, work_id),
  FOREIGN KEY (project_id, replacement_work_id)
    REFERENCES work_node_v3(project_id, work_id),
  FOREIGN KEY (supersedes_id) REFERENCES container_disposition_v3(disposition_id),
  CHECK (container_work_id <> descendant_work_id),
  CHECK (
    (kind IN ('accepted_closed','accepted_cancelled')
      AND replacement_work_id IS NULL)
    OR (kind = 'deferred'
      AND replacement_work_id IS NULL
      AND trim(COALESCE(reason, '')) <> '')
    OR (kind = 'replaced'
      AND replacement_work_id IS NOT NULL
      AND trim(COALESCE(reason, '')) <> '')
  )
);

CREATE INDEX container_disposition_v3_subject
  ON container_disposition_v3(project_id, container_work_id, descendant_work_id);

CREATE UNIQUE INDEX container_disposition_v3_successor
  ON container_disposition_v3(supersedes_id)
  WHERE supersedes_id IS NOT NULL;

CREATE TRIGGER container_disposition_v3_subject_guard
BEFORE INSERT ON container_disposition_v3
WHEN NOT EXISTS (
  SELECT 1
  FROM work_node_v3 container
  WHERE container.project_id = NEW.project_id
    AND container.work_id = NEW.container_work_id
    AND container.execution_mode = 'container'
)
OR NOT EXISTS (
  WITH RECURSIVE descendants(work_id) AS (
    SELECT child.work_id
    FROM work_node_v3 child
    WHERE child.project_id = NEW.project_id
      AND child.parent_id = NEW.container_work_id
    UNION
    SELECT child.work_id
    FROM work_node_v3 child
    JOIN descendants
      ON descendants.work_id = child.parent_id
    WHERE child.project_id = NEW.project_id
  )
  SELECT 1
  FROM descendants
  WHERE work_id = NEW.descendant_work_id
)
BEGIN
  SELECT RAISE(ABORT, 'container_disposition_v3_invalid_subject');
END;

CREATE TRIGGER container_disposition_v3_chain_guard
BEFORE INSERT ON container_disposition_v3
BEGIN
  SELECT CASE
    WHEN NEW.supersedes_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM container_disposition_v3 current
        WHERE current.project_id = NEW.project_id
          AND current.container_work_id = NEW.container_work_id
          AND current.descendant_work_id = NEW.descendant_work_id
          AND NOT EXISTS (
            SELECT 1
            FROM container_disposition_v3 successor
            WHERE successor.supersedes_id = current.disposition_id
          )
      )
    THEN RAISE(ABORT, 'container_disposition_v3_current_exists')
  END;
  SELECT CASE
    WHEN NEW.supersedes_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM container_disposition_v3 current
        WHERE current.disposition_id = NEW.supersedes_id
          AND current.project_id = NEW.project_id
          AND current.container_work_id = NEW.container_work_id
          AND current.descendant_work_id = NEW.descendant_work_id
          AND NOT EXISTS (
            SELECT 1
            FROM container_disposition_v3 successor
            WHERE successor.supersedes_id = current.disposition_id
          )
      )
    THEN RAISE(ABORT, 'container_disposition_v3_invalid_supersedes')
  END;
END;

CREATE TRIGGER container_disposition_v3_append_only_update
BEFORE UPDATE ON container_disposition_v3
BEGIN
  SELECT RAISE(ABORT, 'container_disposition_v3_append_only');
END;

CREATE TRIGGER container_disposition_v3_append_only_delete
BEFORE DELETE ON container_disposition_v3
BEGIN
  SELECT RAISE(ABORT, 'container_disposition_v3_append_only');
END;

-- Set only after the additive objects and their constraints are complete.
-- Migration metadata is part of the production schema identity.
CREATE TABLE IF NOT EXISTS boreal_migration_ledger (
  migration_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  from_version INTEGER NOT NULL CHECK (from_version >= 0),
  to_version INTEGER NOT NULL CHECK (to_version > from_version),
  checksum TEXT NOT NULL CHECK (trim(checksum) <> ''),
  state TEXT NOT NULL CHECK (state IN ('running','applied','failed')),
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (migration_id, attempt),
  CHECK (state = 'running' OR completed_at IS NOT NULL),
  CHECK (state <> 'failed' OR failure_message IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS boreal_migration_ledger_latest
  ON boreal_migration_ledger(migration_id, attempt DESC);
CREATE TABLE IF NOT EXISTS boreal_migration_diagnostic (
  diagnostic_id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  code TEXT NOT NULL CHECK (trim(code) <> ''),
  entity_type TEXT NOT NULL CHECK (trim(entity_type) <> ''),
  entity_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL CHECK (trim(message) <> ''),
  blocking INTEGER NOT NULL CHECK (blocking IN (0,1)),
  raw_payload TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (migration_id, attempt, code, entity_type, entity_id, raw_payload)
);
CREATE INDEX IF NOT EXISTS boreal_migration_diagnostic_subject
  ON boreal_migration_diagnostic(migration_id, entity_type, entity_id);
CREATE TABLE IF NOT EXISTS boreal_schema_identity (
  identity_id INTEGER PRIMARY KEY CHECK (identity_id = 1),
  schema_id TEXT NOT NULL CHECK (trim(schema_id) <> ''),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 0),
  contract_version TEXT NOT NULL CHECK (trim(contract_version) <> ''),
  schema_checksum TEXT NOT NULL CHECK (trim(schema_checksum) <> ''),
  updated_at TEXT NOT NULL
);
PRAGMA user_version = 3;
