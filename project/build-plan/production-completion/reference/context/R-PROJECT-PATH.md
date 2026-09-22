# R-PROJECT-PATH — crates/cli/src/dashboard.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/cli/src/dashboard.rs:L65–L225`  
**File SHA-256:** `c6a7c7e89723916cdad3f0524901d9ae0c75a9fe1782ff2b473d228b8d4b4db3`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Database/root selection performs lexical and canonical checks in separate steps; close symlink/traversal and foreign-instance gaps.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '65,225p' 'crates/cli/src/dashboard.rs'
```

## Exact baseline excerpt

````text
   65 |     let context = resolve_dashboard_context(parsed, &current_dir)?;
   66 |     let database = existing_database_path(&context.database)?;
   67 |     let store = SqliteStore::open(&database, SCHEMA).map_err(map_store_error)?;
   68 |     let project_ids = store.list_project_ids().map_err(map_store_error)?;
   69 |     let project = resolve_project_id(
   70 |         parsed.options.project.as_deref(),
   71 |         &context.project_id,
   72 |         &project_ids,
   73 |         &database,
   74 |     )?;
   75 | 
   76 |     if parsed.options.json {
   77 |         let mut resolved = parsed.clone();
   78 |         resolved.options.project = Some(project);
   79 |         return status_result(&resolved, &store);
   80 |     }
   81 | 
   82 |     drop(store);
   83 |     if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
   84 |         return Err(CliError::invalid(
   85 |             "dashboard requires an interactive terminal; use --json for noninteractive status",
   86 |         ));
   87 |     }
   88 | 
   89 |     #[cfg(unix)]
   90 |     {
   91 |         launch_dashboard(parsed, &database, &project)?;
   92 |         Ok(CliResult {
   93 |             outcome: ApplicationOutcome::Unchanged,
   94 |             revision: None,
   95 |             data: None,
   96 |             ..CliResult::default()
   97 |         })
   98 |     }
   99 |     #[cfg(not(unix))]
  100 |     {
  101 |         let _ = (parsed, database, project);
  102 |         Err(CliError::with(
  103 |             ErrorCode::UnsupportedPlatform,
  104 |             ApplicationOutcome::Failed,
  105 |             "the managed dashboard currently requires Unix-domain sockets",
  106 |         ))
  107 |     }
  108 | }
  109 | 
  110 | fn existing_database_path(path: &Path) -> Result<PathBuf, CliError> {
  111 |     if !path.is_file() {
  112 |         return Err(CliError::with(
  113 |             ErrorCode::NotFound,
  114 |             ApplicationOutcome::Failed,
  115 |             format!(
  116 |                 "Boreal database not found at {}; run `bwrk init` in this project directory or pass --db PATH --project PROJECT",
  117 |                 path.display()
  118 |             ),
  119 |         ));
  120 |     }
  121 |     fs::canonicalize(path).map_err(|error| {
  122 |         CliError::with(
  123 |             ErrorCode::ServiceUnavailable,
  124 |             ApplicationOutcome::Failed,
  125 |             format!("cannot resolve database {}: {error}", path.display()),
  126 |         )
  127 |     })
  128 | }
  129 | 
  130 | fn resolve_dashboard_context(
  131 |     parsed: &ParsedCommand,
  132 |     current_dir: &Path,
  133 | ) -> Result<DashboardContext, CliError> {
  134 |     let metadata_path = nearest_project_metadata(current_dir);
  135 |     let (metadata, project_root) = match metadata_path.as_ref() {
  136 |         Some(path) => {
  137 |             let encoded = fs::read_to_string(path).map_err(|error| {
  138 |                 CliError::with(
  139 |                     ErrorCode::InvalidArgument,
  140 |                     ApplicationOutcome::Rejected,
  141 |                     format!("cannot read project metadata {}: {error}", path.display()),
  142 |                 )
  143 |             })?;
  144 |             let metadata = serde_json::from_str::<ProjectMetadata>(&encoded).map_err(|error| {
  145 |                 CliError::with(
  146 |                     ErrorCode::InvalidArgument,
  147 |                     ApplicationOutcome::Rejected,
  148 |                     format!("invalid project metadata {}: {error}", path.display()),
  149 |                 )
  150 |             })?;
  151 |             if metadata.project_id.trim().is_empty() {
  152 |                 return Err(CliError::invalid(format!(
  153 |                     "project metadata {} has an empty project identifier; run `bwrk init` to repair it",
  154 |                     path.display()
  155 |                 )));
  156 |             }
  157 |             if metadata.project_root.as_os_str().is_empty() {
  158 |                 return Err(CliError::invalid(format!(
  159 |                     "project metadata {} has an empty project root; run `bwrk init` to repair it",
  160 |                     path.display()
  161 |                 )));
  162 |             }
  163 |             if metadata.database.as_os_str().is_empty() {
  164 |                 return Err(CliError::invalid(format!(
  165 |                     "project metadata {} has an empty database path; run `bwrk init` to repair it",
  166 |                     path.display()
  167 |                 )));
  168 |             }
  169 |             let metadata_root = path.parent().and_then(Path::parent).ok_or_else(|| {
  170 |                 CliError::invalid(format!(
  171 |                     "project metadata path is malformed: {}",
  172 |                     path.display()
  173 |                 ))
  174 |             })?;
  175 |             let project_root = fs::canonicalize(resolve_context_path(
  176 |                 &metadata.project_root,
  177 |                 metadata_root,
  178 |             ))
  179 |             .map_err(|error| {
  180 |                 CliError::with(
  181 |                     ErrorCode::NotFound,
  182 |                     ApplicationOutcome::Failed,
  183 |                     format!(
  184 |                         "project folder from {} is unavailable; run `bwrk init` to repair this project context: {error}",
  185 |                         path.display()
  186 |                     ),
  187 |                 )
  188 |             })?;
  189 |             let current_dir = fs::canonicalize(current_dir).map_err(|error| {
  190 |                 CliError::with(
  191 |                     ErrorCode::ServiceUnavailable,
  192 |                     ApplicationOutcome::Failed,
  193 |                     format!("cannot resolve the working directory: {error}"),
  194 |                 )
  195 |             })?;
  196 |             let metadata_root = fs::canonicalize(metadata_root).map_err(|error| {
  197 |                 CliError::with(
  198 |                     ErrorCode::InvalidArgument,
  199 |                     ApplicationOutcome::Rejected,
  200 |                     format!("project metadata directory is unavailable: {error}"),
  201 |                 )
  202 |             })?;
  203 |             if metadata_root != project_root || !current_dir.starts_with(&project_root) {
  204 |                 return Err(CliError::invalid(format!(
  205 |                     "project metadata {} is not bound to the current project; run `bwrk init` in this project",
  206 |                     path.display()
  207 |                 )));
  208 |             }
  209 |             if parsed.options.db == DEFAULT_DATABASE && parsed.options.project.is_none() {
  210 |                 let metadata_database = resolve_context_path(&metadata.database, &project_root);
  211 |                 if !metadata_database.starts_with(&project_root) {
  212 |                     return Err(CliError::invalid(format!(
  213 |                         "project metadata {} points outside this project to {}; pass --db PATH --project PROJECT explicitly or run `bwrk init` to repair it",
  214 |                         path.display(),
  215 |                         metadata_database.display()
  216 |                     )));
  217 |                 }
  218 |             }
  219 |             (Some(metadata), Some(project_root))
  220 |         }
  221 |         None if parsed.options.db == DEFAULT_DATABASE => {
  222 |             return Err(CliError::with(
  223 |                 ErrorCode::NotFound,
  224 |                 ApplicationOutcome::Failed,
  225 |                 "this folder is not initialized for Boreal; run `bwrk init` before starting the dashboard",
````
