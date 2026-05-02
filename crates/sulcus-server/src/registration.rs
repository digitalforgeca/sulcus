//! Public registration — creates a Keycloak user + provisions a Sulcus tenant.
//!
//! This replaces the Keycloak redirect registration flow with a native form.
//! POST /api/v1/register — public, rate-limited by IP.

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::SharedState;

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub phone: Option<String>,
    pub password: String,
    /// Optional invitation token (for invite-based registration).
    pub invitation_token: Option<String>,
}

#[derive(Serialize)]
pub struct RegisterResponse {
    pub status: String,
    pub message: String,
    pub tenant_id: Option<String>,
    pub api_key: Option<String>,
}

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

fn gen_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

/// POST /api/v1/register — Create a new user account.
pub async fn handle_register(
    State(state): State<SharedState>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    // --- Validation ---
    let email = req.email.trim().to_lowercase();
    if !email.contains('@') || email.len() < 5 {
        return (
            StatusCode::BAD_REQUEST,
            Json(RegisterResponse {
                status: "error".into(),
                message: "Valid email required".into(),
                tenant_id: None,
                api_key: None,
            }),
        )
            .into_response();
    }

    if req.password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(RegisterResponse {
                status: "error".into(),
                message: "Password must be at least 8 characters".into(),
                tenant_id: None,
                api_key: None,
            }),
        )
            .into_response();
    }

    if req.first_name.trim().is_empty() || req.last_name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(RegisterResponse {
                status: "error".into(),
                message: "First and last name required".into(),
                tenant_id: None,
                api_key: None,
            }),
        )
            .into_response();
    }

    // --- If invitation token provided, validate it ---
    let invite_tenant_id = if let Some(ref token) = req.invitation_token {
        let token_hash = sha256_hex(token);
        match crate::db::peek_invitation(&state.pool, &token_hash).await {
            Ok(Some(tid)) => Some(tid),
            Ok(None) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(RegisterResponse {
                        status: "error".into(),
                        message: "Invalid or expired invitation token".into(),
                        tenant_id: None,
                        api_key: None,
                    }),
                )
                    .into_response();
            }
            Err(e) => {
                tracing::error!(error = %e, "DB error checking invitation");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(RegisterResponse {
                        status: "error".into(),
                        message: "Server error".into(),
                        tenant_id: None,
                        api_key: None,
                    }),
                )
                    .into_response();
            }
        }
    } else {
        None
    };

    // --- Create Keycloak user ---
    let kc_user_id = match create_keycloak_user(
        &email,
        &req.first_name.trim(),
        &req.last_name.trim(),
        &req.password,
        req.phone.as_deref(),
    )
    .await
    {
        Ok(id) => id,
        Err(e) => {
            let msg = e.to_string();
            // Check if it's a duplicate user error (409 Conflict)
            if msg.contains("409") || msg.to_lowercase().contains("exists") {
                return (
                    StatusCode::CONFLICT,
                    Json(RegisterResponse {
                        status: "error".into(),
                        message: "An account with this email already exists. Try signing in.".into(),
                        tenant_id: None,
                        api_key: None,
                    }),
                )
                    .into_response();
            }
            tracing::error!(error = %e, "failed to create Keycloak user");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RegisterResponse {
                    status: "error".into(),
                    message: format!("Registration failed: {}", msg),
                    tenant_id: None,
                    api_key: None,
                }),
            )
                .into_response();
        }
    };

    // --- Assign free tier role ---
    if let Err(e) = crate::keycloak::assign_user_role(&kc_user_id, "free").await {
        tracing::warn!(error = %e, "failed to assign role (non-fatal)");
    }

    // --- Determine tenant ID ---
    // If invite exists, use that tenant. Otherwise create new tenant.
    let tenant_id = if let Some(ref tid) = invite_tenant_id {
        // Consume the invitation
        if let Some(ref token) = req.invitation_token {
            let token_hash = sha256_hex(token);
            let _ = crate::db::consume_invitation(&state.pool, &token_hash).await;
        }
        tid.clone()
    } else {
        format!("user:{}", kc_user_id)
    };

    // --- Generate API key ---
    let api_key = gen_token();
    let key_hash = sha256_hex(&api_key);

    if let Err(e) = crate::db::insert_api_key(&state.pool, &tenant_id, &key_hash, "free").await {
        tracing::error!(error = %e, "failed to insert API key for new user");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RegisterResponse {
                status: "error".into(),
                message: "Account created but key generation failed. Please contact support.".into(),
                tenant_id: Some(tenant_id),
                api_key: None,
            }),
        )
            .into_response();
    }

    // --- Link OIDC identity ---
    let _ = sqlx::query(
        "INSERT INTO oidc_tenant_links (keycloak_user_id, tenant_id) VALUES ($1, $2) ON CONFLICT (keycloak_user_id) DO NOTHING"
    )
    .bind(&kc_user_id)
    .bind(&tenant_id)
    .execute(&state.pool)
    .await;

    // --- Update api_keys with keycloak_user_id for legacy compat ---
    let _ = sqlx::query(
        "UPDATE api_keys SET keycloak_user_id = $1 WHERE key_hash = $2"
    )
    .bind(&kc_user_id)
    .bind(&key_hash)
    .execute(&state.pool)
    .await;

    // --- Send welcome email (best-effort) ---
    if crate::email::is_configured() {
        let _ = crate::email::send_welcome_email(&email, &tenant_id, &api_key).await;
    }

    tracing::info!(
        email = %email,
        tenant_id = %tenant_id,
        keycloak_id = %kc_user_id,
        invited = invite_tenant_id.is_some(),
        "new user registered"
    );

    (
        StatusCode::CREATED,
        Json(RegisterResponse {
            status: "ok".into(),
            message: "Account created successfully".into(),
            tenant_id: Some(tenant_id),
            api_key: Some(api_key),
        }),
    )
        .into_response()
}

/// Create a user in Keycloak via Admin REST API. Returns the Keycloak user ID.
async fn create_keycloak_user(
    email: &str,
    first_name: &str,
    last_name: &str,
    password: &str,
    phone: Option<&str>,
) -> anyhow::Result<String> {
    let admin_token = crate::keycloak::get_admin_token().await?;
    let token = &admin_token.access_token;

    let keycloak_url = std::env::var("AUTH_KEYCLOAK_ISSUER")
        .map_err(|_| anyhow::anyhow!("AUTH_KEYCLOAK_ISSUER not set"))?;

    let realm = keycloak_url
        .split("/realms/")
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("Could not extract realm from AUTH_KEYCLOAK_ISSUER"))?
        .trim_end_matches('/');

    let base_admin_url = keycloak_url
        .split("/realms/")
        .next()
        .unwrap_or(&keycloak_url)
        .trim_end_matches('/');

    let client = reqwest::Client::new();

    // Build user representation
    let mut user_repr = serde_json::json!({
        "username": email,
        "email": email,
        "emailVerified": true,
        "enabled": true,
        "firstName": first_name,
        "lastName": last_name,
        "credentials": [{
            "type": "password",
            "value": password,
            "temporary": false
        }]
    });

    // Add phone as attribute if provided
    if let Some(ph) = phone {
        if !ph.is_empty() {
            user_repr["attributes"] = serde_json::json!({
                "phone": [ph]
            });
        }
    }

    // Create the user
    let create_url = format!("{}/admin/realms/{}/users", base_admin_url, realm);
    let response = client
        .post(&create_url)
        .bearer_auth(token)
        .json(&user_repr)
        .send()
        .await?;

    let status = response.status();
    if status == reqwest::StatusCode::CONFLICT {
        anyhow::bail!("409: User with this email already exists");
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Keycloak create user failed ({}): {}", status, body);
    }

    // Extract user ID from Location header
    let location = response
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let user_id = location
        .split('/')
        .last()
        .unwrap_or("")
        .to_string();

    if user_id.is_empty() {
        // Fallback: search by email
        let search_url = format!(
            "{}/admin/realms/{}/users?email={}&exact=true",
            base_admin_url, realm, email
        );
        let search_resp = client
            .get(&search_url)
            .bearer_auth(token)
            .send()
            .await?;
        let users: Vec<serde_json::Value> = search_resp.json().await?;
        if let Some(u) = users.first() {
            if let Some(id) = u["id"].as_str() {
                return Ok(id.to_string());
            }
        }
        anyhow::bail!("User created but could not determine user ID");
    }

    Ok(user_id)
}
