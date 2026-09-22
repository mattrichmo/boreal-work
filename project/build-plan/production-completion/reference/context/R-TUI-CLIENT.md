# R-TUI-CLIENT — apps/tui/src/client.ts

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `apps/tui/src/client.ts:L1320–L1440`  
**File SHA-256:** `68c626c72f938f38623578c3e2e3d5b1c2a2f410890da64ef7ff53e38ece27ed`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Client actionAvailability and next-action helpers independently interpret status/gates; replace authority with service action descriptors.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1320,1440p' 'apps/tui/src/client.ts'
```

## Exact baseline excerpt

````text
 1320 |     return this.refresh();
 1321 |   }
 1322 | 
 1323 |   private model: StatusView | null = null;
 1324 | 
 1325 |   private async readLatest(): Promise<StatusView> {
 1326 |     const cursor_revision = this.resnapshotRequested ? null : this.revision;
 1327 |     this.resnapshotRequested = false;
 1328 |     try {
 1329 |       const model = buildMonitoringModel(validateEnvelope<RevisionedStatusResponse>(await this.reader.readStatus({ cursor_revision })));
 1330 |       this.revision = model.revision;
 1331 |       this.model = model;
 1332 |       return model;
 1333 |     } finally {
 1334 |       this.inFlight = null;
 1335 |     }
 1336 |   }
 1337 | }
 1338 | 
 1339 | export function contextualAction(item: StatusItem): string {
 1340 |   const status = item.display_status ?? item.status;
 1341 |   if (status === "blocked") return "resolve hold";
 1342 |   if (status === "queued") return "wait for prerequisite";
 1343 |   if (status === "expired_review") return "review expiry";
 1344 |   if (item.gates?.open.some((gate) => gate.required)) return "satisfy gate";
 1345 |   if (item.claimable) return "claim";
 1346 |   return item.next_action ?? "inspect";
 1347 | }
 1348 | 
 1349 | /** Stable state consumed by a renderer; an open required gate is explicit. */
 1350 | export function workflowDisplayState(item: StatusItem): string {
 1351 |   if (item.gates?.open.some((gate) => gate.required) || ["needs_verification", "awaiting_review"].includes(statusOf(item))) {
 1352 |     return "gate";
 1353 |   }
 1354 |   return statusOf(item);
 1355 | }
 1356 | 
 1357 | function statusOf(item: StatusItem): WorkStatus {
 1358 |   return item.display_status ?? item.status;
 1359 | }
 1360 | 
 1361 | function gateIsOpen(item: StatusItem): boolean {
 1362 |   return (item.gates?.open.some((gate) => gate.required) ?? false)
 1363 |     || ["needs_verification", "awaiting_review"].includes(statusOf(item));
 1364 | }
 1365 | 
 1366 | /** The presentation policy mirrors service-provided status; it never derives claimability. */
 1367 | export interface ActionAvailabilityContext {
 1368 |   /** The current service route requires a receipt before finish_close. */
 1369 |   receipt_available?: boolean;
 1370 |   pending_operation?: PendingOperation;
 1371 | }
 1372 | 
 1373 | export function actionAvailability(
 1374 |   item: StatusItem,
 1375 |   busy: ReadonlySet<TuiAction> = new Set(),
 1376 |   context: ActionAvailabilityContext = {},
 1377 | ): ActionAvailability[] {
 1378 |   const status = statusOf(item);
 1379 |   const blocked = status === "blocked";
 1380 |   const queued = status === "queued";
 1381 |   const expired = status === "expired_review";
 1382 |   const gateOpen = gateIsOpen(item);
 1383 |   const hasAttempt = !!item.attempt;
 1384 |   const receiptAvailable = context.receipt_available !== false;
 1385 |   const pendingOperation = context.pending_operation;
 1386 |   const accepted = (hasAttempt && ["accepted", "running", "in_progress", "verifying"].includes(item.attempt?.phase ?? ""))
 1387 |     || ["accepted", "running", "in_progress"].includes(status);
 1388 |   const disabled = (action: TuiAction, reason: string | null, enabled: boolean, confirmation = true): ActionAvailability => ({
 1389 |     action,
 1390 |     enabled: enabled && !busy.has(action) && !pendingOperation,
 1391 |     reason: busy.has(action)
 1392 |       ? "operation already in progress"
 1393 |       : pendingOperation
 1394 |         ? `operation ${pendingOperation.operation_id} has unknown outcome; read it back before retrying`
 1395 |         : reason,
 1396 |     requires_confirmation: confirmation,
 1397 |   });
 1398 |   if (item.diagnostic) {
 1399 |     return (["claim", "accept_start", "evidence", "finish", "release"] as const).map((action) =>
 1400 |       disabled(action, `unavailable: ${item.diagnostic?.code ?? "corrupt record"}`, false));
 1401 |   }
 1402 |   return [
 1403 |     disabled("claim", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : item.claimable ? null : "work is not claimable at this revision", item.claimable && !blocked && !queued && !expired),
 1404 |     disabled("accept_start", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : hasAttempt && status === "claimed" ? null : "a claimed attempt is required", hasAttempt && status === "claimed" && !blocked && !queued && !expired),
 1405 |     disabled("evidence", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : accepted ? null : "an accepted attempt is required", accepted && !blocked && !queued && !expired),
 1406 |     disabled("finish", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : gateOpen ? "required gate is open" : !receiptAvailable ? "a current receipt is required" : accepted ? null : "an accepted attempt is required", accepted && !blocked && !queued && !expired && !gateOpen && receiptAvailable),
 1407 |     disabled("release", blocked ? "work is blocked" : queued ? "waiting for prerequisite" : expired ? "expiry requires review" : hasAttempt ? null : "a current attempt is required", hasAttempt && !blocked && !queued && !expired),
 1408 |   ];
 1409 | }
 1410 | 
 1411 | export interface MountedView {
 1412 |   mounted: boolean;
 1413 |   route: Route;
 1414 |   monitoring: MonitoringModel | null;
 1415 |   selected_work: StatusItem | null;
 1416 |   actions: ActionAvailability[];
 1417 |   notice: ControllerNotice | null;
 1418 |   stale_revision: StaleRevisionDisplay | null;
 1419 |   busy_actions: TuiAction[];
 1420 |   pending_operations: PendingOperation[];
 1421 |   capabilities?: readonly DashboardCapability[];
 1422 |   selected_receipt_available?: boolean;
 1423 | }
 1424 | 
 1425 | export interface TuiWorkflowContext {
 1426 |   project_id: string;
 1427 |   actor_id: string;
 1428 |   harness_id: string;
 1429 |   session_id: string;
 1430 |   now?: () => Date;
 1431 |   lease_ttl_ms?: number;
 1432 |   hard_deadline_ms?: number;
 1433 | }
 1434 | 
 1435 | export interface TuiWorkflowControllerOptions {
 1436 |   context: TuiWorkflowContext;
 1437 |   notifications?: RefreshNotificationSource;
 1438 | }
 1439 | 
 1440 | let operationSequence = 0;
````
