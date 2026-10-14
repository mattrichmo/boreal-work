//! Public work-container closeout dispositions.
//!
//! These are distinct from intake item lifecycle updates: they record how a
//! container accounts for one of its descendants using the application-owned
//! revisioned snapshot and disposition planner.

use super::*;
use boreal_domain::work_model_v3::{CloseoutDispositionId, DispositionKind};

pub(crate) fn supported(path: &[String]) -> bool {
    path == ["work", "disposition"]
}

pub(crate) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    app: &WorkApplication<'_>,
) -> Result<CliResult, CliError> {
    let project = ProjectId::new(project_argument(parsed, 0)?);
    let project_offset = usize::from(parsed.options.project.is_none());
    let container_id = parsed
        .options
        .positionals
        .get(project_offset)
        .cloned()
        .ok_or_else(|| CliError::invalid("work disposition requires a container identifier"))?;
    let descendant_id = parsed
        .options
        .positionals
        .get(project_offset + 1)
        .cloned()
        .ok_or_else(|| CliError::invalid("work disposition requires a descendant identifier"))?;
    let kind = match parsed.options.kind.as_deref() {
        Some("accepted_closed") => DispositionKind::AcceptedClosed,
        Some("accepted_cancelled") => DispositionKind::AcceptedCancelled,
        Some("deferred") => DispositionKind::Deferred,
        Some("replaced") => DispositionKind::Replaced,
        _ => {
            return Err(CliError::invalid(
                "work disposition requires --kind accepted_closed|accepted_cancelled|deferred|replaced",
            ));
        }
    };
    let expected_revision = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("work disposition requires --expected-revision"))?;
    if !parsed.options.setup.yes {
        return Err(CliError::invalid(
            "work disposition records container closeout; pass --yes to confirm",
        ));
    }

    let replacement_id = optional_extra(&parsed.options, "--replacement")?.map(WorkId::new);
    let supersedes_id = optional_extra(&parsed.options, "--supersedes")?
        .map(CloseoutDispositionId::parse)
        .transpose()
        .map_err(|error| CliError::invalid(error.to_string()))?;
    let disposition_id = CloseoutDispositionId::parse(format!("disposition-{operation}"))
        .map_err(|error| CliError::invalid(error.to_string()))?;
    let scope = PlanningScope {
        project_id: project.clone(),
        actor_id: parsed.options.actor.clone(),
        session_id: parsed
            .options
            .session_explicit
            .then(|| parsed.options.session.clone()),
        expected_revision: Some(expected_revision),
    };
    let as_of = TimestampMs::from_millis(now_ms_u64());
    let result = app
        .apply_container_disposition_v3(
            &scope,
            operation,
            disposition_id,
            &WorkId::new(container_id.clone()),
            &WorkId::new(descendant_id.clone()),
            kind,
            replacement_id,
            parsed.options.reason.clone(),
            supersedes_id,
            as_of,
            &stamp(as_of.as_millis()),
        )
        .map_err(map_application_error)?;
    let disposition = result.value;
    let kind = match disposition.kind {
        DispositionKind::AcceptedClosed => "accepted_closed",
        DispositionKind::AcceptedCancelled => "accepted_cancelled",
        DispositionKind::Deferred => "deferred",
        DispositionKind::Replaced => "replaced",
    };
    let data = json!({
        "project_id": project.as_str(),
        "operation_id": result.operation_id,
        "disposition_id": disposition.id.as_str(),
        "container_id": disposition.container_id.as_str(),
        "descendant_id": disposition.descendant_id.as_str(),
        "kind": kind,
        "descendant_revision": disposition.descendant_revision,
        "descendant_outcome_digest": disposition.descendant_outcome_digest,
        "replacement_id": disposition.replacement_id.as_ref().map(WorkId::as_str),
        "reason": disposition.reason,
        "supersedes_id": disposition.supersedes_id.as_ref().map(CloseoutDispositionId::as_str),
        "changed": result.changed,
    });
    bounded_result(Some(data), Some(result.snapshot_revision)).map(|mut view| {
        view.outcome = if result.changed {
            ApplicationOutcome::Changed
        } else {
            ApplicationOutcome::Unchanged
        };
        view
    })
}

fn optional_extra(options: &CliOptions, name: &str) -> Result<Option<String>, CliError> {
    match options.extra.get(name).map(Vec::as_slice) {
        None => Ok(None),
        Some([value]) => Ok(Some(value.clone())),
        Some(_) => Err(CliError::invalid(format!(
            "{name} may be supplied only once"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_work_disposition_route_is_owned_here() {
        assert!(supported(&["work".to_owned(), "disposition".to_owned()]));
        assert!(!supported(&["intake".to_owned(), "disposition".to_owned()]));
    }

    #[test]
    fn output_kind_names_match_the_public_contract() {
        let names = [
            DispositionKind::AcceptedClosed,
            DispositionKind::AcceptedCancelled,
            DispositionKind::Deferred,
            DispositionKind::Replaced,
        ]
        .map(|kind| match kind {
            DispositionKind::AcceptedClosed => "accepted_closed",
            DispositionKind::AcceptedCancelled => "accepted_cancelled",
            DispositionKind::Deferred => "deferred",
            DispositionKind::Replaced => "replaced",
        });
        assert_eq!(
            names,
            [
                "accepted_closed",
                "accepted_cancelled",
                "deferred",
                "replaced"
            ]
        );
    }
}
