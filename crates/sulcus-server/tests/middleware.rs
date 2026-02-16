use axum::body::Body;
use axum::http::Request;
use axum::routing::post;
use axum::Router;
use axum::middleware::from_fn;
use tower::util::ServiceExt;
use sha2::Digest;

#[tokio::test]
async fn require_agent_api_key_rejects_without_header() {
    // build a tiny router (no state) that applies the same middleware and returns 200 from the handler
    let app = Router::new().route("/test", post(|| async { "ok" })).layer(from_fn(sulcus_server::middleware::require_agent_api_key));

    let req = Request::builder().method("POST").uri("/test").body(Body::empty()).unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn require_agent_api_key_accepts_with_valid_env_hash() {
    // set env var to sha256("test-key")
    let mut hasher = sha2::Sha256::new();
    hasher.update(b"test-key");
    let hash = hex::encode(hasher.finalize());
    std::env::set_var("SULCUS_API_KEY_HASH", hash);

    let app = Router::new().route("/test", post(|| async { "ok" })).layer(from_fn(sulcus_server::middleware::require_agent_api_key));

    let body = "";
    let req = Request::builder()
        .method("POST")
        .uri("/test")
        .header("authorization", "Bearer test-key")
        .body(Body::from(body))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
}
