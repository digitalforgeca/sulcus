use sqlx::{PgPool, Row};
use jsonwebtoken::{decode, decode_header, DecodingKey, Validation, Algorithm, jwk::JwkSet};
use serde::{Deserialize, Deserializer};
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

fn deserialize_string_or_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrVec {
        String(String),
        Vec(Vec<String>),
    }

    match StringOrVec::deserialize(deserializer)? {
        StringOrVec::String(s) => Ok(vec![s]),
        StringOrVec::Vec(v) => Ok(v),
    }
}

#[derive(Debug, Deserialize, Default)]
struct RealmAccess {
    #[serde(default)]
    roles: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Claims {
    iss: String,
    sub: String,
    #[serde(deserialize_with = "deserialize_string_or_vec", default)]
    #[allow(dead_code)]
    aud: Vec<String>,
    #[allow(dead_code)]
    exp: usize,
    #[serde(default)]
    realm_access: RealmAccess,
    /// Optional organization ID for shared enterprise tenancy
    pub org_id: Option<String>,
}

/// Result of a successful OIDC verification.
pub struct OidcIdentity {
    pub tenant_id: String,
    pub subject: String,
    pub roles: Vec<String>,
    pub plan_tier: String,
}

#[derive(Deserialize)]
struct OidcConfig {
    jwks_uri: String,
}

/// Fetch JWKS for a given issuer and cache it for 1 hour.
async fn get_jwks(issuer: &str, force_refresh: bool) -> anyhow::Result<JwkSet> {
    if !force_refresh {
        let cache = JWKS_CACHE.read().await;
        if let Some(entry) = cache.get(issuer) {
            if entry.expires_at > std::time::Instant::now() {
                return Ok(entry.jwks.clone());
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
        
    // 1. OIDC Discovery
    let config_url = format!("{}/.well-known/openid-configuration", issuer.trim_end_matches('/'));
    let oidc_config: OidcConfig = client.get(&config_url).send().await?.json().await?;
    
    // 2. Fetch JWKS
    let jwks: JwkSet = client.get(&oidc_config.jwks_uri).send().await?.json().await?;

    let mut cache = JWKS_CACHE.write().await;
    cache.insert(issuer.to_string(), CachedJwkSet {
        jwks: jwks.clone(),
        expires_at: std::time::Instant::now() + std::time::Duration::from_secs(3600),
    });
    Ok(jwks)
}

fn determine_plan_tier(roles: &[String]) -> String {
    if roles.contains(&"sulcus-enterprise".to_string()) || roles.contains(&"enterprise".to_string()) {
        "enterprise".to_string()
    } else if roles.contains(&"sulcus-team".to_string()) || roles.contains(&"team".to_string()) || roles.contains(&"sulcus-cortex".to_string()) {
        "team".to_string()
    } else {
        "starter".to_string()
    }
}

/// Verify an OIDC token and perform Just-In-Time (JIT) tenant resolution.
pub async fn verify_and_provision_jit(
    pool: &PgPool,
    token: &str,
) -> anyhow::Result<Option<OidcIdentity>> {
    let header = match decode_header(token) {
        Ok(h) => h,
        Err(_) => return Ok(None), 
    };
    
    let kid = match header.kid {
        Some(k) => k,
        None => return Ok(None),
    };

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

    // Validate the issuer against our trusted SSO tenants
    let row = sqlx::query("SELECT client_id FROM sso_tenants WHERE issuer_url = $1")
        .bind(&unverified_claims.iss)
        .fetch_optional(pool)
        .await?;

    let expected_client_id = match row {
        Some(r) => r.get::<String, _>("client_id"),
        None => return Ok(None), // Untrusted issuer
    };

    let mut jwks = match get_jwks(&unverified_claims.iss, false).await {
        Ok(j) => j,
        Err(e) => {
            tracing::error!(error = %e, issuer = %unverified_claims.iss, "failed to fetch JWKS");
            return Ok(None);
        }
    };

    // Retry on cache miss (Keycloak rotation)
    if jwks.find(&kid).is_none() {
        jwks = get_jwks(&unverified_claims.iss, true).await.unwrap_or(jwks);
    }

    let jwk = match jwks.find(&kid) {
        Some(j) => j,
        None => return Ok(None), 
    };

    let decoding_key = match DecodingKey::from_jwk(jwk) {
        Ok(k) => k,
        Err(_) => return Ok(None),
    };

    let mut validation = Validation::new(Algorithm::RS256);
    validation.algorithms = vec![Algorithm::RS256, Algorithm::RS384, Algorithm::RS512, Algorithm::ES256, Algorithm::ES384];
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
    let roles = claims.realm_access.roles;
    let plan_tier = determine_plan_tier(&roles);

    // DETERMINISTIC TENANCY:
    // If JWT has org_id (enterprise), use it.
    // Otherwise, use user:{sub} for personal isolation.
    let tenant_id = claims.org_id.clone().unwrap_or_else(|| format!("user:{}", claims.sub));

    let mut hasher = Sha256::new();
    hasher.update(format!("oidc:{}", tenant_id).as_bytes());
    let jit_hash = hex::encode(hasher.finalize());

    // JIT: Store keycloak_user_id (claims.sub) for Stripe webhook role synchronization
    sqlx::query("INSERT INTO api_keys (tenant_id, key_hash, plan_tier, keycloak_user_id) VALUES ($1, $2, $3, $4) ON CONFLICT (key_hash) DO UPDATE SET plan_tier = EXCLUDED.plan_tier")
        .bind(&tenant_id)
        .bind(&jit_hash)
        .bind(&plan_tier)
        .bind(&claims.sub)
        .execute(pool)
        .await?;

    Ok(Some(OidcIdentity {
        tenant_id,
        subject: claims.sub,
        roles,
        plan_tier,
    }))
}
