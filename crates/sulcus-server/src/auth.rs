use sqlx::{PgPool, Row};
use jsonwebtoken::{decode, decode_header, DecodingKey, Validation, Algorithm, jwk::JwkSet};
use serde::Deserialize;
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Simple JWKS cache with expiration
#[derive(Clone)]
struct CachedJwkSet {
    jwks: JwkSet,
    expires_at: std::time::Instant,
}

/// Global JWKS cache: Issuer URL -> CachedJwkSet
static JWKS_CACHE: Lazy<Arc<RwLock<HashMap<String, CachedJwkSet>>>> = Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

#[derive(Debug, Deserialize)]
struct Claims {
    iss: String,
    sub: String,
    aud: String,
    #[allow(dead_code)]
    exp: usize,
}

/// Result of a successful OIDC verification.
pub struct OidcIdentity {
    pub tenant_id: String,
    pub subject: String,
}

/// Fetch JWKS for a given issuer and cache it for 1 hour.
async fn get_jwks(issuer: &str) -> anyhow::Result<JwkSet> {
    {
        let cache = JWKS_CACHE.read().await;
        if let Some(entry) = cache.get(issuer) {
            if entry.expires_at > std::time::Instant::now() {
                return Ok(entry.jwks.clone());
            }
        }
    }

    let jwks_url = format!("{}/.well-known/jwks.json", issuer.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    
    let jwks: JwkSet = client.get(&jwks_url).send().await?.json().await?;

    let mut cache = JWKS_CACHE.write().await;
    cache.insert(issuer.to_string(), CachedJwkSet {
        jwks: jwks.clone(),
        expires_at: std::time::Instant::now() + std::time::Duration::from_secs(3600),
    });
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
        Err(_) => return Ok(None), 
    };
    
    let kid = match header.kid {
        Some(k) => k,
        None => return Ok(None),
    };

    // 2. Extract issuer without verification to look up tenant config.
    // We use an insecure decode to peek at the claims.
    let mut parts = token.split('.');
    let _ = parts.next();
    let b64_claims = parts.next().unwrap_or_default();
    
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    let claims_json = match URL_SAFE_NO_PAD.decode(b64_claims) {
        Ok(b) => String::from_utf8(b).unwrap_or_default(),
        Err(_) => return Ok(None),
    };
    let unverified_claims: Claims = match serde_json::from_str(&claims_json) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    // --- SECURITY A-1: Prevent SSRF ---
    // Validate the issuer against our trusted SSO tenants BEFORE fetching JWKS.
    let row = sqlx::query("SELECT tenant_id, client_id FROM sso_tenants WHERE issuer_url = $1")
        .bind(&unverified_claims.iss)
        .fetch_optional(pool)
        .await?;

    let (tenant_id, expected_client_id) = match row {
        Some(r) => (r.get::<String, _>("tenant_id"), r.get::<String, _>("client_id")),
        None => return Ok(None), // Untrusted issuer
    };

    // 3. Fetch JWKS from the verified issuer URL
    let jwks = match get_jwks(&unverified_claims.iss).await {
        Ok(j) => j,
        Err(e) => {
            tracing::error!(error = %e, issuer = %unverified_claims.iss, "failed to fetch JWKS");
            return Ok(None);
        }
    };

    // 4. Select the key by kid and verify signature
    let jwk = match jwks.find(&kid) {
        Some(j) => j,
        None => return Ok(None), 
    };

    let decoding_key = match DecodingKey::from_jwk(jwk) {
        Ok(k) => k,
        Err(_) => return Ok(None),
    };

    // --- SECURITY A-2: Enforce Algorithms ---
    let mut validation = Validation::new(Algorithm::RS256); // Start with RS256
    validation.algorithms = vec![Algorithm::RS256, Algorithm::RS384, Algorithm::RS512, Algorithm::ES256, Algorithm::ES384];
    
    // --- SECURITY A-3: Fix Audience Tautology ---
    validation.validate_exp = true;
    validation.set_audience(&[&expected_client_id]);

    let token_data = match decode::<Claims>(token, &decoding_key, &validation) {
        Ok(data) => data,
        Err(e) => {
            tracing::warn!("OIDC verification failed: {}", e);
            return Ok(None);
        }
    };

    let claims = token_data.claims;

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
