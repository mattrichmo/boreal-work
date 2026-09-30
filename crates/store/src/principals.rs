//! Project-scoped credential authority. Raw secrets are never stored in SQLite,
//! operation outcomes or audit events. All mutations are revision-bound.
use super::status_evaluation::canonical_status_timestamp as timestamp_ms;
use super::*;
use boreal_domain::{ActorContext, ActorId, ActorRole};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthenticatedPrincipal {
    pub project_id: String,
    pub actor_id: String,
    pub role: ActorRole,
    pub authority_root: String,
    pub credential_id: String,
}

// Deliberately not Debug: this request contains a secret.
pub struct PrincipalGrantRequest {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub principal_actor_id: String,
    pub role: ActorRole,
    pub independent: bool,
    pub credential: String,
    pub expires_at_ms: Option<u64>,
    pub display_name: String,
    pub reason: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub at: String,
}

#[derive(Clone, Debug)]
pub struct PrincipalRevocationRequest {
    pub project_id: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub principal_actor_id: String,
    pub credential_id: Option<String>,
    pub reason: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub at: String,
}

pub fn credential_digest(project_id: &str, secret: &str) -> Result<String, StoreError> {
    let body = secret.strip_prefix("bwrk1_").ok_or_else(|| {
        StoreError::Invalid(
            "a project credential is required; OS identity strings are not credentials".into(),
        )
    })?;
    if project_id.trim().is_empty()
        || body.len() != 64
        || !body.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(StoreError::Invalid(
            "credential must contain 256 bits of generated key material".into(),
        ));
    }
    Ok(format!(
        "boreal-key-v1:{}",
        checksum(format!("boreal.principal/v1\0{project_id}\0{secret}").as_bytes())
    ))
}

fn role_name(role: ActorRole) -> &'static str {
    match role {
        ActorRole::Agent => "agent",
        ActorRole::Reviewer => "reviewer",
        ActorRole::Operator => "operator",
        ActorRole::Publisher => "publisher",
    }
}

impl SqliteStore {
    /// Historical attribution survives revocation. Authentication always uses
    /// principal_authority instead; this read cannot authorize a caller.
    pub(crate) fn recorded_principal_root(
        &self,
        project: &str,
        actor: &str,
    ) -> Result<String, StoreError> {
        let mut row = self.prepare(
            "SELECT authority_root FROM boreal_principal WHERE project_id=?1 AND actor_id=?2",
        )?;
        row.bind_text(1, project)?;
        row.bind_text(2, actor)?;
        if row.step()? != SQLITE_ROW {
            return Err(StoreError::Corrupt(
                "historical principal attribution is missing".into(),
            ));
        }
        row.column_text(0)
    }

    pub fn authenticate_principal(
        &self,
        project_id: &str,
        secret: &str,
        as_of: TimestampMs,
    ) -> Result<AuthenticatedPrincipal, StoreError> {
        let digest = credential_digest(project_id, secret)?;
        let mut row = self.prepare("SELECT c.actor_id,c.credential_id FROM boreal_principal_credential c WHERE c.project_id=?1 AND c.secret_digest=?2 AND (c.expires_at_ms IS NULL OR c.expires_at_ms>?3) AND NOT EXISTS (SELECT 1 FROM boreal_credential_revocation r WHERE r.project_id=c.project_id AND r.credential_id=c.credential_id)")?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, &digest)?;
        row.bind_i64(3, as_of.0)?;
        if row.step()? != SQLITE_ROW {
            return Err(StoreError::Conflict(
                "credential is unknown, expired or revoked for this project".into(),
            ));
        }
        let actor_id = row.column_text(0)?;
        let credential_id = row.column_text(1)?;
        let (role, authority_root) = self.principal_authority(project_id, &actor_id)?;
        Ok(AuthenticatedPrincipal {
            project_id: project_id.into(),
            actor_id,
            role,
            authority_root,
            credential_id,
        })
    }

    /// Resolving every delegation ancestor makes revocation transitive. A
    /// corrupt cycle, missing parent or changed authority root denies access.
    pub fn principal_authority(
        &self,
        project_id: &str,
        actor_id: &str,
    ) -> Result<(ActorRole, String), StoreError> {
        let role = self.actor_context(actor_id)?.role;
        let mut cursor = actor_id.to_owned();
        let mut seen = BTreeSet::new();
        let mut expected_root: Option<String> = None;
        loop {
            if seen.len() >= 32 || !seen.insert(cursor.clone()) {
                return Err(StoreError::Corrupt(
                    "principal delegation cycle/depth".into(),
                ));
            }
            let mut row = self.prepare("SELECT p.role,p.authority_root,p.delegated_by FROM boreal_principal p WHERE p.project_id=?1 AND p.actor_id=?2 AND NOT EXISTS (SELECT 1 FROM boreal_principal_revocation r WHERE r.project_id=p.project_id AND r.principal_actor_id=p.actor_id)")?;
            row.bind_text(1, project_id)?;
            row.bind_text(2, &cursor)?;
            if row.step()? != SQLITE_ROW {
                return Err(StoreError::Conflict(
                    "principal or its delegator is not active in this project".into(),
                ));
            }
            if cursor == actor_id && row.column_text(0)? != role_name(role) {
                return Err(StoreError::Corrupt(
                    "principal role differs from actor record".into(),
                ));
            }
            let root = row.column_text(1)?;
            if expected_root
                .as_ref()
                .is_some_and(|expected| expected != &root)
            {
                return Err(StoreError::Corrupt("delegation root changed".into()));
            }
            expected_root = Some(root.clone());
            match row.column_optional_text(2)? {
                Some(parent) => cursor = parent,
                None if cursor == root => return Ok((role, root)),
                None => {
                    return Err(StoreError::Corrupt(
                        "independent principal is not its authority root".into(),
                    ))
                }
            }
        }
    }

    pub fn project_actor_context(
        &self,
        project_id: &str,
        actor_id: &str,
    ) -> Result<ActorContext, StoreError> {
        if !self.canonical_production {
            return self.actor_context(actor_id);
        }
        let (role, _) = self.principal_authority(project_id, actor_id)?;
        Ok(ActorContext {
            actor_id: ActorId::new(actor_id),
            role,
        })
    }

    pub fn validate_project_session(
        &self,
        project_id: &str,
        actor_id: &str,
        session_id: &str,
    ) -> Result<(), StoreError> {
        if !self.canonical_production {
            return Ok(());
        }
        self.principal_authority(project_id, actor_id)?;
        let mut row = self.prepare("SELECT 1 FROM boreal_session_binding b JOIN session s ON s.session_id=b.session_id AND s.actor_id=b.actor_id WHERE b.project_id=?1 AND b.actor_id=?2 AND b.session_id=?3 AND s.state='active'")?;
        row.bind_text(1, project_id)?;
        row.bind_text(2, actor_id)?;
        row.bind_text(3, session_id)?;
        if row.step()? != SQLITE_ROW {
            return Err(StoreError::Conflict(
                "session is not active for the authenticated project principal".into(),
            ));
        }
        Ok(())
    }

    pub fn has_project_principals(&self, project_id: &str) -> Result<bool, StoreError> {
        let mut row = self.prepare("SELECT 1 FROM boreal_principal WHERE project_id=?1 LIMIT 1")?;
        row.bind_text(1, project_id)?;
        Ok(row.step()? == SQLITE_ROW)
    }

    /// Local owner-only upgrade of a workspace that predates principal keys.
    /// Transport handlers must never expose this bootstrap operation. The CLI
    /// additionally verifies the canonical workspace and filesystem ownership.
    pub fn bootstrap_project_principal(
        &self,
        request: &PrincipalGrantRequest,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let digest = self.principal_grant_digest(request)?;
            if let Some(operation) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "principal.bootstrap",
                &request.actor_id,
                None,
                Some(request.expected_revision),
                None,
                None,
                &digest,
                "project",
                &request.project_id,
            )? {
                return Ok(MutationResult {
                    operation_id: operation.operation_id,
                    revision: operation.revision,
                    replayed: true,
                });
            }
            if self
                .operation_identity_context(&request.project_id)?
                .is_none()
                || self.has_project_principals(&request.project_id)?
            {
                return Err(StoreError::Conflict(
                    "bootstrap requires a bound project with no principal authority".into(),
                ));
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                Some(request.expected_revision),
            )?;
            if request.actor_id != request.principal_actor_id
                || request.role != ActorRole::Operator
                || !request.independent
                || request.reason.trim().is_empty()
            {
                return Err(StoreError::Invalid(
                    "bootstrap requires an explicit independent operator and reason".into(),
                ));
            }
            self.insert_principal_grant(request, &request.actor_id, None)?;
            self.commit_principal_operation(
                &request.project_id,
                &request.actor_id,
                None,
                request.expected_revision,
                &request.operation_id,
                &request.at,
                "principal.bootstrap",
                &digest,
                json!({"actor_id":request.principal_actor_id,"reason":request.reason}),
            )
        })();
        finish_transaction(self, result)
    }

    pub fn grant_principal(
        &self,
        request: &PrincipalGrantRequest,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let digest = self.principal_grant_digest(request)?;
            if let Some(operation) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "principal.grant",
                &request.actor_id,
                request.session_id.as_deref(),
                Some(request.expected_revision),
                None,
                None,
                &digest,
                "project",
                &request.project_id,
            )? {
                return Ok(MutationResult {
                    operation_id: operation.operation_id,
                    revision: operation.revision,
                    replayed: true,
                });
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                Some(request.expected_revision),
            )?;
            let (role, root) = self.principal_authority(&request.project_id, &request.actor_id)?;
            if role != ActorRole::Operator && (request.independent || request.role != role) {
                return Err(StoreError::Conflict("only an operator may establish independent authority or grant a different role".into()));
            }
            if request.reason.trim().is_empty() || request.principal_actor_id.trim().is_empty() {
                return Err(StoreError::Invalid(
                    "principal grant requires target and reason".into(),
                ));
            }
            if let Some(session) = request.session_id.as_deref() {
                self.validate_project_session(&request.project_id, &request.actor_id, session)?;
            }
            let at = timestamp_ms(&request.at)?;
            if request.expires_at_ms.is_some_and(|expiry| expiry <= at.0) {
                return Err(StoreError::Invalid(
                    "credential expiry must be in the future".into(),
                ));
            }
            let authority = if request.independent {
                request.principal_actor_id.as_str()
            } else {
                root.as_str()
            };
            let parent = (!request.independent).then_some(request.actor_id.as_str());
            self.insert_principal_grant(request, authority, parent)?;
            self.commit_principal_operation(&request.project_id, &request.actor_id, request.session_id.as_deref(), request.expected_revision, &request.operation_id, &request.at, "principal.grant", &digest, json!({"actor_id":request.principal_actor_id,"role":role_name(request.role),"authority_root":authority,"reason":request.reason}))
        })();
        finish_transaction(self, result)
    }

    fn principal_grant_digest(
        &self,
        request: &PrincipalGrantRequest,
    ) -> Result<String, StoreError> {
        Ok(checksum(json!({"project":request.project_id,"actor":request.actor_id,"session":request.session_id,"target":request.principal_actor_id,"role":role_name(request.role),"independent":request.independent,"key_digest":credential_digest(&request.project_id,&request.credential)?,"expires":request.expires_at_ms,"name":request.display_name,"reason":request.reason,"revision":request.expected_revision}).to_string().as_bytes()))
    }

    fn insert_principal_grant(
        &self,
        request: &PrincipalGrantRequest,
        root: &str,
        parent: Option<&str>,
    ) -> Result<(), StoreError> {
        let digest = credential_digest(&request.project_id, &request.credential)?;
        let mut existing = self.prepare("SELECT role,authority_root,delegated_by FROM boreal_principal WHERE project_id=?1 AND actor_id=?2")?;
        existing.bind_text(1, &request.project_id)?;
        existing.bind_text(2, &request.principal_actor_id)?;
        if existing.step()? == SQLITE_ROW {
            if existing.column_text(0)? != role_name(request.role)
                || existing.column_text(1)? != root
                || existing.column_optional_text(2)?.as_deref() != parent
            {
                return Err(StoreError::Conflict(
                    "existing principal role/delegation identity is immutable".into(),
                ));
            }
            self.principal_authority(&request.project_id, &request.principal_actor_id)?;
        } else {
            self.ensure_actor(
                &request.principal_actor_id,
                role_name(request.role),
                &digest,
                &request.display_name,
                &request.at,
            )?;
            let mut row = self.prepare("INSERT INTO boreal_principal(project_id,actor_id,role,authority_root,delegated_by,operation_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")?;
            row.bind_text(1, &request.project_id)?;
            row.bind_text(2, &request.principal_actor_id)?;
            row.bind_text(3, role_name(request.role))?;
            row.bind_text(4, root)?;
            row.bind_optional_text(5, parent)?;
            row.bind_text(6, &request.operation_id)?;
            row.bind_text(7, &request.at)?;
            row.run()?;
        }
        let mut row = self.prepare("INSERT INTO boreal_principal_credential(project_id,credential_id,actor_id,secret_digest,expires_at_ms,operation_id,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)")?;
        row.bind_text(1, &request.project_id)?;
        row.bind_text(2, &format!("key:{}", request.operation_id))?;
        row.bind_text(3, &request.principal_actor_id)?;
        row.bind_text(4, &digest)?;
        row.bind_optional_i64(5, request.expires_at_ms)?;
        row.bind_text(6, &request.operation_id)?;
        row.bind_text(7, &request.at)?;
        row.run()
    }

    pub fn revoke_principal(
        &self,
        request: &PrincipalRevocationRequest,
    ) -> Result<MutationResult, StoreError> {
        self.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let digest = checksum(json!({"project":request.project_id,"actor":request.actor_id,"target":request.principal_actor_id,"credential":request.credential_id,"reason":request.reason,"revision":request.expected_revision}).to_string().as_bytes());
            if let Some(operation) = self.preflight_operation_replay(
                &request.project_id,
                &request.operation_id,
                "principal.revoke",
                &request.actor_id,
                request.session_id.as_deref(),
                Some(request.expected_revision),
                None,
                None,
                &digest,
                "project",
                &request.project_id,
            )? {
                return Ok(MutationResult {
                    operation_id: operation.operation_id,
                    revision: operation.revision,
                    replayed: true,
                });
            }
            check_expected_revision(
                self.project_revision(&request.project_id)?.0,
                Some(request.expected_revision),
            )?;
            let (role, _) = self.principal_authority(&request.project_id, &request.actor_id)?;
            if role != ActorRole::Operator && request.actor_id != request.principal_actor_id {
                return Err(StoreError::Conflict(
                    "principal revocation requires self or operator authority".into(),
                ));
            }
            if let Some(session) = request.session_id.as_deref() {
                self.validate_project_session(&request.project_id, &request.actor_id, session)?;
            }
            if request.reason.trim().is_empty() {
                return Err(StoreError::Invalid("revocation requires a reason".into()));
            }
            self.principal_authority(&request.project_id, &request.principal_actor_id)?;
            let target = request
                .credential_id
                .as_deref()
                .unwrap_or(&request.principal_actor_id);
            let sql = if request.credential_id.is_some() {
                let mut key=self.prepare("SELECT actor_id FROM boreal_principal_credential WHERE project_id=?1 AND credential_id=?2")?;
                key.bind_text(1, &request.project_id)?;
                key.bind_text(2, target)?;
                if key.step()? != SQLITE_ROW || key.column_text(0)? != request.principal_actor_id {
                    return Err(StoreError::Conflict(
                        "credential does not belong to target principal".into(),
                    ));
                }
                "INSERT INTO boreal_credential_revocation(project_id,credential_id,actor_id,reason,operation_id,revoked_at) VALUES (?1,?2,?3,?4,?5,?6)"
            } else {
                "INSERT INTO boreal_principal_revocation(project_id,principal_actor_id,actor_id,reason,operation_id,revoked_at) VALUES (?1,?2,?3,?4,?5,?6)"
            };
            let mut row = self.prepare(sql)?;
            row.bind_text(1, &request.project_id)?;
            row.bind_text(2, target)?;
            row.bind_text(3, &request.actor_id)?;
            row.bind_text(4, &request.reason)?;
            row.bind_text(5, &request.operation_id)?;
            row.bind_text(6, &request.at)?;
            row.run()?;
            // Check after the tentative revocation so transitive descendants
            // and the last usable operator credential are handled correctly.
            let mut keys=self.prepare("SELECT DISTINCT c.actor_id FROM boreal_principal_credential c JOIN boreal_principal p ON p.project_id=c.project_id AND p.actor_id=c.actor_id WHERE c.project_id=?1 AND p.role='operator' AND (c.expires_at_ms IS NULL OR c.expires_at_ms>?2) AND NOT EXISTS (SELECT 1 FROM boreal_credential_revocation r WHERE r.project_id=c.project_id AND r.credential_id=c.credential_id)")?;
            keys.bind_text(1, &request.project_id)?;
            keys.bind_i64(2, timestamp_ms(&request.at)?.0)?;
            let mut usable = false;
            while keys.step()? == SQLITE_ROW {
                if self
                    .principal_authority(&request.project_id, &keys.column_text(0)?)
                    .is_ok()
                {
                    usable = true;
                    break;
                }
            }
            if !usable {
                return Err(StoreError::Conflict("revocation would remove the last usable operator; establish a replacement first".into()));
            }
            self.commit_principal_operation(&request.project_id,&request.actor_id,request.session_id.as_deref(),request.expected_revision,&request.operation_id,&request.at,"principal.revoke",&digest,json!({"actor_id":request.principal_actor_id,"credential_id":request.credential_id,"reason":request.reason}))
        })();
        finish_transaction(self, result)
    }

    #[allow(clippy::too_many_arguments)]
    fn commit_principal_operation(
        &self,
        project: &str,
        actor: &str,
        session: Option<&str>,
        expected: u64,
        operation: &str,
        at: &str,
        command: &str,
        digest: &str,
        payload: Value,
    ) -> Result<MutationResult, StoreError> {
        let revision = self.bump_revision_in_transaction(project)?.0;
        let result_json = payload.to_string();
        self.append_operation_audit_in_transaction(
            OperationRecord {
                operation_id: operation.into(),
                project_id: project.into(),
                command: command.into(),
                actor_id: actor.into(),
                session_id: session.map(str::to_owned),
                expected_revision: Some(expected),
                attempt_id: None,
                fence: None,
                request_digest: digest.into(),
                outcome: OperationOutcome::Changed,
                result_json: result_json.clone(),
                revision,
                created_at: at.into(),
                completed_at: Some(at.into()),
            },
            AuditEventRecord {
                project_id: project.into(),
                revision,
                operation_id: operation.into(),
                event_type: "repair.correction".into(),
                subject_type: "project".into(),
                subject_id: project.into(),
                actor_id: actor.into(),
                session_id: session.map(str::to_owned),
                fence: None,
                as_of: at.into(),
                payload_json: result_json,
            },
        )?;
        Ok(MutationResult {
            operation_id: operation.into(),
            revision,
            replayed: false,
        })
    }
}
