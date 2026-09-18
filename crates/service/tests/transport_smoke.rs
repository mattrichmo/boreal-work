//! Black-box transport coverage for the public service boundary.
//!
//! The inline transport tests exercise implementation details.  This test
//! deliberately uses only the crate's public client/server API so a framing,
//! correlation, or cleanup regression is visible at the integration layer.

#[cfg(unix)]
mod unix_transport {
    use boreal_service::{
        JsonRequest, JsonResponse, TransportConfig, TransportError, UnixSocketClient,
        UnixSocketServer,
    };
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        thread,
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn socket_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "boreal-service-transport-{}-{}.sock",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn public_socket_round_trip_preserves_payload_and_correlation() {
        let path = socket_path();
        let server = match UnixSocketServer::bind(&path, TransportConfig::default()) {
            Ok(server) => server,
            Err(TransportError::Io(error))
                if error.kind() == std::io::ErrorKind::PermissionDenied =>
            {
                println!(
                    "BOREAL_VALIDATION_SKIP: Unix socket creation is unavailable in this environment"
                );
                return;
            }
            Err(error) => panic!("public service socket should bind: {error}"),
        };

        let server_thread = thread::spawn(move || {
            server
                .serve_once(|request| {
                    JsonResponse::success(
                        request.request_id().to_owned(),
                        request.payload().to_owned(),
                    )
                })
                .expect("server should serve one request");
        });

        let mut client = UnixSocketClient::connect(&path, TransportConfig::default())
            .expect("public client should connect");
        let request = JsonRequest::new("integration-request-1", r#"{"command":"ping"}"#)
            .expect("request payload should be valid JSON");
        let response = client.request(request).expect("request should round-trip");
        assert_eq!(response.request_id(), "integration-request-1");
        assert_eq!(response.payload(), Some(r#"{"command":"ping"}"#));

        server_thread.join().expect("server thread should finish");
        assert!(!path.exists(), "server drop should remove its socket path");
        let _ = fs::remove_file(path);
    }
}

#[cfg(not(unix))]
#[test]
fn transport_smoke_is_unix_specific() {}
