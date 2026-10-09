use std::{
    collections::BTreeSet,
    fmt,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use futures_util::StreamExt;
use reqwest::{redirect::Policy as RedirectPolicy, Client};
use serde::Deserialize;

use crate::config::{HttpConfig, McpConfig, Policy};

const MAX_BEARER_TOKEN_BYTES: usize = 4096;
const MAX_INTROSPECTION_BODY_BYTES: usize = 8192;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthenticatedPrincipal {
    /// The OAuth `sub`, mapped by server configuration. Never accepted from a
    /// tool argument or trusted from MCP client metadata.
    pub subject: String,
    pub actor_id: String,
    pub project_ids: BTreeSet<String>,
    pub scopes: BTreeSet<String>,
}

impl AuthenticatedPrincipal {
    pub(crate) fn from_stdio_policy(
        subject: impl Into<String>,
        policy: &Policy,
        config: &McpConfig,
    ) -> Self {
        Self {
            subject: subject.into(),
            actor_id: policy.actor_id.clone(),
            project_ids: policy
                .projects
                .iter()
                .filter(|id| config.projects.contains_key(*id))
                .cloned()
                .collect(),
            scopes: policy.scopes.clone(),
        }
    }

    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.contains(scope)
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum AuthError {
    Unauthorized,
    Unavailable,
    Misconfigured,
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unauthorized => "bearer token is missing, inactive, expired, or not authorized",
            Self::Unavailable => "OAuth token introspection service is unavailable",
            Self::Misconfigured => "OAuth introspection is not configured correctly",
        })
    }
}

impl std::error::Error for AuthError {}

#[derive(Clone)]
pub struct OAuthIntrospector {
    client: Client,
    http: HttpConfig,
    policies: Arc<std::collections::BTreeMap<String, Policy>>,
    bound_projects: Arc<BTreeSet<String>>,
    client_secret: Arc<String>,
}

impl OAuthIntrospector {
    pub fn from_config(config: &McpConfig, http: &HttpConfig) -> Result<Self, AuthError> {
        let secret = std::env::var(&http.introspection.client_secret_env)
            .map_err(|_| AuthError::Misconfigured)?;
        Self::with_secret(config, http, secret)
    }

    pub(crate) fn with_secret(
        config: &McpConfig,
        http: &HttpConfig,
        client_secret: String,
    ) -> Result<Self, AuthError> {
        if client_secret.is_empty() || client_secret.len() > 4096 {
            return Err(AuthError::Misconfigured);
        }
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .connect_timeout(std::time::Duration::from_secs(3))
            .redirect(RedirectPolicy::none())
            .build()
            .map_err(|_| AuthError::Misconfigured)?;
        Ok(Self {
            client,
            http: http.clone(),
            policies: Arc::new(config.principals.clone()),
            bound_projects: Arc::new(config.projects.keys().cloned().collect()),
            client_secret: Arc::new(client_secret),
        })
    }

    /// Introspects one OAuth bearer token at the configured RFC 7662 endpoint.
    /// The token is sent only to that fixed HTTPS endpoint. Redirects are
    /// disabled to prevent forwarding it to another host.
    pub async fn authenticate_token(
        &self,
        token: &str,
    ) -> Result<AuthenticatedPrincipal, AuthError> {
        if token.is_empty()
            || token.len() > MAX_BEARER_TOKEN_BYTES
            || !token.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(AuthError::Unauthorized);
        }
        let response = self
            .client
            .post(self.http.introspection.endpoint.clone())
            .basic_auth(
                self.http.introspection.client_id.as_str(),
                Some(self.client_secret.as_str()),
            )
            .form(&[("token", token), ("token_type_hint", "access_token")])
            .send()
            .await
            .map_err(|_| AuthError::Unavailable)?;
        if !response.status().is_success() {
            return Err(AuthError::Unavailable);
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_INTROSPECTION_BODY_BYTES as u64)
        {
            return Err(AuthError::Unavailable);
        }
        let mut body = Vec::with_capacity(MAX_INTROSPECTION_BODY_BYTES);
        let mut chunks = response.bytes_stream();
        while let Some(chunk) = chunks.next().await {
            let chunk = chunk.map_err(|_| AuthError::Unavailable)?;
            if body.len().saturating_add(chunk.len()) > MAX_INTROSPECTION_BODY_BYTES {
                return Err(AuthError::Unavailable);
            }
            body.extend_from_slice(&chunk);
        }
        let claims: IntrospectionResponse =
            serde_json::from_slice(&body).map_err(|_| AuthError::Unavailable)?;
        self.map_active_token(claims)
    }

    fn map_active_token(
        &self,
        claims: IntrospectionResponse,
    ) -> Result<AuthenticatedPrincipal, AuthError> {
        if !claims.active {
            return Err(AuthError::Unauthorized);
        }
        let subject = claims
            .sub
            .filter(|subject| !subject.trim().is_empty() && subject.len() <= 256)
            .ok_or(AuthError::Unauthorized)?;
        if claims.iss.as_deref() != Some(self.http.introspection.issuer.as_str()) {
            return Err(AuthError::Unauthorized);
        }
        if !claims
            .aud
            .as_ref()
            .is_some_and(|audiences| audiences.contains(self.http.resource_uri.as_str()))
        {
            return Err(AuthError::Unauthorized);
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AuthError::Unavailable)?
            .as_secs();
        let expires_at = claims.exp.ok_or(AuthError::Unauthorized)?;
        if expires_at <= now
            || expires_at.saturating_sub(now) > self.http.introspection.max_token_lifetime_seconds
            || claims.nbf.is_some_and(|not_before| not_before > now)
        {
            return Err(AuthError::Unauthorized);
        }
        let policy = self.policies.get(&subject).ok_or(AuthError::Unauthorized)?;
        let granted_by_token: BTreeSet<String> = claims
            .scope
            .unwrap_or_default()
            .split_ascii_whitespace()
            .map(ToOwned::to_owned)
            .collect();
        let scopes = policy
            .scopes
            .intersection(&granted_by_token)
            .cloned()
            .collect();
        let project_ids = policy
            .projects
            .iter()
            .filter(|project_id| self.bound_projects.contains(*project_id))
            .cloned()
            .collect();
        Ok(AuthenticatedPrincipal {
            subject,
            actor_id: policy.actor_id.clone(),
            project_ids,
            scopes,
        })
    }

    #[cfg(test)]
    fn test_map(
        config: &McpConfig,
        http: &HttpConfig,
        claims: IntrospectionResponse,
    ) -> Result<AuthenticatedPrincipal, AuthError> {
        let introspector = Self::with_secret(config, http, "synthetic-only".into())?;
        introspector.map_active_token(claims)
    }
}

#[derive(Debug, Deserialize)]
struct IntrospectionResponse {
    active: bool,
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    iss: Option<String>,
    #[serde(default)]
    aud: Option<Audience>,
    #[serde(default)]
    exp: Option<u64>,
    #[serde(default)]
    nbf: Option<u64>,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Audience {
    One(String),
    Many(Vec<String>),
}

impl Audience {
    fn contains(&self, expected: &str) -> bool {
        match self {
            Self::One(value) => value == expected,
            Self::Many(values) => values.iter().any(|value| value == expected),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{BTreeMap, BTreeSet},
        net::SocketAddr,
        path::PathBuf,
    };

    use url::Url;

    use crate::config::{GlobalEndpoint, IntrospectionConfig, ProjectEndpoint};

    use super::*;

    fn config() -> (McpConfig, HttpConfig) {
        let subject = "alice@example.test";
        let config = McpConfig {
            version: 1,
            global: Some(GlobalEndpoint {
                socket: PathBuf::from("/tmp/global.sock"),
            }),
            projects: BTreeMap::from([(
                "project-a".into(),
                ProjectEndpoint {
                    socket: PathBuf::from("/tmp/project-a.sock"),
                    credential_env_by_actor: BTreeMap::from([(
                        "agent-a".into(),
                        "BOREAL_AGENT_A".into(),
                    )]),
                },
            )]),
            principals: BTreeMap::from([(
                subject.into(),
                Policy {
                    actor_id: "agent-a".into(),
                    projects: BTreeSet::from(["project-a".into()]),
                    scopes: BTreeSet::from([
                        crate::config::SCOPE_PROJECT_READ.into(),
                        crate::config::SCOPE_PROJECT_WRITE.into(),
                        crate::config::SCOPE_GLOBAL_READ.into(),
                    ]),
                },
            )]),
            stdio_profiles: BTreeMap::new(),
            http: None,
        };
        let http = HttpConfig {
            bind: SocketAddr::from(([127, 0, 0, 1], 8765)),
            resource_uri: Url::parse("http://127.0.0.1:8765/mcp").unwrap(),
            authorization_servers: vec![Url::parse("http://127.0.0.1:9999/issuer").unwrap()],
            introspection: IntrospectionConfig {
                endpoint: Url::parse("http://127.0.0.1:9999/introspect").unwrap(),
                issuer: Url::parse("http://127.0.0.1:9999/issuer").unwrap(),
                client_id: "boreal-mcp-test".into(),
                client_secret_env: "BOREAL_MCP_TEST_SECRET".into(),
                max_token_lifetime_seconds: 600,
            },
            tls: None,
            allowed_hosts: vec!["127.0.0.1:8765".into()],
            allowed_origins: vec![],
        };
        (config, http)
    }

    #[test]
    fn principal_is_actor_mapped_and_scopes_are_intersected() {
        let (config, http) = config();
        let exp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 120;
        let claims = serde_json::from_value(serde_json::json!({
            "active": true,
            "sub": "alice@example.test",
            "iss": "http://127.0.0.1:9999/issuer",
            "aud": ["http://127.0.0.1:8765/mcp"],
            "exp": exp,
            "scope": "boreal:project:read"
        }))
        .unwrap();
        let principal = OAuthIntrospector::test_map(&config, &http, claims).unwrap();
        assert_eq!(principal.actor_id, "agent-a");
        assert!(principal.has_scope(crate::config::SCOPE_PROJECT_READ));
        assert!(!principal.has_scope(crate::config::SCOPE_PROJECT_WRITE));
        assert_eq!(principal.project_ids, BTreeSet::from(["project-a".into()]));
    }

    #[test]
    fn inactive_wrong_audience_expired_and_long_lived_tokens_fail_closed() {
        let (config, http) = config();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let base = serde_json::json!({
            "active": true,
            "sub": "alice@example.test",
            "iss": "http://127.0.0.1:9999/issuer",
            "aud": "http://127.0.0.1:8765/mcp",
            "exp": now + 120,
            "scope": "boreal:project:read"
        });
        for replacement in [
            serde_json::json!({"active":false}),
            serde_json::json!({"aud":"https://other.example/mcp"}),
            serde_json::json!({"exp":now.saturating_sub(1)}),
            serde_json::json!({"exp":now + 3600}),
            serde_json::json!({"iss":"https://wrong.example"}),
        ] {
            let mut claims = base.clone();
            for (key, value) in replacement.as_object().unwrap() {
                claims[key] = value.clone();
            }
            let parsed = serde_json::from_value(claims).unwrap();
            assert_eq!(
                OAuthIntrospector::test_map(&config, &http, parsed),
                Err(AuthError::Unauthorized)
            );
        }
    }
}
