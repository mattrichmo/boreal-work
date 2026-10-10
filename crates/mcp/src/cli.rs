use std::{collections::BTreeSet, path::PathBuf};

use boreal_protocol::{schema, ApplicationOutcome, Envelope, TransportOutcome, API_VERSION};
use serde_json::json;

use crate::{BorealBackend, McpConfig, MCP_PROTOCOL_VERSION};

/// Run the MCP command surface from either the standalone binary or `bwrk`.
pub fn run_cli(args: &[String], program: &str) -> Result<(), String> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .try_init();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("cannot start MCP runtime: {error}"))?;
    runtime.block_on(run(args, program))
}

async fn run(args: &[String], program: &str) -> Result<(), String> {
    let Some(command) = args.first().map(String::as_str) else {
        println!("{}", usage(program));
        return Ok(());
    };
    if matches!(command, "--help" | "-h" | "help") {
        println!("{}", usage(program));
        return Ok(());
    }

    let mut config_path: Option<PathBuf> = None;
    let mut transport: Option<String> = None;
    let mut profile: Option<String> = None;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--config" => {
                index += 1;
                let value = args.get(index).ok_or("--config requires a path")?;
                if config_path.replace(PathBuf::from(value)).is_some() {
                    return Err("--config may be specified only once".into());
                }
            }
            "--transport" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or("--transport requires stdio or http")?
                    .clone();
                if transport.replace(value).is_some() {
                    return Err("--transport may be specified only once".into());
                }
            }
            "--profile" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or("--profile requires a configured profile name")?
                    .clone();
                if profile.replace(value).is_some() {
                    return Err("--profile may be specified only once".into());
                }
            }
            unknown => return Err(format!("unknown argument {unknown:?}\n{}", usage(program))),
        }
        index += 1;
    }
    match command {
        "start" if transport.is_some() || profile.is_some() => {
            return Err(
                "start uses the configured HTTP transport; do not pass --transport or --profile"
                    .into(),
            );
        }
        "serve" if transport.is_none() => {
            return Err("serve requires --transport stdio or --transport http".into());
        }
        "serve" if transport.as_deref() == Some("stdio") && profile.is_none() => {
            return Err("stdio requires --profile <name>".into());
        }
        "serve" if transport.as_deref() == Some("http") && profile.is_some() => {
            return Err("--profile applies only to stdio".into());
        }
        "serve" if !matches!(transport.as_deref(), Some("stdio" | "http")) => {
            return Err(format!(
                "unknown transport {:?}; expected stdio or http",
                transport.as_deref().unwrap_or_default()
            ));
        }
        "status" if transport.is_some() || profile.is_some() => {
            return Err("status does not accept --transport or --profile".into());
        }
        "start" | "serve" | "status" => {}
        unknown => return Err(format!("unknown command {unknown:?}\n{}", usage(program))),
    }
    let config_path =
        config_path.ok_or_else(|| format!("--config is required\n{}", usage(program)))?;
    let config = McpConfig::load_private(&config_path).map_err(|error| error.to_string())?;

    match command {
        "start" => crate::serve_http(config).await,
        "serve" => match transport.as_deref().expect("serve transport validated") {
            "stdio" => {
                let profile = profile.expect("stdio profile validated");
                crate::run_stdio(config, &profile).await
            }
            "http" => crate::serve_http(config).await,
            _ => unreachable!("serve transport validated"),
        },
        "status" => {
            let grants = config
                .principals
                .values()
                .chain(config.stdio_profiles.values())
                .flat_map(|policy| policy.scopes.iter().cloned())
                .collect::<BTreeSet<_>>();
            let project_bindings = config
                .principals
                .values()
                .chain(config.stdio_profiles.values())
                .flat_map(|policy| policy.projects.iter().cloned())
                .collect::<BTreeSet<_>>();
            let endpoints = BorealBackend::endpoint_status(&config);
            let status = json!({
                "server": "boreal-mcp",
                "version": env!("CARGO_PKG_VERSION"),
                "mcp_protocol_version": MCP_PROTOCOL_VERSION,
                "config_valid": true,
                "global_configured": config.global.is_some(),
                "project_bindings": project_bindings,
                "grants_configured": grants,
                "stdio_profiles": config.stdio_profiles.keys().collect::<Vec<_>>(),
                "http": config.http.as_ref().map(|http| json!({
                    "configured": true,
                    "bind": http.bind,
                    "tls_configured": http.tls.is_some(),
                    "oauth_configured": oauth_secret_is_available(
                        std::env::var(&http.introspection.client_secret_env).ok().as_deref()
                    ),
                    "oauth_provider_reachability": "not_checked"
                })).unwrap_or_else(|| json!({"configured": false})),
                "local_service_reachability": endpoints,
                "secrets": "not displayed"
            });
            if program == "bwrk mcp" {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|error| format!("system clock is unavailable: {error}"))?
                    .as_millis();
                let envelope = Envelope {
                    api_version: API_VERSION.to_owned(),
                    schema_version: schema::ENVELOPE.to_owned(),
                    operation_id: format!("op_mcp_status_{}_{}", std::process::id(), now_ms),
                    revision: None,
                    as_of: format!("unix-ms:{now_ms}"),
                    next_status_change_at: None,
                    transport: TransportOutcome::Ok,
                    outcome: ApplicationOutcome::Unchanged,
                    data: Some(status),
                    detail_ref: None,
                    error: None,
                };
                println!(
                    "{}",
                    serde_json::to_string(&envelope).map_err(|error| error.to_string())?
                );
            } else {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&status).map_err(|error| error.to_string())?
                );
            }
            Ok(())
        }
        _ => unreachable!("command validated"),
    }
}

fn usage(program: &str) -> String {
    format!(
        "Usage:\n  {program} start --config <private.toml>\n  {program} serve --config <private.toml> --transport stdio --profile <name>\n  {program} serve --config <private.toml> --transport http\n  {program} status --config <private.toml>\n  {program} --help"
    )
}

fn oauth_secret_is_available(secret: Option<&str>) -> bool {
    secret.is_some_and(|value| !value.is_empty() && value.len() <= 4096)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_status_only_reports_whether_a_usable_secret_exists() {
        assert!(!oauth_secret_is_available(None));
        assert!(!oauth_secret_is_available(Some("")));
        assert!(oauth_secret_is_available(Some("synthetic-secret")));
        assert!(!oauth_secret_is_available(Some(&"x".repeat(4097))));
    }

    #[tokio::test]
    async fn command_arguments_fail_closed_before_loading_configuration() {
        assert!(run(
            &["start".into(), "--transport".into(), "stdio".into()],
            "bwrk mcp"
        )
        .await
        .unwrap_err()
        .contains("start uses the configured HTTP transport"));
        assert!(run(
            &["serve".into(), "--transport".into(), "http".into()],
            "bwrk mcp"
        )
        .await
        .unwrap_err()
        .contains("--config is required"));
        assert!(run(&["unknown".into()], "bwrk mcp")
            .await
            .unwrap_err()
            .contains("unknown command"));
    }
}
