# R-MIGRATION-CODE — crates/migration/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/migration/src/lib.rs:L2000–L2110`  
**File SHA-256:** `ba934b832c913a776f63728750d408c6d9a41acc1b1c978dd1be5a215e9b9fbc`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Legacy lifecycle conversion can map done/complete/archived to Closed; do not equate vocabulary with accepted outcomes.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '2000,2110p' 'crates/migration/src/lib.rs'
```

## Exact baseline excerpt

````text
 2000 | where
 2001 |     F: FnMut(&serde_json::Map<String, Value>) -> Result<T, LegacyRecordError>,
 2002 | {
 2003 |     let Some(raw) = raw else { return Vec::new() };
 2004 |     let Some(items) = raw.as_array() else {
 2005 |         report
 2006 |             .unsupported
 2007 |             .push(issue_value(raw, record_type, None, "expected an array"));
 2008 |         return Vec::new();
 2009 |     };
 2010 |     let mut parsed = Vec::new();
 2011 |     for item in items {
 2012 |         let Some(map) = item.as_object() else {
 2013 |             report
 2014 |                 .unsupported
 2015 |                 .push(issue_value(item, record_type, None, "expected an object"));
 2016 |             continue;
 2017 |         };
 2018 |         if let Some(issue) = legacy_ambiguity(item, record_type) {
 2019 |             report.ambiguous.push(issue);
 2020 |             continue;
 2021 |         }
 2022 |         if let Some(issue) = unsupported_fields(item, record_type, legacy_identifier(item), allowed)
 2023 |         {
 2024 |             report.unsupported.push(issue);
 2025 |             continue;
 2026 |         }
 2027 |         match convert(map) {
 2028 |             Ok(value) => parsed.push(value),
 2029 |             Err(LegacyRecordError::Ambiguous(reason)) => report.ambiguous.push(issue_value(
 2030 |                 item,
 2031 |                 record_type,
 2032 |                 legacy_identifier(item),
 2033 |                 &reason,
 2034 |             )),
 2035 |             Err(LegacyRecordError::Unsupported(reason)) => report.unsupported.push(issue_value(
 2036 |                 item,
 2037 |                 record_type,
 2038 |                 legacy_identifier(item),
 2039 |                 &reason,
 2040 |             )),
 2041 |         }
 2042 |     }
 2043 |     parsed
 2044 | }
 2045 | 
 2046 | fn parse_legacy_work(
 2047 |     map: &serde_json::Map<String, Value>,
 2048 |     project_id: &str,
 2049 | ) -> Result<WorkRecord, LegacyRecordError> {
 2050 |     let id = required_string(map, &["id", "uuid"], "id")?;
 2051 |     let record_project =
 2052 |         optional_string(map, &["project_id"]).unwrap_or_else(|| project_id.to_owned());
 2053 |     let kind = match required_string(map, &["kind", "type"], "kind")?.as_str() {
 2054 |         "milestone" | "phase" => WorkKind::Milestone,
 2055 |         "sprint" | "iteration" => WorkKind::Sprint,
 2056 |         "task" | "issue" => WorkKind::Task,
 2057 |         other => {
 2058 |             return Err(LegacyRecordError::Unsupported(format!(
 2059 |                 "unsupported work kind: {other}"
 2060 |             )))
 2061 |         }
 2062 |     };
 2063 |     let parent_id =
 2064 |         optional_string(map, &["parent_id", "parent"]).filter(|value| !value.is_empty());
 2065 |     let title = optional_string(map, &["title", "name"])
 2066 |         .filter(|value| !value.is_empty())
 2067 |         .ok_or_else(|| LegacyRecordError::Unsupported("work title is required".to_owned()))?;
 2068 |     let lifecycle = match optional_string(map, &["lifecycle", "status"])
 2069 |         .unwrap_or_else(|| "open".to_owned())
 2070 |         .to_ascii_lowercase()
 2071 |         .as_str()
 2072 |     {
 2073 |         "draft" | "planned" => Lifecycle::Draft,
 2074 |         "open" | "active" | "ready" | "in_progress" => Lifecycle::Open,
 2075 |         "closed" | "done" | "complete" | "completed" | "archived" => Lifecycle::Closed,
 2076 |         "cancelled" | "canceled" => Lifecycle::Cancelled,
 2077 |         other => {
 2078 |             return Err(LegacyRecordError::Unsupported(format!(
 2079 |                 "unsupported work lifecycle: {other}"
 2080 |             )))
 2081 |         }
 2082 |     };
 2083 |     Ok(WorkRecord {
 2084 |         id,
 2085 |         project_id: record_project,
 2086 |         kind,
 2087 |         parent_id,
 2088 |         title,
 2089 |         description: optional_string(map, &["description"]).unwrap_or_default(),
 2090 |         lifecycle,
 2091 |     })
 2092 | }
 2093 | 
 2094 | fn parse_legacy_dependency(
 2095 |     map: &serde_json::Map<String, Value>,
 2096 | ) -> Result<DependencyRecord, LegacyRecordError> {
 2097 |     let (from_work_id, to_work_id) =
 2098 |         if map.contains_key("dependent_id") || map.contains_key("prerequisite_id") {
 2099 |             (
 2100 |                 required_string(map, &["dependent_id"], "dependent_id")?,
 2101 |                 required_string(map, &["prerequisite_id"], "prerequisite_id")?,
 2102 |             )
 2103 |         } else {
 2104 |             (
 2105 |                 required_string(map, &["from_work_id"], "from_work_id")?,
 2106 |                 required_string(map, &["to_work_id"], "to_work_id")?,
 2107 |             )
 2108 |         };
 2109 |     let kind = match required_string(map, &["kind", "type", "policy"], "kind")?
 2110 |         .to_ascii_lowercase()
````
