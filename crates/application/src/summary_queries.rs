//! Bounded, project-scoped read models for durable closeout summaries.
use boreal_store::{
    SqliteStore, StoreError, SummaryArtifactPage, SummaryArtifactRecord, SummaryRecord,
};

/// Maximum UTF-8 body bytes returned by one public summary readback page.
/// This leaves room for worst-case JSON escaping and envelope metadata under
/// the protocol's 64 KiB inline response bound.
pub const MAX_SUMMARY_BODY_PAGE_BYTES: u64 = 4 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SummaryBodyPage {
    pub body: String,
    pub body_offset: u64,
    pub next_body_offset: Option<u64>,
    pub body_size: u64,
}

/// Returns a UTF-8-safe slice bounded by the public summary response limit.
/// Offsets are byte offsets; an offset inside a code point advances to the
/// next code-point boundary so callers can continue without duplicate bytes.
pub fn summary_body_page(body: &str, offset: u64, limit: Option<u64>) -> SummaryBodyPage {
    let requested_limit = limit
        .unwrap_or(MAX_SUMMARY_BODY_PAGE_BYTES)
        .clamp(1, MAX_SUMMARY_BODY_PAGE_BYTES) as usize;
    let mut start = usize::try_from(offset)
        .unwrap_or(usize::MAX)
        .min(body.len());
    while start < body.len() && !body.is_char_boundary(start) {
        start += 1;
    }

    let mut end = start;
    for (relative, character) in body[start..].char_indices() {
        let next = start + relative + character.len_utf8();
        if next - start > requested_limit && end > start {
            break;
        }
        end = next;
        if end - start >= requested_limit {
            break;
        }
    }
    let next_body_offset = (end < body.len()).then_some(end as u64);
    SummaryBodyPage {
        body: body[start..end].to_owned(),
        body_offset: start as u64,
        next_body_offset,
        body_size: body.len() as u64,
    }
}

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
        let artifact = self
            .store
            .summary_artifact(project_id, summary_id)?
            .ok_or_else(|| StoreError::NotFound {
                entity: "summary",
                id: summary_id.to_owned(),
            })?;
        validate_body(&artifact)?;
        Ok(artifact)
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

    /// Reads the summary sealed for an exact current final-result proof. A
    /// matching submission is required, and every result identity in its
    /// summary is checked against the immutable result binding.
    pub fn final_result_for_proof(
        &self,
        project_id: &str,
        work_id: &str,
        proof_revision: u64,
    ) -> Result<Option<SummaryArtifactRecord>, StoreError> {
        if project_id.trim().is_empty() || work_id.trim().is_empty() || proof_revision == 0 {
            return Err(StoreError::Invalid(
                "project, work, and positive proof revision are required".into(),
            ));
        }
        let acceptance = boreal_store::acceptance::AcceptanceStore::new(self.store);
        let Some(binding) = acceptance.current_final_result(project_id, work_id, proof_revision)?
        else {
            return Ok(None);
        };
        let Some(submission) =
            self.store
                .current_submission(project_id, work_id, proof_revision)?
        else {
            return Ok(None);
        };
        if submission.attempt_id != binding.attempt_id
            || submission.fence != binding.fence
            || submission.entity_revision != binding.entity_revision
            || submission.source_version_id != binding.source_version_id
            || submission.config_identity != binding.config_identity
            || submission.profile_id != binding.profile_id
            || submission.profile_version != binding.profile_version
            || submission.profile_digest != binding.profile_digest
        {
            return Err(StoreError::Corrupt(
                "submission does not match the final-result binding for its proof".into(),
            ));
        }
        let Some(artifact) = self
            .store
            .summary_artifact(project_id, &submission.summary_id)?
        else {
            return Err(StoreError::Corrupt(
                "sealed submission refers to a missing summary artifact".into(),
            ));
        };
        validate_body(&artifact)?;
        if artifact.body.is_none()
            || artifact.summary.work_id != work_id
            || artifact.summary.attempt_id != binding.attempt_id
            || artifact.summary.fence != binding.fence
            || artifact.summary.source_version_id != binding.source_version_id
            || artifact.summary.config_identity != binding.config_identity
            || artifact.summary.profile_id != binding.profile_id
            || artifact.summary.profile_version != binding.profile_version
        {
            return Err(StoreError::Corrupt(
                "summary artifact does not match the final-result proof or has no durable body"
                    .into(),
            ));
        }
        Ok(Some(artifact))
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
        let page = self
            .store
            .summary_artifact_list(project_id, work_id, limit, offset)?;
        for item in &page.items {
            validate_body(item)?;
        }
        Ok(page)
    }

    /// Returns a bounded summary page without inline bodies. Each row keeps
    /// its durable summary identity so a caller can fetch body pages with
    /// `show` instead of hydrating every retained body in one response.
    pub fn list_metadata(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<SummaryArtifactPage, StoreError> {
        let mut page = self.list(project_id, work_id, limit, offset)?;
        for item in &mut page.items {
            item.body = None;
        }
        Ok(page)
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
    /// Project-scoped summary readback includes and validates the retained
    /// immutable body bytes, so a reopened client can display the delivered
    /// closeout without relying on the original input file.
    pub fn read_summary_artifact(
        &self,
        project_id: &str,
        summary_id: &str,
    ) -> Result<SummaryArtifactRecord, crate::ApplicationError> {
        Ok(SummaryQueries::new(self.store_ref()).show(project_id, summary_id)?)
    }

    pub fn read_summary_artifacts(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<SummaryArtifactPage, crate::ApplicationError> {
        Ok(SummaryQueries::new(self.store_ref()).list(project_id, work_id, limit, offset)?)
    }

    pub fn read_summary_artifact_metadata(
        &self,
        project_id: &str,
        work_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> Result<SummaryArtifactPage, crate::ApplicationError> {
        Ok(SummaryQueries::new(self.store_ref())
            .list_metadata(project_id, work_id, limit, offset)?)
    }

    pub fn read_final_result_summary(
        &self,
        project_id: &str,
        work_id: &str,
        proof_revision: u64,
    ) -> Result<Option<SummaryArtifactRecord>, crate::ApplicationError> {
        Ok(
            SummaryQueries::new(self.store_ref()).final_result_for_proof(
                project_id,
                work_id,
                proof_revision,
            )?,
        )
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_body_pages_are_bounded_utf8_safe_and_concatenate_exactly() {
        let body = format!("{}{}{}", "\u{1}".repeat(9_000), "λ🙂e\u{301}", "\nend");
        let mut offset = 0;
        let mut assembled = String::new();
        loop {
            let page = summary_body_page(&body, offset, None);
            assert!(page.body.len() <= MAX_SUMMARY_BODY_PAGE_BYTES as usize + 3);
            assert_eq!(page.body_offset, offset);
            let encoded = serde_json::to_vec(&serde_json::json!({
                "summary_id": "summary-test",
                "body": page.body,
                "body_offset": page.body_offset,
                "next_body_offset": page.next_body_offset,
                "body_size": page.body_size,
            }))
            .expect("body page serializes");
            assert!(
                encoded.len() < 32 * 1024,
                "JSON page remains well below the inline cap"
            );
            assembled.push_str(&page.body);
            match page.next_body_offset {
                Some(next) => offset = next,
                None => break,
            }
        }
        assert_eq!(assembled, body);
    }

    #[test]
    fn summary_body_page_advances_offsets_inside_multibyte_characters() {
        let body = "aλ🙂b";
        let page = summary_body_page(body, 2, Some(1));
        assert_eq!(page.body_offset, 3);
        assert_eq!(page.body, "🙂");
        assert_eq!(page.next_body_offset, Some(7));
    }
}
