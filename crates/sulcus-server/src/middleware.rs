use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::body::Body;
use sha2::{Digest, Sha256};

/// Middleware that requires `Authorization: Bearer <api-key>` header.
///
/// Validation strategy:
/// - If `SULCUS_API_KEY_HASH` env var is set, compare SHA256(hex) of the provided key to it.
/// - If `DATABASE_URL` is set and `api_keys` table exists, a DB lookup could be added later.
pub async fn require_agent_api_key(req: Request<Body>, next: Next) -> Result<Response, StatusCode> {
    let header = req.headers().get(axum::http::header::AUTHORIZATION).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !header.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = header.trim_start_matches("Bearer ").trim();

    // compute sha256 hex of token
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let hash = hasher.finalize();
    let hash_hex = hex::encode(hash);

    if let Ok(expected) = std::env::var("SULCUS_API_KEY_HASH") {
        if hash_hex == expected {
            Ok(next.run(req).await)
        } else {
            Err(StatusCode::UNAUTHORIZED)
        }
    } else {
        // no env configured — be permissive in dev: reject if token is empty, else allow
        if token.is_empty() {
            Err(StatusCode::UNAUTHORIZED)
        } else {
            Ok(next.run(req).await)
        }
    }
}
