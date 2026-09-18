//! Executable coverage for the additive `boreal.work-model/3` schema artifact.
//!
//! These tests intentionally apply schema-v3.sql manually after schema-v2.
//! The store runtime is still schema-2-only; this proves the SQL contract and
//! records the exact invariants the future store/application adapter must
//! preserve before it advertises version 3.

use boreal_store::SqliteStore;

const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");
const SCHEMA_V3: &str = include_str!("../../../project/spec/schema-v3.sql");

fn store_v3() -> SqliteStore {
    let store = SqliteStore::open_in_memory(SCHEMA_V2).expect("schema-v2 opens");
    store
        .execute_batch(SCHEMA_V3)
        .expect("schema-v3 additive migration applies");
    assert_eq!(store.schema_version().unwrap(), 3);
    store
}

fn seed_base(store: &SqliteStore) {
    store
        .execute_batch(
            "
            INSERT INTO project VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0');
            INSERT INTO actor VALUES ('agent-1', 'agent', 'cred-agent', 'Agent', 't0');
            INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{}', 't0');
            INSERT INTO work_item (
                work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
                acceptance_profile_id, acceptance_profile_version, title,
                description, created_at, updated_at
            ) VALUES
              ('milestone-1', 'p1', 'milestone', NULL, 'open', 'automatic',
               'default', 1, 'Milestone', '', 't0', 't0'),
              ('container-1', 'p1', 'task', NULL, 'open', 'automatic',
               'default', 1, 'Container 1', '', 't0', 't0'),
              ('container-2', 'p1', 'task', NULL, 'open', 'automatic',
               'default', 1, 'Container 2', '', 't0', 't0'),
              ('direct-a', 'p1', 'task', NULL, 'open', 'automatic',
               'default', 1, 'Direct A', '', 't0', 't0'),
              ('direct-b', 'p1', 'task', NULL, 'open', 'automatic',
               'default', 1, 'Direct B', '', 't0', 't0'),
              ('legacy-sprint', 'p1', 'sprint', NULL, 'open', 'automatic',
               'default', 1, 'Legacy Sprint', '', 't0', 't0');
            ",
        )
        .expect("schema-v2 fixture data inserts");
}

fn seed_nodes(store: &SqliteStore) {
    store
        .execute_batch(
            "
            INSERT INTO work_node_v3
                (work_id, project_id, decomposition_kind, execution_mode,
                 parent_id, created_at, updated_at)
            VALUES
              ('milestone-1', 'p1', 'milestone', 'container', NULL, 't0', 't0'),
              ('container-1', 'p1', 'task', 'container', 'milestone-1', 't0', 't0'),
              ('container-2', 'p1', 'task', 'container', 'container-1', 't0', 't0'),
              ('direct-a', 'p1', 'task', 'direct', 'container-1', 't0', 't0'),
              ('direct-b', 'p1', 'task', 'direct', 'container-2', 't0', 't0');
            ",
        )
        .expect("v3 nodes insert");
}

fn reject(store: &SqliteStore, sql: &str, expected_message: &str) {
    let error = store
        .execute_batch(sql)
        .expect_err("statement should violate a v3 invariant");
    let rendered = error.to_string();
    assert!(
        rendered.contains(expected_message),
        "expected {expected_message:?} in {rendered:?} ({error:?})"
    );
}

#[test]
fn schema_v3_is_a_versioned_additive_extension_of_schema_v2() {
    let store = store_v3();
    seed_base(&store);

    // The original v2 tables and their semantics remain available.  In
    // particular, v2 dependency rows are not silently reinterpreted as the
    // stricter v3 direct-task graph.
    store
        .execute_batch(
            "INSERT INTO dependency (
                 project_id, prerequisite_id, dependent_id, created_at
             ) VALUES ('p1', 'milestone-1', 'direct-a', 't0');",
        )
        .expect("schema-v2 dependency semantics remain intact");

    store
        .execute_batch(
            "INSERT INTO work_model_v3_meta
                 (schema_id, schema_version, base_schema_version,
                  contract_version, created_at)
             VALUES ('another', 3, 2, 'boreal.work-model/3', 't0');",
        )
        .expect_err("the v3 metadata identity is singleton and fixed");
    assert_eq!(store.schema_version().unwrap(), 3);
    assert!(store.work("p1", "milestone-1").unwrap().is_some());
}

#[test]
fn hierarchy_separates_cycles_and_rejects_sprint_or_direct_task_children() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);

    reject(
        &store,
        "INSERT INTO work_node_v3
             (work_id, project_id, decomposition_kind, execution_mode,
              parent_id, created_at, updated_at)
         VALUES ('legacy-sprint', 'p1', 'task', 'direct', NULL, 't0', 't0');",
        "work_node_v3_kind_mismatch",
    );

    reject(
        &store,
        "INSERT INTO work_node_v3
             (work_id, project_id, decomposition_kind, execution_mode,
              parent_id, created_at, updated_at)
         VALUES ('direct-child', 'p1', 'task', 'direct', 'direct-a', 't0', 't0');",
        "work_node_v3_invalid_parent",
    );
    reject(
        &store,
        "UPDATE work_node_v3
         SET parent_id = 'container-2' WHERE work_id = 'container-1';",
        "work_node_v3_hierarchy_cycle",
    );
    reject(
        &store,
        "UPDATE work_node_v3
         SET execution_mode = 'direct' WHERE work_id = 'container-1';",
        "work_node_v3_invalid_retype",
    );

    store
        .execute_batch(
            "INSERT INTO cycle_series_v3
                 (series_id, project_id, name, lifecycle, timezone,
                  tzdb_identity, created_at, updated_at)
             VALUES ('series-1', 'p1', 'Weekly delivery', 'active',
                     'America/Regina', 'tzdb-2026a', 't0', 't0');
             INSERT INTO cycle_template_v3
                 (template_version_id, project_id, series_id, version,
                  effective_from_slot_ordinal, interval_weeks,
                  anchor_local_date, anchor_local_time, anchor_weekday,
                  recurrence_end_kind, recurrence_end_count,
                  recurrence_end_local_date, name_pattern, goal_template,
                  timezone, tzdb_identity, gap_policy, fold_policy, created_at)
             VALUES ('template-1', 'p1', 'series-1', 1, 0, 1,
                     '2026-09-21', '09:00:00', 1, 'never', NULL, NULL,
                     'Cycle {slot}', 'Ship the slice', 'America/Regina',
                     'tzdb-2026a', 'next_valid', 'earlier_offset', 't0');
             INSERT INTO cycle_template_weekday_v3
                 (project_id, template_version_id, weekday)
             VALUES ('p1', 'template-1', 1), ('p1', 'template-1', 3);
             INSERT INTO cycle_v3
                 (cycle_id, project_id, series_id, template_version_id,
                  slot_ordinal, slot_key, name, lifecycle,
                  scheduled_start_utc_ms, scheduled_end_utc_ms,
                  scheduled_start_local, scheduled_start_utc_offset_minutes,
                  timezone, tzdb_identity, gap_policy, fold_policy,
                  created_at, updated_at)
             VALUES ('cycle-1', 'p1', 'series-1', 'template-1', 7,
                     'boreal.cycle-slot/1/series-1/7', 'Cycle 7', 'planned',
                     1790000000000, 1790043200000, '2026-09-21T09:00:00',
                     -360, 'America/Regina', 'tzdb-2026a', 'next_valid',
                     'earlier_offset', 't0', 't0');
             INSERT INTO cycle_assignment_v3
                 (assignment_id, project_id, cycle_id, work_id, state,
                  activation_policy, activation_at_utc_ms, created_at, updated_at)
             VALUES ('assignment-1', 'p1', 'cycle-1', 'direct-a', 'planned',
                     'at_cycle_start', NULL, 't0', 't0');",
        )
        .expect("cycle recurrence and direct assignment insert");

    reject(
        &store,
        "INSERT INTO cycle_v3
             (cycle_id, project_id, series_id, template_version_id,
              slot_ordinal, slot_key, name, lifecycle,
              scheduled_start_utc_ms, scheduled_end_utc_ms,
              scheduled_start_local, scheduled_start_utc_offset_minutes,
              timezone, tzdb_identity, gap_policy, fold_policy,
              created_at, updated_at)
         VALUES ('cycle-bad-slot', 'p1', 'series-1', 'template-1', 8,
                 'not-a-slot', 'Bad', 'planned', 1790000000000, NULL,
                 '2026-09-28T09:00:00', -360, 'America/Regina', 'tzdb-2026a',
                 'next_valid', 'earlier_offset', 't0', 't0');",
        "CHECK constraint failed",
    );

    reject(
        &store,
        "INSERT INTO cycle_assignment_v3
             (assignment_id, project_id, cycle_id, work_id, state,
              activation_policy, activation_at_utc_ms, created_at, updated_at)
         VALUES ('assignment-container', 'p1', 'cycle-1', 'container-1',
                 'planned', 'at_cycle_start', NULL, 't0', 't0');",
        "cycle_assignment_v3_requires_direct_task",
    );
}

#[test]
fn direct_task_dependencies_are_separate_and_dag_safe() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);

    store
        .execute_batch(
            "INSERT INTO work_dependency_v3
                 (project_id, prerequisite_work_id, dependent_work_id, created_at)
             VALUES ('p1', 'direct-a', 'direct-b', 't0');",
        )
        .expect("direct-task edge inserts");

    reject(
        &store,
        "INSERT INTO work_dependency_v3
             (project_id, prerequisite_work_id, dependent_work_id, created_at)
         VALUES ('p1', 'container-1', 'direct-b', 't0');",
        "work_dependency_v3_requires_direct_tasks",
    );
    reject(
        &store,
        "INSERT INTO work_dependency_v3
             (project_id, prerequisite_work_id, dependent_work_id, created_at)
         VALUES ('p1', 'direct-b', 'direct-a', 't0');",
        "work_dependency_v3_cycle",
    );

    reject(
        &store,
        "INSERT INTO work_dependency_v3
             (project_id, prerequisite_work_id, dependent_work_id, policy,
              exception_reason, approved_by, created_at)
         VALUES ('p1', 'direct-a', 'direct-b', 'explicit_exception',
                 'missing approval', NULL, 't0');",
        "CHECK constraint failed",
    );
}

#[test]
fn recurrence_fields_capture_resolved_timezone_and_template_identity() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);

    store
        .execute_batch(
            "INSERT INTO cycle_series_v3
                 (series_id, project_id, name, lifecycle, timezone,
                  tzdb_identity, created_at, updated_at)
             VALUES ('series-2', 'p1', 'Biweekly review', 'active',
                     'America/New_York', 'tzdb-2026a', 't0', 't0');
             INSERT INTO cycle_template_v3
                 (template_version_id, project_id, series_id, version,
                  effective_from_slot_ordinal, interval_weeks,
                  anchor_local_date, anchor_local_time, anchor_weekday,
                  recurrence_end_kind, recurrence_end_count,
                  recurrence_end_local_date, name_pattern, goal_template,
                  timezone, tzdb_identity, gap_policy, fold_policy, created_at)
             VALUES ('template-2', 'p1', 'series-2', 4, 12, 2,
                     '2026-09-27', '23:59:00', 7, 'count', 8, NULL,
                     'Review {slot}', 'Review outcomes', 'America/New_York',
                     'tzdb-2026a', 'next_valid', 'later_offset', 't0');
             INSERT INTO cycle_template_weekday_v3
                 (project_id, template_version_id, weekday)
             VALUES ('p1', 'template-2', 7);
             INSERT INTO cycle_v3
                 (cycle_id, project_id, series_id, template_version_id,
                  slot_ordinal, slot_key, name, goal, lifecycle,
                  scheduled_start_utc_ms, scheduled_end_utc_ms,
                  scheduled_start_local, scheduled_start_utc_offset_minutes,
                  timezone, tzdb_identity, gap_policy, fold_policy,
                  created_at, updated_at)
             VALUES ('cycle-2', 'p1', 'series-2', 'template-2', 12,
                     'boreal.cycle-slot/1/series-2/12', 'Review 12',
                     'Review outcomes', 'planned', 1790000000000,
                     1790000060000, '2026-09-27T23:59:00', -240,
                     'America/New_York', 'tzdb-2026a', 'next_valid', 'later_offset',
                     't0', 't0');",
        )
        .expect("biweekly recurrence fixture inserts");

    reject(
        &store,
        "INSERT INTO cycle_template_v3
             (template_version_id, project_id, series_id, version,
              effective_from_slot_ordinal, interval_weeks,
              anchor_local_date, anchor_local_time, anchor_weekday,
              recurrence_end_kind, recurrence_end_count,
              recurrence_end_local_date, name_pattern, goal_template,
              timezone, tzdb_identity, gap_policy, fold_policy, created_at)
         VALUES ('template-bad', 'p1', 'series-2', 5, 13, 0,
                 '2026-09-27', '23:59:00', 7, 'count', 0, NULL, 'Bad', '',
                 'America/New_York', 'tzdb-2026a', 'next_valid',
                 'later_offset', 't0');",
        "CHECK constraint failed",
    );
}

#[test]
fn intake_promotion_binds_content_revision_and_digest() {
    let store = store_v3();
    seed_base(&store);

    store
        .execute_batch(
            "INSERT INTO intake_bucket_v3
                 (bucket_id, project_id, name, created_at, updated_at)
             VALUES ('bucket-1', 'p1', 'Inbox', 't0', 't0');
             INSERT INTO intake_item_v3
                 (intake_id, project_id, bucket_id, kind, lifecycle, content,
                  content_revision, content_digest, captured_at, updated_at)
             VALUES ('intake-1', 'p1', 'bucket-1', 'discovery', 'captured',
                     'Found a reproducible edge case', 1, 'sha256:intake-a',
                     't0', 't0');
             INSERT INTO intake_promotion_v3
                 (promotion_id, project_id, intake_id, intake_revision,
                  intake_digest, target_kind, target_id, actor_id,
                  operation_id, created_at)
             VALUES ('promotion-1', 'p1', 'intake-1', 1, 'sha256:intake-a',
                     'draft_work', 'draft-1', 'agent-1', 'op-1', 't0');",
        )
        .expect("matching promotion provenance inserts");

    reject(
        &store,
        "INSERT INTO intake_promotion_v3
             (promotion_id, project_id, intake_id, intake_revision,
              intake_digest, target_kind, target_id, actor_id,
              operation_id, created_at)
         VALUES ('promotion-stale', 'p1', 'intake-1', 2, 'sha256:intake-b',
                 'memory_draft', 'memory-1', 'agent-1', 'op-stale', 't0');",
        "intake_promotion_v3_stale_provenance",
    );
    reject(
        &store,
        "INSERT INTO intake_item_v3
             (intake_id, project_id, bucket_id, kind, lifecycle, content,
              content_revision, content_digest, captured_at, updated_at)
         VALUES ('intake-deferred', 'p1', 'bucket-1', 'revisit', 'deferred',
                 'Come back later', 1, 'sha256:later', 't0', 't0');",
        "CHECK constraint failed",
    );

    store
        .execute_batch(
            "UPDATE intake_item_v3
             SET content = 'Found a narrower edge case',
                 content_revision = 2,
                 content_digest = 'sha256:intake-b',
                 updated_at = 't1'
             WHERE intake_id = 'intake-1';",
        )
        .expect("content revision advances with a new digest");

    reject(
        &store,
        "INSERT INTO intake_promotion_v3
             (promotion_id, project_id, intake_id, intake_revision,
              intake_digest, target_kind, target_id, actor_id,
              operation_id, created_at)
         VALUES ('promotion-old', 'p1', 'intake-1', 1, 'sha256:intake-a',
                 'source_version', 'source-1', 'agent-1', 'op-old', 't1');",
        "intake_promotion_v3_stale_provenance",
    );

    reject(
        &store,
        "UPDATE intake_item_v3
         SET content = 'Untracked edit', content_revision = 4,
             content_digest = 'sha256:intake-c'
         WHERE intake_id = 'intake-1';",
        "intake_item_v3_revision_digest_mismatch",
    );

    store
        .execute_batch(
            "INSERT INTO intake_promotion_v3
                 (promotion_id, project_id, intake_id, intake_revision,
                  intake_digest, target_kind, target_id, actor_id,
                  operation_id, created_at)
             VALUES ('promotion-2', 'p1', 'intake-1', 2, 'sha256:intake-b',
                     'memory_draft', 'memory-1', 'agent-1', 'op-2', 't1');",
        )
        .expect("new promotion binds the new content revision");

    reject(
        &store,
        "DELETE FROM intake_promotion_v3 WHERE promotion_id = 'promotion-1';",
        "intake_promotion_v3_append_only",
    );
}

#[test]
fn container_dispositions_are_append_only_chain_tips() {
    let store = store_v3();
    seed_base(&store);
    seed_nodes(&store);

    store
        .execute_batch(
            "INSERT INTO container_disposition_v3
                 (disposition_id, project_id, container_work_id,
                  descendant_work_id, kind, descendant_revision,
                  descendant_outcome_digest, created_at)
             VALUES ('disposition-1', 'p1', 'container-1', 'direct-a',
                     'accepted_closed', 7, 'sha256:outcome-a', 't0');",
        )
        .expect("initial disposition inserts");

    reject(
        &store,
        "UPDATE container_disposition_v3
         SET kind = 'deferred' WHERE disposition_id = 'disposition-1';",
        "container_disposition_v3_append_only",
    );
    reject(
        &store,
        "DELETE FROM container_disposition_v3
         WHERE disposition_id = 'disposition-1';",
        "container_disposition_v3_append_only",
    );
    reject(
        &store,
        "INSERT INTO container_disposition_v3
             (disposition_id, project_id, container_work_id,
              descendant_work_id, kind, descendant_revision,
              descendant_outcome_digest, created_at)
         VALUES ('disposition-duplicate', 'p1', 'container-1', 'direct-a',
                 'accepted_cancelled', 8, 'sha256:outcome-b', 't1');",
        "container_disposition_v3_current_exists",
    );

    store
        .execute_batch(
            "INSERT INTO container_disposition_v3
                 (disposition_id, project_id, container_work_id,
                  descendant_work_id, kind, descendant_revision,
                  descendant_outcome_digest, replacement_work_id, reason,
                  supersedes_id, created_at)
             VALUES ('disposition-2', 'p1', 'container-1', 'direct-a',
                     'replaced', 9, 'sha256:outcome-c', 'direct-b',
                     'replacement approved', 'disposition-1', 't2');",
        )
        .expect("replacement disposition supersedes the current tip");

    reject(
        &store,
        "INSERT INTO container_disposition_v3
             (disposition_id, project_id, container_work_id,
              descendant_work_id, kind, descendant_revision,
              descendant_outcome_digest, supersedes_id, created_at)
         VALUES ('disposition-3', 'p1', 'container-1', 'direct-a',
                 'accepted_closed', 10, 'sha256:outcome-d',
                 'disposition-1', 't3');",
        "container_disposition_v3_invalid_supersedes",
    );
    reject(
        &store,
        "INSERT INTO container_disposition_v3
             (disposition_id, project_id, container_work_id,
              descendant_work_id, kind, descendant_revision,
              descendant_outcome_digest, created_at)
         VALUES ('disposition-outside', 'p1', 'container-2', 'direct-a',
                 'accepted_closed', 1, 'sha256:outside', 't3');",
        "container_disposition_v3_invalid_subject",
    );
    reject(
        &store,
        "INSERT INTO container_disposition_v3
             (disposition_id, project_id, container_work_id,
              descendant_work_id, kind, descendant_revision,
              descendant_outcome_digest, replacement_work_id, created_at)
         VALUES ('disposition-bad-shape', 'p1', 'container-1', 'direct-b',
                 'accepted_closed', 1, 'sha256:bad', 'direct-a', 't3');",
        "CHECK constraint failed",
    );
}
