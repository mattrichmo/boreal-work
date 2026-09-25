//! Reproducible status-read baseline.
//!
//! This is intentionally a measurement fixture, not a performance regression
//! claim. It records adapter-level prepared statements, rows, decoded text
//! bytes, and wall time for the current canonical status read at several
//! project sizes. The output is consumed by scripts/validation/status.

use boreal_store::SqliteStore;
use serde_json::json;
use std::time::Instant;

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

fn seed_project(store: &SqliteStore) {
    store
        .execute_batch(
            "INSERT INTO project VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0');
             INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{}', 't0');",
        )
        .expect("seed project");
}

fn seed_work(store: &SqliteStore, count: usize) {
    let mut sql = String::with_capacity(count.saturating_mul(190));
    for index in 0..count {
        sql.push_str(&format!(
            "INSERT INTO work_item (
                 work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
                 priority, acceptance_profile_id, acceptance_profile_version,
                 title, description, created_at, updated_at
             ) VALUES ('w-{index:05}', 'p1', 'task', NULL, 'open', 'automatic',
                       {priority}, 'default', 1, 'Benchmark item {index}',
                       'status benchmark fixture', 't0', 't0');\n",
            priority = index % 256
        ));
    }
    store.execute_batch(&sql).expect("seed benchmark work");
}

#[test]
fn emits_status_read_scaling_baseline() {
    let sizes = [100_usize, 1_000, 10_000];
    let mut measurements = Vec::new();
    let mut runtime = None;

    for count in sizes {
        let store = SqliteStore::open_in_memory(SCHEMA).expect("schema opens");
        seed_project(&store);
        if runtime.is_none() {
            runtime = Some(store.sqlite_runtime_identity());
        }
        seed_work(&store, count);
        store.reset_query_metrics();
        let started = Instant::now();
        let status = store
            .read_project_status("p1")
            .expect("status read succeeds");
        let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let metrics = store.query_metrics();
        assert_eq!(status.total as usize, count);
        assert_eq!(status.works.len(), count);
        measurements.push(json!({
            "work_items": count,
            "elapsed_ms": elapsed_ms,
            "statements_prepared": metrics.statements_prepared,
            "batch_calls": metrics.batch_calls,
            "rows_returned": metrics.rows_returned,
            "text_bytes_read": metrics.text_bytes_read,
            "returned_work_items": status.works.len(),
            "returned_dependency_edges": status.dependencies.len(),
        }));
    }

    println!(
        "STATUS_BENCHMARK {}",
        json!({
            "result_version": "boreal.status-read-baseline/1",
            "schema_version": 2,
            "status_contract_version": "boreal.work-status/2",
            "runtime": runtime.expect("benchmark sizes include a runtime").as_json(),
            "measurements": measurements,
            "limitations": [
                "This is one process and one in-memory SQLite connection.",
                "Wall time includes Rust decoding and object construction.",
                "text_bytes_read is decoded text observed by the adapter, not serialized response bytes.",
                "The fixture measures the current full canonical read; it does not claim a bounded-page implementation.",
                "No before/after performance improvement is claimed by this fixture."
            ]
        })
    );
}
