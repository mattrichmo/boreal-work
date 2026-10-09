use std::{collections::BTreeSet, path::PathBuf, process::ExitCode};

use boreal_mcp::{BorealBackend, McpConfig, MCP_PROTOCOL_VERSION};
use serde_json::json;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    match run(std::env::args().skip(1).collect()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("boreal-mcp: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run(args: Vec<String>) -> Result<(), String> {
    let Some(command) = args.first().map(String::as_str) else {
        return Err(usage().into());
    };
    if command == "--help" || command == "-h" || command == "help" {
        println!("{}", usage());
        return Ok(());
    }

    let mut config_path: Option<PathBuf> = None;
    let mut transport: Option<&str> = None;
    let mut profile: Option<String> = None;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--config" => {
                index += 1;
                let value = args.get(index).ok_or("--config requires a path")?;
                config_path = Some(PathBuf::from(value));
            }
            "--transport" => {
                index += 1;
                transport = Some(
                    args.get(index)
                        .ok_or("--transport requires stdio or http")?,
                );
            }
            "--profile" => {
                index += 1;
                profile = Some(
                    args.get(index)
                        .ok_or("--profile requires a configured profile name")?
                        .clone(),
                );
            }
            unknown => return Err(format!("unknown argument {unknown:?}\n{}", usage())),
        }
        index += 1;
    }
    let config_path = config_path.ok_or_else(|| format!("--config is required\n{}", usage()))?;
    let config = McpConfig::load_private(&config_path).map_err(|error| error.to_string())?;

    match command {
        "serve" => match transport.ok_or("serve requires --transport stdio or --transport http")? {
            "stdio" => {
                let profile = profile.ok_or("stdio requires --profile <name>")?;
                boreal_mcp::run_stdio(config, &profile).await
            }
            "http" => {
                if profile.is_some() {
                    return Err("--profile applies only to stdio".into());
                }
                boreal_mcp::serve_http(config).await
            }
            value => Err(format!(
                "unknown transport {value:?}; expected stdio or http"
            )),
        },
        "status" => {
            if transport.is_some() || profile.is_some() {
                return Err("status does not accept --transport or --profile".into());
            }
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
                    "oauth_configured": true
                })).unwrap_or_else(|| json!({"configured": false})),
                "local_service_reachability": endpoints,
                "secrets": "not displayed"
            });
            println!(
                "{}",
                serde_json::to_string_pretty(&status).map_err(|error| error.to_string())?
            );
            Ok(())
        }
        unknown => Err(format!("unknown command {unknown:?}\n{}", usage())),
    }
}

fn usage() -> &'static str {
    "Usage:\n  boreal-mcp serve --config <private.toml> --transport stdio --profile <name>\n  boreal-mcp serve --config <private.toml> --transport http\n  boreal-mcp status --config <private.toml>\n  boreal-mcp --help"
}
