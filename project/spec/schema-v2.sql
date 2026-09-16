-- Boreal v2 persistence fixture: boreal.sqlite/2.
-- One local project database; application mutations use short WAL transactions.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

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
  event_type TEXT NOT NULL CHECK (event_type IN ('work.created','work.published','work.closed','work.blocked','work.paused','work.resumed','work.cancelled','work.reopened','attempt.claimed','attempt.accepted','attempt.started','attempt.submitted','attempt.released','attempt.failed','attempt.expiry_pending','attempt.expired','expiry.resolved','lease.renewed','receipt.recorded','receipt.rejected','review.accepted','review.rejected','close.requested','gate.satisfied','hold.resolved','repair.correction','repair.supersession')),
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
PRAGMA user_version = 2;
