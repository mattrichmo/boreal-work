-- Additive principal and transition history. Never auto-promote an OS UID,
-- imported actor row or caller-supplied actor label to an authenticated user.
CREATE TABLE boreal_principal (
  project_id TEXT NOT NULL REFERENCES project(project_id),
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  role TEXT NOT NULL CHECK (role IN ('agent','reviewer','operator','publisher')),
  authority_root TEXT NOT NULL,
  delegated_by TEXT,
  operation_id TEXT NOT NULL REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, actor_id),
  FOREIGN KEY(project_id, authority_root) REFERENCES boreal_principal(project_id, actor_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(project_id, delegated_by) REFERENCES boreal_principal(project_id, actor_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (delegated_by IS NULL OR delegated_by <> actor_id),
  CHECK (delegated_by IS NOT NULL OR authority_root = actor_id)
);
CREATE TABLE boreal_principal_credential (
  project_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  secret_digest TEXT NOT NULL CHECK (secret_digest LIKE 'boreal-key-v1:sha256:%'),
  expires_at_ms INTEGER CHECK (expires_at_ms IS NULL OR expires_at_ms > 0),
  operation_id TEXT NOT NULL REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, credential_id),
  UNIQUE(project_id, secret_digest),
  FOREIGN KEY(project_id, actor_id) REFERENCES boreal_principal(project_id, actor_id)
);
CREATE INDEX boreal_credential_actor ON boreal_principal_credential(project_id, actor_id);
CREATE TABLE boreal_credential_revocation (
  project_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  revoked_at TEXT NOT NULL,
  PRIMARY KEY(project_id, credential_id),
  FOREIGN KEY(project_id, credential_id) REFERENCES boreal_principal_credential(project_id, credential_id)
);
CREATE TABLE boreal_principal_revocation (
  project_id TEXT NOT NULL,
  principal_actor_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  revoked_at TEXT NOT NULL,
  PRIMARY KEY(project_id, principal_actor_id),
  FOREIGN KEY(project_id, principal_actor_id) REFERENCES boreal_principal(project_id, actor_id)
);
CREATE TABLE boreal_session_binding (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES session(session_id),
  actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, session_id),
  FOREIGN KEY(project_id, actor_id) REFERENCES boreal_principal(project_id, actor_id)
);
CREATE TABLE boreal_dependency_event (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  prerequisite_id TEXT NOT NULL,
  dependent_id TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('added','removed')),
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  reason TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id, prerequisite_id) REFERENCES work_item(project_id,work_id),
  FOREIGN KEY(project_id, dependent_id) REFERENCES work_item(project_id,work_id)
);
CREATE INDEX boreal_dependency_event_subject ON boreal_dependency_event(project_id,dependent_id,prerequisite_id);
CREATE TABLE boreal_work_transition (
  operation_id TEXT PRIMARY KEY REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  transition TEXT NOT NULL CHECK (transition IN ('reopened','cancelled','retried','published')),
  prior_proof_revision INTEGER NOT NULL CHECK (prior_proof_revision > 0),
  next_proof_revision INTEGER NOT NULL CHECK (next_proof_revision >= prior_proof_revision),
  reason TEXT NOT NULL CHECK (trim(reason) <> ''),
  actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id,work_id) REFERENCES work_item(project_id,work_id)
);
CREATE INDEX boreal_review_submission_order ON boreal_review_event(submission_id,gate_id,created_at);
CREATE TRIGGER boreal_principal_bootstrap AFTER INSERT ON operation
WHEN NEW.command='project.init'
 AND EXISTS (SELECT 1 FROM actor a WHERE a.actor_id=NEW.actor_id AND a.role='operator' AND a.credential_ref LIKE 'boreal-key-v1:sha256:%')
 AND EXISTS (SELECT 1 FROM boreal_project_identity p WHERE p.project_id=NEW.project_id)
 AND NOT EXISTS (SELECT 1 FROM boreal_principal p WHERE p.project_id=NEW.project_id)
BEGIN
 INSERT INTO boreal_principal(project_id,actor_id,role,authority_root,delegated_by,operation_id,created_at)
 SELECT NEW.project_id,a.actor_id,a.role,a.actor_id,NULL,NEW.operation_id,NEW.created_at FROM actor a WHERE a.actor_id=NEW.actor_id;
 INSERT INTO boreal_principal_credential(project_id,credential_id,actor_id,secret_digest,operation_id,created_at)
 SELECT NEW.project_id,'bootstrap:'||NEW.actor_id,a.actor_id,a.credential_ref,NEW.operation_id,NEW.created_at FROM actor a WHERE a.actor_id=NEW.actor_id;
END;
CREATE TRIGGER boreal_session_principal_binding AFTER INSERT ON operation
WHEN NEW.command='session.register' AND NEW.session_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM boreal_principal p WHERE p.project_id=NEW.project_id AND p.actor_id=NEW.actor_id)
BEGIN
 INSERT INTO boreal_session_binding(project_id,session_id,actor_id,operation_id,created_at)
 VALUES (NEW.project_id,NEW.session_id,NEW.actor_id,NEW.operation_id,NEW.created_at);
END;
CREATE TRIGGER boreal_principal_immutable_update BEFORE UPDATE ON boreal_principal
BEGIN SELECT RAISE(ABORT, 'boreal_principal_immutable'); END;
CREATE TRIGGER boreal_principal_immutable_delete BEFORE DELETE ON boreal_principal
BEGIN SELECT RAISE(ABORT, 'boreal_principal_immutable'); END;
CREATE TRIGGER boreal_principal_credential_immutable_update BEFORE UPDATE ON boreal_principal_credential
BEGIN SELECT RAISE(ABORT, 'boreal_principal_credential_immutable'); END;
CREATE TRIGGER boreal_principal_credential_immutable_delete BEFORE DELETE ON boreal_principal_credential
BEGIN SELECT RAISE(ABORT, 'boreal_principal_credential_immutable'); END;
CREATE TRIGGER boreal_credential_revocation_immutable_update BEFORE UPDATE ON boreal_credential_revocation
BEGIN SELECT RAISE(ABORT, 'boreal_credential_revocation_immutable'); END;
CREATE TRIGGER boreal_credential_revocation_immutable_delete BEFORE DELETE ON boreal_credential_revocation
BEGIN SELECT RAISE(ABORT, 'boreal_credential_revocation_immutable'); END;
CREATE TRIGGER boreal_principal_revocation_immutable_update BEFORE UPDATE ON boreal_principal_revocation
BEGIN SELECT RAISE(ABORT, 'boreal_principal_revocation_immutable'); END;
CREATE TRIGGER boreal_principal_revocation_immutable_delete BEFORE DELETE ON boreal_principal_revocation
BEGIN SELECT RAISE(ABORT, 'boreal_principal_revocation_immutable'); END;
CREATE TRIGGER boreal_session_binding_immutable_update BEFORE UPDATE ON boreal_session_binding
BEGIN SELECT RAISE(ABORT, 'boreal_session_binding_immutable'); END;
CREATE TRIGGER boreal_session_binding_immutable_delete BEFORE DELETE ON boreal_session_binding
BEGIN SELECT RAISE(ABORT, 'boreal_session_binding_immutable'); END;
CREATE TRIGGER boreal_dependency_event_immutable_update BEFORE UPDATE ON boreal_dependency_event
BEGIN SELECT RAISE(ABORT, 'boreal_dependency_event_immutable'); END;
CREATE TRIGGER boreal_dependency_event_immutable_delete BEFORE DELETE ON boreal_dependency_event
BEGIN SELECT RAISE(ABORT, 'boreal_dependency_event_immutable'); END;
CREATE TRIGGER boreal_work_transition_immutable_update BEFORE UPDATE ON boreal_work_transition
BEGIN SELECT RAISE(ABORT, 'boreal_work_transition_immutable'); END;
CREATE TRIGGER boreal_work_transition_immutable_delete BEFORE DELETE ON boreal_work_transition
BEGIN SELECT RAISE(ABORT, 'boreal_work_transition_immutable'); END;
