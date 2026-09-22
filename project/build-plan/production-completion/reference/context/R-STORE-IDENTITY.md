# R-STORE-IDENTITY — crates/store/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/lib.rs:L1390–L1505`  
**File SHA-256:** `4110cba684bfb5401d6e7af4cf45a4190aebe6d39b25e77155a88b6a35f3a59b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing project initialization/actor preparation; audit transactional bootstrap and privilege identity.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1390,1505p' 'crates/store/src/lib.rs'
```

## Exact baseline excerpt

````text
 1390 | 
 1391 |     #[allow(clippy::too_many_arguments)]
 1392 |     pub fn initialize_project(
 1393 |         &self,
 1394 |         project_id: &str,
 1395 |         actor_id: &str,
 1396 |         actor_role: &str,
 1397 |         credential_ref: &str,
 1398 |         display_name: &str,
 1399 |         operation_id: &str,
 1400 |         request_digest: &str,
 1401 |         now: &str,
 1402 |     ) -> Result<MutationResult, StoreError> {
 1403 |         self.execute_batch("BEGIN IMMEDIATE")?;
 1404 |         let result = (|| {
 1405 |             if let Some(existing) = self.operation(operation_id)? {
 1406 |                 if existing.request_digest != request_digest {
 1407 |                     return Err(StoreError::Conflict(
 1408 |                         "operation request digest mismatch".to_owned(),
 1409 |                     ));
 1410 |                 }
 1411 |                 return Ok(MutationResult {
 1412 |                     operation_id: operation_id.to_owned(),
 1413 |                     revision: existing.revision,
 1414 |                     replayed: true,
 1415 |                 });
 1416 |             }
 1417 |             self.ensure_actor(actor_id, actor_role, credential_ref, display_name, now)?;
 1418 |             self.ensure_acceptance_profile("focused", 1, "sha256:focused", "{}", now)?;
 1419 |             if self
 1420 |                 .list_project_ids()?
 1421 |                 .iter()
 1422 |                 .any(|existing| existing == project_id)
 1423 |             {
 1424 |                 let revision = self.project_revision(project_id)?;
 1425 |                 let payload = json_object(json!({"project_id": project_id}))?;
 1426 |                 self.append_operation(&OperationRecord {
 1427 |                     operation_id: operation_id.to_owned(),
 1428 |                     project_id: project_id.to_owned(),
 1429 |                     command: "project.init".to_owned(),
 1430 |                     actor_id: actor_id.to_owned(),
 1431 |                     session_id: None,
 1432 |                     expected_revision: None,
 1433 |                     attempt_id: None,
 1434 |                     fence: None,
 1435 |                     request_digest: request_digest.to_owned(),
 1436 |                     outcome: OperationOutcome::Unchanged,
 1437 |                     result_json: payload,
 1438 |                     revision: revision.0,
 1439 |                     created_at: now.to_owned(),
 1440 |                     completed_at: Some(now.to_owned()),
 1441 |                 })?;
 1442 |                 return Ok(MutationResult {
 1443 |                     operation_id: operation_id.to_owned(),
 1444 |                     revision: revision.0,
 1445 |                     replayed: true,
 1446 |                 });
 1447 |             }
 1448 |             self.create_project(project_id, now)?;
 1449 |             let revision = self.bump_revision_in_transaction(project_id)?;
 1450 |             let payload = json_object(json!({"project_id": project_id}))?;
 1451 |             self.append_operation(&OperationRecord {
 1452 |                 operation_id: operation_id.to_owned(),
 1453 |                 project_id: project_id.to_owned(),
 1454 |                 command: "project.init".to_owned(),
 1455 |                 actor_id: actor_id.to_owned(),
 1456 |                 session_id: None,
 1457 |                 expected_revision: None,
 1458 |                 attempt_id: None,
 1459 |                 fence: None,
 1460 |                 request_digest: request_digest.to_owned(),
 1461 |                 outcome: OperationOutcome::Changed,
 1462 |                 result_json: payload.clone(),
 1463 |                 revision: revision.0,
 1464 |                 created_at: now.to_owned(),
 1465 |                 completed_at: Some(now.to_owned()),
 1466 |             })?;
 1467 |             self.append_audit_event(&AuditEventRecord {
 1468 |                 project_id: project_id.to_owned(),
 1469 |                 revision: revision.0,
 1470 |                 operation_id: operation_id.to_owned(),
 1471 |                 event_type: "work.created".to_owned(),
 1472 |                 subject_type: "project".to_owned(),
 1473 |                 subject_id: project_id.to_owned(),
 1474 |                 actor_id: actor_id.to_owned(),
 1475 |                 session_id: None,
 1476 |                 fence: None,
 1477 |                 as_of: now.to_owned(),
 1478 |                 payload_json: payload,
 1479 |             })?;
 1480 |             Ok(MutationResult {
 1481 |                 operation_id: operation_id.to_owned(),
 1482 |                 revision: revision.0,
 1483 |                 replayed: false,
 1484 |             })
 1485 |         })();
 1486 |         match result {
 1487 |             Ok(value) => {
 1488 |                 self.execute_batch("COMMIT")?;
 1489 |                 Ok(value)
 1490 |             }
 1491 |             Err(error) => {
 1492 |                 let _ = self.execute_batch("ROLLBACK");
 1493 |                 Err(error)
 1494 |             }
 1495 |         }
 1496 |     }
 1497 | 
 1498 |     /// Registers a durable actor/harness session for a project.
 1499 |     ///
 1500 |     /// The session row is inserted before the operation row so that the
 1501 |     /// operation and audit records can carry the session foreign key. The
 1502 |     /// whole sequence is protected by the project write transaction, making
 1503 |     /// registration and its audit trail atomic.
 1504 |     pub fn register_session(
 1505 |         &self,
````
