//! Versioned application commands over the dependency-light framed transport.
//!
//! The route owns no persistence or application implementation. It validates
//! the versioned command envelope, extracts a stable command discriminator,
//! and delegates to a typed handler supplied by the application layer.

use crate::transport::{
    parse_json_object_fields, parse_json_string_value, quote_json_string_value,
};
use crate::{JsonRequest, JsonResponse, ProtocolError, ProtocolErrorCode, UnixSocketServer};

pub const APPLICATION_API_VERSION: &str = "2";
pub const APPLICATION_SCHEMA_VERSION: &str = "boreal.protocol.envelope.v1";
pub const DEFAULT_APPLICATION_PAYLOAD_SIZE: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ApplicationRouteConfig {
    pub max_payload_size: usize,
}

impl Default for ApplicationRouteConfig {
    fn default() -> Self {
        Self {
            max_payload_size: DEFAULT_APPLICATION_PAYLOAD_SIZE,
        }
    }
}

impl ApplicationRouteConfig {
    pub fn new(max_payload_size: usize) -> Result<Self, ProtocolError> {
        if max_payload_size == 0 {
            return Err(route_error(
                ProtocolErrorCode::InvalidPayload,
                "application payload limit must be positive",
            ));
        }
        Ok(Self { max_payload_size })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApplicationRequest {
    pub request_id: String,
    pub api_version: String,
    pub schema_version: String,
    pub operation_id: String,
    pub command: String,
    pub data: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApplicationResponse {
    pub api_version: String,
    pub schema_version: String,
    pub operation_id: String,
    pub data: String,
}

pub trait ApplicationCommandHandler {
    fn handle(&mut self, request: ApplicationRequest)
        -> Result<ApplicationResponse, ProtocolError>;
}

pub struct ApplicationRoute<H> {
    handler: H,
    config: ApplicationRouteConfig,
}

impl<H> ApplicationRoute<H> {
    pub const fn new(handler: H) -> Self {
        Self {
            handler,
            config: ApplicationRouteConfig {
                max_payload_size: DEFAULT_APPLICATION_PAYLOAD_SIZE,
            },
        }
    }

    pub const fn with_config(handler: H, config: ApplicationRouteConfig) -> Self {
        Self { handler, config }
    }

    pub const fn handler(&self) -> &H {
        &self.handler
    }

    pub const fn handler_mut(&mut self) -> &mut H {
        &mut self.handler
    }

    pub fn dispatch(&mut self, request: JsonRequest) -> Result<JsonResponse, ProtocolError>
    where
        H: ApplicationCommandHandler,
    {
        let request_id = request.request_id().to_owned();
        if request.payload().len() > self.config.max_payload_size {
            return Err(route_error(
                ProtocolErrorCode::InvalidPayload,
                format!(
                    "application payload is {} bytes; maximum is {}",
                    request.payload().len(),
                    self.config.max_payload_size
                ),
            ));
        }
        let application_request = decode_request(&request_id, request.payload())?;
        let response = self.handler.handle(application_request)?;
        let payload = encode_response(&response)?;
        JsonResponse::success(request_id, payload)
    }

    pub fn serve_once(&mut self, server: &UnixSocketServer) -> Result<(), crate::TransportError>
    where
        H: ApplicationCommandHandler,
    {
        server.serve_once(|request| self.dispatch(request))
    }
}

fn decode_request(request_id: &str, body: &str) -> Result<ApplicationRequest, ProtocolError> {
    let fields = parse_json_object_fields(body)?;
    reject_unknown_fields(
        &fields,
        &["api_version", "schema_version", "operation_id", "data"],
    )?;
    let api_version = required_string(&fields, "api_version")?;
    let schema_version = required_string(&fields, "schema_version")?;
    let operation_id = required_string(&fields, "operation_id")?;
    validate_version(&api_version, &schema_version)?;
    validate_operation_id(&operation_id)?;
    let data = required_value(&fields, "data")?.to_owned();
    let data_fields = parse_json_object_fields(&data)?;
    let command = required_string(&data_fields, "command")?;
    Ok(ApplicationRequest {
        request_id: request_id.to_owned(),
        api_version,
        schema_version,
        operation_id,
        command,
        data,
    })
}

fn encode_response(response: &ApplicationResponse) -> Result<String, ProtocolError> {
    validate_version(&response.api_version, &response.schema_version)?;
    validate_operation_id(&response.operation_id)?;
    JsonRequest::new("application-response", response.data.clone())?;
    Ok(format!(
        "{{\"api_version\":{},\"schema_version\":{},\"operation_id\":{},\"data\":{}}}",
        quote_json_string_value(&response.api_version),
        quote_json_string_value(&response.schema_version),
        quote_json_string_value(&response.operation_id),
        response.data
    ))
}

fn validate_version(api_version: &str, schema_version: &str) -> Result<(), ProtocolError> {
    if api_version != APPLICATION_API_VERSION {
        return Err(route_error(
            ProtocolErrorCode::InvalidField,
            format!(
                "application API version mismatch: expected {APPLICATION_API_VERSION}, found {api_version}"
            ),
        ));
    }
    if schema_version != APPLICATION_SCHEMA_VERSION {
        return Err(route_error(
            ProtocolErrorCode::InvalidField,
            format!(
                "application schema version mismatch: expected {APPLICATION_SCHEMA_VERSION}, found {schema_version}"
            ),
        ));
    }
    Ok(())
}

fn validate_operation_id(value: &str) -> Result<(), ProtocolError> {
    let valid = value.strip_prefix("op_").is_some_and(|tail| {
        !tail.is_empty()
            && tail
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    });
    if valid {
        Ok(())
    } else {
        Err(route_error(
            ProtocolErrorCode::InvalidField,
            "operation_id must start with op_ and contain only safe identifier characters",
        ))
    }
}

fn reject_unknown_fields(
    fields: &[(String, String)],
    allowed: &[&str],
) -> Result<(), ProtocolError> {
    if let Some((name, _)) = fields
        .iter()
        .find(|(name, _)| !allowed.contains(&name.as_str()))
    {
        return Err(route_error(
            ProtocolErrorCode::UnknownField,
            format!("unknown application envelope field {name:?}"),
        ));
    }
    Ok(())
}

fn required_value<'a>(
    fields: &'a [(String, String)],
    name: &str,
) -> Result<&'a str, ProtocolError> {
    fields
        .iter()
        .find(|(field_name, _)| field_name == name)
        .map(|(_, value)| value.as_str())
        .ok_or_else(|| route_error(ProtocolErrorCode::MissingField, format!("missing {name:?}")))
}

fn required_string(fields: &[(String, String)], name: &str) -> Result<String, ProtocolError> {
    parse_json_string_value(required_value(fields, name)?).map_err(|error| {
        if error.code() == ProtocolErrorCode::InvalidJson {
            route_error(
                ProtocolErrorCode::InvalidField,
                format!("field {name:?} must be a JSON string"),
            )
        } else {
            error
        }
    })
}

fn route_error(code: ProtocolErrorCode, message: impl Into<String>) -> ProtocolError {
    ProtocolError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StatusHandler;

    impl ApplicationCommandHandler for StatusHandler {
        fn handle(
            &mut self,
            request: ApplicationRequest,
        ) -> Result<ApplicationResponse, ProtocolError> {
            assert_eq!(request.command, "status");
            Ok(ApplicationResponse {
                api_version: APPLICATION_API_VERSION.to_owned(),
                schema_version: APPLICATION_SCHEMA_VERSION.to_owned(),
                operation_id: request.operation_id,
                data: "{\"command\":\"status\",\"served\":true}".to_owned(),
            })
        }
    }

    fn request_payload() -> String {
        format!(
            "{{\"api_version\":\"{APPLICATION_API_VERSION}\",\"schema_version\":\"{APPLICATION_SCHEMA_VERSION}\",\"operation_id\":\"op_status_route_test\",\"data\":{{\"command\":\"status\",\"project_id\":\"project_demo\"}}}}"
        )
    }

    #[test]
    fn representative_status_command_is_typed_and_versioned() {
        let mut route = ApplicationRoute::new(StatusHandler);
        let response = route
            .dispatch(JsonRequest::new("correlation-7", request_payload()).unwrap())
            .unwrap();
        assert_eq!(response.request_id(), "correlation-7");
        assert!(response.payload().unwrap().contains("\"served\":true"));
    }

    #[test]
    fn incompatible_api_version_is_rejected_before_handler() {
        let mut route = ApplicationRoute::new(StatusHandler);
        let payload = request_payload().replace("\"api_version\":\"2\"", "\"api_version\":\"999\"");
        let error = route
            .dispatch(JsonRequest::new("correlation-version", payload).unwrap())
            .unwrap_err();
        assert_eq!(error.code(), ProtocolErrorCode::InvalidField);
        assert!(error.message().contains("API version mismatch"));
    }

    #[test]
    fn bounded_payload_is_rejected_before_handler() {
        let config = ApplicationRouteConfig::new(16).unwrap();
        let mut route = ApplicationRoute::with_config(StatusHandler, config);
        let error = route
            .dispatch(JsonRequest::new("correlation-bounds", request_payload()).unwrap())
            .unwrap_err();
        assert_eq!(error.code(), ProtocolErrorCode::InvalidPayload);
        assert!(error.message().contains("maximum is 16"));
    }

    #[test]
    fn malformed_command_payload_is_rejected_without_invoking_handler() {
        let mut route = ApplicationRoute::new(StatusHandler);
        let payload = format!(
            "{{\"api_version\":\"{APPLICATION_API_VERSION}\",\"schema_version\":\"{APPLICATION_SCHEMA_VERSION}\",\"operation_id\":\"op_bad\",\"data\":{{\"command\":42}}}}"
        );
        let error = route
            .dispatch(JsonRequest::new("correlation-payload", payload).unwrap())
            .unwrap_err();
        assert_eq!(error.code(), ProtocolErrorCode::InvalidField);
    }
}
