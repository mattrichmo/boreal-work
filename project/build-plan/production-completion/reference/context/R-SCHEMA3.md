# R-SCHEMA3 — project/spec/schema-v3.sql

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/schema-v3.sql:L1–L606`  
**File SHA-256:** `c8c47ab7202a0db3e9ae73196827c04ab116b4ddaa19d4cd8760fcb395051d74`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Additive v3 tables are groundwork, not evidence of a complete cycle-backed application.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,606p' 'project/spec/schema-v3.sql'
```

## Exact baseline excerpt

````text
    1 | -- Boreal v2 additive work-model extension: boreal.work-model/3.
    2 | --
    3 | -- This is an additive migration artifact.  It requires a complete schema-v2
    4 | -- database and leaves every schema-v2 table, trigger, and column unchanged.
    5 | -- The store applies it transactionally and reopens it with explicit v3
    6 | -- contract validation; project rows retain their schema-2 compatibility
    7 | -- version while the database user_version records the installed extension.
    8 | --
    9 | -- The v3 tables deliberately use their own names.  This keeps the existing
   10 | -- v2 WorkItem/Dependency semantics available for compatibility and gives the
   11 | -- application a reviewable projection into the stricter model:
   12 | --
   13 | --   work_node_v3 + work_dependency_v3  decomposition and task graph
   14 | --   cycle_*_v3                         scheduled/recurring planning
   15 | --   intake_*_v3 + promotion             non-work project inbox/provenance
   16 | --   container_disposition_v3            append-only container closeout facts
   17 | 
   18 | BEGIN IMMEDIATE;
   19 | 
   20 | CREATE TABLE work_model_v3_meta (
   21 |   schema_id TEXT PRIMARY KEY CHECK (schema_id = 'boreal.work-model'),
   22 |   schema_version INTEGER NOT NULL CHECK (schema_version = 3),
   23 |   base_schema_version INTEGER NOT NULL CHECK (base_schema_version = 2),
   24 |   contract_version TEXT NOT NULL CHECK (contract_version = 'boreal.work-model/3'),
   25 |   created_at TEXT NOT NULL CHECK (trim(created_at) <> '')
   26 | );
   27 | 
   28 | INSERT INTO work_model_v3_meta (
   29 |   schema_id, schema_version, base_schema_version, contract_version, created_at
   30 | ) VALUES (
   31 |   'boreal.work-model', 3, 2, 'boreal.work-model/3', 'schema-migration'
   32 | );
   33 | 
   34 | -- A v3 node is an explicit decomposition projection over an existing v2
   35 | -- work_item.  Sprints are intentionally absent: cycles below schedule work,
   36 | -- while milestones and tasks express containment.
   37 | CREATE TABLE work_node_v3 (
   38 |   work_id TEXT PRIMARY KEY,
   39 |   project_id TEXT NOT NULL REFERENCES project(project_id),
   40 |   decomposition_kind TEXT NOT NULL
   41 |     CHECK (decomposition_kind IN ('milestone','task')),
   42 |   execution_mode TEXT NOT NULL
   43 |     CHECK (execution_mode IN ('direct','container')),
   44 |   parent_id TEXT,
   45 |   created_at TEXT NOT NULL,
   46 |   updated_at TEXT NOT NULL,
   47 |   UNIQUE (project_id, work_id),
   48 |   FOREIGN KEY (project_id, work_id)
   49 |     REFERENCES work_item(project_id, work_id),
   50 |   FOREIGN KEY (project_id, parent_id)
   51 |     REFERENCES work_node_v3(project_id, work_id),
   52 |   CHECK (
   53 |     (decomposition_kind = 'milestone' AND execution_mode = 'container')
   54 |     OR decomposition_kind = 'task'
   55 |   ),
   56 |   CHECK (parent_id IS NULL OR parent_id <> work_id)
   57 | );
   58 | 
   59 | CREATE TRIGGER work_node_v3_kind_guard BEFORE INSERT ON work_node_v3
   60 | WHEN NOT EXISTS (
   61 |   SELECT 1
   62 |   FROM work_item
   63 |   WHERE project_id = NEW.project_id
   64 |     AND work_id = NEW.work_id
   65 |     AND kind = NEW.decomposition_kind
   66 | )
   67 | BEGIN
   68 |   SELECT RAISE(ABORT, 'work_node_v3_kind_mismatch');
   69 | END;
   70 | 
   71 | CREATE TRIGGER work_node_v3_parent_guard BEFORE INSERT ON work_node_v3
   72 | WHEN NEW.parent_id IS NOT NULL
   73 |  AND NOT EXISTS (
   74 |    SELECT 1
   75 |    FROM work_node_v3 parent
   76 |    WHERE parent.project_id = NEW.project_id
   77 |      AND parent.work_id = NEW.parent_id
   78 |      AND (
   79 |        parent.decomposition_kind = 'milestone'
   80 |        OR (
   81 |          parent.decomposition_kind = 'task'
   82 |          AND parent.execution_mode = 'container'
   83 |        )
   84 |      )
   85 |  )
   86 | BEGIN
   87 |   SELECT RAISE(ABORT, 'work_node_v3_invalid_parent');
   88 | END;
   89 | 
   90 | CREATE TRIGGER work_node_v3_no_cycle BEFORE INSERT ON work_node_v3
   91 | WHEN NEW.parent_id IS NOT NULL
   92 |  AND EXISTS (
   93 |    WITH RECURSIVE ancestors(work_id) AS (
   94 |      SELECT NEW.parent_id
   95 |      UNION
   96 |      SELECT node.parent_id
   97 |      FROM work_node_v3 node
   98 |      JOIN ancestors ON ancestors.work_id = node.work_id
   99 |      WHERE node.project_id = NEW.project_id
  100 |        AND node.parent_id IS NOT NULL
  101 |    )
  102 |    SELECT 1 FROM ancestors WHERE work_id = NEW.work_id
  103 |  )
  104 | BEGIN
  105 |   SELECT RAISE(ABORT, 'work_node_v3_hierarchy_cycle');
  106 | END;
  107 | 
  108 | CREATE TRIGGER work_node_v3_identity_guard
  109 | BEFORE UPDATE OF project_id, work_id
  110 | ON work_node_v3
  111 | BEGIN
  112 |   SELECT RAISE(ABORT, 'work_node_v3_identity_immutable');
  113 | END;
  114 | 
  115 | CREATE TRIGGER work_node_v3_kind_update_guard
  116 | BEFORE UPDATE OF decomposition_kind, execution_mode ON work_node_v3
  117 | WHEN NOT EXISTS (
  118 |   SELECT 1
  119 |   FROM work_item
  120 |   WHERE project_id = NEW.project_id
  121 |     AND work_id = NEW.work_id
  122 |     AND kind = NEW.decomposition_kind
  123 | )
  124 | OR (NEW.decomposition_kind = 'milestone' AND NEW.execution_mode <> 'container')
  125 | OR EXISTS (
  126 |   SELECT 1
  127 |   FROM work_node_v3 child
  128 |   WHERE child.project_id = NEW.project_id
  129 |     AND child.parent_id = NEW.work_id
  130 |     AND NOT (
  131 |       NEW.decomposition_kind = 'milestone'
  132 |       OR (
  133 |         NEW.decomposition_kind = 'task'
  134 |         AND NEW.execution_mode = 'container'
  135 |       )
  136 |     )
  137 | )
  138 | BEGIN
  139 |   SELECT RAISE(ABORT, 'work_node_v3_invalid_retype');
  140 | END;
  141 | 
  142 | CREATE TRIGGER work_node_v3_parent_update_guard
  143 | BEFORE UPDATE OF project_id, parent_id ON work_node_v3
  144 | WHEN NEW.parent_id IS NOT NULL
  145 |  AND NOT EXISTS (
  146 |    SELECT 1
  147 |    FROM work_node_v3 parent
  148 |    WHERE parent.project_id = NEW.project_id
  149 |      AND parent.work_id = NEW.parent_id
  150 |      AND (
  151 |        parent.decomposition_kind = 'milestone'
  152 |        OR (
  153 |          parent.decomposition_kind = 'task'
  154 |          AND parent.execution_mode = 'container'
  155 |        )
  156 |      )
  157 |  )
  158 | BEGIN
  159 |   SELECT RAISE(ABORT, 'work_node_v3_invalid_parent');
  160 | END;
  161 | 
  162 | CREATE TRIGGER work_node_v3_no_cycle_update
  163 | BEFORE UPDATE OF project_id, work_id, parent_id ON work_node_v3
  164 | WHEN NEW.parent_id IS NOT NULL
  165 |  AND EXISTS (
  166 |    WITH RECURSIVE ancestors(work_id) AS (
  167 |      SELECT NEW.parent_id
  168 |      UNION
  169 |      SELECT node.parent_id
  170 |      FROM work_node_v3 node
  171 |      JOIN ancestors ON ancestors.work_id = node.work_id
  172 |      WHERE node.project_id = NEW.project_id
  173 |        AND node.parent_id IS NOT NULL
  174 |    )
  175 |    SELECT 1 FROM ancestors WHERE work_id = NEW.work_id
  176 |  )
  177 | BEGIN
  178 |   SELECT RAISE(ABORT, 'work_node_v3_hierarchy_cycle');
  179 | END;
  180 | 
  181 | -- The v3 dependency graph is task-only and never treats a container or cycle
  182 | -- as an executable prerequisite.  The original v2 dependency table remains
  183 | -- available for legacy compatibility during migration.
  184 | CREATE TABLE work_dependency_v3 (
  185 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  186 |   prerequisite_work_id TEXT NOT NULL,
  187 |   dependent_work_id TEXT NOT NULL,
  188 |   policy TEXT NOT NULL DEFAULT 'closed_only'
  189 |     CHECK (policy IN ('closed_only','explicit_exception')),
  190 |   exception_reason TEXT,
  191 |   approved_by TEXT REFERENCES actor(actor_id),
  192 |   created_at TEXT NOT NULL,
  193 |   PRIMARY KEY (project_id, prerequisite_work_id, dependent_work_id),
  194 |   FOREIGN KEY (project_id, prerequisite_work_id)
  195 |     REFERENCES work_node_v3(project_id, work_id),
  196 |   FOREIGN KEY (project_id, dependent_work_id)
  197 |     REFERENCES work_node_v3(project_id, work_id),
  198 |   CHECK (prerequisite_work_id <> dependent_work_id),
  199 |   CHECK (
  200 |     policy = 'closed_only'
  201 |     OR (trim(COALESCE(exception_reason, '')) <> '' AND approved_by IS NOT NULL)
  202 |   )
  203 | );
  204 | 
  205 | CREATE INDEX work_dependency_v3_dependent
  206 |   ON work_dependency_v3(project_id, dependent_work_id);
  207 | 
  208 | CREATE TRIGGER work_dependency_v3_direct_guard
  209 | BEFORE INSERT ON work_dependency_v3
  210 | WHEN EXISTS (
  211 |   SELECT 1
  212 |   FROM work_node_v3 node
  213 |   WHERE node.project_id = NEW.project_id
  214 |     AND node.work_id IN (NEW.prerequisite_work_id, NEW.dependent_work_id)
  215 |     AND NOT (
  216 |       node.decomposition_kind = 'task'
  217 |       AND node.execution_mode = 'direct'
  218 |     )
  219 | )
  220 | BEGIN
  221 |   SELECT RAISE(ABORT, 'work_dependency_v3_requires_direct_tasks');
  222 | END;
  223 | 
  224 | CREATE TRIGGER work_dependency_v3_no_cycle
  225 | BEFORE INSERT ON work_dependency_v3
  226 | WHEN EXISTS (
  227 |   WITH RECURSIVE reachable(work_id) AS (
  228 |     SELECT NEW.dependent_work_id
  229 |     UNION
  230 |     SELECT dependency.dependent_work_id
  231 |     FROM work_dependency_v3 dependency
  232 |     JOIN reachable
  233 |       ON reachable.work_id = dependency.prerequisite_work_id
  234 |     WHERE dependency.project_id = NEW.project_id
  235 |   )
  236 |   SELECT 1 FROM reachable WHERE work_id = NEW.prerequisite_work_id
  237 | )
  238 | BEGIN
  239 |   SELECT RAISE(ABORT, 'work_dependency_v3_cycle');
  240 | END;
  241 | 
  242 | -- Calendar planning is a separate object from execution deadlines.  A series
  243 | -- owns versioned recurrence templates; each materialized cycle stores the
  244 | -- resolved local/UTC/timezone facts so later tzdb changes cannot rewrite
  245 | -- history.
  246 | CREATE TABLE cycle_series_v3 (
  247 |   series_id TEXT PRIMARY KEY,
  248 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  249 |   name TEXT NOT NULL CHECK (trim(name) <> ''),
  250 |   lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active','paused','retired')),
  251 |   timezone TEXT NOT NULL CHECK (trim(timezone) <> ''),
  252 |   tzdb_identity TEXT NOT NULL CHECK (trim(tzdb_identity) <> ''),
  253 |   revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  254 |   created_at TEXT NOT NULL,
  255 |   updated_at TEXT NOT NULL,
  256 |   UNIQUE (project_id, series_id)
  257 | );
  258 | 
  259 | CREATE TABLE cycle_template_v3 (
  260 |   template_version_id TEXT PRIMARY KEY,
  261 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  262 |   series_id TEXT NOT NULL,
  263 |   version INTEGER NOT NULL CHECK (version > 0),
  264 |   effective_from_slot_ordinal INTEGER NOT NULL CHECK (effective_from_slot_ordinal >= 0),
  265 |   interval_weeks INTEGER NOT NULL CHECK (interval_weeks > 0),
  266 |   anchor_local_date TEXT NOT NULL CHECK (trim(anchor_local_date) <> ''),
  267 |   anchor_local_time TEXT NOT NULL CHECK (trim(anchor_local_time) <> ''),
  268 |   anchor_weekday INTEGER NOT NULL CHECK (anchor_weekday BETWEEN 1 AND 7),
  269 |   recurrence_end_kind TEXT NOT NULL
  270 |     CHECK (recurrence_end_kind IN ('never','count','until_local_date')),
  271 |   recurrence_end_count INTEGER,
  272 |   recurrence_end_local_date TEXT,
  273 |   name_pattern TEXT NOT NULL CHECK (trim(name_pattern) <> ''),
  274 |   goal_template TEXT NOT NULL DEFAULT '',
  275 |   timezone TEXT NOT NULL CHECK (trim(timezone) <> ''),
  276 |   tzdb_identity TEXT NOT NULL CHECK (trim(tzdb_identity) <> ''),
  277 |   gap_policy TEXT NOT NULL CHECK (gap_policy IN ('next_valid')),
  278 |   fold_policy TEXT NOT NULL CHECK (fold_policy IN ('earlier_offset','later_offset')),
  279 |   created_at TEXT NOT NULL,
  280 |   FOREIGN KEY (project_id, series_id)
  281 |     REFERENCES cycle_series_v3(project_id, series_id),
  282 |   UNIQUE (project_id, template_version_id),
  283 |   UNIQUE (project_id, series_id, version),
  284 |   UNIQUE (project_id, series_id, effective_from_slot_ordinal),
  285 |   CHECK (
  286 |     (recurrence_end_kind = 'never'
  287 |       AND recurrence_end_count IS NULL
  288 |       AND recurrence_end_local_date IS NULL)
  289 |     OR (recurrence_end_kind = 'count'
  290 |       AND recurrence_end_count > 0
  291 |       AND recurrence_end_local_date IS NULL)
  292 |     OR (recurrence_end_kind = 'until_local_date'
  293 |       AND recurrence_end_count IS NULL
  294 |       AND trim(COALESCE(recurrence_end_local_date, '')) <> '')
  295 |   )
  296 | );
  297 | 
  298 | CREATE TABLE cycle_template_weekday_v3 (
  299 |   project_id TEXT NOT NULL,
  300 |   template_version_id TEXT NOT NULL,
  301 |   weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  302 |   FOREIGN KEY (project_id, template_version_id)
  303 |     REFERENCES cycle_template_v3(project_id, template_version_id),
  304 |   PRIMARY KEY (project_id, template_version_id, weekday)
  305 | );
  306 | 
  307 | CREATE TABLE cycle_v3 (
  308 |   cycle_id TEXT PRIMARY KEY,
  309 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  310 |   series_id TEXT NOT NULL,
  311 |   template_version_id TEXT NOT NULL,
  312 |   slot_ordinal INTEGER NOT NULL CHECK (slot_ordinal >= 0),
  313 |   slot_key TEXT NOT NULL,
  314 |   name TEXT NOT NULL CHECK (trim(name) <> ''),
  315 |   goal TEXT NOT NULL DEFAULT '',
  316 |   lifecycle TEXT NOT NULL CHECK (lifecycle IN ('planned','active','completed','cancelled')),
  317 |   scheduled_start_utc_ms INTEGER NOT NULL,
  318 |   scheduled_end_utc_ms INTEGER,
  319 |   scheduled_start_local TEXT NOT NULL,
  320 |   scheduled_start_utc_offset_minutes INTEGER NOT NULL
  321 |     CHECK (scheduled_start_utc_offset_minutes BETWEEN -1440 AND 1440),
  322 |   timezone TEXT NOT NULL CHECK (trim(timezone) <> ''),
  323 |   tzdb_identity TEXT NOT NULL CHECK (trim(tzdb_identity) <> ''),
  324 |   gap_policy TEXT NOT NULL CHECK (gap_policy IN ('next_valid')),
  325 |   fold_policy TEXT NOT NULL CHECK (fold_policy IN ('earlier_offset','later_offset')),
  326 |   created_at TEXT NOT NULL,
  327 |   updated_at TEXT NOT NULL,
  328 |   FOREIGN KEY (project_id, series_id)
  329 |     REFERENCES cycle_series_v3(project_id, series_id),
  330 |   FOREIGN KEY (project_id, template_version_id)
  331 |     REFERENCES cycle_template_v3(project_id, template_version_id),
  332 |   UNIQUE (project_id, cycle_id),
  333 |   UNIQUE (project_id, series_id, slot_ordinal),
  334 |   CHECK (slot_key = 'boreal.cycle-slot/1/' || series_id || '/' || slot_ordinal),
  335 |   CHECK (scheduled_end_utc_ms IS NULL OR scheduled_end_utc_ms > scheduled_start_utc_ms)
  336 | );
  337 | 
  338 | CREATE TABLE cycle_assignment_v3 (
  339 |   assignment_id TEXT PRIMARY KEY,
  340 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  341 |   cycle_id TEXT NOT NULL,
  342 |   work_id TEXT NOT NULL,
  343 |   state TEXT NOT NULL
  344 |     CHECK (state IN ('planned','committed','removed','completed','carried_over')),
  345 |   activation_policy TEXT NOT NULL
  346 |     CHECK (activation_policy IN ('at_cycle_start','immediate','explicit_not_before')),
  347 |   activation_at_utc_ms INTEGER,
  348 |   predecessor_id TEXT,
  349 |   successor_id TEXT,
  350 |   created_at TEXT NOT NULL,
  351 |   updated_at TEXT NOT NULL,
  352 |   FOREIGN KEY (project_id, cycle_id) REFERENCES cycle_v3(project_id, cycle_id),
  353 |   FOREIGN KEY (project_id, work_id) REFERENCES work_node_v3(project_id, work_id),
  354 |   UNIQUE (project_id, assignment_id),
  355 |   UNIQUE (project_id, cycle_id, work_id),
  356 |   CHECK ((activation_policy = 'explicit_not_before') = (activation_at_utc_ms IS NOT NULL)),
  357 |   CHECK (predecessor_id IS NULL OR predecessor_id <> assignment_id),
  358 |   CHECK (successor_id IS NULL OR successor_id <> assignment_id)
  359 | );
  360 | 
  361 | CREATE INDEX cycle_assignment_v3_live_work
  362 |   ON cycle_assignment_v3(project_id, work_id)
  363 |   WHERE state IN ('planned','committed');
  364 | 
  365 | CREATE TRIGGER cycle_assignment_v3_direct_guard
  366 | BEFORE INSERT ON cycle_assignment_v3
  367 | WHEN EXISTS (
  368 |   SELECT 1
  369 |   FROM work_node_v3 node
  370 |   WHERE node.project_id = NEW.project_id
  371 |     AND node.work_id = NEW.work_id
  372 |     AND NOT (
  373 |       node.decomposition_kind = 'task'
  374 |       AND node.execution_mode = 'direct'
  375 |     )
  376 | )
  377 | BEGIN
  378 |   SELECT RAISE(ABORT, 'cycle_assignment_v3_requires_direct_task');
  379 | END;
  380 | 
  381 | CREATE TRIGGER cycle_assignment_v3_terminal_guard
  382 | BEFORE INSERT ON cycle_assignment_v3
  383 | WHEN NEW.state IN ('planned','committed')
  384 |  AND EXISTS (
  385 |    SELECT 1 FROM cycle_v3 cycle
  386 |    WHERE cycle.project_id = NEW.project_id
  387 |      AND cycle.cycle_id = NEW.cycle_id
  388 |      AND cycle.lifecycle IN ('completed','cancelled')
  389 |  )
  390 | BEGIN
  391 |   SELECT RAISE(ABORT, 'cycle_assignment_v3_terminal_cycle');
  392 | END;
  393 | 
  394 | -- Intake is intentionally not a work_item.  Its status is derived from
  395 | -- lifecycle and revisit_at_utc_ms; it can later be promoted with a bound
  396 | -- content revision/digest into work, a source version, or a memory draft.
  397 | CREATE TABLE intake_bucket_v3 (
  398 |   bucket_id TEXT PRIMARY KEY,
  399 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  400 |   name TEXT NOT NULL CHECK (trim(name) <> ''),
  401 |   archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  402 |   created_at TEXT NOT NULL,
  403 |   updated_at TEXT NOT NULL,
  404 |   UNIQUE (project_id, bucket_id)
  405 | );
  406 | 
  407 | CREATE TABLE intake_item_v3 (
  408 |   intake_id TEXT PRIMARY KEY,
  409 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  410 |   bucket_id TEXT NOT NULL,
  411 |   kind TEXT NOT NULL CHECK (kind IN ('note','discovery','question','revisit')),
  412 |   lifecycle TEXT NOT NULL
  413 |     CHECK (lifecycle IN ('captured','triaged','deferred','resolved','archived')),
  414 |   content TEXT NOT NULL CHECK (length(content) > 0),
  415 |   content_revision INTEGER NOT NULL CHECK (content_revision > 0),
  416 |   content_digest TEXT NOT NULL CHECK (trim(content_digest) <> ''),
  417 |   captured_at TEXT NOT NULL,
  418 |   updated_at TEXT NOT NULL,
  419 |   revisit_at_utc_ms INTEGER,
  420 |   FOREIGN KEY (project_id, bucket_id)
  421 |     REFERENCES intake_bucket_v3(project_id, bucket_id),
  422 |   UNIQUE (project_id, intake_id),
  423 |   CHECK (lifecycle <> 'deferred' OR revisit_at_utc_ms IS NOT NULL)
  424 | );
  425 | 
  426 | CREATE TRIGGER intake_item_v3_revision_guard
  427 | BEFORE UPDATE ON intake_item_v3
  428 | WHEN NEW.content_revision <> OLD.content_revision
  429 |   OR NEW.content IS NOT OLD.content
  430 |   OR NEW.content_digest IS NOT OLD.content_digest
  431 | BEGIN
  432 |   SELECT CASE
  433 |     WHEN NEW.content_revision <> OLD.content_revision + 1
  434 |       OR (NEW.content IS NOT OLD.content AND NEW.content_digest = OLD.content_digest)
  435 |     THEN RAISE(ABORT, 'intake_item_v3_revision_digest_mismatch')
  436 |   END;
  437 | END;
  438 | 
  439 | CREATE TABLE intake_promotion_v3 (
  440 |   promotion_id TEXT PRIMARY KEY,
  441 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  442 |   intake_id TEXT NOT NULL,
  443 |   intake_revision INTEGER NOT NULL CHECK (intake_revision > 0),
  444 |   intake_digest TEXT NOT NULL CHECK (trim(intake_digest) <> ''),
  445 |   target_kind TEXT NOT NULL CHECK (target_kind IN ('draft_work','source_version','memory_draft')),
  446 |   target_id TEXT NOT NULL CHECK (trim(target_id) <> ''),
  447 |   actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  448 |   operation_id TEXT NOT NULL UNIQUE,
  449 |   created_at TEXT NOT NULL,
  450 |   FOREIGN KEY (project_id, intake_id)
  451 |     REFERENCES intake_item_v3(project_id, intake_id),
  452 |   UNIQUE (project_id, intake_id, intake_revision, target_kind, target_id)
  453 | );
  454 | 
  455 | CREATE TRIGGER intake_promotion_v3_current_provenance
  456 | BEFORE INSERT ON intake_promotion_v3
  457 | WHEN NOT EXISTS (
  458 |   SELECT 1
  459 |   FROM intake_item_v3 item
  460 |   WHERE item.project_id = NEW.project_id
  461 |     AND item.intake_id = NEW.intake_id
  462 |     AND item.content_revision = NEW.intake_revision
  463 |     AND item.content_digest = NEW.intake_digest
  464 | )
  465 | BEGIN
  466 |   SELECT RAISE(ABORT, 'intake_promotion_v3_stale_provenance');
  467 | END;
  468 | 
  469 | CREATE TRIGGER intake_promotion_v3_append_only_update
  470 | BEFORE UPDATE ON intake_promotion_v3
  471 | BEGIN
  472 |   SELECT RAISE(ABORT, 'intake_promotion_v3_append_only');
  473 | END;
  474 | 
  475 | CREATE TRIGGER intake_promotion_v3_append_only_delete
  476 | BEFORE DELETE ON intake_promotion_v3
  477 | BEGIN
  478 |   SELECT RAISE(ABORT, 'intake_promotion_v3_append_only');
  479 | END;
  480 | 
  481 | -- Container closeout is a fact stream.  A new disposition supersedes the
  482 | -- current fact by reference; no old row is updated or deleted.  The current
  483 | -- row is the chain tip (the row not referenced by a later supersedes_id).
  484 | CREATE TABLE container_disposition_v3 (
  485 |   disposition_id TEXT PRIMARY KEY,
  486 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  487 |   container_work_id TEXT NOT NULL,
  488 |   descendant_work_id TEXT NOT NULL,
  489 |   kind TEXT NOT NULL
  490 |     CHECK (kind IN ('accepted_closed','accepted_cancelled','deferred','replaced')),
  491 |   descendant_revision INTEGER NOT NULL CHECK (descendant_revision >= 0),
  492 |   descendant_outcome_digest TEXT NOT NULL CHECK (trim(descendant_outcome_digest) <> ''),
  493 |   replacement_work_id TEXT,
  494 |   reason TEXT,
  495 |   supersedes_id TEXT,
  496 |   created_at TEXT NOT NULL,
  497 |   FOREIGN KEY (project_id, container_work_id)
  498 |     REFERENCES work_node_v3(project_id, work_id),
  499 |   FOREIGN KEY (project_id, descendant_work_id)
  500 |     REFERENCES work_node_v3(project_id, work_id),
  501 |   FOREIGN KEY (project_id, replacement_work_id)
  502 |     REFERENCES work_node_v3(project_id, work_id),
  503 |   FOREIGN KEY (supersedes_id) REFERENCES container_disposition_v3(disposition_id),
  504 |   CHECK (container_work_id <> descendant_work_id),
  505 |   CHECK (
  506 |     (kind IN ('accepted_closed','accepted_cancelled')
  507 |       AND replacement_work_id IS NULL)
  508 |     OR (kind = 'deferred'
  509 |       AND replacement_work_id IS NULL
  510 |       AND trim(COALESCE(reason, '')) <> '')
  511 |     OR (kind = 'replaced'
  512 |       AND replacement_work_id IS NOT NULL
  513 |       AND trim(COALESCE(reason, '')) <> '')
  514 |   )
  515 | );
  516 | 
  517 | CREATE INDEX container_disposition_v3_subject
  518 |   ON container_disposition_v3(project_id, container_work_id, descendant_work_id);
  519 | 
  520 | CREATE UNIQUE INDEX container_disposition_v3_successor
  521 |   ON container_disposition_v3(supersedes_id)
  522 |   WHERE supersedes_id IS NOT NULL;
  523 | 
  524 | CREATE TRIGGER container_disposition_v3_subject_guard
  525 | BEFORE INSERT ON container_disposition_v3
  526 | WHEN NOT EXISTS (
  527 |   SELECT 1
  528 |   FROM work_node_v3 container
  529 |   WHERE container.project_id = NEW.project_id
  530 |     AND container.work_id = NEW.container_work_id
  531 |     AND container.execution_mode = 'container'
  532 | )
  533 | OR NOT EXISTS (
  534 |   WITH RECURSIVE descendants(work_id) AS (
  535 |     SELECT child.work_id
  536 |     FROM work_node_v3 child
  537 |     WHERE child.project_id = NEW.project_id
  538 |       AND child.parent_id = NEW.container_work_id
  539 |     UNION
  540 |     SELECT child.work_id
  541 |     FROM work_node_v3 child
  542 |     JOIN descendants
  543 |       ON descendants.work_id = child.parent_id
  544 |     WHERE child.project_id = NEW.project_id
  545 |   )
  546 |   SELECT 1
  547 |   FROM descendants
  548 |   WHERE work_id = NEW.descendant_work_id
  549 | )
  550 | BEGIN
  551 |   SELECT RAISE(ABORT, 'container_disposition_v3_invalid_subject');
  552 | END;
  553 | 
  554 | CREATE TRIGGER container_disposition_v3_chain_guard
  555 | BEFORE INSERT ON container_disposition_v3
  556 | BEGIN
  557 |   SELECT CASE
  558 |     WHEN NEW.supersedes_id IS NULL
  559 |       AND EXISTS (
  560 |         SELECT 1
  561 |         FROM container_disposition_v3 current
  562 |         WHERE current.project_id = NEW.project_id
  563 |           AND current.container_work_id = NEW.container_work_id
  564 |           AND current.descendant_work_id = NEW.descendant_work_id
  565 |           AND NOT EXISTS (
  566 |             SELECT 1
  567 |             FROM container_disposition_v3 successor
  568 |             WHERE successor.supersedes_id = current.disposition_id
  569 |           )
  570 |       )
  571 |     THEN RAISE(ABORT, 'container_disposition_v3_current_exists')
  572 |   END;
  573 |   SELECT CASE
  574 |     WHEN NEW.supersedes_id IS NOT NULL
  575 |       AND NOT EXISTS (
  576 |         SELECT 1
  577 |         FROM container_disposition_v3 current
  578 |         WHERE current.disposition_id = NEW.supersedes_id
  579 |           AND current.project_id = NEW.project_id
  580 |           AND current.container_work_id = NEW.container_work_id
  581 |           AND current.descendant_work_id = NEW.descendant_work_id
  582 |           AND NOT EXISTS (
  583 |             SELECT 1
  584 |             FROM container_disposition_v3 successor
  585 |             WHERE successor.supersedes_id = current.disposition_id
  586 |           )
  587 |       )
  588 |     THEN RAISE(ABORT, 'container_disposition_v3_invalid_supersedes')
  589 |   END;
  590 | END;
  591 | 
  592 | CREATE TRIGGER container_disposition_v3_append_only_update
  593 | BEFORE UPDATE ON container_disposition_v3
  594 | BEGIN
  595 |   SELECT RAISE(ABORT, 'container_disposition_v3_append_only');
  596 | END;
  597 | 
  598 | CREATE TRIGGER container_disposition_v3_append_only_delete
  599 | BEFORE DELETE ON container_disposition_v3
  600 | BEGIN
  601 |   SELECT RAISE(ABORT, 'container_disposition_v3_append_only');
  602 | END;
  603 | 
  604 | -- Set only after the additive objects and their constraints are complete.
  605 | PRAGMA user_version = 3;
  606 | COMMIT;
````
