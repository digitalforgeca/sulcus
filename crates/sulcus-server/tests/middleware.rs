use axum::body::Body;
use axum::http::Request;
use tower::util::ServiceExt;
use std::sync::Arc;
use sulcus_server::{AppState, make_app_with_state};

#[tokio::test]
async fn require_agent_api_key_rejects_without_header() {
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/unused").unwrap(); 
    let state = Arc::new(AppState::new(pool));
    let app = make_app_with_state(state);

    let req = Request::builder().method("POST").uri("/api/v1/agent/sync").body(Body::from("{\"ops\": [], \"last_cursor\": null}")).unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn require_agent_api_key_accepts_with_bypass() {
    std::env::set_var("SULCUS_ALLOW_ANY_KEY", "1");
    let pool = sqlx::PgPool::connect_lazy("postgres://localhost/unused").unwrap(); 
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
    assert_eq!(resp.status(), 200);
}
