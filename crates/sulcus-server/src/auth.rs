use sqlx::PgPool;
use jsonwebtoken::{decode, decode_header, DecodingKey, Validation, jwk::JwkSet};
use serde::Deserialize;
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Global JWKS cache: Issuer URL -> JwkSet
static JWKS_CACHE: Lazy<Arc<RwLock<HashMap<String, JwkSet>>>> = Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

#[derive(Debug, Deserialize)]
struct Claims {
    iss: String,
    sub: String,
    aud: String,
    exp: usize,
}

/// Result of a successful OIDC verification.
pub struct OidcIdentity {
    pub tenant_id: String,
    pub subject: String,
}

/// Fetch JWKS for a given issuer and cache it.
async fn get_jwks(issuer: &str) -> anyhow::Result<JwkSet> {
    {
        let cache = JWKS_CACHE.read().await;
        if let Some(jwks) = cache.get(issuer) {
            return Ok(jwks.clone());
        }
    }

    let jwks_url = format!("{}/.well-known/jwks.json", issuer.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let jwks: JwkSet = client.get(&jwks_url).send().await?.json().await?;

    let mut cache = JWKS_CACHE.write().await;
    cache.insert(issuer.to_string(), jwks.clone());
    Ok(jwks)
}

/// Verify an OIDC token and perform Just-In-Time (JIT) tenant resolution.
pub async fn verify_and_provision_jit(
    pool: &PgPool,
    token: &str,
) -> anyhow::Result<Option<OidcIdentity>> {
    // 1. Decode header to find 'kid' and 'alg'
    let header = match decode_header(token) {
        Ok(h) => h,
        Err(_) => return Ok(None), // Not a valid JWT
    };
    
    let kid = match header.kid {
        Some(k) => k,
        None => return Ok(None),
    };

    // We must do a preliminary decode (without verification) to extract the issuer 'iss'.
    // In jsonwebtoken, we can use an insecure empty validation to peek, or parse manually.
    let mut parts = token.split('.');
    let _b64_header = parts.next().unwrap_or_default();
    let b64_claims = parts.next().unwrap_or_default();
    
    // Parse claims
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    let claims_json = match URL_SAFE_NO_PAD.decode(b64_claims) {
        Ok(b) => String::from_utf8(b).unwrap_or_default(),
        Err(_) => return Ok(None),
    };
    let unverified_claims: Claims = match serde_json::from_str(&claims_json) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    // 2. Fetch JWKS from the issuer URL
    let jwks = match get_jwks(&unverified_claims.iss).await {
        Ok(j) => j,
        Err(_) => return Ok(None),
    };

    // 3. Select the key by kid and verify signature
    let jwk = match jwks.find(&kid) {
        Some(j) => j,
        None => return Ok(None), // Key not found in JWKS
    };

    let decoding_key = match DecodingKey::from_jwk(jwk) {
        Ok(k) => k,
        Err(_) => return Ok(None),
    };

    let mut validation = Validation::new(header.alg);
    validation.validate_exp = true;
    validation.set_audience(&[&unverified_claims.aud]);

    let token_data = match decode::<Claims>(token, &decoding_key, &validation) {
        Ok(data) => data,
        Err(e) => {
            tracing::warn!("OIDC verification failed: {}", e);
            return Ok(None);
        }
    };

    let claims = token_data.claims;

    // 4. Lookup tenant by issuer and aud (client_id)
    let row = sqlx::query("SELECT tenant_id FROM sso_tenants WHERE issuer_url = $1 AND client_id = $2")
        .bind(&claims.iss)
        .bind(&claims.aud)
        .fetch_optional(pool)
        .await?;

    let tenant_id = match row {
        Some(r) => sqlx::Row::get::<String, _>(&r, "tenant_id"),
        None => return Ok(None),
    };

    // 5. Deterministic JIT key hash for this agent
    let mut hasher = Sha256::new();
    hasher.update(format!("oidc:{}:{}", tenant_id, claims.sub).as_bytes());
    let jit_hash = hex::encode(hasher.finalize());

    // 6. Provision JIT API key if it doesn't exist
    sqlx::query("INSERT INTO api_keys (tenant_id, key_hash, plan_tier) VALUES ($1, $2, 'enterprise') ON CONFLICT DO NOTHING")
        .bind(&tenant_id)
        .bind(&jit_hash)
        .execute(pool)
        .await?;

    Ok(Some(OidcIdentity {
        tenant_id,
        subject: claims.sub,
    }))
}
