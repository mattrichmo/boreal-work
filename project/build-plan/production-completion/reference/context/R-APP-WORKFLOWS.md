# R-APP-WORKFLOWS — crates/application/src/workflow_assets.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/workflow_assets.rs:L1–L240`  
**File SHA-256:** `e3f79a0ef72846a1ad6561cadee4e87677537653360a0b74757a87900a435838`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Workflow asset resolution, versioning and command validation boundary.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,240p' 'crates/application/src/workflow_assets.rs'
```

## Exact baseline excerpt

````text
    1 | //! Embedded, versioned workflow assets.
    2 | //!
    3 | //! Workflow files are guidance and routing data.  This module validates their
    4 | //! package boundary once and exposes only the requested asset; lifecycle
    5 | //! decisions remain in the application/domain layer.
    6 | 
    7 | use serde_json::Value;
    8 | use std::fmt;
    9 | 
   10 | const PACKAGE: &str = include_str!("../../../project/spec/workflows/package.json");
   11 | const EMBEDDED_ASSETS: &[&str] = &[
   12 |     include_str!("../../../project/spec/workflows/route.json"),
   13 |     include_str!("../../../project/spec/workflows/context.json"),
   14 |     include_str!("../../../project/spec/workflows/plan.json"),
   15 |     include_str!("../../../project/spec/workflows/claim.json"),
   16 |     include_str!("../../../project/spec/workflows/finish.json"),
   17 |     include_str!("../../../project/spec/workflows/review.json"),
   18 |     include_str!("../../../project/spec/workflows/audit.json"),
   19 |     include_str!("../../../project/spec/workflows/handoff.json"),
   20 |     include_str!("../../../project/spec/workflows/health.json"),
   21 |     include_str!("../../../project/spec/workflows/memory.json"),
   22 | ];
   23 | 
   24 | #[derive(Clone, Debug, Eq, PartialEq)]
   25 | pub struct WorkflowAsset {
   26 |     pub reference: String,
   27 |     pub kind: String,
   28 |     pub title: String,
   29 |     pub allowed_commands: Vec<String>,
   30 |     pub typed_inputs: Vec<String>,
   31 |     pub finish_criteria: Vec<String>,
   32 |     pub next_refs: Vec<String>,
   33 | }
   34 | 
   35 | #[derive(Clone, Debug, Eq, PartialEq)]
   36 | pub struct WorkflowRegistry {
   37 |     package_id: String,
   38 |     package_version: String,
   39 |     asset_identity: String,
   40 |     assets: Vec<WorkflowAsset>,
   41 | }
   42 | 
   43 | #[derive(Clone, Debug, Eq, PartialEq)]
   44 | pub enum WorkflowAssetError {
   45 |     InvalidJson(String),
   46 |     MissingField(&'static str),
   47 |     InvalidField(String),
   48 |     DuplicateReference(String),
   49 |     UnknownReference(String),
   50 | }
   51 | 
   52 | impl fmt::Display for WorkflowAssetError {
   53 |     fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
   54 |         match self {
   55 |             Self::InvalidJson(message) => {
   56 |                 write!(formatter, "invalid workflow package JSON: {message}")
   57 |             }
   58 |             Self::MissingField(field) => write!(formatter, "workflow package is missing {field}"),
   59 |             Self::InvalidField(message) => formatter.write_str(message),
   60 |             Self::DuplicateReference(reference) => {
   61 |                 write!(formatter, "duplicate workflow reference: {reference}")
   62 |             }
   63 |             Self::UnknownReference(reference) => {
   64 |                 write!(formatter, "unknown workflow reference: {reference}")
   65 |             }
   66 |         }
   67 |     }
   68 | }
   69 | 
   70 | impl std::error::Error for WorkflowAssetError {}
   71 | 
   72 | impl WorkflowRegistry {
   73 |     pub fn embedded() -> Result<Self, WorkflowAssetError> {
   74 |         Self::from_package_and_assets(PACKAGE, EMBEDDED_ASSETS)
   75 |     }
   76 | 
   77 |     pub fn from_package_json(package_json: &str) -> Result<Self, WorkflowAssetError> {
   78 |         let value: Value = serde_json::from_str(package_json)
   79 |             .map_err(|error| WorkflowAssetError::InvalidJson(error.to_string()))?;
   80 |         Self::from_package_value(value, None)
   81 |     }
   82 | 
   83 |     fn from_package_and_assets(
   84 |         package_json: &str,
   85 |         asset_json: &[&str],
   86 |     ) -> Result<Self, WorkflowAssetError> {
   87 |         let package = serde_json::from_str(package_json)
   88 |             .map_err(|error| WorkflowAssetError::InvalidJson(error.to_string()))?;
   89 |         let assets = asset_json
   90 |             .iter()
   91 |             .map(|asset| {
   92 |                 serde_json::from_str(asset)
   93 |                     .map_err(|error| WorkflowAssetError::InvalidJson(error.to_string()))
   94 |             })
   95 |             .collect::<Result<Vec<Value>, WorkflowAssetError>>()?;
   96 |         Self::from_package_value(package, Some(assets))
   97 |     }
   98 | 
   99 |     fn from_package_value(
  100 |         value: Value,
  101 |         embedded_assets: Option<Vec<Value>>,
  102 |     ) -> Result<Self, WorkflowAssetError> {
  103 |         let object = value.as_object().ok_or_else(|| {
  104 |             WorkflowAssetError::InvalidField("workflow package must be an object".to_owned())
  105 |         })?;
  106 |         require_string(object, "schema_version")?;
  107 |         let package_id = require_string(object, "package_id")?;
  108 |         let package_version = require_string(object, "package_version")?;
  109 |         let asset_identity = require_string(object, "asset_identity")?;
  110 |         if object.get("state_authority").and_then(Value::as_str) != Some("boreal.application.v2") {
  111 |             return Err(WorkflowAssetError::InvalidField(
  112 |                 "workflow package state_authority must be boreal.application.v2".to_owned(),
  113 |             ));
  114 |         }
  115 |         let package_assets = object
  116 |             .get("assets")
  117 |             .and_then(Value::as_array)
  118 |             .ok_or(WorkflowAssetError::MissingField("assets"))?
  119 |             .to_owned();
  120 |         let assets = match embedded_assets {
  121 |             Some(values) => values
  122 |                 .iter()
  123 |                 .map(parse_asset)
  124 |                 .collect::<Result<Vec<_>, _>>()?,
  125 |             None => package_assets
  126 |                 .iter()
  127 |                 .map(parse_asset)
  128 |                 .collect::<Result<Vec<_>, _>>()?,
  129 |         };
  130 |         if assets.len() != package_assets.len() {
  131 |             return Err(WorkflowAssetError::InvalidField(
  132 |                 "workflow package asset metadata does not match embedded assets".to_owned(),
  133 |             ));
  134 |         }
  135 |         for (metadata, asset) in package_assets.iter().zip(&assets) {
  136 |             let reference = metadata
  137 |                 .get("ref")
  138 |                 .and_then(Value::as_str)
  139 |                 .ok_or(WorkflowAssetError::MissingField("ref"))?;
  140 |             let kind = metadata
  141 |                 .get("kind")
  142 |                 .and_then(Value::as_str)
  143 |                 .ok_or(WorkflowAssetError::MissingField("kind"))?;
  144 |             if reference != asset.reference || kind != asset.kind {
  145 |                 return Err(WorkflowAssetError::InvalidField(format!(
  146 |                     "workflow package identity does not match asset {reference}"
  147 |                 )));
  148 |             }
  149 |         }
  150 |         let registry = Self {
  151 |             package_id,
  152 |             package_version,
  153 |             asset_identity,
  154 |             assets,
  155 |         };
  156 |         registry.validate_references()?;
  157 |         Ok(registry)
  158 |     }
  159 | 
  160 |     pub fn package_id(&self) -> &str {
  161 |         &self.package_id
  162 |     }
  163 | 
  164 |     pub fn package_version(&self) -> &str {
  165 |         &self.package_version
  166 |     }
  167 | 
  168 |     pub fn asset_identity(&self) -> &str {
  169 |         &self.asset_identity
  170 |     }
  171 | 
  172 |     pub fn assets(&self) -> &[WorkflowAsset] {
  173 |         &self.assets
  174 |     }
  175 | 
  176 |     pub fn get(&self, reference: &str) -> Result<&WorkflowAsset, WorkflowAssetError> {
  177 |         self.assets
  178 |             .iter()
  179 |             .find(|asset| asset.reference == reference)
  180 |             .ok_or_else(|| WorkflowAssetError::UnknownReference(reference.to_owned()))
  181 |     }
  182 | 
  183 |     fn validate_references(&self) -> Result<(), WorkflowAssetError> {
  184 |         for (index, asset) in self.assets.iter().enumerate() {
  185 |             if self
  186 |                 .assets
  187 |                 .iter()
  188 |                 .take(index)
  189 |                 .any(|other| other.reference == asset.reference)
  190 |             {
  191 |                 return Err(WorkflowAssetError::DuplicateReference(
  192 |                     asset.reference.clone(),
  193 |                 ));
  194 |             }
  195 |         }
  196 |         for asset in &self.assets {
  197 |             for reference in &asset.next_refs {
  198 |                 if !self
  199 |                     .assets
  200 |                     .iter()
  201 |                     .any(|candidate| candidate.reference == *reference)
  202 |                 {
  203 |                     return Err(WorkflowAssetError::UnknownReference(reference.clone()));
  204 |                 }
  205 |             }
  206 |         }
  207 |         Ok(())
  208 |     }
  209 | }
  210 | 
  211 | fn parse_asset(value: &Value) -> Result<WorkflowAsset, WorkflowAssetError> {
  212 |     let object = value.as_object().ok_or_else(|| {
  213 |         WorkflowAssetError::InvalidField("workflow asset must be an object".to_owned())
  214 |     })?;
  215 |     let reference = require_string(object, "ref")?;
  216 |     let kind = require_string(object, "kind")?;
  217 |     let title = require_string(object, "title")?;
  218 |     let allowed_commands = string_array(object, "allowed_commands")?;
  219 |     if allowed_commands
  220 |         .iter()
  221 |         .any(|command| command.trim().is_empty())
  222 |     {
  223 |         return Err(WorkflowAssetError::InvalidField(format!(
  224 |             "workflow {reference} has an empty allowed command"
  225 |         )));
  226 |     }
  227 |     let typed_inputs = object
  228 |         .get("typed_inputs")
  229 |         .and_then(Value::as_array)
  230 |         .ok_or(WorkflowAssetError::MissingField("typed_inputs"))?
  231 |         .iter()
  232 |         .map(|input| {
  233 |             let input = input.as_object().ok_or_else(|| {
  234 |                 WorkflowAssetError::InvalidField(format!(
  235 |                     "workflow {reference} input must be an object"
  236 |                 ))
  237 |             })?;
  238 |             let name = require_string(input, "name")?;
  239 |             require_string(input, "type")?;
  240 |             require_string(input, "source")?;
````
