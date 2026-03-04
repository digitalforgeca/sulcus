use sqlx::PgPool;
use sha2::{Sha256, Digest};

/// Result of a successful OIDC verification.
pub struct OidcIdentity {
    pub tenant_id: String,
    pub subject: String,
}

/// Verify an OIDC token and perform Just-In-Time (JIT) tenant resolution.
///
/// STUB: Currently only parses claims, does not verify signatures.
pub async fn verify_and_provision_jit(
    pool: &PgPool,
    _token: &str,
) -> anyhow::Result<Option<OidcIdentity>> {
    // 1. Parse JWT claims (Placeholder)
    // In a real implementation, we would fetch JWKS from the issuer and verify the signature.
    let issuer = "https://sts.windows.net/8adca017-c842-4290-a9c8-f339374f3f83/"; // Mock Azure AD
    let subject = "agent-42"; // Mock Agent ID

    // 2. Lookup tenant by issuer
    let row = sqlx::query("SELECT tenant_id FROM sso_tenants WHERE issuer_url = $1")
        .bind(issuer)
        .fetch_optional(pool)
        .await?;

    let tenant_id = match row {
        Some(r) => sqlx::Row::get::<String, _>(&r, "tenant_id"),
        None => return Ok(None),
    };

    // 3. Deterministic JIT key hash for this agent
    let mut hasher = Sha256::new();
    hasher.update(format!("oidc:{}:{}", tenant_id, subject).as_bytes());
    let jit_hash = hex::encode(hasher.finalize());

    // 4. Provision JIT API key if it doesn't exist
    sqlx::query("INSERT INTO api_keys (tenant_id, key_hash, plan_tier) VALUES ($1, $2, 'enterprise') ON CONFLICT DO NOTHING")
        .bind(&tenant_id)
        .bind(&jit_hash)
        .execute(pool)
        .await?;

    Ok(Some(OidcIdentity {
        tenant_id,
        subject: subject.to_string(),
    }))
}
