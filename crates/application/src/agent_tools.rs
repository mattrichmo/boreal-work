//! Typed project annotations and acknowledgements are facts, not gate waivers.
use boreal_store::{MutationResult, SqliteStore, StoreError, V3MutationContext};
pub fn update_work_labels(
    store: &SqliteStore,
    context: &V3MutationContext,
    work: &str,
    labels: &[String],
) -> Result<MutationResult, StoreError> {
    if labels.len() > 64 {
        return Err(StoreError::Invalid(
            "work supports at most 64 labels".into(),
        ));
    }
    let mut labels = labels
        .iter()
        .map(|l| l.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    labels.sort();
    labels.dedup();
    if labels.iter().any(|l| {
        l.is_empty()
            || l.len() > 64
            || !l
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
    }) {
        return Err(StoreError::Invalid(
            "labels must be 1..64 ASCII letters, digits, -, _, . or /".into(),
        ));
    }
    store.set_work_labels(context, work, &labels)
}
pub const TRUSTED_DIRECTIVES: &[(&str, &str)] = &[
    (
        "agent.start@v1",
        "Select available source/configuration proof and start work through canonical ownership.",
    ),
    (
        "attempt.resume@v1",
        "Resume the current fenced attempt with its bound session.",
    ),
    (
        "guidance.claim@v1",
        "Claim ready work through the canonical ownership transaction.",
    ),
    (
        "guidance.accept_attempt@v1",
        "Acknowledge the current fenced attempt before implementation.",
    ),
    (
        "guidance.run_evidence@v1",
        "Run a registered bounded evidence gate and retain its receipt.",
    ),
    (
        "guidance.attach_evidence@v1",
        "Inspect required proof inputs and attach only evidence bound to the current attempt and fence.",
    ),
    (
        "guidance.checkpoint@v1",
        "Record semantic progress separately from lease renewal.",
    ),
    (
        "guidance.finish_close@v1",
        "Close only after current proof, review and summary obligations pass.",
    ),
    (
        "guidance.review@v1",
        "Inspect and submit the independent reviewer action descriptor.",
    ),
    (
        "guidance.recover@v1",
        "Submit the current descriptor-bound expired-attempt recovery action with its confirmation, fence, session, and typed stop disposition; the transaction records the expiry obligation, which remains a separate resolution step.",
    ),
    (
        "guidance.inspect@v1",
        "Inspect current work context and application action descriptors.",
    ),
];
pub fn acknowledge_trusted_directive(
    store: &SqliteStore,
    context: &V3MutationContext,
    id: &str,
    work: Option<&str>,
) -> Result<MutationResult, StoreError> {
    if !TRUSTED_DIRECTIVES.iter().any(|(known, _)| *known == id) {
        return Err(StoreError::Invalid(
            "directive is not in the trusted versioned registry".into(),
        ));
    }
    store.acknowledge_directive(context, id, work)
}
