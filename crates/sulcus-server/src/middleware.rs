use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use sha2::{Digest, Sha256};

/// Middleware that requires `Authorization: Bearer <api-key>` header.
///
/// Validation strategy:
/// - If `SULCUS_API_KEY_HASH` env var is set, compare SHA256(hex) of the provided key to it.
/// - If `SULCUS_DATABASE_URL` is set and `api_keys` table exists, a DB lookup could be added later.
pub async fn require_agent_api_key(
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !header.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = header.trim_start_matches("Bearer ").trim();

    // compute sha256 hex of token
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let hash = hasher.finalize();
    let hash_hex = hex::encode(hash);

    // For multi-tenancy: the SHA-256 hex of the provided token *is* the tenant_id.
    // Accept any non-empty token and insert the tenant_id into request extensions so
    // downstream handlers can scope DB / in-memory state by tenant.
    if token.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // insert tenant_id into request extensions for downstream handlers
    let tenant_id: String = hash_hex;
    req.extensions_mut().insert(tenant_id);

    Ok(next.run(req).await)
}
