# R-BOOTSTRAP — crates/cli/src/service.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/cli/src/service.rs:L1305–L1375`  
**File SHA-256:** `0e91f462908bf9d6e50c24e80f70002cb9a0cd67b91915e7e59d66cb1b907897`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Public initialization accepts actor/role inputs; reinitialization must not be an enrollment or privilege escalation route.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1305,1375p' 'crates/cli/src/service.rs'
```

## Exact baseline excerpt

````text
 1305 |                         Some(wire_error),
 1306 |                     )
 1307 |                 }
 1308 |             };
 1309 |             Ok(ApplicationResponse {
 1310 |                 api_version: APPLICATION_API_VERSION.to_owned(),
 1311 |                 schema_version: APPLICATION_SCHEMA_VERSION.to_owned(),
 1312 |                 operation_id: request.operation_id,
 1313 |                 data: serde_json::to_string(&envelope).map_err(|error| {
 1314 |                     boreal_service::ProtocolError::new(
 1315 |                         boreal_service::ProtocolErrorCode::InvalidPayload,
 1316 |                         error.to_string(),
 1317 |                     )
 1318 |                 })?,
 1319 |             })
 1320 |         }
 1321 |     }
 1322 | 
 1323 |     type ServicePayload = (ApplicationOutcome, Option<u64>, Option<Value>);
 1324 |     type ServiceResult = Result<ServicePayload, CliError>;
 1325 | 
 1326 |     #[derive(Debug, Deserialize)]
 1327 |     #[serde(deny_unknown_fields)]
 1328 |     struct CreateProjectRequest {
 1329 |         command: String,
 1330 |         #[serde(default)]
 1331 |         project_id: Option<String>,
 1332 |         name: String,
 1333 |         #[serde(default)]
 1334 |         description: String,
 1335 |         actor_id: String,
 1336 |         #[serde(default = "default_actor_role")]
 1337 |         actor_role: String,
 1338 |         #[serde(default = "default_credential_ref")]
 1339 |         credential_ref: String,
 1340 |         #[serde(default, rename = "harness_id")]
 1341 |         _harness_id: Option<String>,
 1342 |         #[serde(default, rename = "session_id")]
 1343 |         _session_id: Option<String>,
 1344 |         #[serde(default)]
 1345 |         expected_revision: Option<u64>,
 1346 |         #[serde(default, rename = "operation_id")]
 1347 |         _operation_id: Option<String>,
 1348 |     }
 1349 | 
 1350 |     #[derive(Debug, Deserialize)]
 1351 |     #[serde(deny_unknown_fields)]
 1352 |     struct CreateWorkRequest {
 1353 |         command: String,
 1354 |         project_id: String,
 1355 |         #[serde(default)]
 1356 |         work_id: Option<String>,
 1357 |         kind: String,
 1358 |         #[serde(default)]
 1359 |         parent_id: Option<String>,
 1360 |         title: String,
 1361 |         #[serde(default)]
 1362 |         description: String,
 1363 |         #[serde(default)]
 1364 |         priority: u8,
 1365 |         #[serde(default = "default_dispatch", alias = "dispatch_policy")]
 1366 |         dispatch: String,
 1367 |         #[serde(default)]
 1368 |         hold: Option<String>,
 1369 |         #[serde(
 1370 |             default = "default_profile",
 1371 |             alias = "acceptance_profile",
 1372 |             alias = "profile_id"
 1373 |         )]
 1374 |         profile: String,
 1375 |         #[serde(
````
