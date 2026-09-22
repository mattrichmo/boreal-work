# R-SCHEMA2 — project/spec/schema-v2.sql

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/schema-v2.sql:L1–L463`  
**File SHA-256:** `ae5febe8a491404f7cc4103164b82369b24fb19977239a00860978b30ca545e1`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing canonical tables, keys, constraints and migration baseline.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,463p' 'project/spec/schema-v2.sql'
```

## Exact baseline excerpt

````text
    1 | -- Boreal v2 persistence fixture: boreal.sqlite/2.
    2 | -- One local project database; application mutations use short WAL transactions.
    3 | PRAGMA foreign_keys = ON;
    4 | PRAGMA journal_mode = WAL;
    5 | 
    6 | CREATE TABLE project (
    7 |   project_id TEXT PRIMARY KEY,
    8 |   schema_version INTEGER NOT NULL CHECK (schema_version = 2),
    9 |   status_contract_version TEXT NOT NULL CHECK (status_contract_version = 'boreal.work-status/2'),
   10 |   project_revision INTEGER NOT NULL DEFAULT 0 CHECK (project_revision >= 0),
   11 |   created_at TEXT NOT NULL,
   12 |   updated_at TEXT NOT NULL
   13 | );
   14 | 
   15 | CREATE TABLE actor (
   16 |   actor_id TEXT PRIMARY KEY,
   17 |   role TEXT NOT NULL CHECK (role IN ('agent','reviewer','operator','publisher')),
   18 |   credential_ref TEXT NOT NULL UNIQUE,
   19 |   display_name TEXT NOT NULL,
   20 |   created_at TEXT NOT NULL
   21 | );
   22 | 
   23 | CREATE TABLE session (
   24 |   session_id TEXT PRIMARY KEY,
   25 |   actor_id TEXT NOT NULL REFERENCES actor(actor_id),
   26 |   harness_id TEXT NOT NULL,
   27 |   state TEXT NOT NULL CHECK (state IN ('active','ended','unknown')),
   28 |   started_at TEXT NOT NULL,
   29 |   ended_at TEXT,
   30 |   CHECK ((state = 'ended') = (ended_at IS NOT NULL))
   31 | );
   32 | 
   33 | CREATE TABLE source_version (
   34 |   source_version_id TEXT PRIMARY KEY,
   35 |   project_id TEXT NOT NULL REFERENCES project(project_id),
   36 |   origin TEXT NOT NULL,
   37 |   access_scope TEXT NOT NULL CHECK (access_scope IN ('project','private')),
   38 |   content_digest TEXT NOT NULL,
   39 |   media_type TEXT NOT NULL,
   40 |   byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
   41 |   captured_at TEXT NOT NULL,
   42 |   parser_identity TEXT NOT NULL,
   43 |   availability TEXT NOT NULL CHECK (availability IN ('available','missing','quarantined')),
   44 |   citation_json TEXT NOT NULL,
   45 |   UNIQUE (project_id, source_version_id)
   46 | );
   47 | 
   48 | CREATE TABLE acceptance_profile (
   49 |   profile_id TEXT NOT NULL,
   50 |   version INTEGER NOT NULL CHECK (version > 0),
   51 |   policy_digest TEXT NOT NULL,
   52 |   definition_json TEXT NOT NULL,
   53 |   created_at TEXT NOT NULL,
   54 |   PRIMARY KEY (profile_id, version)
   55 | );
   56 | 
   57 | CREATE TABLE work_item (
   58 |   work_id TEXT PRIMARY KEY,
   59 |   project_id TEXT NOT NULL REFERENCES project(project_id),
   60 |   kind TEXT NOT NULL CHECK (kind IN ('milestone','sprint','task')),
   61 |   parent_id TEXT,
   62 |   lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle IN ('draft','open','closed','cancelled')),
   63 |   dispatch_policy TEXT NOT NULL DEFAULT 'automatic' CHECK (dispatch_policy IN ('automatic','operator_only','paused')),
   64 |   priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0 AND priority <= 255),
   65 |   retry_not_before TEXT,
   66 |   acceptance_profile_id TEXT NOT NULL,
   67 |   acceptance_profile_version INTEGER NOT NULL,
   68 |   source_version_id TEXT REFERENCES source_version(source_version_id),
   69 |   due_at TEXT,
   70 |   title TEXT NOT NULL CHECK (title <> ''),
   71 |   description TEXT NOT NULL DEFAULT '',
   72 |   created_at TEXT NOT NULL,
   73 |   updated_at TEXT NOT NULL,
   74 |   FOREIGN KEY (acceptance_profile_id, acceptance_profile_version)
   75 |     REFERENCES acceptance_profile(profile_id, version),
   76 |   FOREIGN KEY (project_id, parent_id)
   77 |     REFERENCES work_item(project_id, work_id),
   78 |   FOREIGN KEY (project_id, source_version_id)
   79 |     REFERENCES source_version(project_id, source_version_id),
   80 |   UNIQUE (project_id, work_id),
   81 |   CHECK (parent_id IS NULL OR parent_id <> work_id)
   82 | );
   83 | CREATE INDEX work_item_project ON work_item(project_id, lifecycle, dispatch_policy);
   84 | CREATE INDEX work_item_project_id ON work_item(project_id, work_id);
   85 | CREATE INDEX work_item_parent ON work_item(parent_id);
   86 | 
   87 | CREATE TRIGGER work_parent_kind_guard BEFORE INSERT ON work_item
   88 | WHEN NEW.parent_id IS NOT NULL
   89 |  AND EXISTS (SELECT 1 FROM work_item existing
   90 |              WHERE existing.work_id = NEW.parent_id AND existing.project_id = NEW.project_id)
   91 |  AND NOT EXISTS (
   92 |   SELECT 1 FROM work_item parent
   93 |   WHERE parent.project_id = NEW.project_id
   94 |     AND parent.work_id = NEW.parent_id
   95 |     AND ((parent.kind = 'milestone' AND NEW.kind = 'sprint')
   96 |       OR (parent.kind = 'sprint' AND NEW.kind = 'task'))
   97 | )
   98 | BEGIN
   99 |   SELECT RAISE(ABORT, 'invalid_parent_kind');
  100 | END;
  101 | 
  102 | CREATE TRIGGER work_parent_kind_guard_update BEFORE UPDATE OF parent_id, kind ON work_item
  103 | WHEN NEW.parent_id IS NOT NULL
  104 |  AND EXISTS (SELECT 1 FROM work_item existing
  105 |              WHERE existing.work_id = NEW.parent_id AND existing.project_id = NEW.project_id)
  106 |  AND NOT EXISTS (
  107 |   SELECT 1 FROM work_item parent
  108 |   WHERE parent.project_id = NEW.project_id
  109 |     AND parent.work_id = NEW.parent_id
  110 |     AND ((parent.kind = 'milestone' AND NEW.kind = 'sprint')
  111 |       OR (parent.kind = 'sprint' AND NEW.kind = 'task'))
  112 | )
  113 | BEGIN
  114 |   SELECT RAISE(ABORT, 'invalid_parent_kind');
  115 | END;
  116 | 
  117 | CREATE TRIGGER work_parent_retype_guard BEFORE UPDATE OF kind ON work_item
  118 | WHEN EXISTS (
  119 |   SELECT 1 FROM work_item child
  120 |   WHERE child.project_id = NEW.project_id
  121 |     AND child.parent_id = NEW.work_id
  122 |     AND NOT (
  123 |       (NEW.kind = 'milestone' AND child.kind = 'sprint')
  124 |       OR (NEW.kind = 'sprint' AND child.kind = 'task')
  125 |     )
  126 | )
  127 | BEGIN
  128 |   SELECT RAISE(ABORT, 'invalid_parent_kind');
  129 | END;
  130 | 
  131 | CREATE TABLE dependency (
  132 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  133 |   prerequisite_id TEXT NOT NULL,
  134 |   dependent_id TEXT NOT NULL,
  135 |   satisfaction_policy TEXT NOT NULL DEFAULT 'closed_only'
  136 |     CHECK (satisfaction_policy IN ('closed_only','explicit_exception')),
  137 |   policy_version TEXT NOT NULL DEFAULT 'edge/1',
  138 |   exception_reason TEXT,
  139 |   approved_by TEXT REFERENCES actor(actor_id),
  140 |   created_at TEXT NOT NULL,
  141 |   PRIMARY KEY (project_id, prerequisite_id, dependent_id),
  142 |   FOREIGN KEY (project_id, prerequisite_id) REFERENCES work_item(project_id, work_id),
  143 |   FOREIGN KEY (project_id, dependent_id) REFERENCES work_item(project_id, work_id),
  144 |   CHECK (prerequisite_id <> dependent_id),
  145 |   CHECK (satisfaction_policy = 'closed_only'
  146 |          OR (exception_reason IS NOT NULL AND approved_by IS NOT NULL))
  147 | );
  148 | CREATE INDEX dependency_dependent ON dependency(dependent_id);
  149 | 
  150 | CREATE TRIGGER dependency_no_cycle BEFORE INSERT ON dependency
  151 | WHEN EXISTS (
  152 |   WITH RECURSIVE reachable(work_id) AS (
  153 |     SELECT NEW.dependent_id
  154 |     UNION
  155 |     SELECT d.dependent_id
  156 |     FROM dependency d
  157 |     JOIN reachable r ON r.work_id = d.prerequisite_id
  158 |     WHERE d.project_id = NEW.project_id
  159 |   )
  160 |   SELECT 1 FROM reachable WHERE work_id = NEW.prerequisite_id
  161 | )
  162 | BEGIN
  163 |   SELECT RAISE(ABORT, 'dependency_cycle');
  164 | END;
  165 | 
  166 | CREATE TABLE attempt (
  167 |   attempt_id TEXT PRIMARY KEY,
  168 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  169 |   actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  170 |   harness_id TEXT NOT NULL,
  171 |   session_id TEXT REFERENCES session(session_id),
  172 |   fence INTEGER NOT NULL CHECK (fence > 0),
  173 |   current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0,1)),
  174 |   state TEXT NOT NULL CHECK (state IN ('claimed','accepted','running','verifying','expiry_pending','completed','failed','released','expired','cancelled')),
  175 |   claimed_at TEXT NOT NULL,
  176 |   accepted_at TEXT,
  177 |   lease_deadline TEXT NOT NULL,
  178 |   max_attempt_deadline TEXT NOT NULL,
  179 |   last_heartbeat_at TEXT,
  180 |   last_checkpoint_at TEXT,
  181 |   review_required_after_expiry INTEGER NOT NULL DEFAULT 1 CHECK (review_required_after_expiry IN (0,1)),
  182 |   stop_requested_at TEXT,
  183 |   stop_acknowledged_at TEXT,
  184 |   terminal_at TEXT,
  185 |   terminal_reason TEXT,
  186 |   source_version_id TEXT REFERENCES source_version(source_version_id),
  187 |   config_identity TEXT NOT NULL,
  188 |   binary_identity TEXT NOT NULL,
  189 |   protocol_version TEXT NOT NULL,
  190 |   schema_version INTEGER NOT NULL CHECK (schema_version = 2),
  191 |   CHECK (max_attempt_deadline > claimed_at),
  192 |   CHECK (lease_deadline >= claimed_at),
  193 |   CHECK ((current = 1 AND state IN ('claimed','accepted','running','verifying','expiry_pending'))
  194 |          OR (current = 0 AND state IN ('completed','failed','released','expired','cancelled'))),
  195 |   CHECK (state IN ('claimed','expiry_pending','expired','released','failed','cancelled') OR accepted_at IS NOT NULL)
  196 | );
  197 | CREATE UNIQUE INDEX attempt_current_work ON attempt(work_id) WHERE current = 1;
  198 | CREATE UNIQUE INDEX attempt_current_session ON attempt(session_id) WHERE current = 1 AND session_id IS NOT NULL;
  199 | CREATE UNIQUE INDEX attempt_fence ON attempt(work_id, fence);
  200 | CREATE INDEX attempt_expiry ON attempt(state, lease_deadline, max_attempt_deadline);
  201 | 
  202 | CREATE TABLE reservation (
  203 |   reservation_id TEXT PRIMARY KEY,
  204 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  205 |   attempt_id TEXT NOT NULL UNIQUE REFERENCES attempt(attempt_id),
  206 |   fence INTEGER NOT NULL CHECK (fence > 0),
  207 |   state TEXT NOT NULL CHECK (state IN ('active','released','expired')),
  208 |   lease_deadline TEXT NOT NULL,
  209 |   renewed_at TEXT,
  210 |   renewal_count INTEGER NOT NULL DEFAULT 0 CHECK (renewal_count >= 0),
  211 |   released_at TEXT,
  212 |   CHECK ((state = 'active') = (released_at IS NULL))
  213 | );
  214 | CREATE UNIQUE INDEX reservation_current_work ON reservation(work_id) WHERE state = 'active';
  215 | 
  216 | CREATE TABLE work_hold (
  217 |   hold_id TEXT PRIMARY KEY,
  218 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  219 |   reason_code TEXT NOT NULL CHECK (trim(reason_code) <> ''),
  220 |   actor_id TEXT REFERENCES actor(actor_id),
  221 |   created_at TEXT NOT NULL,
  222 |   resolved_at TEXT,
  223 |   resolved_by TEXT REFERENCES actor(actor_id),
  224 |   resolution_reason TEXT,
  225 |   CHECK (resolved_at IS NULL OR resolved_by IS NOT NULL),
  226 |   CHECK (resolved_at IS NULL OR resolution_reason IS NOT NULL)
  227 | );
  228 | CREATE INDEX work_hold_active ON work_hold(work_id) WHERE resolved_at IS NULL;
  229 | CREATE INDEX attempt_work_current ON attempt(work_id, current, attempt_id);
  230 | CREATE INDEX attempt_session_current ON attempt(session_id, current, attempt_id);
  231 | 
  232 | CREATE TABLE gate (
  233 |   gate_id TEXT PRIMARY KEY,
  234 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  235 |   profile_id TEXT NOT NULL,
  236 |   profile_version INTEGER NOT NULL,
  237 |   kind TEXT NOT NULL CHECK (kind IN ('checkpoint','verification','review','audit','operator_approval','summary')),
  238 |   required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  239 |   state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','satisfied','waived','failed')),
  240 |   subject_ref TEXT NOT NULL DEFAULT '',
  241 |   updated_at TEXT NOT NULL,
  242 |   FOREIGN KEY (profile_id, profile_version) REFERENCES acceptance_profile(profile_id, version),
  243 |   UNIQUE (work_id, profile_id, profile_version, kind, subject_ref)
  244 | );
  245 | CREATE INDEX gate_work_state ON gate(work_id, state);
  246 | 
  247 | CREATE TABLE checkpoint (
  248 |   checkpoint_id TEXT PRIMARY KEY,
  249 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  250 |   attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  251 |   fence INTEGER NOT NULL,
  252 |   kind TEXT NOT NULL CHECK (kind IN ('progress','blocker','validation_input')),
  253 |   subject_ref TEXT NOT NULL,
  254 |   source_version_id TEXT REFERENCES source_version(source_version_id),
  255 |   output_digest TEXT,
  256 |   detail_json TEXT NOT NULL,
  257 |   created_at TEXT NOT NULL,
  258 |   FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence)
  259 | );
  260 | 
  261 | CREATE TABLE receipt (
  262 |   receipt_id TEXT PRIMARY KEY,
  263 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  264 |   attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  265 |   fence INTEGER NOT NULL,
  266 |   operation_id TEXT NOT NULL,
  267 |   gate_id TEXT REFERENCES gate(gate_id),
  268 |   executable TEXT NOT NULL,
  269 |   argv_json TEXT NOT NULL,
  270 |   cwd TEXT NOT NULL,
  271 |   exit_code INTEGER NOT NULL,
  272 |   started_at TEXT NOT NULL,
  273 |   ended_at TEXT NOT NULL,
  274 |   source_version_id TEXT REFERENCES source_version(source_version_id),
  275 |   config_identity TEXT NOT NULL,
  276 |   environment_fingerprint TEXT NOT NULL,
  277 |   output_digest TEXT,
  278 |   output_ref TEXT,
  279 |   subject_json TEXT NOT NULL,
  280 |   coverage_json TEXT NOT NULL,
  281 |   attestation TEXT NOT NULL CHECK (attestation IN ('boreal_witnessed','external_attested','self_reported','unknown')),
  282 |   result TEXT NOT NULL CHECK (result IN ('passed','failed','rejected','unknown','stale')),
  283 |   rejection_code TEXT,
  284 |   created_at TEXT NOT NULL,
  285 |   FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  286 |   UNIQUE (operation_id),
  287 |   CHECK (ended_at >= started_at),
  288 |   CHECK ((result = 'rejected') = (rejection_code IS NOT NULL))
  289 | );
  290 | CREATE INDEX receipt_subject ON receipt(work_id, attempt_id, fence, result);
  291 | 
  292 | -- External command execution has a lifecycle separate from receipt
  293 | -- persistence.  An operation is admitted here before any process can be
  294 | -- launched.  Incomplete entries are intentionally fail-closed: a retry reads
  295 | -- the journal and must reconcile the unknown outcome instead of launching the
  296 | -- command a second time.
  297 | CREATE TABLE evidence_execution (
  298 |   operation_id TEXT PRIMARY KEY,
  299 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  300 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  301 |   attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  302 |   fence INTEGER NOT NULL CHECK (fence > 0),
  303 |   gate_id TEXT NOT NULL REFERENCES gate(gate_id),
  304 |   actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  305 |   session_id TEXT REFERENCES session(session_id),
  306 |   request_digest TEXT NOT NULL,
  307 |   artifact_ref TEXT NOT NULL UNIQUE,
  308 |   state TEXT NOT NULL CHECK (state IN ('admitted','running','exited','receipt_committed','unknown')),
  309 |   admitted_at TEXT NOT NULL,
  310 |   started_at TEXT,
  311 |   exited_at TEXT,
  312 |   exit_code INTEGER,
  313 |   receipt_id TEXT REFERENCES receipt(receipt_id),
  314 |   failure_code TEXT,
  315 |   FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  316 |   CHECK (state <> 'running' OR started_at IS NOT NULL),
  317 |   CHECK (state NOT IN ('exited','receipt_committed') OR exited_at IS NOT NULL),
  318 |   CHECK (state <> 'receipt_committed' OR receipt_id IS NOT NULL)
  319 | );
  320 | CREATE INDEX evidence_execution_subject
  321 |   ON evidence_execution(work_id, attempt_id, fence, state);
  322 | 
  323 | CREATE TABLE review (
  324 |   review_id TEXT PRIMARY KEY,
  325 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  326 |   attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  327 |   fence INTEGER NOT NULL,
  328 |   gate_id TEXT REFERENCES gate(gate_id),
  329 |   reviewer_actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  330 |   decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
  331 |   reason TEXT NOT NULL,
  332 |   source_version_id TEXT REFERENCES source_version(source_version_id),
  333 |   policy_digest TEXT NOT NULL,
  334 |   created_at TEXT NOT NULL,
  335 |   FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence)
  336 | );
  337 | 
  338 | CREATE TABLE summary (
  339 |   summary_id TEXT PRIMARY KEY,
  340 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  341 |   attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  342 |   fence INTEGER NOT NULL,
  343 |   subject_ref TEXT NOT NULL,
  344 |   source_version_id TEXT REFERENCES source_version(source_version_id),
  345 |   config_identity TEXT NOT NULL,
  346 |   profile_id TEXT NOT NULL,
  347 |   profile_version INTEGER NOT NULL,
  348 |   body_digest TEXT NOT NULL,
  349 |   body_size INTEGER NOT NULL CHECK (body_size > 0 AND body_size <= 65536),
  350 |   current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0,1)),
  351 |   created_at TEXT NOT NULL,
  352 |   FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  353 |   FOREIGN KEY (profile_id, profile_version) REFERENCES acceptance_profile(profile_id, version)
  354 | );
  355 | CREATE UNIQUE INDEX summary_current_work ON summary(work_id) WHERE current = 1;
  356 | 
  357 | CREATE TABLE close_intent (
  358 |   close_intent_id TEXT PRIMARY KEY,
  359 |   work_id TEXT NOT NULL REFERENCES work_item(work_id),
  360 |   attempt_id TEXT NOT NULL REFERENCES attempt(attempt_id),
  361 |   fence INTEGER NOT NULL,
  362 |   operation_id TEXT NOT NULL UNIQUE,
  363 |   source_version_id TEXT REFERENCES source_version(source_version_id),
  364 |   config_identity TEXT NOT NULL,
  365 |   profile_id TEXT NOT NULL,
  366 |   profile_version INTEGER NOT NULL,
  367 |   summary_id TEXT REFERENCES summary(summary_id),
  368 |   state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','invalidated','finalized','rejected')),
  369 |   created_at TEXT NOT NULL,
  370 |   finalized_at TEXT,
  371 |   invalidated_at TEXT,
  372 |   invalidation_code TEXT,
  373 |   FOREIGN KEY (work_id, fence) REFERENCES attempt(work_id, fence),
  374 |   FOREIGN KEY (profile_id, profile_version) REFERENCES acceptance_profile(profile_id, version),
  375 |   CHECK (state <> 'invalidated' OR (invalidated_at IS NOT NULL AND invalidation_code IS NOT NULL)),
  376 |   CHECK (state <> 'finalized' OR finalized_at IS NOT NULL)
  377 | );
  378 | CREATE UNIQUE INDEX close_intent_open_work ON close_intent(work_id) WHERE state = 'open';
  379 | 
  380 | CREATE TABLE operation (
  381 |   operation_id TEXT PRIMARY KEY,
  382 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  383 |   command TEXT NOT NULL,
  384 |   actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  385 |   session_id TEXT REFERENCES session(session_id),
  386 |   expected_revision INTEGER,
  387 |   attempt_id TEXT,
  388 |   fence INTEGER,
  389 |   request_digest TEXT NOT NULL,
  390 |   outcome TEXT NOT NULL CHECK (outcome IN ('changed','unchanged','rejected','conflict','busy','failed','unknown')),
  391 |   result_json TEXT NOT NULL,
  392 |   revision INTEGER NOT NULL CHECK (revision >= 0),
  393 |   created_at TEXT NOT NULL,
  394 |   completed_at TEXT,
  395 |   UNIQUE (operation_id, request_digest)
  396 | );
  397 | 
  398 | CREATE TABLE audit_event (
  399 |   event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  400 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  401 |   revision INTEGER NOT NULL CHECK (revision > 0),
  402 |   operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id),
  403 |   event_type TEXT NOT NULL CHECK (event_type IN ('work.created','work.published','work.closed','work.blocked','work.paused','work.resumed','work.cancelled','work.reopened','attempt.claimed','attempt.accepted','attempt.started','attempt.submitted','attempt.released','attempt.failed','attempt.expiry_pending','attempt.expired','expiry.resolved','lease.renewed','receipt.recorded','receipt.rejected','review.accepted','review.rejected','close.requested','gate.satisfied','hold.resolved','repair.correction','repair.supersession')),
  404 |   subject_type TEXT NOT NULL CHECK (subject_type IN ('work','attempt','receipt','review','gate','hold','dependency','summary','operation','project')),
  405 |   subject_id TEXT NOT NULL,
  406 |   actor_id TEXT NOT NULL REFERENCES actor(actor_id),
  407 |   session_id TEXT REFERENCES session(session_id),
  408 |   fence INTEGER CHECK (fence IS NULL OR fence > 0),
  409 |   as_of TEXT NOT NULL,
  410 |   payload_json TEXT NOT NULL,
  411 |   UNIQUE (project_id, revision)
  412 | );
  413 | CREATE INDEX audit_revision ON audit_event(project_id, revision);
  414 | 
  415 | CREATE TABLE memory_publication (
  416 |   publication_id TEXT PRIMARY KEY,
  417 |   project_id TEXT NOT NULL REFERENCES project(project_id),
  418 |   memory_entry_id TEXT NOT NULL,
  419 |   source_version_id TEXT NOT NULL REFERENCES source_version(source_version_id),
  420 |   state TEXT NOT NULL CHECK (state IN ('draft','publishing','published','failed')),
  421 |   manifest_path TEXT NOT NULL,
  422 |   git_revision TEXT,
  423 |   content_digest TEXT NOT NULL,
  424 |   error_code TEXT,
  425 |   created_at TEXT NOT NULL,
  426 |   updated_at TEXT NOT NULL
  427 | );
  428 | 
  429 | CREATE TABLE blob (
  430 |   blob_digest TEXT PRIMARY KEY,
  431 |   byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
  432 |   media_type TEXT NOT NULL,
  433 |   path TEXT NOT NULL,
  434 |   verified_at TEXT,
  435 |   created_at TEXT NOT NULL
  436 | );
  437 | 
  438 | -- Evidence and audit are historical facts, not mutable status projections.
  439 | CREATE TRIGGER receipt_append_only_update BEFORE UPDATE ON receipt BEGIN
  440 |   SELECT RAISE(ABORT, 'receipt_append_only');
  441 | END;
  442 | CREATE TRIGGER receipt_append_only_delete BEFORE DELETE ON receipt BEGIN
  443 |   SELECT RAISE(ABORT, 'receipt_append_only');
  444 | END;
  445 | CREATE TRIGGER audit_append_only_update BEFORE UPDATE ON audit_event BEGIN
  446 |   SELECT RAISE(ABORT, 'audit_append_only');
  447 | END;
  448 | CREATE TRIGGER audit_append_only_delete BEFORE DELETE ON audit_event BEGIN
  449 |   SELECT RAISE(ABORT, 'audit_append_only');
  450 | END;
  451 | 
  452 | CREATE TRIGGER review_no_self_review BEFORE INSERT ON review
  453 | WHEN EXISTS (
  454 |   SELECT 1 FROM attempt
  455 |   WHERE attempt_id = NEW.attempt_id AND actor_id = NEW.reviewer_actor_id
  456 | )
  457 | BEGIN
  458 |   SELECT RAISE(ABORT, 'reviewer_cannot_review_own_attempt');
  459 | END;
  460 | 
  461 | -- Set only after every object above has been created successfully. The store
  462 | -- applies this file inside a transaction for fresh databases.
  463 | PRAGMA user_version = 2;
````
