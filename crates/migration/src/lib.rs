//! A deliberately small, explicit import/export boundary for Boreal v2.
//!
//! This crate describes data that may cross the legacy-to-v2 boundary. It is
//! intentionally independent of the runtime crates: importing data produces a
//! report and a reduced document, but does not write to a database, filesystem,
//! Git repository, or memory bank.

use std::{collections::BTreeMap, fmt};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

pub const FORMAT: &str = "boreal.v2.migration";
pub const FORMAT_VERSION: u32 = 1;
pub const LEGACY_FORMAT: &str = "boreal.legacy.records";
pub const LEGACY_FORMAT_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MigrationDocument {
    pub format: String,
    pub version: u32,
    pub project: ProjectRecord,
    #[serde(default)]
    pub work: Vec<WorkRecord>,
    #[serde(default)]
    pub dependencies: Vec<DependencyRecord>,
    #[serde(default)]
    pub attempts: Vec<AttemptRecord>,
    #[serde(default)]
    pub reservations: Vec<ReservationRecord>,
    #[serde(default)]
    pub evidence: Vec<EvidenceReference>,
    #[serde(default)]
    pub failures: Vec<FailureRecord>,
    #[serde(default)]
    pub summaries: Vec<SummaryReference>,
    #[serde(default)]
    pub memory: Vec<MemoryReference>,
    #[serde(default)]
    pub git: Vec<GitReference>,
}

impl MigrationDocument {
    pub fn new(project: ProjectRecord) -> Self {
        Self {
            format: FORMAT.to_owned(),
            version: FORMAT_VERSION,
            project,
            work: Vec::new(),
            dependencies: Vec::new(),
            attempts: Vec::new(),
            reservations: Vec::new(),
            evidence: Vec::new(),
            failures: Vec::new(),
            summaries: Vec::new(),
            memory: Vec::new(),
            git: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.format != FORMAT {
            return Err(ValidationError::InvalidHeader("format"));
        }
        if self.version != FORMAT_VERSION {
            return Err(ValidationError::InvalidHeader("version"));
        }
        if self.project.id.is_empty() {
            return Err(ValidationError::EmptyIdentifier("project.id"));
        }

        let mut work_ids = BTreeMap::new();
        for work in &self.work {
            if work.project_id != self.project.id {
                return Err(ValidationError::WrongProject {
                    record: "work",
                    id: work.id.clone(),
                });
            }
            if work.id.is_empty() {
                return Err(ValidationError::EmptyIdentifier("work.id"));
            }
            if work_ids.insert(work.id.clone(), ()).is_some() {
                return Err(ValidationError::DuplicateIdentifier {
                    record: "work",
                    id: work.id.clone(),
                });
            }
            if let Some(parent_id) = &work.parent_id {
                if parent_id == &work.id {
                    return Err(ValidationError::SelfParent(work.id.clone()));
                }
                let Some(parent) = self
                    .work
                    .iter()
                    .find(|candidate| &candidate.id == parent_id)
                else {
                    return Err(ValidationError::MissingReference {
                        record: "work.parent_id",
                        id: parent_id.clone(),
                    });
                };
                if !matches!(
                    (parent.kind, work.kind),
                    (WorkKind::Milestone, WorkKind::Sprint) | (WorkKind::Sprint, WorkKind::Task)
                ) {
                    return Err(ValidationError::InvalidParentKind {
                        parent: parent.id.clone(),
                        child: work.id.clone(),
                    });
                }
            }
        }

        validate_unique("attempt", self.attempts.iter().map(|record| &record.id))?;
        validate_unique(
            "reservation",
            self.reservations.iter().map(|record| &record.id),
        )?;
        validate_unique("evidence", self.evidence.iter().map(|record| &record.id))?;
        validate_unique("failure", self.failures.iter().map(|record| &record.id))?;
        validate_unique("summary", self.summaries.iter().map(|record| &record.id))?;
        validate_unique("memory", self.memory.iter().map(|record| &record.id))?;
        validate_unique("git", self.git.iter().map(|record| &record.id))?;

        for dependency in &self.dependencies {
            if dependency.kind != DependencyKind::ClosedOnly {
                return Err(ValidationError::NonClosedDependency(
                    dependency.from_work_id.clone(),
                ));
            }
            for id in [&dependency.from_work_id, &dependency.to_work_id] {
                if !work_ids.contains_key(id) {
                    return Err(ValidationError::MissingReference {
                        record: "dependency.work_id",
                        id: (*id).clone(),
                    });
                }
            }
        }

        for attempt in &self.attempts {
            if !work_ids.contains_key(&attempt.work_id) {
                return Err(ValidationError::MissingReference {
                    record: "attempt.work_id",
                    id: attempt.work_id.clone(),
                });
            }
        }
        for reservation in &self.reservations {
            if reservation.id.is_empty() {
                return Err(ValidationError::EmptyIdentifier("reservation.id"));
            }
            if !self
                .attempts
                .iter()
                .any(|attempt| attempt.id == reservation.attempt_id)
            {
                return Err(ValidationError::MissingReference {
                    record: "reservation.attempt_id",
                    id: reservation.attempt_id.clone(),
                });
            }
        }

        for evidence in &self.evidence {
            if !work_ids.contains_key(&evidence.work_id) {
                return Err(ValidationError::MissingReference {
                    record: "evidence.work_id",
                    id: evidence.work_id.clone(),
                });
            }
        }
        for failure in &self.failures {
            if !work_ids.contains_key(&failure.work_id) {
                return Err(ValidationError::MissingReference {
                    record: "failure.work_id",
                    id: failure.work_id.clone(),
                });
            }
            if let Some(attempt_id) = &failure.attempt_id {
                if !self
                    .attempts
                    .iter()
                    .any(|attempt| &attempt.id == attempt_id)
                {
                    return Err(ValidationError::MissingReference {
                        record: "failure.attempt_id",
                        id: attempt_id.clone(),
                    });
                }
            }
        }
        for summary in &self.summaries {
            if !work_ids.contains_key(&summary.work_id) {
                return Err(ValidationError::MissingReference {
                    record: "summary.work_id",
                    id: summary.work_id.clone(),
                });
            }
            if let Some(attempt_id) = &summary.attempt_id {
                if !self
                    .attempts
                    .iter()
                    .any(|attempt| &attempt.id == attempt_id)
                {
                    return Err(ValidationError::MissingReference {
                        record: "summary.attempt_id",
                        id: attempt_id.clone(),
                    });
                }
            }
        }
        for memory in &self.memory {
            if memory.project_id != self.project.id {
                return Err(ValidationError::WrongProject {
                    record: "memory",
                    id: memory.id.clone(),
                });
            }
        }
        for git in &self.git {
            if git.project_id != self.project.id {
                return Err(ValidationError::WrongProject {
                    record: "git",
                    id: git.id.clone(),
                });
            }
        }

        Ok(())
    }

    /// Return the document in the order used by the v2 export boundary.
    ///
    /// Collection order is not semantic in the migration format. Sorting at
    /// the boundary keeps exports stable when a source store returns rows in
    /// a different order, while leaving the caller's document untouched.
    pub fn canonicalized(&self) -> Self {
        let mut document = self.clone();
        document.work.sort_by(|left, right| left.id.cmp(&right.id));
        document.dependencies.sort_by(|left, right| {
            (left.from_work_id.as_str(), left.to_work_id.as_str())
                .cmp(&(right.from_work_id.as_str(), right.to_work_id.as_str()))
        });
        document
            .attempts
            .sort_by(|left, right| left.id.cmp(&right.id));
        document
            .reservations
            .sort_by(|left, right| left.id.cmp(&right.id));
        document
            .evidence
            .sort_by(|left, right| left.id.cmp(&right.id));
        document
            .failures
            .sort_by(|left, right| left.id.cmp(&right.id));
        document
            .summaries
            .sort_by(|left, right| left.id.cmp(&right.id));
        document
            .memory
            .sort_by(|left, right| left.id.cmp(&right.id));
        document.git.sort_by(|left, right| left.id.cmp(&right.id));
        document
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkRecord {
    pub id: String,
    pub project_id: String,
    pub kind: WorkKind,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub lifecycle: Lifecycle,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkKind {
    Milestone,
    Sprint,
    Task,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Lifecycle {
    Draft,
    Open,
    Closed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyKind {
    ClosedOnly,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DependencyRecord {
    pub from_work_id: String,
    pub to_work_id: String,
    pub kind: DependencyKind,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AttemptRecord {
    pub id: String,
    pub work_id: String,
    pub actor_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub phase: AttemptPhase,
    pub claimed_at_ms: u64,
    pub hard_deadline_ms: u64,
    pub lease_expires_at_ms: u64,
    pub fence: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttemptPhase {
    Reserved,
    Accepted,
    InProgress,
    Submitted,
    Released,
    Failed,
    Expired,
    Cancelled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReservationRecord {
    pub id: String,
    pub attempt_id: String,
    pub owner_id: String,
    pub reserved_at_ms: u64,
    pub hard_deadline_ms: u64,
    pub lease_expires_at_ms: u64,
    pub fence: u64,
    pub state: ReservationState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReservationState {
    Active,
    Released,
    Expired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EvidenceReference {
    pub id: String,
    pub work_id: String,
    pub kind: EvidenceKind,
    pub reference: String,
    #[serde(default)]
    pub source_version: Option<String>,
    #[serde(default)]
    pub citation: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FailureRecord {
    pub id: String,
    pub work_id: String,
    #[serde(default)]
    pub attempt_id: Option<String>,
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub detail: Value,
    pub occurred_at_ms: u64,
    #[serde(default = "default_true")]
    pub retained: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SummaryReference {
    pub id: String,
    pub work_id: String,
    #[serde(default)]
    pub attempt_id: Option<String>,
    #[serde(default)]
    pub fence: Option<u64>,
    pub subject_ref: String,
    pub body_digest: String,
    pub body_size: u64,
    #[serde(default)]
    pub source_version: Option<String>,
    #[serde(default)]
    pub config_identity: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub profile_version: Option<u32>,
    #[serde(default = "default_true")]
    pub current: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    Source,
    File,
    Test,
    Command,
    Review,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MemoryReference {
    pub id: String,
    pub project_id: String,
    pub kind: MemoryKind,
    pub path: String,
    pub identity: String,
    #[serde(default)]
    pub git_commit: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    Source,
    Entry,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GitReference {
    pub id: String,
    pub project_id: String,
    pub repository: String,
    pub commit: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub line_start: Option<u32>,
    #[serde(default)]
    pub line_end: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ImportReport {
    pub document: Option<MigrationDocument>,
    pub unsupported: Vec<ImportIssue>,
    pub ambiguous: Vec<ImportIssue>,
}

/// Facts about the source snapshot carried across the migration boundary.
/// `source_fingerprint` is a stable, non-cryptographic content fingerprint;
/// an integrator may replace or supplement it with a stronger digest from its
/// source system before committing rows.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SourceProvenance {
    pub source_format: String,
    pub source_version: u32,
    pub source_fingerprint: String,
    #[serde(default)]
    pub as_of_ms: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ImportAction {
    pub collection: String,
    pub id: String,
    pub conflict_policy: String,
}

/// An explicit, side-effect-free plan for a store integrator. An unready plan
/// has no actions, so a malformed or unsupported source can never become a
/// partial write plan by accident.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ImportPlan {
    pub target_format: String,
    pub target_version: u32,
    pub source: SourceProvenance,
    pub dry_run: bool,
    pub ready: bool,
    pub actions: Vec<ImportAction>,
    pub report: ImportReport,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MigrationExport {
    pub provenance: SourceProvenance,
    pub document: MigrationDocument,
    pub document_json: String,
    pub import_plan: ImportPlan,
}

impl ImportReport {
    pub fn is_lossless(&self) -> bool {
        self.unsupported.is_empty() && self.ambiguous.is_empty()
    }

    pub fn issue_count(&self) -> usize {
        self.unsupported.len() + self.ambiguous.len()
    }

    pub fn canonicalized(&self) -> Self {
        let mut report = self.clone();
        let sort_issues = |issues: &mut Vec<ImportIssue>| {
            issues.sort_by(|left, right| {
                (
                    left.record_type.as_str(),
                    left.record_id.as_deref().unwrap_or(""),
                    left.reason.as_str(),
                )
                    .cmp(&(
                        right.record_type.as_str(),
                        right.record_id.as_deref().unwrap_or(""),
                        right.reason.as_str(),
                    ))
            });
        };
        sort_issues(&mut report.unsupported);
        sort_issues(&mut report.ambiguous);
        report
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ImportIssue {
    pub record_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_id: Option<String>,
    pub reason: String,
    pub raw: Value,
}

#[derive(Debug)]
pub enum ImportError {
    Json(serde_json::Error),
    RootMustBeObject,
    UnsupportedFormat(String),
    UnsupportedVersion(u64),
    MissingHeader(&'static str),
}

impl fmt::Display for ImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(error) => write!(formatter, "invalid migration JSON: {error}"),
            Self::RootMustBeObject => formatter.write_str("migration root must be an object"),
            Self::UnsupportedFormat(format) => {
                write!(formatter, "unsupported migration format: {format}")
            }
            Self::UnsupportedVersion(version) => {
                write!(formatter, "unsupported migration version: {version}")
            }
            Self::MissingHeader(field) => {
                write!(formatter, "migration is missing required header: {field}")
            }
        }
    }
}

impl std::error::Error for ImportError {}

impl From<serde_json::Error> for ImportError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ValidationError {
    InvalidHeader(&'static str),
    EmptyIdentifier(&'static str),
    WrongProject { record: &'static str, id: String },
    DuplicateIdentifier { record: &'static str, id: String },
    SelfParent(String),
    MissingReference { record: &'static str, id: String },
    NonClosedDependency(String),
    InvalidParentKind { parent: String, child: String },
}

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidHeader(field) => write!(formatter, "invalid migration {field}"),
            Self::EmptyIdentifier(field) => write!(formatter, "empty identifier: {field}"),
            Self::WrongProject { record, id } => {
                write!(formatter, "{record} belongs to another project: {id}")
            }
            Self::DuplicateIdentifier { record, id } => {
                write!(formatter, "duplicate {record} identifier: {id}")
            }
            Self::SelfParent(id) => write!(formatter, "work cannot parent itself: {id}"),
            Self::MissingReference { record, id } => {
                write!(formatter, "missing {record} reference: {id}")
            }
            Self::NonClosedDependency(id) => {
                write!(formatter, "dependency is not close-only: {id}")
            }
            Self::InvalidParentKind { parent, child } => {
                write!(formatter, "invalid parent kind for {child} under {parent}")
            }
        }
    }
}

impl std::error::Error for ValidationError {}

pub fn export_json(document: &MigrationDocument) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&document.canonicalized())
}

pub fn import_json(input: &str) -> Result<ImportReport, ImportError> {
    let root: Value = serde_json::from_str(input)?;
    let object = root.as_object().ok_or(ImportError::RootMustBeObject)?;

    let format = object
        .get("format")
        .and_then(Value::as_str)
        .ok_or(ImportError::MissingHeader("format"))?;
    if format != FORMAT {
        return Err(ImportError::UnsupportedFormat(format.to_owned()));
    }
    let version = object
        .get("version")
        .and_then(Value::as_u64)
        .ok_or(ImportError::MissingHeader("version"))?;
    if version != u64::from(FORMAT_VERSION) {
        return Err(ImportError::UnsupportedVersion(version));
    }

    let mut report = ImportReport {
        document: None,
        unsupported: Vec::new(),
        ambiguous: Vec::new(),
    };

    let known_top_level = [
        "format",
        "version",
        "project",
        "work",
        "dependencies",
        "attempts",
        "reservations",
        "evidence",
        "failures",
        "summaries",
        "memory",
        "git",
    ];
    for (key, value) in object {
        if !known_top_level.contains(&key.as_str()) {
            report.unsupported.push(ImportIssue {
                record_type: "top_level".to_owned(),
                record_id: Some(key.clone()),
                reason: "unsupported top-level field".to_owned(),
                raw: value.clone(),
            });
        }
    }

    let project = parse_single::<ProjectRecord>(
        object.get("project"),
        "project",
        &["id", "name", "description"],
        &mut report,
    );
    let work = parse_collection::<WorkRecord>(
        object.get("work"),
        "work",
        &[
            "id",
            "project_id",
            "kind",
            "parent_id",
            "title",
            "description",
            "lifecycle",
        ],
        &mut report,
    );
    let dependencies = parse_collection::<DependencyRecord>(
        object.get("dependencies"),
        "dependency",
        &["from_work_id", "to_work_id", "kind"],
        &mut report,
    );
    let attempts = parse_collection::<AttemptRecord>(
        object.get("attempts"),
        "attempt",
        &[
            "id",
            "work_id",
            "actor_id",
            "session_id",
            "phase",
            "claimed_at_ms",
            "hard_deadline_ms",
            "lease_expires_at_ms",
            "fence",
        ],
        &mut report,
    );
    let reservations = parse_collection::<ReservationRecord>(
        object.get("reservations"),
        "reservation",
        &[
            "id",
            "attempt_id",
            "owner_id",
            "reserved_at_ms",
            "hard_deadline_ms",
            "lease_expires_at_ms",
            "fence",
            "state",
        ],
        &mut report,
    );
    let evidence = parse_collection::<EvidenceReference>(
        object.get("evidence"),
        "evidence",
        &[
            "id",
            "work_id",
            "kind",
            "reference",
            "source_version",
            "citation",
        ],
        &mut report,
    );
    let failures = parse_collection::<FailureRecord>(
        object.get("failures"),
        "failure",
        &[
            "id",
            "work_id",
            "attempt_id",
            "code",
            "message",
            "detail",
            "occurred_at_ms",
            "retained",
        ],
        &mut report,
    );
    let summaries = parse_collection::<SummaryReference>(
        object.get("summaries"),
        "summary",
        &[
            "id",
            "work_id",
            "attempt_id",
            "fence",
            "subject_ref",
            "body_digest",
            "body_size",
            "source_version",
            "config_identity",
            "profile_id",
            "profile_version",
            "current",
        ],
        &mut report,
    );
    let memory = parse_collection::<MemoryReference>(
        object.get("memory"),
        "memory",
        &["id", "project_id", "kind", "path", "identity", "git_commit"],
        &mut report,
    );
    let git = parse_collection::<GitReference>(
        object.get("git"),
        "git",
        &[
            "id",
            "project_id",
            "repository",
            "commit",
            "path",
            "line_start",
            "line_end",
        ],
        &mut report,
    );

    if let Some(project) = project {
        let document = MigrationDocument {
            format: FORMAT.to_owned(),
            version: FORMAT_VERSION,
            project,
            work,
            dependencies,
            attempts,
            reservations,
            evidence,
            failures,
            summaries,
            memory,
            git,
        };
        if let Err(error) = document.validate() {
            report.unsupported.push(ImportIssue {
                record_type: "document".to_owned(),
                record_id: None,
                reason: error.to_string(),
                raw: serde_json::to_value(&document).expect("migration document is serializable"),
            });
        } else {
            report.document = Some(document);
        }
    }

    Ok(report)
}

fn parse_single<T>(
    raw: Option<&Value>,
    record_type: &str,
    allowed: &[&str],
    report: &mut ImportReport,
) -> Option<T>
where
    T: DeserializeOwned,
{
    let raw = raw?;
    if let Some(issue) = ambiguity(raw, record_type) {
        report.ambiguous.push(issue);
        return None;
    }
    if let Some(issue) = unsupported_fields(raw, record_type, None, allowed) {
        report.unsupported.push(issue);
        return None;
    }
    match serde_json::from_value(raw.clone()) {
        Ok(value) => Some(value),
        Err(error) => {
            report.unsupported.push(ImportIssue {
                record_type: record_type.to_owned(),
                record_id: identifier(raw),
                reason: format!("unsupported record shape: {error}"),
                raw: raw.clone(),
            });
            None
        }
    }
}

fn parse_collection<T>(
    raw: Option<&Value>,
    record_type: &str,
    allowed: &[&str],
    report: &mut ImportReport,
) -> Vec<T>
where
    T: DeserializeOwned,
{
    let Some(raw) = raw else { return Vec::new() };
    let Some(items) = raw.as_array() else {
        report.unsupported.push(ImportIssue {
            record_type: record_type.to_owned(),
            record_id: None,
            reason: "expected an array".to_owned(),
            raw: raw.clone(),
        });
        return Vec::new();
    };

    let mut parsed = Vec::new();
    for item in items {
        if let Some(issue) = ambiguity(item, record_type) {
            report.ambiguous.push(issue);
            continue;
        }
        if let Some(issue) = unsupported_fields(item, record_type, identifier(item), allowed) {
            report.unsupported.push(issue);
            continue;
        }
        match serde_json::from_value(item.clone()) {
            Ok(value) => parsed.push(value),
            Err(error) => report.unsupported.push(ImportIssue {
                record_type: record_type.to_owned(),
                record_id: identifier(item),
                reason: format!("unsupported record shape: {error}"),
                raw: item.clone(),
            }),
        }
    }
    parsed
}

fn identifier(value: &Value) -> Option<String> {
    value.get("id").and_then(Value::as_str).map(str::to_owned)
}

fn validate_unique<'a, I>(record: &'static str, identifiers: I) -> Result<(), ValidationError>
where
    I: IntoIterator<Item = &'a String>,
{
    let mut seen = BTreeMap::new();
    for identifier in identifiers {
        if seen.insert(identifier, ()).is_some() {
            return Err(ValidationError::DuplicateIdentifier {
                record,
                id: identifier.clone(),
            });
        }
    }
    Ok(())
}

/// A validated, dry-run-only import result for representative legacy records.
///
/// The plan deliberately contains no database handle and has no method that
/// writes to a store. `materialize_in_memory` is the only apply-like operation
/// and returns a validated clone of the reduced v2 document.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct LegacyImportPlan {
    pub source_format: String,
    pub source_version: u32,
    pub dry_run: bool,
    pub provenance: SourceProvenance,
    pub report: ImportReport,
}

impl LegacyImportPlan {
    pub fn is_ready(&self) -> bool {
        self.dry_run && self.report.is_lossless() && self.report.document.is_some()
    }

    pub fn materialize_in_memory(&self) -> Result<MigrationDocument, ValidationError> {
        let document = self
            .report
            .document
            .clone()
            .ok_or(ValidationError::InvalidHeader("document"))?;
        document.validate()?;
        Ok(document)
    }

    /// Build the complete write description without performing any writes.
    pub fn import_plan(&self) -> ImportPlan {
        let ready = self.is_ready();
        let actions = if ready {
            self.report
                .document
                .as_ref()
                .map(|document| import_actions(&document.canonicalized()))
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        ImportPlan {
            target_format: FORMAT.to_owned(),
            target_version: FORMAT_VERSION,
            source: self.provenance.clone(),
            dry_run: self.dry_run,
            ready,
            actions,
            report: self.report.canonicalized(),
        }
    }

    /// Materialize the validated source into a deterministic export package.
    /// Unsupported or ambiguous input returns the report and no document or
    /// actions, preserving the all-or-nothing boundary.
    pub fn materialize_export(&self) -> Result<MigrationExport, MaterializationError> {
        if !self.is_ready() {
            return Err(MaterializationError::NotReady(Box::new(self.import_plan())));
        }
        let document = self
            .materialize_in_memory()
            .map_err(MaterializationError::Validation)?
            .canonicalized();
        let document_json = export_json(&document).map_err(MaterializationError::Json)?;
        Ok(MigrationExport {
            provenance: self.provenance.clone(),
            document,
            document_json,
            import_plan: self.import_plan(),
        })
    }
}

#[derive(Debug)]
pub enum MaterializationError {
    NotReady(Box<ImportPlan>),
    Validation(ValidationError),
    Json(serde_json::Error),
}

impl fmt::Display for MaterializationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotReady(plan) => write!(
                formatter,
                "migration is not ready for materialization ({} issue(s))",
                plan.report.issue_count()
            ),
            Self::Validation(error) => write!(formatter, "migration validation failed: {error}"),
            Self::Json(error) => write!(formatter, "could not encode migration export: {error}"),
        }
    }
}

impl std::error::Error for MaterializationError {}

pub fn export_plan_json(plan: &LegacyImportPlan) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&plan.import_plan())
}

fn import_actions(document: &MigrationDocument) -> Vec<ImportAction> {
    let mut actions = Vec::new();
    actions.push(action("project", document.project.id.clone()));
    actions.extend(
        document
            .work
            .iter()
            .map(|record| action("work", record.id.clone())),
    );
    actions.extend(document.dependencies.iter().map(|record| {
        action(
            "dependency",
            format!("{}->{}", record.from_work_id, record.to_work_id),
        )
    }));
    actions.extend(
        document
            .attempts
            .iter()
            .map(|record| action("attempt", record.id.clone())),
    );
    actions.extend(
        document
            .reservations
            .iter()
            .map(|record| action("reservation", record.id.clone())),
    );
    actions.extend(
        document
            .evidence
            .iter()
            .map(|record| action("evidence", record.id.clone())),
    );
    actions.extend(
        document
            .failures
            .iter()
            .map(|record| action("failure", record.id.clone())),
    );
    actions.extend(
        document
            .summaries
            .iter()
            .map(|record| action("summary", record.id.clone())),
    );
    actions.extend(
        document
            .memory
            .iter()
            .map(|record| action("memory", record.id.clone())),
    );
    actions.extend(
        document
            .git
            .iter()
            .map(|record| action("git", record.id.clone())),
    );
    actions
}

fn action(collection: &str, id: String) -> ImportAction {
    ImportAction {
        collection: collection.to_owned(),
        id,
        conflict_policy: "reject_existing".to_owned(),
    }
}

fn source_fingerprint(input: &str) -> String {
    // FNV-1a is used here solely as a stable provenance token without adding
    // a crypto dependency to this dependency-light boundary crate.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}

#[derive(Debug)]
pub enum LegacyImportError {
    Json(serde_json::Error),
    RootMustBeObject,
    UnsupportedFormat(String),
    UnsupportedVersion(u64),
    MissingHeader(&'static str),
    MissingProject,
}

impl fmt::Display for LegacyImportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(error) => write!(formatter, "invalid legacy migration JSON: {error}"),
            Self::RootMustBeObject => {
                formatter.write_str("legacy migration root must be an object")
            }
            Self::UnsupportedFormat(format) => {
                write!(formatter, "unsupported legacy migration format: {format}")
            }
            Self::UnsupportedVersion(version) => {
                write!(formatter, "unsupported legacy migration version: {version}")
            }
            Self::MissingHeader(field) => {
                write!(
                    formatter,
                    "legacy migration is missing required header: {field}"
                )
            }
            Self::MissingProject => formatter.write_str("legacy migration is missing project"),
        }
    }
}

impl std::error::Error for LegacyImportError {}

impl From<serde_json::Error> for LegacyImportError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Debug)]
enum LegacyRecordError {
    Ambiguous(String),
    Unsupported(String),
}

/// Convert the explicit legacy fixture shape into v2 records without any
/// side effects. The accepted shape is intentionally small and versioned:
/// `project`, `work_items`, `dependencies`, `claims`, `reservations`,
/// `evidence`, `failures`, `summaries`, `memory_entries`, and `git_refs`.
pub fn import_legacy_json(input: &str) -> Result<LegacyImportPlan, LegacyImportError> {
    let root: Value = serde_json::from_str(input)?;
    let object = root
        .as_object()
        .ok_or(LegacyImportError::RootMustBeObject)?;
    let format = object
        .get("format")
        .and_then(Value::as_str)
        .ok_or(LegacyImportError::MissingHeader("format"))?;
    if format != LEGACY_FORMAT {
        return Err(LegacyImportError::UnsupportedFormat(format.to_owned()));
    }
    let version = object
        .get("version")
        .and_then(Value::as_u64)
        .ok_or(LegacyImportError::MissingHeader("version"))?;
    if version != u64::from(LEGACY_FORMAT_VERSION) {
        return Err(LegacyImportError::UnsupportedVersion(version));
    }

    let mut report = ImportReport {
        document: None,
        unsupported: Vec::new(),
        ambiguous: Vec::new(),
    };
    let known_top_level = [
        "format",
        "version",
        "as_of_ms",
        "project",
        "work_items",
        "work",
        "dependencies",
        "claims",
        "attempts",
        "reservations",
        "evidence",
        "failures",
        "summaries",
        "memory_entries",
        "memory",
        "git_refs",
        "git",
    ];
    for (key, value) in object {
        if !known_top_level.contains(&key.as_str()) {
            report.unsupported.push(ImportIssue {
                record_type: "top_level".to_owned(),
                record_id: Some(key.clone()),
                reason: "unsupported legacy top-level field".to_owned(),
                raw: value.clone(),
            });
        }
    }

    let project = parse_legacy_project(object.get("project"), &mut report);
    let project = project.ok_or(LegacyImportError::MissingProject)?;
    let as_of_ms = object.get("as_of_ms").and_then(Value::as_u64);
    let project_id = project.id.clone();

    let work = legacy_collection(
        first_present(object, &["work_items", "work"], "work", &mut report),
        "work",
        &[
            "id",
            "uuid",
            "project_id",
            "kind",
            "type",
            "parent_id",
            "parent",
            "title",
            "name",
            "description",
            "lifecycle",
            "status",
        ],
        &mut report,
        |item| parse_legacy_work(item, &project_id),
    );
    let dependencies = legacy_collection(
        object.get("dependencies"),
        "dependency",
        &[
            "id",
            "dependent_id",
            "prerequisite_id",
            "from_work_id",
            "to_work_id",
            "kind",
            "type",
            "policy",
        ],
        &mut report,
        parse_legacy_dependency,
    );
    let attempts = legacy_collection(
        first_present(object, &["claims", "attempts"], "attempt", &mut report),
        "attempt",
        &[
            "id",
            "uuid",
            "work_id",
            "item_id",
            "actor_id",
            "owner_id",
            "session_id",
            "status",
            "phase",
            "claimed_at_ms",
            "started_at_ms",
            "hard_deadline_ms",
            "deadline_ms",
            "max_attempt_deadline_ms",
            "lease_expires_at_ms",
            "lease_deadline_ms",
            "fence",
        ],
        &mut report,
        |item| parse_legacy_attempt(item, as_of_ms),
    );
    let reservations = legacy_collection(
        object.get("reservations"),
        "reservation",
        &[
            "id",
            "reservation_id",
            "attempt_id",
            "claim_id",
            "owner_id",
            "reserved_at_ms",
            "created_at_ms",
            "hard_deadline_ms",
            "deadline_ms",
            "lease_expires_at_ms",
            "lease_deadline_ms",
            "fence",
            "state",
            "status",
        ],
        &mut report,
        |item| parse_legacy_reservation(item, as_of_ms),
    );
    let evidence = legacy_collection(
        object.get("evidence"),
        "evidence",
        &[
            "id",
            "work_id",
            "item_id",
            "kind",
            "type",
            "reference",
            "ref",
            "path",
            "source_version",
            "citation",
        ],
        &mut report,
        parse_legacy_evidence,
    );
    let failures = legacy_collection(
        object.get("failures"),
        "failure",
        &[
            "id",
            "work_id",
            "item_id",
            "attempt_id",
            "claim_id",
            "code",
            "reason",
            "message",
            "detail",
            "occurred_at_ms",
            "failed_at_ms",
            "retained",
        ],
        &mut report,
        parse_legacy_failure,
    );
    let summaries = legacy_collection(
        object.get("summaries"),
        "summary",
        &[
            "id",
            "work_id",
            "item_id",
            "attempt_id",
            "claim_id",
            "fence",
            "subject_ref",
            "subject",
            "body_digest",
            "digest",
            "body_size",
            "size",
            "source_version",
            "config_identity",
            "profile_id",
            "profile_version",
            "current",
        ],
        &mut report,
        parse_legacy_summary,
    );
    let memory = legacy_collection(
        first_present(object, &["memory_entries", "memory"], "memory", &mut report),
        "memory",
        &[
            "id",
            "project_id",
            "kind",
            "type",
            "path",
            "identity",
            "digest",
            "git_commit",
            "commit",
        ],
        &mut report,
        |item| parse_legacy_memory(item, &project_id),
    );
    let git = legacy_collection(
        first_present(object, &["git_refs", "git"], "git", &mut report),
        "git",
        &[
            "id",
            "project_id",
            "repository",
            "repo",
            "commit",
            "revision",
            "path",
            "line_start",
            "line_end",
        ],
        &mut report,
        |item| parse_legacy_git(item, &project_id),
    );

    let document = MigrationDocument {
        format: FORMAT.to_owned(),
        version: FORMAT_VERSION,
        project,
        work,
        dependencies,
        attempts,
        reservations,
        evidence,
        failures,
        summaries,
        memory,
        git,
    };
    match document.validate() {
        Ok(()) => report.document = Some(document),
        Err(error) => report.unsupported.push(ImportIssue {
            record_type: "document".to_owned(),
            record_id: None,
            reason: error.to_string(),
            raw: serde_json::to_value(&document).expect("migration document is serializable"),
        }),
    }

    Ok(LegacyImportPlan {
        source_format: LEGACY_FORMAT.to_owned(),
        source_version: LEGACY_FORMAT_VERSION,
        dry_run: true,
        provenance: SourceProvenance {
            source_format: LEGACY_FORMAT.to_owned(),
            source_version: LEGACY_FORMAT_VERSION,
            source_fingerprint: source_fingerprint(input),
            as_of_ms,
        },
        report,
    })
}

fn first_present<'a>(
    object: &'a serde_json::Map<String, Value>,
    names: &[&str],
    record_type: &str,
    report: &mut ImportReport,
) -> Option<&'a Value> {
    let present: Vec<(&str, &Value)> = names
        .iter()
        .filter_map(|name| object.get(*name).map(|value| (*name, value)))
        .collect();
    if present.len() <= 1 {
        return present.first().map(|(_, value)| *value);
    }

    let mut raw = serde_json::Map::new();
    for (name, value) in &present {
        raw.insert((*name).to_owned(), (*value).clone());
    }
    report.ambiguous.push(ImportIssue {
        record_type: record_type.to_owned(),
        record_id: None,
        reason: format!(
            "multiple legacy collection aliases are present: {}",
            present
                .iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>()
                .join(", ")
        ),
        raw: Value::Object(raw),
    });
    None
}

fn parse_legacy_project(raw: Option<&Value>, report: &mut ImportReport) -> Option<ProjectRecord> {
    let raw = raw?;
    let map = match raw.as_object() {
        Some(map) => map,
        None => {
            report.unsupported.push(ImportIssue {
                record_type: "project".to_owned(),
                record_id: None,
                reason: "expected an object".to_owned(),
                raw: raw.clone(),
            });
            return None;
        }
    };
    if let Some(issue) = legacy_ambiguity(raw, "project") {
        report.ambiguous.push(issue);
        return None;
    }
    if let Some(issue) = unsupported_fields(
        raw,
        "project",
        legacy_identifier(raw),
        &["id", "uuid", "name", "title", "description"],
    ) {
        report.unsupported.push(issue);
        return None;
    }
    let id = match string_field(map, &["id", "uuid"], "id") {
        Ok(Some(id)) if !id.is_empty() => id,
        Ok(_) => {
            report
                .unsupported
                .push(issue(raw, "project", "project id is required"));
            return None;
        }
        Err(error) => {
            let reason = match error {
                LegacyRecordError::Ambiguous(reason) | LegacyRecordError::Unsupported(reason) => {
                    reason
                }
            };
            report.unsupported.push(issue(raw, "project", reason));
            return None;
        }
    };
    let name = match string_field(map, &["name", "title"], "name") {
        Ok(Some(name)) if !name.is_empty() => name,
        Ok(_) => {
            report
                .unsupported
                .push(issue(raw, "project", "project name is required"));
            return None;
        }
        Err(error) => {
            let reason = match error {
                LegacyRecordError::Ambiguous(reason) | LegacyRecordError::Unsupported(reason) => {
                    reason
                }
            };
            report.unsupported.push(issue(raw, "project", reason));
            return None;
        }
    };
    Some(ProjectRecord {
        id,
        name,
        description: optional_string(map, &["description"]).unwrap_or_default(),
    })
}

fn legacy_collection<T, F>(
    raw: Option<&Value>,
    record_type: &str,
    allowed: &[&str],
    report: &mut ImportReport,
    mut convert: F,
) -> Vec<T>
where
    F: FnMut(&serde_json::Map<String, Value>) -> Result<T, LegacyRecordError>,
{
    let Some(raw) = raw else { return Vec::new() };
    let Some(items) = raw.as_array() else {
        report
            .unsupported
            .push(issue_value(raw, record_type, None, "expected an array"));
        return Vec::new();
    };
    let mut parsed = Vec::new();
    for item in items {
        let Some(map) = item.as_object() else {
            report
                .unsupported
                .push(issue_value(item, record_type, None, "expected an object"));
            continue;
        };
        if let Some(issue) = legacy_ambiguity(item, record_type) {
            report.ambiguous.push(issue);
            continue;
        }
        if let Some(issue) = unsupported_fields(item, record_type, legacy_identifier(item), allowed)
        {
            report.unsupported.push(issue);
            continue;
        }
        match convert(map) {
            Ok(value) => parsed.push(value),
            Err(LegacyRecordError::Ambiguous(reason)) => report.ambiguous.push(issue_value(
                item,
                record_type,
                legacy_identifier(item),
                &reason,
            )),
            Err(LegacyRecordError::Unsupported(reason)) => report.unsupported.push(issue_value(
                item,
                record_type,
                legacy_identifier(item),
                &reason,
            )),
        }
    }
    parsed
}

fn parse_legacy_work(
    map: &serde_json::Map<String, Value>,
    project_id: &str,
) -> Result<WorkRecord, LegacyRecordError> {
    let id = required_string(map, &["id", "uuid"], "id")?;
    let record_project =
        optional_string(map, &["project_id"]).unwrap_or_else(|| project_id.to_owned());
    let kind = match required_string(map, &["kind", "type"], "kind")?.as_str() {
        "milestone" | "phase" => WorkKind::Milestone,
        "sprint" | "iteration" => WorkKind::Sprint,
        "task" | "issue" => WorkKind::Task,
        other => {
            return Err(LegacyRecordError::Unsupported(format!(
                "unsupported work kind: {other}"
            )))
        }
    };
    let parent_id =
        optional_string(map, &["parent_id", "parent"]).filter(|value| !value.is_empty());
    let title = optional_string(map, &["title", "name"])
        .filter(|value| !value.is_empty())
        .ok_or_else(|| LegacyRecordError::Unsupported("work title is required".to_owned()))?;
    let lifecycle = match optional_string(map, &["lifecycle", "status"])
        .unwrap_or_else(|| "open".to_owned())
        .to_ascii_lowercase()
        .as_str()
    {
        "draft" | "planned" => Lifecycle::Draft,
        "open" | "active" | "ready" | "in_progress" => Lifecycle::Open,
        "closed" | "done" | "complete" | "completed" | "archived" => Lifecycle::Closed,
        "cancelled" | "canceled" => Lifecycle::Cancelled,
        other => {
            return Err(LegacyRecordError::Unsupported(format!(
                "unsupported work lifecycle: {other}"
            )))
        }
    };
    Ok(WorkRecord {
        id,
        project_id: record_project,
        kind,
        parent_id,
        title,
        description: optional_string(map, &["description"]).unwrap_or_default(),
        lifecycle,
    })
}

fn parse_legacy_dependency(
    map: &serde_json::Map<String, Value>,
) -> Result<DependencyRecord, LegacyRecordError> {
    let (from_work_id, to_work_id) =
        if map.contains_key("dependent_id") || map.contains_key("prerequisite_id") {
            (
                required_string(map, &["dependent_id"], "dependent_id")?,
                required_string(map, &["prerequisite_id"], "prerequisite_id")?,
            )
        } else {
            (
                required_string(map, &["from_work_id"], "from_work_id")?,
                required_string(map, &["to_work_id"], "to_work_id")?,
            )
        };
    let kind = match required_string(map, &["kind", "type", "policy"], "kind")?
        .to_ascii_lowercase()
        .as_str()
    {
        "closed_only" | "close_only" | "closed" | "blocks_until_closed" => {
            DependencyKind::ClosedOnly
        }
        other => {
            return Err(LegacyRecordError::Unsupported(format!(
                "dependency meaning is not safely representable: {other}"
            )))
        }
    };
    Ok(DependencyRecord {
        from_work_id,
        to_work_id,
        kind,
    })
}

fn parse_legacy_attempt(
    map: &serde_json::Map<String, Value>,
    as_of_ms: Option<u64>,
) -> Result<AttemptRecord, LegacyRecordError> {
    let id = required_string(map, &["id", "uuid"], "id")?;
    let work_id = required_string(map, &["work_id", "item_id"], "work_id")?;
    let actor_id = optional_string(map, &["actor_id", "owner_id"])
        .ok_or_else(|| LegacyRecordError::Unsupported("attempt actor_id is required".to_owned()))?;
    let claimed_at_ms =
        optional_u64(map, &["claimed_at_ms", "started_at_ms"]).ok_or_else(|| {
            LegacyRecordError::Unsupported("attempt claimed_at_ms is required".to_owned())
        })?;
    let hard_deadline_ms = optional_u64(
        map,
        &["hard_deadline_ms", "max_attempt_deadline_ms", "deadline_ms"],
    )
    .unwrap_or_else(|| claimed_at_ms.saturating_add(7_200_000));
    let lease_expires_at_ms = optional_u64(map, &["lease_expires_at_ms", "lease_deadline_ms"])
        .ok_or_else(|| {
            LegacyRecordError::Unsupported("attempt lease expiry is required".to_owned())
        })?;
    let fence = optional_u64(map, &["fence"]).unwrap_or(1);
    let mut phase = match optional_string(map, &["phase", "status"])
        .unwrap_or_else(|| "reserved".to_owned())
        .to_ascii_lowercase()
        .as_str()
    {
        "reserved" | "claimed" => AttemptPhase::Reserved,
        "accepted" => AttemptPhase::Accepted,
        "in_progress" | "running" | "started" => AttemptPhase::InProgress,
        "submitted" | "verifying" => AttemptPhase::Submitted,
        "released" => AttemptPhase::Released,
        "failed" | "failure" => AttemptPhase::Failed,
        "expired" | "expiry_pending" => AttemptPhase::Expired,
        "cancelled" | "canceled" => AttemptPhase::Cancelled,
        other => {
            return Err(LegacyRecordError::Unsupported(format!(
                "unsupported attempt phase: {other}"
            )))
        }
    };
    if phase_is_live(phase) && as_of_ms.is_some_and(|now| lease_expires_at_ms <= now) {
        phase = AttemptPhase::Expired;
    }
    Ok(AttemptRecord {
        id,
        work_id,
        actor_id,
        session_id: optional_string(map, &["session_id"]),
        phase,
        claimed_at_ms,
        hard_deadline_ms,
        lease_expires_at_ms,
        fence,
    })
}

fn parse_legacy_reservation(
    map: &serde_json::Map<String, Value>,
    as_of_ms: Option<u64>,
) -> Result<ReservationRecord, LegacyRecordError> {
    let attempt_id = required_string(map, &["attempt_id", "claim_id"], "attempt_id")?;
    let id = optional_string(map, &["id", "reservation_id"])
        .unwrap_or_else(|| format!("reservation:{attempt_id}"));
    let reserved_at_ms =
        optional_u64(map, &["reserved_at_ms", "created_at_ms"]).ok_or_else(|| {
            LegacyRecordError::Unsupported("reservation reserved_at_ms is required".to_owned())
        })?;
    let hard_deadline_ms = optional_u64(map, &["hard_deadline_ms", "deadline_ms"])
        .unwrap_or_else(|| reserved_at_ms.saturating_add(7_200_000));
    let lease_expires_at_ms = optional_u64(map, &["lease_expires_at_ms", "lease_deadline_ms"])
        .ok_or_else(|| {
            LegacyRecordError::Unsupported("reservation lease expiry is required".to_owned())
        })?;
    let state = optional_string(map, &["state", "status"])
        .unwrap_or_else(|| "active".to_owned())
        .to_ascii_lowercase();
    let state = match state.as_str() {
        "released" => ReservationState::Released,
        "expired" => ReservationState::Expired,
        "active" if as_of_ms.is_some_and(|now| lease_expires_at_ms <= now) => {
            ReservationState::Expired
        }
        "active" => ReservationState::Active,
        other => {
            return Err(LegacyRecordError::Unsupported(format!(
                "unsupported reservation state: {other}"
            )))
        }
    };
    let owner_id = optional_string(map, &["owner_id"]).ok_or_else(|| {
        LegacyRecordError::Unsupported("reservation owner_id is required".to_owned())
    })?;
    let fence = optional_u64(map, &["fence"]).unwrap_or(1);
    Ok(ReservationRecord {
        id,
        attempt_id,
        owner_id,
        reserved_at_ms,
        hard_deadline_ms,
        lease_expires_at_ms,
        fence,
        state,
    })
}

fn parse_legacy_evidence(
    map: &serde_json::Map<String, Value>,
) -> Result<EvidenceReference, LegacyRecordError> {
    let id = required_string(map, &["id"], "id")?;
    let work_id = required_string(map, &["work_id", "item_id"], "work_id")?;
    let kind = match required_string(map, &["kind", "type"], "kind")?
        .to_ascii_lowercase()
        .as_str()
    {
        "source" => EvidenceKind::Source,
        "file" | "artifact" => EvidenceKind::File,
        "test" | "test_result" => EvidenceKind::Test,
        "command" | "log" => EvidenceKind::Command,
        "review" => EvidenceKind::Review,
        other => {
            return Err(LegacyRecordError::Unsupported(format!(
                "unsupported evidence kind: {other}"
            )))
        }
    };
    let reference = optional_string(map, &["reference", "ref", "path"]).ok_or_else(|| {
        LegacyRecordError::Unsupported("evidence reference is required".to_owned())
    })?;
    Ok(EvidenceReference {
        id,
        work_id,
        kind,
        reference,
        source_version: optional_string(map, &["source_version"]),
        citation: optional_string(map, &["citation"]),
    })
}

fn parse_legacy_failure(
    map: &serde_json::Map<String, Value>,
) -> Result<FailureRecord, LegacyRecordError> {
    let id = required_string(map, &["id"], "id")?;
    let work_id = required_string(map, &["work_id", "item_id"], "work_id")?;
    let code = optional_string(map, &["code"]).unwrap_or_else(|| "legacy_failure".to_owned());
    let message = optional_string(map, &["message", "reason"])
        .ok_or_else(|| LegacyRecordError::Unsupported("failure message is required".to_owned()))?;
    let occurred_at_ms = optional_u64(map, &["occurred_at_ms", "failed_at_ms"]).unwrap_or(0);
    Ok(FailureRecord {
        id,
        work_id,
        attempt_id: optional_string(map, &["attempt_id", "claim_id"]),
        code,
        message,
        detail: map.get("detail").cloned().unwrap_or(Value::Null),
        occurred_at_ms,
        retained: map.get("retained").and_then(Value::as_bool).unwrap_or(true),
    })
}

fn parse_legacy_summary(
    map: &serde_json::Map<String, Value>,
) -> Result<SummaryReference, LegacyRecordError> {
    let id = required_string(map, &["id"], "id")?;
    let work_id = required_string(map, &["work_id", "item_id"], "work_id")?;
    let body_digest = required_string(map, &["body_digest", "digest"], "body_digest")?;
    Ok(SummaryReference {
        id,
        work_id,
        attempt_id: optional_string(map, &["attempt_id", "claim_id"]),
        fence: optional_u64(map, &["fence"]),
        subject_ref: optional_string(map, &["subject_ref", "subject"]).unwrap_or_default(),
        body_digest,
        body_size: optional_u64(map, &["body_size", "size"]).unwrap_or(0),
        source_version: optional_string(map, &["source_version"]),
        config_identity: optional_string(map, &["config_identity"]),
        profile_id: optional_string(map, &["profile_id"]),
        profile_version: optional_u64(map, &["profile_version"]).map(|value| value as u32),
        current: map.get("current").and_then(Value::as_bool).unwrap_or(true),
    })
}

fn parse_legacy_memory(
    map: &serde_json::Map<String, Value>,
    project_id: &str,
) -> Result<MemoryReference, LegacyRecordError> {
    let id = required_string(map, &["id"], "id")?;
    Ok(MemoryReference {
        id,
        project_id: optional_string(map, &["project_id"]).unwrap_or_else(|| project_id.to_owned()),
        kind: match optional_string(map, &["kind", "type"])
            .unwrap_or_else(|| "entry".to_owned())
            .as_str()
        {
            "source" => MemoryKind::Source,
            "entry" | "memory" => MemoryKind::Entry,
            other => {
                return Err(LegacyRecordError::Unsupported(format!(
                    "unsupported memory kind: {other}"
                )))
            }
        },
        path: required_string(map, &["path"], "path")?,
        identity: required_string(map, &["identity", "digest"], "identity")?,
        git_commit: optional_string(map, &["git_commit", "commit"]),
    })
}

fn parse_legacy_git(
    map: &serde_json::Map<String, Value>,
    project_id: &str,
) -> Result<GitReference, LegacyRecordError> {
    let id = required_string(map, &["id"], "id")?;
    Ok(GitReference {
        id,
        project_id: optional_string(map, &["project_id"]).unwrap_or_else(|| project_id.to_owned()),
        repository: required_string(map, &["repository", "repo"], "repository")?,
        commit: required_string(map, &["commit", "revision"], "commit")?,
        path: optional_string(map, &["path"]),
        line_start: optional_u64(map, &["line_start"]).map(|value| value as u32),
        line_end: optional_u64(map, &["line_end"]).map(|value| value as u32),
    })
}

fn phase_is_live(phase: AttemptPhase) -> bool {
    matches!(
        phase,
        AttemptPhase::Reserved
            | AttemptPhase::Accepted
            | AttemptPhase::InProgress
            | AttemptPhase::Submitted
    )
}

fn required_string(
    map: &serde_json::Map<String, Value>,
    names: &[&str],
    field: &str,
) -> Result<String, LegacyRecordError> {
    string_field(map, names, field)?
        .ok_or_else(|| LegacyRecordError::Unsupported(format!("{field} is required")))
}

fn string_field(
    map: &serde_json::Map<String, Value>,
    names: &[&str],
    field: &str,
) -> Result<Option<String>, LegacyRecordError> {
    let values = names.iter().filter_map(|name| map.get(*name));
    let mut selected = None;
    for value in values {
        let Some(value) = value.as_str() else {
            return Err(LegacyRecordError::Unsupported(format!(
                "{field} must be a string"
            )));
        };
        if selected
            .as_deref()
            .is_some_and(|previous| previous != value)
        {
            return Err(LegacyRecordError::Ambiguous(format!(
                "conflicting values for {field}"
            )));
        }
        selected = Some(value.to_owned());
    }
    Ok(selected)
}

fn optional_string(map: &serde_json::Map<String, Value>, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| map.get(*name))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn optional_u64(map: &serde_json::Map<String, Value>, names: &[&str]) -> Option<u64> {
    names
        .iter()
        .find_map(|name| map.get(*name))
        .and_then(Value::as_u64)
}

fn legacy_identifier(value: &Value) -> Option<String> {
    value
        .get("id")
        .or_else(|| value.get("uuid"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn legacy_ambiguity(value: &Value, record_type: &str) -> Option<ImportIssue> {
    let object = value.as_object()?;
    for aliases in [["id", "uuid"], ["kind", "type"], ["status", "phase"]] {
        if let (Some(left), Some(right)) = (object.get(aliases[0]), object.get(aliases[1])) {
            if left != right {
                return Some(issue_value(
                    value,
                    record_type,
                    legacy_identifier(value),
                    format!(
                        "conflicting legacy fields: {} and {}",
                        aliases[0], aliases[1]
                    ),
                ));
            }
        }
    }
    None
}

fn issue(value: &Value, record_type: &str, reason: impl Into<String>) -> ImportIssue {
    issue_value(value, record_type, legacy_identifier(value), reason)
}

fn issue_value(
    value: &Value,
    record_type: &str,
    record_id: Option<String>,
    reason: impl Into<String>,
) -> ImportIssue {
    ImportIssue {
        record_type: record_type.to_owned(),
        record_id,
        reason: reason.into(),
        raw: value.clone(),
    }
}

fn ambiguity(value: &Value, record_type: &str) -> Option<ImportIssue> {
    let object = value.as_object()?;
    let pairs = [
        ("id", "uuid"),
        ("parent_id", "parent"),
        ("work_id", "task_id"),
    ];
    for (first, second) in pairs {
        if let (Some(left), Some(right)) = (object.get(first), object.get(second)) {
            if left != right {
                return Some(ImportIssue {
                    record_type: record_type.to_owned(),
                    record_id: identifier(value),
                    reason: format!("conflicting {first} and {second} values"),
                    raw: value.clone(),
                });
            }
        }
    }
    None
}

fn unsupported_fields(
    value: &Value,
    record_type: &str,
    record_id: Option<String>,
    allowed: &[&str],
) -> Option<ImportIssue> {
    let object = value.as_object()?;
    let unknown: Vec<&str> = object
        .keys()
        .map(String::as_str)
        .filter(|key| !allowed.contains(key))
        .collect();
    if unknown.is_empty() {
        return None;
    }
    Some(ImportIssue {
        record_type: record_type.to_owned(),
        record_id,
        reason: format!("unsupported fields: {}", unknown.join(", ")),
        raw: value.clone(),
    })
}
