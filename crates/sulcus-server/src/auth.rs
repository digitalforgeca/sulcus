use sqlx::PgPool;

/// Result of a successful OIDC verification.
pub struct OidcIdentity {
    pub tenant_id: String,
    pub subject: String,
}

/// Verify an OIDC token and perform Just-In-Time (JIT) tenant resolution.
///
/// TODO: Implement JWKS validation —
///   1. Decode JWT header/claims (no verify) to extract `iss` and `kid`.
///   2. Fetch `{iss}/.well-known/jwks.json` and cache the key set.
///   3. Select the key by `kid`, verify the RS256/ES256 signature.
///   4. Validate `exp`, `nbf`, `aud` (must match this service's client-id).
///   5. Resolve or JIT-provision the tenant from the verified `iss` + `sub`.
pub async fn verify_and_provision_jit(
    _pool: &PgPool,
    _token: &str,
) -> anyhow::Result<Option<OidcIdentity>> {
    // OIDC signature verification not yet implemented.
    // Return None — callers treat requests as unauthenticated until wired up.
    Ok(None)
}
