//! Release-facing store acceptance probes.
//!
//! The ordinary workspace suite keeps these checks small and deterministic.
//! The ignored benchmark is deliberately invoked by
//! `scripts/validation/release_performance.py`, so a normal test run does not
//! accidentally spend release-validation time on a 100k-row fixture.

use boreal_store::SqliteStore;
use serde_json::json;
use std::time::Instant;

const SCHEMA_V2: &str = include_str!("../../../project/spec/schema-v2.sql");
const SCHEMA_V3: &str = include_str!("../../../project/spec/schema-v3.sql");
const SQLITE_RUNTIME_FLOOR: (u64, u64, u64) = (3, 51, 3);

fn seed_project(store: &SqliteStore) {
    store
        .execute_batch(
            "INSERT INTO project VALUES ('p1', 2, 'boreal.work-status/2', 0, 't0', 't0');
             INSERT INTO acceptance_profile VALUES ('default', 1, 'sha256:policy', '{}', 't0');",
        )
        .expect("seed release project");
}

fn seed_work(store: &SqliteStore, count: usize) {
    store
        .execute_batch("DELETE FROM work_item")
        .expect("clear release work");
    let mut sql = String::with_capacity(count.saturating_mul(180));
    for index in 0..count {
        sql.push_str(&format!(
            "INSERT INTO work_item (
                 work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
                 priority, acceptance_profile_id, acceptance_profile_version,
                 title, description, created_at, updated_at
             ) VALUES ('release-{index:06}', 'p1', 'task', NULL, 'open', 'automatic',
                       {priority}, 'default', 1, 'Release benchmark item {index}',
                       'bounded status acceptance fixture', 't0', 't0');\n",
            priority = index % 256
        ));
    }
    store
        .execute_batch(&sql)
        .expect("seed release benchmark work");
}

#[test]
fn runtime_floor_is_reported_without_falsifying_support() {
    let store = SqliteStore::open_in_memory(SCHEMA_V2).expect("schema opens");
    let identity = store.sqlite_runtime_identity();
    let meets_floor = identity.at_least(SQLITE_RUNTIME_FLOOR);

    assert!(!identity.libversion.is_empty());
    assert!(!identity.source_id.is_empty());
    assert!(identity.version_tuple().is_some());
    assert_eq!(identity.as_json()["libversion"], identity.libversion);
    assert_eq!(identity.as_json()["source_id"], identity.source_id);

    println!(
        "RELEASE_RUNTIME {}",
        json!({
            "result_version": "boreal.release-runtime/1",
            "runtime": identity.as_json(),
            "required_floor": "3.51.3",
            "meets_floor": meets_floor,
            "policy": "report-and-gate-release; do not claim support when false"
        })
    );
}

#[test]
fn schema_v3_release_contract_reopens_and_preserves_schema2() {
    let store = SqliteStore::open_in_memory(SCHEMA_V2).expect("schema-v2 opens");
    seed_project(&store);
    store
        .apply_schema(SCHEMA_V3)
        .expect("schema-v3 additive migration applies");
    assert_eq!(store.schema_version().unwrap(), 3);
    assert!(store.work_model_v3_enabled().unwrap());
    assert!(store.work("p1", "missing").unwrap().is_none());

    println!(
        "RELEASE_SCHEMA {}",
        json!({
            "result_version": "boreal.release-schema/1",
            "schema_version": store.schema_version().unwrap(),
            "work_model_v3": store.work_model_v3_enabled().unwrap(),
            "schema2_compatibility": "existing schema2 rows and readers remain addressable"
        })
    );
}

#[test]
#[ignore = "release runner invokes this explicitly with 10k/100k sizes"]
fn status_read_release_benchmark_10k_100k() {
    let sizes = std::env::var("BOREAL_RELEASE_BENCH_SIZES")
        .unwrap_or_else(|_| "10000,100000".to_owned())
        .split(',')
        .map(|value| value.trim().parse::<usize>().expect("valid benchmark size"))
        .collect::<Vec<_>>();
    assert!(!sizes.is_empty());
    assert!(sizes.iter().all(|size| *size > 0));

    let store = SqliteStore::open_in_memory(SCHEMA_V2).expect("schema opens");
    seed_project(&store);
    let runtime = store.sqlite_runtime_identity();
    let mut measurements = Vec::new();

    for size in sizes {
        seed_work(&store, size);
        store.reset_query_metrics();
        let started = Instant::now();
        let status = store
            .read_project_status("p1")
            .expect("canonical status read succeeds");
        let elapsed_ms = started.elapsed().as_secs_f64() * 1_000.0;
        let metrics = store.query_metrics();
        assert_eq!(status.total as usize, size);
        assert_eq!(status.works.len(), size);
        measurements.push(json!({
            "work_items": size,
            "elapsed_ms": elapsed_ms,
            "statements_prepared": metrics.statements_prepared,
            "batch_calls": metrics.batch_calls,
            "rows_returned": metrics.rows_returned,
            "text_bytes_read": metrics.text_bytes_read,
            "returned_work_items": status.works.len(),
            "returned_dependency_edges": status.dependencies.len()
        }));
    }

    println!(
        "RELEASE_STATUS_BENCHMARK {}",
        json!({
            "result_version": "boreal.release-status/1",
            "schema_version": 2,
            "status_contract_version": "boreal.work-status/2",
            "runtime": runtime.as_json(),
            "measurements": measurements,
            "interpretation": "scaling baseline only; full canonical read is not proof of bounded-page database work",
            "limitations": [
                "one process and one in-memory SQLite connection",
                "wall time includes Rust decoding and object construction",
                "no TUI, service, concurrent writer, or serialized protocol payload",
                "no before/after optimization claim"
            ]
        })
    );
}
