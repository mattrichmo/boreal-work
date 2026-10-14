-- Append-only civil-time settings, work schedules, and external decision waits.
-- This is an additive feature schema; existing work-item dates and v2/v3
-- lifecycle tables remain untouched.

CREATE TABLE IF NOT EXISTS project_civil_time_v1 (
  project_id TEXT NOT NULL REFERENCES project(project_id) ON DELETE RESTRICT,
  setting_revision INTEGER NOT NULL CHECK (setting_revision > 0),
  timezone TEXT NOT NULL CHECK (trim(timezone) <> ''),
  tzdb_identity TEXT NOT NULL CHECK (trim(tzdb_identity) <> ''),
  changed_by TEXT NOT NULL REFERENCES actor(actor_id) ON DELETE RESTRICT,
  changed_at_ms INTEGER NOT NULL CHECK (changed_at_ms >= 0),
  created_project_revision INTEGER NOT NULL CHECK (created_project_revision >= 0),
  operation_id TEXT NOT NULL CHECK (trim(operation_id) <> ''),
  request_digest TEXT NOT NULL CHECK (trim(request_digest) <> ''),
  PRIMARY KEY (project_id, setting_revision)
);

CREATE TABLE IF NOT EXISTS work_schedule_v3 (
  project_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  schedule_revision INTEGER NOT NULL CHECK (schedule_revision > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  civil_time_setting_revision INTEGER CHECK (
    civil_time_setting_revision IS NULL OR civil_time_setting_revision > 0
  ),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  created_project_revision INTEGER NOT NULL CHECK (created_project_revision >= 0),
  operation_id TEXT NOT NULL CHECK (trim(operation_id) <> ''),
  request_digest TEXT NOT NULL CHECK (trim(request_digest) <> ''),
  PRIMARY KEY (project_id, work_id, schedule_revision),
  FOREIGN KEY (project_id, work_id)
    REFERENCES work_item(project_id, work_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, civil_time_setting_revision)
    REFERENCES project_civil_time_v1(project_id, setting_revision) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS external_wait_v1 (
  project_id TEXT NOT NULL REFERENCES project(project_id) ON DELETE RESTRICT,
  wait_id TEXT NOT NULL CHECK (trim(wait_id) <> ''),
  wait_revision INTEGER NOT NULL CHECK (wait_revision > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_project_revision INTEGER NOT NULL CHECK (created_project_revision >= 0),
  operation_id TEXT NOT NULL CHECK (trim(operation_id) <> ''),
  request_digest TEXT NOT NULL CHECK (trim(request_digest) <> ''),
  PRIMARY KEY (project_id, wait_id, wait_revision)
);

CREATE TABLE IF NOT EXISTS external_wait_scope_v1 (
  project_id TEXT NOT NULL,
  wait_id TEXT NOT NULL,
  wait_revision INTEGER NOT NULL CHECK (wait_revision > 0),
  affected_work_id TEXT NOT NULL,
  PRIMARY KEY (project_id, wait_id, wait_revision, affected_work_id),
  FOREIGN KEY (project_id, wait_id, wait_revision)
    REFERENCES external_wait_v1(project_id, wait_id, wait_revision) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, affected_work_id)
    REFERENCES work_item(project_id, work_id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS project_civil_time_v1_no_update
BEFORE UPDATE ON project_civil_time_v1
BEGIN SELECT RAISE(ABORT, 'project_civil_time_revisions_are_immutable'); END;

CREATE TRIGGER IF NOT EXISTS project_civil_time_v1_no_delete
BEFORE DELETE ON project_civil_time_v1
BEGIN SELECT RAISE(ABORT, 'project_civil_time_revisions_are_immutable'); END;

CREATE TRIGGER IF NOT EXISTS work_schedule_v3_no_update
BEFORE UPDATE ON work_schedule_v3
BEGIN SELECT RAISE(ABORT, 'work_schedule_revisions_are_immutable'); END;

CREATE TRIGGER IF NOT EXISTS work_schedule_v3_no_delete
BEFORE DELETE ON work_schedule_v3
BEGIN SELECT RAISE(ABORT, 'work_schedule_revisions_are_immutable'); END;

CREATE TRIGGER IF NOT EXISTS external_wait_v1_no_update
BEFORE UPDATE ON external_wait_v1
BEGIN SELECT RAISE(ABORT, 'external_wait_revisions_are_immutable'); END;

CREATE TRIGGER IF NOT EXISTS external_wait_v1_no_delete
BEFORE DELETE ON external_wait_v1
BEGIN SELECT RAISE(ABORT, 'external_wait_revisions_are_immutable'); END;

CREATE TRIGGER IF NOT EXISTS external_wait_scope_v1_no_update
BEFORE UPDATE ON external_wait_scope_v1
BEGIN SELECT RAISE(ABORT, 'external_wait_scope_is_immutable'); END;

CREATE TRIGGER IF NOT EXISTS external_wait_scope_v1_no_delete
BEFORE DELETE ON external_wait_scope_v1
BEGIN SELECT RAISE(ABORT, 'external_wait_scope_is_immutable'); END;
