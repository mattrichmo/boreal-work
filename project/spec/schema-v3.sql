-- Boreal v2 additive work-model extension: boreal.work-model/3.
--
-- This is a migration artifact, not runtime wiring.  It requires a complete
-- schema-v2 database and leaves every schema-v2 table, trigger, and column
-- unchanged.  The current store still advertises/opens schema version 2;
-- the future migration owner must teach it how to apply and reopen this
-- extension before using user_version 3 in production.
--
-- The v3 tables deliberately use their own names.  This keeps the existing
-- v2 WorkItem/Dependency semantics available for compatibility and gives the
-- application a reviewable projection into the stricter model:
--
--   work_node_v3 + work_dependency_v3  decomposition and task graph
--   cycle_*_v3                         scheduled/recurring planning
--   intake_*_v3 + promotion             non-work project inbox/provenance
--   container_disposition_v3            append-only container closeout facts

BEGIN IMMEDIATE;

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
PRAGMA user_version = 3;
COMMIT;
