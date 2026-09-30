use boreal_application::{GlobalManagerApplication, GlobalManagerError};
use serde_json::{Value, json};
use std::sync::{
    Arc, Barrier,
    atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(1);
fn db() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "boreal-global-{}-{}.sqlite",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}
fn call(
    app: &GlobalManagerApplication,
    cmd: &str,
    payload: Value,
    op: &str,
) -> Result<Value, GlobalManagerError> {
    app.execute(cmd, &payload, op)
}

#[test]
fn hierarchy_status_history_replay_and_failed_transition() {
    let path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let project = call(&app, "project add", json!({"name":"Life"}), "project").unwrap();
    let pid = project["id"].as_str().unwrap();
    let milestone = call(
        &app,
        "milestone add",
        json!({"project_id":pid,"title":"Launch"}),
        "milestone",
    )
    .unwrap();
    let task = call(
        &app,
        "task add",
        json!({"project_id":pid,"parent_id":milestone["id"],"title":"Call suppliers"}),
        "task",
    )
    .unwrap();
    let subtask = call(
        &app,
        "subtask add",
        json!({"project_id":pid,"parent_id":task["id"],"title":"Request quote"}),
        "subtask",
    )
    .unwrap();
    call(
        &app,
        "workflow status add",
        json!({"project_id":pid,"status_id":"ready","label":"Ready","category":"completed"}),
        "status",
    )
    .unwrap();
    call(
        &app,
        "todo move",
        json!({"item_id":task["id"],"status_id":"ready"}),
        "move",
    )
    .unwrap();
    call(
        &app,
        "workflow status edit",
        json!({"project_id":pid,"status_id":"ready","label":"Approved"}),
        "rename",
    )
    .unwrap();
    assert!(
        call(
            &app,
            "task add",
            json!({"project_id":pid,"parent_id":subtask["id"],"title":"Invalid child"}),
            "invalid-hierarchy"
        )
        .is_err()
    );
    let rev = app.revision().unwrap();
    assert!(
        call(
            &app,
            "todo add",
            json!({"title":"Bad status","status_id":"missing"}),
            "failed"
        )
        .is_err()
    );
    assert_eq!(app.revision().unwrap(), rev);
    assert!(matches!(
        call(&app, "project add", json!({"name":"Different"}), "project"),
        Err(GlobalManagerError::Conflict(_))
    ));
    let snapshot = call(&app, "snapshot", json!({}), "snapshot").unwrap();
    assert_eq!(snapshot["items"].as_array().unwrap().len(), 3);
    assert!(snapshot["status_history"].as_array().unwrap().len() >= 4);
    assert_eq!(
        snapshot["statuses"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["status_id"] == "ready" && s["project_id"] == pid)
            .unwrap()["label"],
        "Approved"
    );
    drop(app);
    let _ = std::fs::remove_file(path);
}

#[test]
fn blocks_relationships_reject_reverse_cycle_without_revision_change() {
    let path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let first = call(&app, "todo add", json!({"title":"First"}), "first").unwrap();
    let second = call(&app, "todo add", json!({"title":"Second"}), "second").unwrap();
    call(
        &app,
        "relationship add",
        json!({"source_id":first["id"],"target_id":second["id"],"kind":"blocks"}),
        "blocks-first",
    )
    .unwrap();
    let revision = app.revision().unwrap();
    assert!(
        call(
            &app,
            "relationship add",
            json!({"source_id":second["id"],"target_id":first["id"],"kind":"blocks"}),
            "blocks-reverse",
        )
        .is_err()
    );
    assert_eq!(app.revision().unwrap(), revision);
    let snapshot = call(&app, "snapshot", json!({}), "snapshot").unwrap();
    assert_eq!(snapshot["relationships"].as_array().unwrap().len(), 1);
    drop(app);
    let _ = std::fs::remove_file(path);
}

#[test]
fn mixed_blocks_and_depends_on_use_same_prerequisite_direction() {
    let path = db();
    let imported_path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let first = call(&app, "todo add", json!({"title":"Prerequisite"}), "first").unwrap();
    let second = call(&app, "todo add", json!({"title":"Follow-up"}), "second").unwrap();
    call(
        &app,
        "relationship add",
        json!({"source_id":first["id"],"target_id":second["id"],"kind":"blocks"}),
        "blocks",
    )
    .unwrap();
    // “Second depends on first” is the same edge as “first blocks second”.
    call(
        &app,
        "relationship add",
        json!({"source_id":second["id"],"target_id":first["id"],"kind":"depends_on"}),
        "depends-on",
    )
    .unwrap();
    let revision = app.revision().unwrap();
    // “First depends on second” reverses the edge and closes a cycle.
    assert!(
        call(
            &app,
            "relationship add",
            json!({"source_id":first["id"],"target_id":second["id"],"kind":"depends_on"}),
            "mixed-cycle",
        )
        .is_err()
    );
    assert_eq!(app.revision().unwrap(), revision);

    let mut backup = call(&app, "export", json!({}), "export").unwrap();
    backup["relationships"].as_array_mut().unwrap().push(json!({
        "project_id":null,
        "source_id":first["id"],
        "target_id":second["id"],
        "kind":"depends_on"
    }));
    let target = GlobalManagerApplication::open(&imported_path).unwrap();
    assert!(
        call(
            &target,
            "import",
            json!({"snapshot":backup}),
            "invalid-cycle-import",
        )
        .is_err()
    );
    drop(target);
    drop(app);
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(imported_path);
}

#[test]
fn import_is_revision_guarded_and_backup_round_trips() {
    let source = db();
    let target = db();
    let app = GlobalManagerApplication::open(&source).unwrap();
    let project = call(
        &app,
        "project add",
        json!({"name":"Business","folder":"/offline"}),
        "project",
    )
    .unwrap();
    call(
        &app,
        "note add",
        json!({"project_id":project["id"],"title":"Plan","body":"Keep history"}),
        "note",
    )
    .unwrap();
    let backup = call(&app, "export", json!({}), "export").unwrap();
    drop(app);
    let restored = GlobalManagerApplication::open(&target).unwrap();
    call(
        &restored,
        "import",
        json!({"snapshot":backup,"expected_revision":0}),
        "import",
    )
    .unwrap();
    let snapshot = call(&restored, "snapshot", json!({}), "snapshot").unwrap();
    assert_eq!(snapshot["projects"][0]["id"], project["id"]);
    assert_eq!(snapshot["notes"][0]["body"], "Keep history");
    assert_eq!(snapshot["associations"][0]["kind"], "folder");
    assert!(
        call(
            &restored,
            "import",
            json!({"snapshot":backup,"replace":true,"expected_revision":0}),
            "stale-import"
        )
        .is_err()
    );
    drop(restored);
    let _ = std::fs::remove_file(source);
    let _ = std::fs::remove_file(target);
}

#[test]
fn concurrent_bootstrap_revision_guard_admits_one_writer() {
    let path = db();
    let barrier = Arc::new(Barrier::new(2));
    let mut threads = Vec::new();
    for name in ["one", "two"] {
        let path = path.clone();
        let barrier = barrier.clone();
        threads.push(std::thread::spawn(move || {
            let app = GlobalManagerApplication::open(path).unwrap();
            barrier.wait();
            call(
                &app,
                "project add",
                json!({"name":name,"expected_revision":0}),
                name,
            )
            .is_ok()
        }));
    }
    let winners = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .filter(|won| *won)
        .count();
    assert_eq!(winners, 1);
    let app = GlobalManagerApplication::open(&path).unwrap();
    assert_eq!(app.revision().unwrap(), 1);
    drop(app);
    let _ = std::fs::remove_file(path);
}

#[test]
fn unarchive_and_bounded_activity_are_application_operations() {
    let path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let project = call(&app, "project add", json!({"name":"Personal"}), "project").unwrap();
    let item = call(
        &app,
        "todo add",
        json!({"project_id":project["id"],"title":"Remember"}),
        "item",
    )
    .unwrap();
    let note = call(
        &app,
        "note add",
        json!({"project_id":project["id"],"title":"Reference","body":"Useful"}),
        "note",
    )
    .unwrap();
    call(
        &app,
        "project archive",
        json!({"project_id":project["id"]}),
        "project-archive",
    )
    .unwrap();
    call(
        &app,
        "todo archive",
        json!({"item_id":item["id"]}),
        "item-archive",
    )
    .unwrap();
    call(
        &app,
        "note archive",
        json!({"note_id":note["id"]}),
        "note-archive",
    )
    .unwrap();
    call(
        &app,
        "project unarchive",
        json!({"project_id":project["id"]}),
        "project-restore",
    )
    .unwrap();
    call(
        &app,
        "unarchive",
        json!({"item_id":item["id"]}),
        "item-restore",
    )
    .unwrap();
    call(
        &app,
        "note unarchive",
        json!({"note_id":note["id"]}),
        "note-restore",
    )
    .unwrap();
    for index in 0..80 {
        call(
            &app,
            "todo edit",
            json!({"item_id":item["id"],"description":format!("Update {index}")}),
            &format!("edit-{index}"),
        )
        .unwrap();
    }
    let snapshot = call(&app, "snapshot", json!({}), "snapshot").unwrap();
    assert_eq!(snapshot["projects"][0]["archived"], false);
    assert_eq!(snapshot["items"][0]["archived"], false);
    assert_eq!(snapshot["notes"][0]["archived"], false);
    let activity = &snapshot["activity"];
    assert_eq!(activity["limit"], 50);
    assert_eq!(activity["events"].as_array().unwrap().len(), 50);
    assert_eq!(activity["has_more"], true);
    assert!(serde_json::to_vec(&snapshot).unwrap().len() < 1_048_576);
    let first_page = call(
        &app,
        "history",
        json!({"limit":10,"offset":0,"project_id":project["id"]}),
        "history",
    )
    .unwrap();
    assert_eq!(first_page["events"].as_array().unwrap().len(), 10);
    assert_eq!(first_page["total"], 89);
    assert!(first_page["events"][0]["operation_id"].is_string());
    drop(app);
    let _ = std::fs::remove_file(path);
}

#[test]
fn todo_reorder_swaps_adjacent_siblings_and_treats_boundaries_as_noop() {
    let path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let project = call(&app, "project add", json!({"name":"Ordered"}), "project").unwrap();
    let first = call(
        &app,
        "todo add",
        json!({"project_id":project["id"],"title":"First"}),
        "first",
    )
    .unwrap();
    let second = call(
        &app,
        "todo add",
        json!({"project_id":project["id"],"title":"Second"}),
        "second",
    )
    .unwrap();
    let third = call(
        &app,
        "todo add",
        json!({"project_id":project["id"],"title":"Third"}),
        "third",
    )
    .unwrap();
    let initial = call(
        &app,
        "todo list",
        json!({"project_id":project["id"]}),
        "initial",
    )
    .unwrap();
    let before = initial
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        before,
        vec![
            first["id"].as_str().unwrap(),
            second["id"].as_str().unwrap(),
            third["id"].as_str().unwrap()
        ]
    );

    let moved = call(&app, "todo reorder", json!({"item_id":first["id"],"direction":"down","expected_revision":app.revision().unwrap()}), "move-down").unwrap();
    assert_eq!(moved["moved"], true);
    assert_eq!(
        moved["ordered_ids"],
        json!([second["id"], first["id"], third["id"]])
    );
    let after = call(
        &app,
        "todo list",
        json!({"project_id":project["id"]}),
        "after",
    )
    .unwrap();
    assert_eq!(after[0]["id"], second["id"]);
    assert_eq!(after[0]["position"], 0);
    assert_eq!(after[1]["id"], first["id"]);
    assert_eq!(after[1]["position"], 1);
    assert_eq!(after[2]["id"], third["id"]);
    assert_eq!(after[2]["position"], 2);

    let boundary = call(
        &app,
        "todo reorder",
        json!({"item_id":second["id"],"direction":"up"}),
        "move-up-at-top",
    )
    .unwrap();
    assert_eq!(boundary["moved"], false);
    assert_eq!(
        boundary["ordered_ids"],
        json!([second["id"], first["id"], third["id"]])
    );
    let still_ordered = call(
        &app,
        "todo list",
        json!({"project_id":project["id"]}),
        "after-boundary",
    )
    .unwrap();
    assert_eq!(still_ordered[0]["id"], second["id"]);
    assert_eq!(still_ordered[1]["id"], first["id"]);
    assert_eq!(still_ordered[2]["id"], third["id"]);
    drop(app);
    let _ = std::fs::remove_file(path);
}
