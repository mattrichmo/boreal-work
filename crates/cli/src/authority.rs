//! Thin local authority command adapter. Store transactions own grant/revoke
//! policy; the CLI only handles local secret files and bootstrap ownership.
use super::*;
use boreal_store::principals::{PrincipalGrantRequest, PrincipalRevocationRequest};

pub(super) fn run(
    parsed: &ParsedCommand,
    operation: &str,
    store: &SqliteStore,
) -> Result<CliResult, CliError> {
    let context = project_context::resolve(parsed)?;
    project_context::validate_store(&context, store)?;
    let command = parsed.path.get(1).map(String::as_str).unwrap_or("");
    if command == "key" {
        credentials::create(&context.root, &context.project_id, &parsed.options.actor)?;
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            data: Some(
                json!({"command":"auth.key","project_id":context.project_id,"actor_id":parsed.options.actor,"credential_created_or_present":true,"authority_granted":false}),
            ),
            ..CliResult::default()
        });
    }
    if command != "bootstrap" {
        credentials::authenticate(parsed, store)?;
    }
    if command == "show" {
        let (role, root) = store
            .principal_authority(&context.project_id, &parsed.options.actor)
            .map_err(map_store_error)?;
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            revision: Some(
                store
                    .project_revision(&context.project_id)
                    .map_err(map_store_error)?
                    .0,
            ),
            data: Some(
                json!({"command":"auth.show","project_id":context.project_id,"actor_id":parsed.options.actor,"role":format!("{role:?}").to_ascii_lowercase(),"authority_root":root}),
            ),
            ..CliResult::default()
        });
    }
    let expected = parsed
        .options
        .expected_revision
        .ok_or_else(|| CliError::invalid("authority mutation requires --expected-revision"))?;
    let reason = parsed
        .options
        .reason
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| CliError::invalid("authority mutation requires --reason"))?;
    if !parsed.options.setup.yes {
        return Err(CliError::invalid(
            "authority mutation requires explicit --yes confirmation",
        ));
    }
    let result = match command {
        "bootstrap" => {
            // No secret is minted until local project ownership is established.
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                unsafe extern "C" {
                    fn geteuid() -> u32;
                }
                if fs::metadata(&context.root)
                    .map_err(|e| CliError::invalid(e.to_string()))?
                    .uid()
                    != unsafe { geteuid() }
                {
                    return Err(CliError::with(
                        ErrorCode::PermissionDenied,
                        ApplicationOutcome::Rejected,
                        "only the local workspace owner may bootstrap a pre-key project",
                    ));
                }
            }
            if store
                .has_project_principals(&context.project_id)
                .map_err(map_store_error)?
            {
                return Err(CliError::invalid(
                    "this project already has principal authority; use an existing operator key",
                ));
            }
            let credential =
                credentials::create(&context.root, &context.project_id, &parsed.options.actor)?;
            store.bootstrap_project_principal(&PrincipalGrantRequest {
                project_id: context.project_id.clone(),
                actor_id: parsed.options.actor.clone(),
                session_id: None,
                principal_actor_id: parsed.options.actor.clone(),
                role: boreal_domain::ActorRole::Operator,
                independent: true,
                credential,
                expires_at_ms: None,
                display_name: "Project operator".into(),
                reason: reason.into(),
                expected_revision: expected,
                operation_id: operation.into(),
                at: now(),
            })
        }
        "grant" => {
            let input = parsed.options.input.as_deref().ok_or_else(|| {
                CliError::invalid(
                    "auth grant requires --input PATH containing the target credential enrollment",
                )
            })?;
            let path = project_context::confined_path(&context.root, Path::new(input), false)?;
            credentials::check_owner(&path)?;
            let body: Value = serde_json::from_slice(
                &fs::read(path).map_err(|e| CliError::invalid(e.to_string()))?,
            )
            .map_err(|_| CliError::invalid("invalid enrollment JSON"))?;
            let field = |name: &str| {
                body.get(name)
                    .and_then(Value::as_str)
                    .filter(|v| !v.trim().is_empty())
                    .map(str::to_owned)
                    .ok_or_else(|| CliError::invalid(format!("enrollment requires {name}")))
            };
            let role = match body.get("role").and_then(Value::as_str) {
                Some("agent") => boreal_domain::ActorRole::Agent,
                Some("reviewer") => boreal_domain::ActorRole::Reviewer,
                Some("operator") => boreal_domain::ActorRole::Operator,
                Some("publisher") => boreal_domain::ActorRole::Publisher,
                _ => return Err(CliError::invalid("enrollment role is invalid")),
            };
            store.grant_principal(&PrincipalGrantRequest {
                project_id: context.project_id.clone(),
                actor_id: parsed.options.actor.clone(),
                session_id: None,
                principal_actor_id: field("actor_id")?,
                role,
                independent: body
                    .get("independent")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                credential: field("credential")?,
                expires_at_ms: body.get("expires_at_ms").and_then(Value::as_u64),
                display_name: field("display_name")?,
                reason: reason.into(),
                expected_revision: expected,
                operation_id: operation.into(),
                at: now(),
            })
        }
        "revoke" => {
            let target = parsed
                .options
                .positionals
                .first()
                .ok_or_else(|| CliError::invalid("auth revoke requires a target actor"))?;
            store.revoke_principal(&PrincipalRevocationRequest {
                project_id: context.project_id.clone(),
                actor_id: parsed.options.actor.clone(),
                session_id: None,
                principal_actor_id: target.clone(),
                credential_id: parsed.options.positionals.get(1).cloned(),
                reason: reason.into(),
                expected_revision: expected,
                operation_id: operation.into(),
                at: now(),
            })
        }
        _ => return Err(CliError::invalid("unknown authority command")),
    }
    .map_err(map_store_error)?;
    Ok(CliResult {
        outcome: if result.replayed {
            ApplicationOutcome::Unchanged
        } else {
            ApplicationOutcome::Changed
        },
        revision: Some(result.revision),
        data: Some(
            json!({"command":format!("auth.{command}"),"project_id":context.project_id,"operation_id":result.operation_id,"replayed":result.replayed}),
        ),
        ..CliResult::default()
    })
}
