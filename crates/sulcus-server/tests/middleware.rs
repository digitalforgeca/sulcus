use axum::body::Body;
use axum::http::Request;
use std::sync::Arc;
use sulcus_server::{make_app_with_state, AppState};
use tower::util::ServiceExt;

#[tokio::test]
async fn require_agent_api_key_rejects_without_header() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/unused").unwrap();
    let state = Arc::new(AppState::new(pool));
    let app = make_app_with_state(state);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/agent/sync")
        .body(Body::from("{\"ops\": [], \"last_cursor\": null}"))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn require_agent_api_key_accepts_with_bypass() {
    // This test requires a reachable PG instance (uses SULCUS_DATABASE_URL or falls back to sulcus_test).
    let db_url = std::env::var("SULCUS_DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://localhost/sulcus_test".to_string());

    let pool = match sqlx::PgPool::connect(&db_url).await {
        Ok(p) => p,
        Err(_) => {
            eprintln!("skipping require_agent_api_key_accepts_with_bypass: no DB at {db_url}");
            return;
        }
    };

    std::env::set_var("SULCUS_ALLOW_ANY_KEY", "1");
    let state = Arc::new(AppState::new(pool));
    let app = make_app_with_state(state);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/agent/sync")
        .header("authorization", "Bearer any-key")
        .header("content-type", "application/json")
        .body(Body::from("{\"ops\": [], \"last_cursor\": null}"))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    // Middleware must NOT reject with 401.  The handler may return 500 in CI
    // environments where ONNX Runtime is not installed, so we only assert that
    // the auth layer passed the request through.
    assert_ne!(
        resp.status(),
        401,
        "middleware should not reject a request with SULCUS_ALLOW_ANY_KEY=1"
    );
}
