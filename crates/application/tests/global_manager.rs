use boreal_application::{GlobalManagerApplication, GlobalManagerError};
use boreal_store::global_manager::GlobalManagerStore;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Barrier,
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
    assert!(call(
        &app,
        "task add",
        json!({"project_id":pid,"parent_id":subtask["id"],"title":"Invalid child"}),
        "invalid-hierarchy"
    )
    .is_err());
    let rev = app.revision().unwrap();
    assert!(call(
        &app,
        "todo add",
        json!({"title":"Bad status","status_id":"missing"}),
        "failed"
    )
    .is_err());
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
fn bounded_snapshot_pages_search_and_preserves_large_notes_for_export() {
    let path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let project = call(&app, "project add", json!({"name":"Large"}), "p").unwrap();
    let body = "x".repeat(100_000);
    for n in 0..12 {
        call(
            &app,
            "note add",
            json!({"project_id":project["id"],"title":format!("Note {n}"),"body":body}),
            &format!("n{n}"),
        )
        .unwrap();
    }
    let snapshot = call(&app, "snapshot", json!({}), "snap").unwrap();
    assert_eq!(snapshot["totals"]["notes"], 12);
    assert!(snapshot["notes"][0].get("body").is_none());
    assert!(serde_json::to_vec(&snapshot).unwrap().len() < 1024 * 1024);
    let notes_page = call(
        &app,
        "detail page",
        json!({"collection":"notes","limit":50,"offset":0}),
        "all-notes-page",
    )
    .unwrap();
    assert_eq!(notes_page["total"], 12);
    assert_eq!(notes_page["rows"].as_array().unwrap().len(), 12);
    assert!(notes_page["rows"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row.get("body").is_none()));
    assert!(serde_json::to_vec(&notes_page).unwrap().len() < 1024 * 1024);
    let page = call(
        &app,
        "detail page",
        json!({"collection":"notes","query":"note 1","limit":5,"offset":0}),
        "page",
    )
    .unwrap();
    assert_eq!(page["total"], 3);
    assert_eq!(page["rows"].as_array().unwrap().len(), 3);
    let full = call(
        &app,
        "note show",
        json!({"note_id":page["rows"][0]["id"]}),
        "show",
    )
    .unwrap();
    assert_eq!(full["body"].as_str().unwrap().len(), 100_000);
    let backup = call(&app, "export", json!({}), "backup").unwrap();
    assert_eq!(backup["notes"].as_array().unwrap().len(), 12);
    let restore_path = db();
    let restore = GlobalManagerApplication::open(&restore_path).unwrap();
    call(&restore, "import", json!({"snapshot":backup}), "import-one").unwrap();
    call(
        &restore,
        "import",
        json!({"snapshot":backup,"replace":true,"expected_revision":1}),
        "import-two",
    )
    .unwrap();
    let history_page = call(
        &restore,
        "detail page",
        json!({"collection":"imported_history","limit":10}),
        "history-page",
    )
    .unwrap();
    assert!(history_page["total"].as_u64().unwrap() > 2);
    assert!(history_page["rows"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row.get("snapshot").is_none()));
    assert!(serde_json::to_vec(&history_page).unwrap().len() < 1024 * 1024);
    drop(restore);
    let _ = std::fs::remove_file(restore_path);
    drop(app);
    let _ = std::fs::remove_file(path);
}

#[test]
fn exact_association_read_reaches_records_beyond_snapshot_window() {
    let path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let project = call(&app, "project add", json!({"name":"Portfolio"}), "project").unwrap();
    let project_id = project["id"].as_str().unwrap();
    let mut backup = call(&app, "export", json!({}), "export").unwrap();
    backup["associations"] = json!((0..101)
        .map(|n| json!({
            "project_id": project_id,
            "kind": "workspace",
            "identity": format!("workspace-{n}"),
            "path": format!("/workspaces/{n}"),
            "updated_at": "2026-09-30T00:00:00Z"
        }))
        .collect::<Vec<_>>());
    call(
        &app,
        "import",
        json!({"snapshot":backup,"replace":true,"expected_revision":1}),
        "import-large-association-set",
    )
    .unwrap();

    let snapshot = call(&app, "snapshot", json!({}), "summary").unwrap();
    assert_eq!(snapshot["totals"]["associations"], 101);
    assert_eq!(snapshot["associations"].as_array().unwrap().len(), 100);
    assert!(!snapshot["associations"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["identity"] == "workspace-100"));

    let association = call(
        &app,
        "association show",
        json!({"project_id":project_id,"kind":"workspace","identity":"workspace-100"}),
        "read-last-association",
    )
    .unwrap();
    assert_eq!(association["path"], "/workspaces/100");
    assert!(call(
        &app,
        "association show",
        json!({"project_id":project_id,"kind":"workspace","identity":"missing"}),
        "missing-association",
    )
    .is_err());

    drop(app);
    let _ = std::fs::remove_file(path);
}

#[test]
fn waiting_follow_up_is_separate_from_due_date_and_survives_snapshot() {
    let path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let item = call(
        &app,
        "todo add",
        json!({"title":"Call back","due_at":"2026-10-02","follow_up_at":"2026-10-03"}),
        "follow-up",
    )
    .unwrap();
    assert_eq!(item["due_at"], "2026-10-02");
    assert_eq!(item["follow_up_at"], "2026-10-03");
    let snapshot = call(&app, "snapshot", json!({}), "snapshot").unwrap();
    assert_eq!(snapshot["items"][0]["follow_up_at"], "2026-10-03");
    drop(app);
    let _ = std::fs::remove_file(path);
}

#[test]
fn bulk_triage_is_atomic_and_restorable_with_relationships() {
    let source = db();
    let target = db();
    let app = GlobalManagerApplication::open(&source).unwrap();
    let a = call(&app, "project add", json!({"name":"A"}), "a").unwrap();
    let b = call(&app, "project add", json!({"name":"B"}), "b").unwrap();
    let first = call(
        &app,
        "todo add",
        json!({"project_id":a["id"],"title":"First"}),
        "first",
    )
    .unwrap();
    let second = call(
        &app,
        "todo add",
        json!({"project_id":a["id"],"title":"Second"}),
        "second",
    )
    .unwrap();
    call(
        &app,
        "relationship add",
        json!({"source_id":first["id"],"target_id":second["id"],"kind":"related"}),
        "edge",
    )
    .unwrap();
    let revision = app.revision().unwrap();
    let split = call(
        &app,
        "todo bulk triage",
        json!({"expected_revision":revision,"changes":[{"item_id":first["id"],"project_id":b["id"],"parent_id":null,"status_id":"todo"}]}),
        "split",
    );
    assert!(split.is_err());
    assert_eq!(app.revision().unwrap(), revision);
    let bad_mapping = call(
        &app,
        "todo bulk triage",
        json!({"expected_revision":revision,"changes":[{"item_id":first["id"],"project_id":b["id"],"parent_id":null,"status_id":"missing"},{"item_id":second["id"],"project_id":b["id"],"parent_id":null,"status_id":"todo"}]}),
        "bad-map",
    );
    assert!(bad_mapping.is_err());
    assert_eq!(app.revision().unwrap(), revision);
    let moved = call(&app, "todo bulk triage", json!({"expected_revision":revision,"changes":[{"item_id":first["id"],"project_id":b["id"],"parent_id":null,"status_id":"todo"},{"item_id":second["id"],"project_id":b["id"],"parent_id":null,"status_id":"todo"}]}), "move-pair").unwrap();
    assert_eq!(moved["changed"], 2);
    assert_eq!(moved["project_id"], b["id"]);
    assert_eq!(moved["item_id"], first["id"]);
    let activity = call(&app, "history", json!({"entity_id":first["id"]}), "history").unwrap();
    assert_eq!(activity["events"][0]["project_id"], b["id"]);
    assert_eq!(activity["events"][0]["entity_id"], first["id"]);
    let backup = call(&app, "export", json!({}), "backup").unwrap();
    let restored = GlobalManagerApplication::open(&target).unwrap();
    call(&restored, "import", json!({"snapshot":backup}), "restore").unwrap();
    assert_eq!(
        call(
            &restored,
            "relationship list",
            json!({"project_id":b["id"]}),
            "edges"
        )
        .unwrap()
        .as_array()
        .unwrap()
        .len(),
        1
    );
    drop(restored);
    drop(app);
    let _ = std::fs::remove_file(source);
    let _ = std::fs::remove_file(target);
}

#[test]
fn note_links_are_owner_checked_readable_and_exportable() {
    let source = db();
    let target = db();
    let app = GlobalManagerApplication::open(&source).unwrap();
    let project = call(&app, "project add", json!({"name":"Notes"}), "p").unwrap();
    let other = call(&app, "project add", json!({"name":"Other"}), "other").unwrap();
    let item = call(
        &app,
        "todo add",
        json!({"project_id":project["id"],"title":"Action"}),
        "item",
    )
    .unwrap();
    let note = call(
        &app,
        "note add",
        json!({"project_id":project["id"],"title":"Context","body":"Full note body"}),
        "note",
    )
    .unwrap();
    let other_note = call(
        &app,
        "note add",
        json!({"project_id":other["id"],"title":"Other","body":"body"}),
        "other-note",
    )
    .unwrap();
    call(
        &app,
        "note link add",
        json!({"note_id":note["id"],"item_id":item["id"]}),
        "link",
    )
    .unwrap();
    assert_eq!(
        call(
            &app,
            "note show",
            json!({"note_id":note["id"]}),
            "note-show"
        )
        .unwrap()["linked_items"][0]["id"],
        item["id"]
    );
    assert_eq!(
        call(
            &app,
            "todo show",
            json!({"item_id":item["id"]}),
            "item-show"
        )
        .unwrap()["linked_notes"][0]["id"],
        note["id"]
    );
    let revision = app.revision().unwrap();
    assert!(call(
        &app,
        "note link add",
        json!({"note_id":other_note["id"],"item_id":item["id"]}),
        "wrong-owner"
    )
    .is_err());
    assert_eq!(app.revision().unwrap(), revision);
    let moved = call(
        &app,
        "todo edit",
        json!({"item_id":item["id"],"project_id":other["id"],"status_id":"todo"}),
        "linked-transfer",
    );
    assert!(moved.is_err());
    assert_eq!(app.revision().unwrap(), revision);
    let snapshot = call(&app, "snapshot", json!({}), "snapshot").unwrap();
    assert_eq!(snapshot["totals"]["note_links"], 1);
    let backup = call(&app, "export", json!({}), "backup").unwrap();
    let restored = GlobalManagerApplication::open(&target).unwrap();
    call(&restored, "import", json!({"snapshot":backup}), "import").unwrap();
    assert_eq!(
        call(
            &restored,
            "note show",
            json!({"note_id":note["id"]}),
            "read"
        )
        .unwrap()["linked_items"][0]["id"],
        item["id"]
    );
    drop(restored);
    drop(app);
    let _ = std::fs::remove_file(source);
    let _ = std::fs::remove_file(target);
}

#[test]
fn revision_history_growth_is_measured_and_every_snapshot_restores() {
    let source = db();
    let target = db();
    let app = GlobalManagerApplication::open(&source).unwrap();
    let project = call(&app, "project add", json!({"name":"Growth"}), "p").unwrap();
    let store = GlobalManagerStore::open(&source).unwrap();
    let start = store.revision_history_bytes().unwrap();
    let description = "x".repeat(4_096);
    let mut ids = Vec::new();
    for index in 0..8 {
        let item=call(&app,"todo add",json!({"project_id":project["id"],"title":format!("Item {index}"),"description":description}),&format!("add-{index}")).unwrap();
        ids.push(item["id"].clone());
    }
    let after_adds = store.revision_history_bytes().unwrap();
    for (index, id) in ids.iter().enumerate() {
        call(
            &app,
            "todo edit",
            json!({"item_id":id,"description":format!("{}-edit-{index}",description)}),
            &format!("edit-{index}"),
        )
        .unwrap();
    }
    let after_edits = store.revision_history_bytes().unwrap();
    eprintln!("lossless global revision snapshots: start={start} bytes, after_adds={after_adds} bytes, after_edits={after_edits} bytes");
    assert!(after_adds > start && after_edits > after_adds);
    let backup = call(&app, "export", json!({}), "backup").unwrap();
    assert_eq!(
        backup["revision_history"].as_array().unwrap().len() as u64,
        app.revision().unwrap()
    );
    let restored = GlobalManagerApplication::open(&target).unwrap();
    call(&restored, "import", json!({"snapshot":backup}), "restore").unwrap();
    assert_eq!(restored.revision().unwrap(), 1);
    drop(restored);
    drop(store);
    drop(app);
    let _ = std::fs::remove_file(source);
    let _ = std::fs::remove_file(target);
}

#[test]
fn attention_next_action_and_milestone_are_computed_before_snapshot_cap() {
    let path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let project = call(&app, "project add", json!({"name":"Portfolio"}), "p").unwrap();
    let milestone=call(&app,"milestone add",json!({"project_id":project["id"],"item_id":"milestone-release","title":"Release","due_at":"2026-12-01"}),"milestone").unwrap();
    let child=call(&app,"task add",json!({"project_id":project["id"],"parent_id":milestone["id"],"item_id":"milestone-child","title":"Ship notes"}),"child").unwrap();
    call(
        &app,
        "todo complete",
        json!({"item_id":child["id"]}),
        "complete-child",
    )
    .unwrap();
    for index in 0..100 {
        call(&app,"todo add",json!({"project_id":project["id"],"item_id":format!("ordinary-{index:03}"),"title":format!("Ordinary {index}"),"due_at":"2026-11-01","position":index}),&format!("ordinary-{index}")).unwrap();
    }
    call(&app,"todo add",json!({"project_id":project["id"],"item_id":"best-action","title":"Urgent next action","due_at":"2026-10-01","priority":9,"position":500}),"best").unwrap();
    let snapshot = call(&app, "snapshot", json!({}), "snapshot").unwrap();
    assert_eq!(snapshot["items"].as_array().unwrap().len(), 100);
    assert!(!snapshot["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["id"] == "best-action"));
    let summary = &snapshot["attention"]["projects"][project["id"].as_str().unwrap()];
    assert_eq!(summary["next_action"]["item_id"], "best-action");
    assert_eq!(summary["next_milestone"]["item_id"], "milestone-release");
    assert_eq!(summary["next_milestone"]["completed_children"], 1);
    assert_eq!(summary["next_milestone"]["total_children"], 1);
    drop(app);
    let _ = std::fs::remove_file(path);
}

#[test]
fn related_transfer_rejects_atomically_and_status_history_is_portable() {
    let path = db();
    let target_path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let a = call(&app, "project add", json!({"name":"A"}), "a").unwrap();
    let b = call(&app, "project add", json!({"name":"B"}), "b").unwrap();
    let x = call(
        &app,
        "todo add",
        json!({"project_id":a["id"],"title":"X"}),
        "x",
    )
    .unwrap();
    let y = call(
        &app,
        "todo add",
        json!({"project_id":a["id"],"title":"Y"}),
        "y",
    )
    .unwrap();
    call(
        &app,
        "relationship add",
        json!({"source_id":x["id"],"target_id":y["id"],"kind":"related"}),
        "edge",
    )
    .unwrap();
    let revision = app.revision().unwrap();
    assert!(call(
        &app,
        "todo edit",
        json!({"item_id":x["id"],"project_id":b["id"],"status_id":"todo"}),
        "split"
    )
    .is_err());
    assert_eq!(app.revision().unwrap(), revision);
    let removed = call(
        &app,
        "relationship remove",
        json!({"source_id":x["id"],"target_id":y["id"],"kind":"related"}),
        "edge-remove",
    )
    .unwrap();
    assert_eq!(removed["project_id"], a["id"]);
    assert_eq!(removed["source_id"], x["id"]);
    let activity = call(&app, "history", json!({"limit":50}), "history").unwrap();
    let removal = activity["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["command"] == "relationship remove")
        .expect("relationship removal activity");
    assert_eq!(removal["project_id"], a["id"]);
    assert_eq!(removal["source_id"], x["id"]);
    assert_eq!(removal["target_id"], y["id"]);
    call(
        &app,
        "workflow status add",
        json!({"project_id":a["id"],"status_id":"approved","label":"Approved","category":"active"}),
        "status",
    )
    .unwrap();
    call(&app,"workflow status add",json!({"project_id":b["id"],"status_id":"approved","label":"Accepted","category":"completed"}),"status-b").unwrap();
    call(
        &app,
        "todo move",
        json!({"item_id":x["id"],"status_id":"approved"}),
        "custom-status",
    )
    .unwrap();
    call(
        &app,
        "todo edit",
        json!({"item_id":x["id"],"project_id":b["id"],"status_id":"approved","parent_id":null}),
        "transfer",
    )
    .unwrap();
    let restored = GlobalManagerApplication::open(&target_path).unwrap();
    let backup = call(&app, "export", json!({}), "export").unwrap();
    call(&restored, "import", json!({"snapshot":backup}), "import").unwrap();
    assert_eq!(
        call(&restored, "snapshot", json!({}), "s").unwrap()["relationships"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    let restored_x = call(&restored, "todo show", json!({"item_id":x["id"]}), "show-x").unwrap();
    assert_eq!(restored_x["project_id"], b["id"]);
    assert_eq!(restored_x["status_id"], "approved");
    let history = call(
        &restored,
        "detail page",
        json!({"collection":"status_history","limit":20}),
        "history",
    )
    .unwrap();
    assert!(history["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["item_id"] == x["id"]
            && row["to_status_id"] == "approved"
            && row["to_status_label"] == "Approved"));
    assert!(history["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["item_id"] == x["id"]
            && row["to_status_id"] == "approved"
            && row["to_status_label"] == "Accepted"
            && row["to_status_category"] == "completed"));
    drop(app);
    drop(restored);
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(target_path);
}

#[test]
fn malformed_nested_history_is_rejected_without_revision_change() {
    let path = db();
    let app = GlobalManagerApplication::open(&path).unwrap();
    let mut backup = call(&app, "export", json!({}), "export").unwrap();
    backup["revision_history"] = json!([{"revision":0,"snapshot":{},"created_at":"now"}]);
    let revision = app.revision().unwrap();
    assert!(call(&app, "import", json!({"snapshot":backup}), "bad-history").is_err());
    assert_eq!(app.revision().unwrap(), revision);
    assert!(call(
        &app,
        "operation show",
        json!({"operation_id":"bad-history"}),
        "read"
    )
    .is_err());
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
    assert!(call(
        &app,
        "relationship add",
        json!({"source_id":second["id"],"target_id":first["id"],"kind":"blocks"}),
        "blocks-reverse",
    )
    .is_err());
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
    assert!(call(
        &app,
        "relationship add",
        json!({"source_id":first["id"],"target_id":second["id"],"kind":"depends_on"}),
        "mixed-cycle",
    )
    .is_err());
    assert_eq!(app.revision().unwrap(), revision);

    let mut backup = call(&app, "export", json!({}), "export").unwrap();
    backup["relationships"].as_array_mut().unwrap().push(json!({
        "project_id":null,
        "source_id":first["id"],
        "target_id":second["id"],
        "kind":"depends_on"
    }));
    let target = GlobalManagerApplication::open(&imported_path).unwrap();
    assert!(call(
        &target,
        "import",
        json!({"snapshot":backup}),
        "invalid-cycle-import",
    )
    .is_err());
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
    let note_id = snapshot["notes"][0]["id"].as_str().unwrap();
    assert_eq!(
        call(
            &restored,
            "note show",
            json!({"note_id":note_id}),
            "note-body"
        )
        .unwrap()["body"],
        "Keep history"
    );
    assert_eq!(snapshot["associations"][0]["kind"], "folder");
    assert!(call(
        &restored,
        "import",
        json!({"snapshot":backup,"replace":true,"expected_revision":0}),
        "stale-import"
    )
    .is_err());
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
