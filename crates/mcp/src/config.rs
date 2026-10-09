use std::{
    collections::{BTreeMap, BTreeSet},
    fmt, fs,
    io::Read,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use url::Url;

const CONFIG_VERSION: u32 = 1;
const MAX_CONFIG_BYTES: u64 = 256 * 1024;
pub(crate) const SCOPE_GLOBAL_READ: &str = "boreal:global:read";
pub(crate) const SCOPE_PROJECT_READ: &str = "boreal:project:read";
pub(crate) const SCOPE_PROJECT_WRITE: &str = "boreal:project:work-write";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpConfig {
    pub version: u32,
    #[serde(default)]
    pub global: Option<GlobalEndpoint>,
    #[serde(default)]
    pub projects: BTreeMap<String, ProjectEndpoint>,
    /// OAuth subject to a server-side Boreal actor and grant mapping.
    #[serde(default)]
    pub principals: BTreeMap<String, Policy>,
    /// Local OS-launched stdio profiles. These are not exposed over HTTP.
    #[serde(default)]
    pub stdio_profiles: BTreeMap<String, Policy>,
    #[serde(default)]
    pub http: Option<HttpConfig>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalEndpoint {
    pub socket: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectEndpoint {
    pub socket: PathBuf,
    /// Environment variable containing the Boreal project credential for
    /// each server-side actor. Client OAuth tokens are never forwarded.
    pub credential_env_by_actor: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub actor_id: String,
    #[serde(default)]
    pub projects: BTreeSet<String>,
    #[serde(default)]
    pub scopes: BTreeSet<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HttpConfig {
    pub bind: SocketAddr,
    /// Public MCP endpoint, used as OAuth resource audience and discovery ID.
    pub resource_uri: Url,
    /// OAuth authorization-server URLs returned in RFC 9728 metadata.
    pub authorization_servers: Vec<Url>,
    /// OAuth 2.0 token-introspection endpoint (RFC 7662).
    pub introspection: IntrospectionConfig,
    /// Required for any non-loopback bind.
    #[serde(default)]
    pub tls: Option<TlsConfig>,
    /// Host header allowlist; include host and port when the client sends it.
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    /// Browser origins allowed by MCP Streamable HTTP. Empty means no browser
    /// Origin is accepted; native MCP clients without Origin remain allowed.
    #[serde(default)]
    pub allowed_origins: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IntrospectionConfig {
    pub endpoint: Url,
    pub issuer: Url,
    pub client_id: String,
    /// Name of the environment variable containing the introspection secret.
    pub client_secret_env: String,
    /// Maximum accepted token lifetime. Short-lived tokens reduce exposure if
    /// an authorization server omits an expiration from introspection data.
    pub max_token_lifetime_seconds: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TlsConfig {
    pub certificate: PathBuf,
    pub private_key: PathBuf,
}

#[derive(Debug)]
pub enum ConfigError {
    Io(String),
    TooLarge,
    NotPrivate,
    InvalidToml(String),
    Invalid(String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(message) => write!(f, "cannot read MCP configuration: {message}"),
            Self::TooLarge => f.write_str("MCP configuration exceeds 256 KiB"),
            Self::NotPrivate => {
                f.write_str("MCP configuration must be a regular, owner-owned file with mode 0600")
            }
            Self::InvalidToml(message) => write!(f, "invalid MCP TOML configuration: {message}"),
            Self::Invalid(message) => write!(f, "invalid MCP configuration: {message}"),
        }
    }
}

impl std::error::Error for ConfigError {}

impl McpConfig {
    pub fn load_private(path: &Path) -> Result<Self, ConfigError> {
        let file = open_without_following_symlinks(path)
            .map_err(|error| ConfigError::Io(error.to_string()))?;
        let metadata = file
            .metadata()
            .map_err(|error| ConfigError::Io(error.to_string()))?;
        if !metadata.is_file() || !private_owner_file(&metadata) {
            return Err(ConfigError::NotPrivate);
        }
        if metadata.len() > MAX_CONFIG_BYTES {
            return Err(ConfigError::TooLarge);
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_CONFIG_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| ConfigError::Io(error.to_string()))?;
        if bytes.len() as u64 > MAX_CONFIG_BYTES {
            return Err(ConfigError::TooLarge);
        }
        let config: Self = toml::from_slice(&bytes)
            .map_err(|error| ConfigError::InvalidToml(error.to_string()))?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.version != CONFIG_VERSION {
            return Err(ConfigError::Invalid(format!(
                "version must be {CONFIG_VERSION}"
            )));
        }
        for (project_id, endpoint) in &self.projects {
            validate_identifier(project_id, "project ID")?;
            validate_socket_path(&endpoint.socket)?;
            for (actor_id, env_name) in &endpoint.credential_env_by_actor {
                validate_identifier(actor_id, "actor ID")?;
                validate_env_name(env_name)?;
            }
        }
        if let Some(global) = &self.global {
            validate_socket_path(&global.socket)?;
        }
        for (subject, policy) in &self.principals {
            self.validate_policy(subject, policy)?;
        }
        for (profile, policy) in &self.stdio_profiles {
            validate_identifier(profile, "stdio profile")?;
            self.validate_policy(profile, policy)?;
        }
        if let Some(http) = &self.http {
            self.validate_http(http)?;
        }
        Ok(())
    }

    fn validate_policy(&self, label: &str, policy: &Policy) -> Result<(), ConfigError> {
        if label.trim().is_empty() || label.len() > 256 {
            return Err(ConfigError::Invalid(
                "principal key must be 1–256 bytes".into(),
            ));
        }
        validate_identifier(&policy.actor_id, "actor ID")?;
        for project_id in &policy.projects {
            if !self.projects.contains_key(project_id) {
                return Err(ConfigError::Invalid(format!(
                    "principal {label:?} references project {project_id:?} without an explicit server binding"
                )));
            }
        }
        for scope in &policy.scopes {
            if !matches!(
                scope.as_str(),
                SCOPE_GLOBAL_READ | SCOPE_PROJECT_READ | SCOPE_PROJECT_WRITE
            ) {
                return Err(ConfigError::Invalid(format!("unsupported grant {scope:?}")));
            }
        }
        if policy.scopes.contains(SCOPE_PROJECT_WRITE)
            && (!policy.scopes.contains(SCOPE_PROJECT_READ) || policy.projects.is_empty())
        {
            return Err(ConfigError::Invalid(
                "project work-write requires project read and at least one explicitly bound project".into(),
            ));
        }
        if policy.scopes.contains(SCOPE_PROJECT_READ) {
            for project_id in &policy.projects {
                let endpoint = &self.projects[project_id];
                if !endpoint
                    .credential_env_by_actor
                    .contains_key(&policy.actor_id)
                {
                    return Err(ConfigError::Invalid(format!(
                        "project {project_id:?} has no internal credential environment mapping for actor {:?}",
                        policy.actor_id
                    )));
                }
            }
        }
        if policy.scopes.contains(SCOPE_GLOBAL_READ) && self.global.is_none() {
            return Err(ConfigError::Invalid(
                "global read grant requires an explicit Global socket binding".into(),
            ));
        }
        Ok(())
    }

    fn validate_http(&self, http: &HttpConfig) -> Result<(), ConfigError> {
        if http.bind.port() == 0 {
            return Err(ConfigError::Invalid("HTTP port must be non-zero".into()));
        }
        if http.authorization_servers.is_empty() {
            return Err(ConfigError::Invalid(
                "HTTP requires at least one OAuth authorization server".into(),
            ));
        }
        if http.resource_uri.scheme() != "https" && !http.bind.ip().is_loopback() {
            return Err(ConfigError::Invalid(
                "a non-loopback MCP endpoint must use an https resource_uri".into(),
            ));
        }
        if !http.bind.ip().is_loopback() {
            if http.tls.is_none() {
                return Err(ConfigError::Invalid(
                    "a non-loopback HTTP bind requires TLS certificate and private key files"
                        .into(),
                ));
            }
            if http.allowed_hosts.is_empty() {
                return Err(ConfigError::Invalid(
                    "a non-loopback HTTP bind requires an explicit Host allowlist".into(),
                ));
            }
        }
        if !http
            .allowed_hosts
            .iter()
            .any(|host| !host.trim().is_empty())
            && !http.bind.ip().is_loopback()
        {
            return Err(ConfigError::Invalid(
                "Host allowlist must not be empty".into(),
            ));
        }
        let oauth = &http.introspection;
        let local_introspection = oauth.endpoint.host_str().is_some_and(is_loopback_host);
        if oauth.endpoint.scheme() != "https" && !local_introspection {
            return Err(ConfigError::Invalid(
                "OAuth introspection must use https (plain http is allowed only for loopback test providers)".into(),
            ));
        }
        if oauth.issuer.scheme() != "https"
            && !oauth.issuer.host_str().is_some_and(is_loopback_host)
        {
            return Err(ConfigError::Invalid(
                "OAuth issuer must use https (plain http is allowed only for loopback test providers)".into(),
            ));
        }
        if oauth.client_id.trim().is_empty() || oauth.client_id.len() > 256 {
            return Err(ConfigError::Invalid(
                "OAuth client_id must be 1–256 bytes".into(),
            ));
        }
        validate_env_name(&oauth.client_secret_env)?;
        if !(60..=86_400).contains(&oauth.max_token_lifetime_seconds) {
            return Err(ConfigError::Invalid(
                "OAuth token lifetime bound must be between 60 and 86400 seconds".into(),
            ));
        }
        for url in &http.authorization_servers {
            if url.scheme() != "https" && !url.host_str().is_some_and(is_loopback_host) {
                return Err(ConfigError::Invalid(
                    "authorization server URLs must use https except for loopback tests".into(),
                ));
            }
        }
        if let Some(tls) = &http.tls {
            if !tls.certificate.is_absolute() || !tls.private_key.is_absolute() {
                return Err(ConfigError::Invalid(
                    "TLS certificate and key paths must be absolute host paths".into(),
                ));
            }
        }
        Ok(())
    }
}

#[cfg(unix)]
fn open_without_following_symlinks(path: &Path) -> std::io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open(path)
}

#[cfg(not(unix))]
fn open_without_following_symlinks(path: &Path) -> std::io::Result<fs::File> {
    fs::File::open(path)
}

fn validate_socket_path(path: &Path) -> Result<(), ConfigError> {
    if !path.is_absolute() {
        return Err(ConfigError::Invalid(
            "Unix service socket paths must be absolute".into(),
        ));
    }
    if path.as_os_str().as_encoded_bytes().len() > 100 {
        return Err(ConfigError::Invalid(
            "Unix service socket path exceeds the portable 100-byte limit".into(),
        ));
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), ConfigError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if valid {
        Ok(())
    } else {
        Err(ConfigError::Invalid(format!(
            "{label} must be 1–128 ASCII letters, digits, '.', '_' or '-'"
        )))
    }
}

fn validate_env_name(value: &str) -> Result<(), ConfigError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_');
    if valid {
        Ok(())
    } else {
        Err(ConfigError::Invalid(
            "secret environment variable name must contain only A–Z, 0–9 and '_'".into(),
        ))
    }
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

#[cfg(unix)]
fn private_owner_file(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    unsafe extern "C" {
        fn geteuid() -> u32;
    }
    metadata.uid() == unsafe { geteuid() } && metadata.mode() & 0o777 == 0o600
}

#[cfg(not(unix))]
fn private_owner_file(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> McpConfig {
        McpConfig {
            version: 1,
            global: Some(GlobalEndpoint {
                socket: PathBuf::from("/tmp/boreal-global.sock"),
            }),
            projects: BTreeMap::from([(
                "project-a".into(),
                ProjectEndpoint {
                    socket: PathBuf::from("/tmp/boreal-project-a.sock"),
                    credential_env_by_actor: BTreeMap::from([(
                        "agent-a".into(),
                        "BOREAL_PROJECT_A_CREDENTIAL".into(),
                    )]),
                },
            )]),
            principals: BTreeMap::new(),
            stdio_profiles: BTreeMap::new(),
            http: None,
        }
    }

    #[test]
    fn policy_rejects_unknown_and_unbound_projects() {
        let mut config = base();
        config.principals.insert(
            "alice".into(),
            Policy {
                actor_id: "agent-a".into(),
                projects: BTreeSet::from(["project-missing".into()]),
                scopes: BTreeSet::from([SCOPE_PROJECT_READ.into()]),
            },
        );
        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("without an explicit server binding"));
    }

    #[test]
    fn project_write_requires_read_and_explicit_project() {
        let mut config = base();
        config.principals.insert(
            "alice".into(),
            Policy {
                actor_id: "agent-a".into(),
                projects: BTreeSet::from(["project-a".into()]),
                scopes: BTreeSet::from([SCOPE_PROJECT_WRITE.into()]),
            },
        );
        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("requires project read"));
    }

    #[test]
    fn remote_bind_fails_closed_without_tls_and_origin_host_configuration() {
        let mut config = base();
        config.http = Some(HttpConfig {
            bind: "0.0.0.0:8443".parse().unwrap(),
            resource_uri: Url::parse("https://mcp.example.test/mcp").unwrap(),
            authorization_servers: vec![Url::parse("https://auth.example.test").unwrap()],
            introspection: IntrospectionConfig {
                endpoint: Url::parse("https://auth.example.test/introspect").unwrap(),
                issuer: Url::parse("https://auth.example.test").unwrap(),
                client_id: "boreal-test".into(),
                client_secret_env: "BOREAL_TEST_SECRET".into(),
                max_token_lifetime_seconds: 600,
            },
            tls: None,
            allowed_hosts: vec![],
            allowed_origins: vec![],
        });
        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("requires TLS"));
    }

    #[test]
    fn unknown_config_fields_are_rejected() {
        let parsed: Result<McpConfig, _> = toml::from_str("version = 1\nunknown = true\n");
        assert!(parsed.is_err());
        assert_eq!(json!({"ok": true})["ok"], true);
    }

    #[cfg(unix)]
    #[test]
    fn private_config_loader_rejects_group_readable_files_and_symlinks() {
        use std::{
            os::unix::fs::{symlink, PermissionsExt},
            time::{SystemTime, UNIX_EPOCH},
        };
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("boreal-mcp-config-{}-{nonce}", std::process::id()));
        fs::create_dir(&directory).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
        let file = directory.join("config.toml");
        fs::write(&file, "version = 1\n").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).unwrap();
        assert!(matches!(
            McpConfig::load_private(&file),
            Err(ConfigError::NotPrivate)
        ));

        let link = directory.join("link.toml");
        symlink(&file, &link).unwrap();
        assert!(McpConfig::load_private(&link).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
