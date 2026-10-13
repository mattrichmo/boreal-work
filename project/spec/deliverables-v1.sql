-- Additive planning contract and template-prefix schema. Artifact bytes and
-- source catalog ownership remain in the source/artifact layer.

CREATE TABLE IF NOT EXISTS work_planning_contract_v1 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  contract_revision INTEGER NOT NULL CHECK (contract_revision > 0),
  template_id TEXT,
  template_version INTEGER CHECK (template_version IS NULL OR template_version > 0),
  requirements_json TEXT NOT NULL CHECK (json_valid(requirements_json)),
  inputs_json TEXT NOT NULL CHECK (json_valid(inputs_json)),
  actor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, work_id, contract_revision),
  FOREIGN KEY (project_id, work_id) REFERENCES work_item(project_id, work_id),
  CHECK ((template_id IS NULL) = (template_version IS NULL))
);
CREATE INDEX IF NOT EXISTS work_planning_contract_current_v1
  ON work_planning_contract_v1(project_id, work_id, contract_revision DESC);
CREATE TRIGGER IF NOT EXISTS work_planning_contract_no_update_v1
BEFORE UPDATE ON work_planning_contract_v1
BEGIN SELECT RAISE(ABORT, 'work_planning_contract_append_only'); END;
CREATE TRIGGER IF NOT EXISTS work_planning_contract_no_delete_v1
BEFORE DELETE ON work_planning_contract_v1
BEGIN SELECT RAISE(ABORT, 'work_planning_contract_append_only'); END;

CREATE TABLE IF NOT EXISTS work_template_prefix_v1 (
  project_id TEXT NOT NULL REFERENCES project(project_id),
  id_prefix TEXT NOT NULL CHECK (length(id_prefix) BETWEEN 1 AND 48),
  template_id TEXT NOT NULL CHECK (trim(template_id) <> ''),
  template_version INTEGER NOT NULL CHECK (template_version > 0),
  project_revision INTEGER NOT NULL CHECK (project_revision > 0),
  operation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id_prefix),
  UNIQUE (project_id, operation_id)
);

CREATE TABLE IF NOT EXISTS work_template_prefix_history_v1 (
  project_id TEXT NOT NULL,
  id_prefix TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL CHECK (template_version > 0),
  project_revision INTEGER NOT NULL CHECK (project_revision > 0),
  operation_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id_prefix, project_revision),
  UNIQUE (project_id, operation_id),
  FOREIGN KEY (project_id, id_prefix)
    REFERENCES work_template_prefix_v1(project_id, id_prefix)
);
CREATE TRIGGER IF NOT EXISTS work_template_prefix_history_no_update_v1
BEFORE UPDATE ON work_template_prefix_history_v1
BEGIN SELECT RAISE(ABORT, 'work_template_prefix_history_append_only'); END;
CREATE TRIGGER IF NOT EXISTS work_template_prefix_history_no_delete_v1
BEFORE DELETE ON work_template_prefix_history_v1
BEGIN SELECT RAISE(ABORT, 'work_template_prefix_history_append_only'); END;

CREATE TABLE IF NOT EXISTS work_template_prefix_item_v1 (
  project_id TEXT NOT NULL,
  id_prefix TEXT NOT NULL,
  item_key TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 64),
  work_id TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id_prefix, item_key),
  UNIQUE (project_id, id_prefix, work_id),
  FOREIGN KEY (project_id, id_prefix)
    REFERENCES work_template_prefix_v1(project_id, id_prefix),
  FOREIGN KEY (project_id, work_id)
    REFERENCES work_item(project_id, work_id)
);
CREATE TRIGGER IF NOT EXISTS work_template_prefix_item_identity_guard_v1
BEFORE UPDATE OF project_id, id_prefix, item_key, work_id
ON work_template_prefix_item_v1
BEGIN SELECT RAISE(ABORT, 'work_template_prefix_item_identity_immutable'); END;
CREATE TRIGGER IF NOT EXISTS work_template_prefix_item_no_delete_v1
BEFORE DELETE ON work_template_prefix_item_v1
BEGIN SELECT RAISE(ABORT, 'work_template_prefix_item_immutable'); END;
