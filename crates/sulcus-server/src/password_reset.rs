//! Self-hosted forgot/reset password flow.
//!
//! No Keycloak hosted pages — everything stays on sulcus.ca with our own
//! forms, matching the custom login and registration experience.
//!
//! Flow:
//! 1. POST /api/v1/forgot-password  { email }
//!    → Generates a token, stores the SHA-256 hash in password_reset_tokens,
//!      sends the reset link via our SMTP (email.rs).
//!    → Returns 404 if no account exists (explicit feedback per product decision).
//!
//! 2. POST /api/v1/reset-password   { token, new_password }
//!    → Validates the token, looks up the user in Keycloak by email,
//!      sets the new password via Keycloak Admin API, consumes the token.

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::SharedState;

// ── Request / Response types ───────────────────────────────────────

#[derive(Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Serialize)]
pub struct ForgotPasswordResponse {
    pub status: String,
    pub message: String,
}

#[derive(Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
}

#[derive(Serialize)]
pub struct ResetPasswordResponse {
    pub status: String,
    pub message: String,
}

// ── Helpers ────────────────────────────────────────────────────────

fn gen_reset_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

// ── POST /api/v1/forgot-password ───────────────────────────────────

pub async fn handle_forgot_password(
    State(state): State<SharedState>,
    Json(req): Json<ForgotPasswordRequest>,
) -> impl IntoResponse {
    let email = req.email.trim().to_lowercase();

    if !email.contains('@') || email.len() < 5 {
        return (
            StatusCode::BAD_REQUEST,
            Json(ForgotPasswordResponse {
                status: "error".into(),
                message: "Please enter a valid email address.".into(),
            }),
        )
            .into_response();
    }

    match generate_and_send_reset(&state.pool, &email).await {
        Ok(()) => (
            StatusCode::OK,
            Json(ForgotPasswordResponse {
                status: "ok".into(),
                message: "Password reset link sent to your email.".into(),
            }),
        )
            .into_response(),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("no account") {
                (
                    StatusCode::NOT_FOUND,
                    Json(ForgotPasswordResponse {
                        status: "not_found".into(),
                        message: "No account found with that email address.".into(),
                    }),
                )
                    .into_response()
            } else {
                tracing::error!(email = %email, error = %e, "forgot-password: failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ForgotPasswordResponse {
                        status: "error".into(),
                        message: "Something went wrong. Please try again.".into(),
                    }),
                )
                    .into_response()
            }
        }
    }
}

/// Generate a reset token, store it, and email the link.
async fn generate_and_send_reset(pool: &sqlx::PgPool, email: &str) -> anyhow::Result<()> {
    // Check if user exists in Keycloak first — don't store tokens for unknown emails
    let admin_token = crate::keycloak::get_admin_token().await?;
    let token_str = &admin_token.access_token;

    let keycloak_url = std::env::var("AUTH_KEYCLOAK_ISSUER")
        .map_err(|_| anyhow::anyhow!("AUTH_KEYCLOAK_ISSUER not set"))?;
    let realm = keycloak_url
        .split("/realms/")
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("Could not extract realm"))?
        .trim_end_matches('/');
    let base_admin_url = keycloak_url
        .split("/realms/")
        .next()
        .unwrap_or(&keycloak_url)
        .trim_end_matches('/');

    let client = reqwest::Client::new();

    let search_url = format!(
        "{}/admin/realms/{}/users?email={}&exact=true",
        base_admin_url, realm, email
    );
    let search_resp = client
        .get(&search_url)
        .bearer_auth(token_str)
        .send()
        .await?
        .error_for_status()?;
    let users: Vec<serde_json::Value> = search_resp.json().await?;

    if users.is_empty() {
        tracing::info!(email = %email, "forgot-password: no account found");
        return Err(anyhow::anyhow!("no account found"));
    }

    // Invalidate any existing unused reset tokens for this email
    let _ = sqlx::query(
        "UPDATE password_reset_tokens SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL"
    )
    .bind(email)
    .execute(pool)
    .await;

    // Generate and store a new token (15 min expiry)
    let raw_token = gen_reset_token();
    let token_hash = sha256_hex(&raw_token);

    sqlx::query(
        "INSERT INTO password_reset_tokens (email, token_hash, expires_at) VALUES ($1, $2, now() + interval '15 minutes')"
    )
    .bind(email)
    .bind(&token_hash)
    .execute(pool)
    .await?;

    // Send the email with our own template
    let reset_url = format!("https://sulcus.ca/reset-password?token={}", raw_token);
    send_reset_email(email, &reset_url).await.map_err(|e| anyhow::anyhow!(e))?;

    tracing::info!(email = %email, "forgot-password: reset email sent");
    Ok(())
}

// ── POST /api/v1/reset-password ────────────────────────────────────

pub async fn handle_reset_password(
    State(state): State<SharedState>,
    Json(req): Json<ResetPasswordRequest>,
) -> impl IntoResponse {
    let token = req.token.trim().to_string();
    let new_password = req.new_password.clone();

    // Validate password strength
    if new_password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(ResetPasswordResponse {
                status: "error".into(),
                message: "Password must be at least 8 characters.".into(),
            }),
        )
            .into_response();
    }

    if token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ResetPasswordResponse {
                status: "error".into(),
                message: "Invalid or expired reset token.".into(),
            }),
        )
            .into_response();
    }

    let token_hash = sha256_hex(&token);

    // Look up and consume the token atomically
    let row = sqlx::query(
        "UPDATE password_reset_tokens SET consumed_at = now() \
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() \
         RETURNING email"
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await;

    let email = match row {
        Ok(Some(r)) => {
            use sqlx::Row;
            r.get::<String, _>("email")
        }
        Ok(None) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ResetPasswordResponse {
                    status: "error".into(),
                    message: "Invalid or expired reset token.".into(),
                }),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "reset-password: DB error consuming token");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ResetPasswordResponse {
                    status: "error".into(),
                    message: "Server error. Please try again.".into(),
                }),
            )
                .into_response();
        }
    };

    // Set the new password in Keycloak via Admin API
    match set_keycloak_password(&email, &new_password).await {
        Ok(()) => {
            tracing::info!(email = %email, "reset-password: password updated successfully");
            (
                StatusCode::OK,
                Json(ResetPasswordResponse {
                    status: "ok".into(),
                    message: "Password updated successfully. You can now sign in.".into(),
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(email = %email, error = %e, "reset-password: failed to set password in Keycloak");
            // Re-enable the token since the password wasn't actually changed
            let _ = sqlx::query(
                "UPDATE password_reset_tokens SET consumed_at = NULL WHERE token_hash = $1"
            )
            .bind(&token_hash)
            .execute(&state.pool)
            .await;

            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ResetPasswordResponse {
                    status: "error".into(),
                    message: "Failed to update password. Please try again.".into(),
                }),
            )
                .into_response()
        }
    }
}

/// Set a user's password in Keycloak via the Admin REST API.
async fn set_keycloak_password(email: &str, new_password: &str) -> anyhow::Result<()> {
    let admin_token = crate::keycloak::get_admin_token().await?;
    let token = &admin_token.access_token;

    let keycloak_url = std::env::var("AUTH_KEYCLOAK_ISSUER")
        .map_err(|_| anyhow::anyhow!("AUTH_KEYCLOAK_ISSUER not set"))?;
    let realm = keycloak_url
        .split("/realms/")
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("Could not extract realm"))?
        .trim_end_matches('/');
    let base_admin_url = keycloak_url
        .split("/realms/")
        .next()
        .unwrap_or(&keycloak_url)
        .trim_end_matches('/');

    let client = reqwest::Client::new();

    // Find user by email
    let search_url = format!(
        "{}/admin/realms/{}/users?email={}&exact=true",
        base_admin_url, realm, email
    );
    let users: Vec<serde_json::Value> = client
        .get(&search_url)
        .bearer_auth(token)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let user_id = users
        .first()
        .and_then(|u| u["id"].as_str())
        .ok_or_else(|| anyhow::anyhow!("User not found in Keycloak"))?;

    // Reset the password
    let reset_url = format!(
        "{}/admin/realms/{}/users/{}/reset-password",
        base_admin_url, realm, user_id
    );

    let credential = serde_json::json!({
        "type": "password",
        "value": new_password,
        "temporary": false
    });

    client
        .put(&reset_url)
        .bearer_auth(token)
        .json(&credential)
        .send()
        .await?
        .error_for_status()?;

    Ok(())
}

// ── Email template ─────────────────────────────────────────────────

async fn send_reset_email(to: &str, reset_url: &str) -> Result<(), String> {
    let subject = "Reset your Sulcus password";

    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #050a0f; color: #e5e5e5; padding: 40px 20px; margin: 0; }}
    .container {{ max-width: 560px; margin: 0 auto; background: #0a1520; padding: 40px; border: 1px solid #D4AF37; border-radius: 2px; }}
    .logo {{ text-align: center; margin-bottom: 24px; }}
    .diamond {{ display: inline-block; width: 28px; height: 28px; background: #00F0FF; transform: rotate(45deg); box-shadow: 0 0 20px rgba(0, 240, 255, 0.4); }}
    .brand {{ text-align: center; margin-bottom: 32px; }}
    .brand-name {{ color: #fafafa; font-size: 22px; font-weight: 700; letter-spacing: 6px; text-transform: uppercase; margin: 12px 0 4px; }}
    .brand-tagline {{ color: #D4AF37; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; }}
    h1 {{ color: #fafafa; font-size: 20px; margin: 0 0 16px; font-weight: 600; }}
    p {{ line-height: 1.7; color: #a3a3a3; font-size: 14px; }}
    a {{ color: #00F0FF; }}
    .btn {{ display: inline-block; background: linear-gradient(135deg, #D4AF37, #B8860B); color: #050a0f; padding: 14px 36px; border-radius: 2px; text-decoration: none; font-weight: 700; margin: 24px 0; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }}
    .footer {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #1a2530; font-size: 11px; color: #555; text-align: center; }}
    .footer a {{ color: #D4AF37; text-decoration: none; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"><div class="diamond"></div></div>
    <div class="brand">
      <div class="brand-name">Sulcus</div>
      <div class="brand-tagline">Memory that thinks.</div>
    </div>

    <h1>Reset Your Password</h1>
    <p>We received a request to reset the password for your Sulcus account. Click the button below to choose a new password:</p>

    <p style="text-align: center;">
      <a href="{url}" class="btn">Reset Password &rarr;</a>
    </p>

    <p style="font-size: 12px; color: #555;">This link expires in <strong style="color: #a3a3a3;">15 minutes</strong>. If you didn't request this, you can safely ignore this email.</p>

    <p style="font-size: 11px; color: #555; word-break: break-all;">Or paste this link in your browser:<br>{url}</p>

    <div class="footer">
      <p><a href="https://sulcus.ca">sulcus.ca</a></p>
      <p>Digital Forge Studios &middot; <a href="mailto:contact@sulcus.ca">contact@sulcus.ca</a></p>
    </div>
  </div>
</body>
</html>"#,
        url = reset_url,
    );

    crate::email::send_email(to, subject, &html).await
}
