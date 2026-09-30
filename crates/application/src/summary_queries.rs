//! Bounded, project-scoped read models for durable closeout summaries.
use boreal_store::{
    SqliteStore, StoreError, SummaryArtifactPage, SummaryArtifactRecord, SummaryRecord,
};

pub struct SummaryQueries<'a> {
    store: &'a SqliteStore,
}
impl<'a> SummaryQueries<'a> {
    pub fn new(store: &'a SqliteStore) -> Self {
        Self { store }
    }

    pub fn show(
        &self,
        project_id: &str,
        summary_id: &str,
    ) -> Result<SummaryArtifactRecord, StoreError> {
        if project_id.trim().is_empty() || summary_id.trim().is_empty() {
            return Err(StoreError::Invalid(
                "project and summary ids are required".into(),
            ));
        }
        self.store
            .summary_artifact(project_id, summary_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "summary",
                id: summary_id.to_owned(),
            })
    }

    pub fn current_for_work(
        &self,
        project_id: &str,
        work_id: &str,
    ) -> Result<Option<SummaryArtifactRecord>, StoreError> {
        if project_id.trim().is_empty() || work_id.trim().is_empty() {
            return Err(StoreError::Invalid(
                "project and work ids are required".into(),
            ));
        }
        let Some(summary) = self.store.current_summary(project_id, work_id)? else {
            return Ok(None);
        };
        let artifact = self
            .store
            .summary_artifact(project_id, &summary.summary_id)?;
        if let Some(artifact) = &artifact {
            validate_body(artifact)?;
        }
        Ok(artifact)
    }

    /// Returns a bounded newest-first page, including superseded history.
    pub fn list(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<SummaryArtifactPage, StoreError> {
        if project_id.trim().is_empty() {
            return Err(StoreError::Invalid("project id is required".into()));
        }
        self.store
            .summary_artifact_list(project_id, work_id, limit, offset)
    }

    /// Compatibility helper for output paths that need metadata only.
    pub fn metadata(
        &self,
        project_id: &str,
        summary_id: &str,
    ) -> Result<SummaryRecord, StoreError> {
        Ok(self.show(project_id, summary_id)?.summary)
    }
}

fn validate_body(artifact: &SummaryArtifactRecord) -> Result<(), StoreError> {
    if let Some(body) = &artifact.body {
        if body.len() as u64 != artifact.summary.body_size
            || crate::sha256_content_digest(body.as_bytes()) != artifact.summary.body_digest
        {
            return Err(StoreError::Corrupt(format!(
                "summary body {} fails digest/size validation",
                artifact.summary.summary_id
            )));
        }
    }
    Ok(())
}

impl crate::WorkApplication<'_> {
    /// Proof-bound summary create with atomic immutable body persistence.
    #[allow(clippy::too_many_arguments)]
    pub fn record_summary_with_body(
        &self,
        project_id: &str,
        actor_id: &str,
        session_id: Option<&str>,
        summary: &crate::SummaryPayload,
        body: &str,
        operation_id: &str,
        expected_project_revision: Option<u64>,
        now: boreal_domain::TimestampMs,
    ) -> Result<boreal_store::SummaryInsertResult, crate::ApplicationError> {
        summary.validate().map_err(crate::ApplicationError::from)?;
        if body.is_empty()
            || body.len() as u64 != summary.body_size
            || crate::sha256_content_digest(body.as_bytes()) != summary.body_digest
        {
            return Err(crate::ApplicationError::Invalid(
                "summary body bytes do not match the declared digest and size".into(),
            ));
        }
        let profile_version = summary.profile_version.parse::<u64>().map_err(|_| {
            crate::ApplicationError::Invalid(
                "summary profile version must be a positive integer".into(),
            )
        })?;
        let request = boreal_store::SummaryInsertRequest {
            project_id: project_id.to_owned(),
            actor_id: actor_id.to_owned(),
            session_id: session_id.map(str::to_owned),
            expected_project_revision,
            summary_id: summary.summary_id.clone(),
            work_id: summary.work_id.as_str().to_owned(),
            attempt_id: summary.attempt_id.as_str().to_owned(),
            fence: summary.fence.get(),
            source_version_id: summary.source_snapshot_hash.as_str().to_owned(),
            config_identity: summary.config_identity.as_str().to_owned(),
            profile_id: summary.profile_id.as_str().to_owned(),
            profile_version,
            body_digest: summary.body_digest.clone(),
            body_size: summary.body_size,
            operation_id: operation_id.to_owned(),
            created_at: format!("{}", now.as_millis()),
        };
        Ok(self
            .store_ref()
            .insert_summary_with_body(&request, body, &summary.body_digest)?)
    }
}
