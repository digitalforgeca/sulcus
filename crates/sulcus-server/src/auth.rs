use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use once_cell::sync::Lazy;
use serde::{Deserialize, Deserializer};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Simple JWKS cache with expiration
#[derive(Clone)]
struct CachedJwkSet {
    jwks: JwkSet,
    expires_at: std::time::Instant,
}

/// Global JWKS cache: Issuer URL -> CachedJwkSet
static JWKS_CACHE: Lazy<Arc<RwLock<HashMap<String, CachedJwkSet>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

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
    let config_url = format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    );
    let oidc_config: OidcConfig = client.get(&config_url).send().await?.json().await?;

    // 2. Fetch JWKS
    let jwks: JwkSet = client
        .get(&oidc_config.jwks_uri)
        .send()
        .await?
        .json()
        .await?;

    let mut cache = JWKS_CACHE.write().await;
    cache.insert(
        issuer.to_string(),
        CachedJwkSet {
            jwks: jwks.clone(),
            expires_at: std::time::Instant::now() + std::time::Duration::from_secs(3600),
        },
    );
    Ok(jwks)
}

fn determine_plan_tier(roles: &[String]) -> String {
    if roles.contains(&"sulcus-enterprise".to_string()) || roles.contains(&"enterprise".to_string())
    {
        "enterprise".to_string()
    } else if roles.contains(&"sulcus-team".to_string())
        || roles.contains(&"team".to_string())
        || roles.contains(&"sulcus-cortex".to_string())
    {
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

    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    let claims_json = match URL_SAFE_NO_PAD.decode(b64_claims) {
        Ok(b) => String::from_utf8(b).unwrap_or_default(),
        Err(_) => return Ok(None),
    };
    let unverified_claims: Claims = match serde_json::from_str(&claims_json) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    // Validate the issuer against our trusted SSO tenants
    // First check env var for a simple single-issuer setup
    let trusted_issuer = std::env::var("SULCUS_OIDC_ISSUER").ok();
    let trusted_client = std::env::var("SULCUS_OIDC_CLIENT_ID")
        .unwrap_or_else(|_| "sulcus-web".to_string());

    let expected_client_id = if trusted_issuer.as_deref() == Some(unverified_claims.iss.as_str()) {
        tracing::info!(issuer = %unverified_claims.iss, "OIDC issuer matched via env var");
        trusted_client
    } else {
        // Fall back to sso_tenants DB table
        let row = sqlx::query("SELECT client_id FROM sso_tenants WHERE issuer_url = $1")
            .bind(&unverified_claims.iss)
            .fetch_optional(pool)
            .await?;

        match row {
            Some(r) => {
                tracing::info!(issuer = %unverified_claims.iss, "OIDC issuer matched via sso_tenants");
                r.get::<String, _>("client_id")
            }
            None => {
                tracing::warn!(issuer = %unverified_claims.iss, "OIDC issuer not trusted (not in env or sso_tenants)");
                return Ok(None);
            }
        }
    };

    let mut jwks = match get_jwks(&unverified_claims.iss, false).await {
        Ok(j) => {
            tracing::info!(key_count = j.keys.len(), "JWKS fetched successfully");
            j
        }
        Err(e) => {
            tracing::error!(error = %e, issuer = %unverified_claims.iss, "failed to fetch JWKS");
            return Ok(None);
        }
    };

    // Retry on cache miss (Keycloak rotation)
    if jwks.find(&kid).is_none() {
        tracing::info!(kid = %kid, "kid not in cached JWKS, refreshing");
        jwks = get_jwks(&unverified_claims.iss, true).await.unwrap_or(jwks);
    }

    let jwk = match jwks.find(&kid) {
        Some(j) => j,
        None => {
            tracing::warn!(kid = %kid, "kid not found in JWKS after refresh");
            return Ok(None);
        }
    };

    let decoding_key = match DecodingKey::from_jwk(jwk) {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!(error = %e, "failed to create decoding key from JWK");
            return Ok(None);
        }
    };

    let mut validation = Validation::new(Algorithm::RS256);
    validation.algorithms = vec![
        Algorithm::RS256,
        Algorithm::RS384,
        Algorithm::RS512,
        Algorithm::ES256,
        Algorithm::ES384,
    ];
    validation.validate_exp = true;
    validation.set_audience(&[&expected_client_id]);

    let token_data = match decode::<Claims>(token, &decoding_key, &validation) {
        Ok(data) => data,
        Err(e) => {
            tracing::warn!(error = %e, expected_aud = %expected_client_id, "OIDC JWT verification failed");
            return Ok(None);
        }
    };

    let claims = token_data.claims;
    let roles = claims.realm_access.roles.clone();
    let plan_tier = determine_plan_tier(&roles);
    tracing::info!(sub = %claims.sub, tenant_id = ?claims.org_id, roles = ?roles, plan_tier = %plan_tier, "OIDC JIT: verified token");

    // TENANT RESOLUTION ORDER:
    // 1. If JWT has org_id (enterprise), use it
    // 2. If keycloak_user_id already exists in api_keys, use that tenant
    // 3. Otherwise, auto-provision a new tenant: user:{sub}
    let tenant_id = if let Some(org) = &claims.org_id {
        org.clone()
    } else {
        // Check if this Keycloak user already has a linked tenant
        let existing = sqlx::query("SELECT tenant_id, plan_tier FROM api_keys WHERE keycloak_user_id = $1 LIMIT 1")
            .bind(&claims.sub)
            .fetch_optional(pool)
            .await?;

        if let Some(row) = existing {
            let tid: String = row.get("tenant_id");
            let existing_tier: String = row.get("plan_tier");
            tracing::info!(tenant_id = %tid, existing_tier = %existing_tier, "OIDC JIT: found existing tenant for keycloak user");
            tid
        } else {
            // Auto-provision new tenant
            let new_tid = format!("user:{}", claims.sub);
            let mut hasher = Sha256::new();
            hasher.update(format!("oidc:{}", new_tid).as_bytes());
            let jit_hash = hex::encode(hasher.finalize());

            sqlx::query("INSERT INTO api_keys (tenant_id, key_hash, plan_tier, keycloak_user_id) VALUES ($1, $2, $3, $4) ON CONFLICT (key_hash) DO UPDATE SET plan_tier = EXCLUDED.plan_tier")
                .bind(&new_tid)
                .bind(&jit_hash)
                .bind(&plan_tier)
                .bind(&claims.sub)
                .execute(pool)
                .await?;
            tracing::info!(tenant_id = %new_tid, "OIDC JIT: provisioned new tenant");
            new_tid
        }
    };

    Ok(Some(OidcIdentity {
        tenant_id,
        subject: claims.sub,
        roles,
        plan_tier,
    }))
}
