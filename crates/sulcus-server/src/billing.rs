//! Stripe billing webhook handler.

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::SharedState;

type HmacSha256 = Hmac<Sha256>;

/// Verify a Stripe-Signature header against the raw request body.
///
/// Stripe signs with: HMAC-SHA256(secret, "{t}.{payload}") and encodes as hex.
/// The header format is: `t=<unix_ts>,v1=<hex_sig>[,v1=<hex_sig>...]`
///
/// Returns `false` on any parse or verification failure.
fn verify_stripe_signature(secret: &str, payload: &[u8], sig_header: &str) -> bool {
    let mut timestamp: Option<&str> = None;
    let mut v1_sigs: Vec<&str> = Vec::new();

    for part in sig_header.split(',') {
        if let Some(t) = part.strip_prefix("t=") {
            timestamp = Some(t);
        } else if let Some(v1) = part.strip_prefix("v1=") {
            v1_sigs.push(v1);
        }
    }

    let t = match timestamp {
        Some(t) => t,
        None => return false,
    };

    // --- SECURITY B-1: Timestamp staleness check ---
    if let Ok(ts_sec) = t.parse::<i64>() {
        let now = chrono::Utc::now().timestamp();
        if (now - ts_sec).abs() > 300 {
            tracing::warn!(t = %t, now = %now, "stripe webhook: timestamp out of range");
            return false;
        }
    } else {
        return false;
    }

    if v1_sigs.is_empty() {
        return false;
    }

    // Signed payload: "{t}.{raw_body}"
    let mut signed = Vec::with_capacity(t.len() + 1 + payload.len());
    signed.extend_from_slice(t.as_bytes());
    signed.push(b'.');
    signed.extend_from_slice(payload);

    // Compute HMAC-SHA256 of the signed payload.
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(&signed);
    let expected = mac.finalize().into_bytes();

    // Constant-time comparison against each v1 value in the header.
    // Stripe may include multiple v1 values during secret rotation; pass if any match.
    v1_sigs.iter().any(|v1| {
        hex::decode(v1)
            .map(|decoded| {
                decoded.len() == expected.len()
                    && bool::from(expected.ct_eq(decoded.as_slice()))
            })
            .unwrap_or(false)
    })
}

/// POST /api/v1/billing/stripe-webhook
pub async fn stripe_webhook(
    State(state): State<SharedState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    // --- 1. Verify Stripe-Signature header -----------------------------------
    let sig_header = match headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
    {
        Some(s) => s.to_owned(),
        None => {
            tracing::warn!("stripe webhook: missing Stripe-Signature header");
            return StatusCode::BAD_REQUEST.into_response();
        }
    };

    let secret = match std::env::var("SULCUS_STRIPE_WEBHOOK_SECRET") {
        Ok(s) => s,
        Err(_) => {
            tracing::error!("stripe webhook: SULCUS_STRIPE_WEBHOOK_SECRET not set");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    if !verify_stripe_signature(&secret, &body, &sig_header) {
        tracing::warn!("stripe webhook: signature verification failed");
        return StatusCode::UNAUTHORIZED.into_response();
    }

    // --- 2. Parse event body -------------------------------------------------
    let event: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "stripe webhook: invalid JSON body");
            return StatusCode::BAD_REQUEST.into_response();
        }
    };

    let event_type = event
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let customer_id = event
        .pointer("/data/object/customer")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    tracing::info!(
        event_type = %event_type,
        customer_id = %customer_id,
        "stripe webhook received"
    );

    let pool = &state.pool;

    match event_type {
        "checkout.session.completed" => {
            let client_reference_id = event
                .pointer("/data/object/client_reference_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
                
            if !client_reference_id.is_empty() && !customer_id.is_empty() {
                if let Err(e) = sqlx::query(
                    "UPDATE api_keys SET stripe_customer_id = $1 WHERE tenant_id = $2",
                )
                .bind(customer_id)
                .bind(client_reference_id)
                .execute(pool)
                .await
                {
                    tracing::error!(error = %e, "stripe webhook: failed to link customer_id");
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            }
        }
        "customer.subscription.created" | "customer.subscription.updated" => {
            let price_id = event
                .pointer("/data/object/items/data/0/price/id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let plan_tier = match price_id {
                p if p.starts_with("price_enterprise") => "enterprise",
                p if p.starts_with("price_team") => "team",
                p if p.starts_with("price_pro") => "pro",
                _ => "free",
            };

            if let Err(e) = sqlx::query(
                "UPDATE api_keys SET plan_tier = $1 WHERE stripe_customer_id = $2",
            )
            .bind(plan_tier)
            .bind(customer_id)
            .execute(pool)
            .await
            {
                tracing::error!(error = %e, "stripe webhook: failed to update plan_tier");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }

            // Sync the role to Keycloak in the background
            let pool_clone = pool.clone();
            let cid_clone = customer_id.to_string();
            let pt_clone = plan_tier.to_string();
            tokio::spawn(async move {
                let row = sqlx::query("SELECT keycloak_user_id FROM api_keys WHERE stripe_customer_id = $1")
                    .bind(&cid_clone)
                    .fetch_optional(&pool_clone)
                    .await
                    .ok()
                    .flatten();

                if let Some(r) = row {
                    if let Ok(Some(uid)) = sqlx::Row::try_get::<Option<String>, _>(&r, "keycloak_user_id") {
                        if !uid.is_empty() {
                            tracing::info!("Keycloak Sync: Assigned user {} to role {}", uid, pt_clone);
                            // TODO: Add Admin REST API POST here
                        }
                    }
                }
            });
        }
        "customer.subscription.deleted" | "invoice.payment_failed" => {
            if let Err(e) = sqlx::query(
                "UPDATE api_keys SET plan_tier = 'free', ops_limit = NULL \
                 WHERE stripe_customer_id = $1",
            )
            .bind(customer_id)
            .execute(pool)
            .await
            {
                tracing::error!(error = %e, "stripe webhook: failed to downgrade plan");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
        "invoice.paid" => {
            let amount_paid: i64 = event
                .pointer("/data/object/amount_paid")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let new_ops_limit = amount_paid.saturating_mul(100);

            if let Err(e) = sqlx::query(
                "UPDATE api_keys SET ops_limit = $1 WHERE stripe_customer_id = $2",
            )
            .bind(new_ops_limit)
            .bind(customer_id)
            .execute(pool)
            .await
            {
                tracing::error!(error = %e, "stripe webhook: failed to set ops_limit");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
        other => {
            tracing::debug!(event_type = %other, "stripe webhook: unhandled event type");
        }
    }

    StatusCode::OK.into_response()
}

use axum::{extract::Json, Extension};

/// POST /api/v1/billing/create-checkout-session
///
/// Creates a Stripe Checkout Session for the authenticated tenant.
pub async fn create_checkout_session(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let price_id = payload.get("price_id").and_then(|v| v.as_str()).unwrap_or("price_team_monthly");
    let tenant_id = tenant_ctx.id;

    let stripe_secret = match std::env::var("STRIPE_SECRET_KEY") {
        Ok(s) => s,
        Err(_) => {
            tracing::error!("STRIPE_SECRET_KEY not set");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Billing configuration error").into_response();
        }
    };

    let client = reqwest::Client::new();
    
    // Construct the form data for Stripe API
    let mut params = std::collections::HashMap::new();
    params.insert("success_url", format!("{}/dashboard/billing?success=true", state.public_url));
    params.insert("cancel_url", format!("{}/dashboard/billing?canceled=true", state.public_url));
    params.insert("mode", "subscription".to_string());
    params.insert("line_items[0][price]", price_id.to_string());
    params.insert("line_items[0][quantity]", "1".to_string());
    params.insert("client_reference_id", tenant_id.to_string());

    let res = match client.post("https://api.stripe.com/v1/checkout/sessions")
        .basic_auth(stripe_secret, Some(""))
        .form(&params)
        .send()
        .await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(error = %e, "failed to call stripe api");
                return (StatusCode::BAD_GATEWAY, "Stripe communication error").into_response();
            }
        };

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        tracing::error!(error = %err_text, "stripe api error");
        return (StatusCode::BAD_GATEWAY, "Stripe returned an error").into_response();
    }

    let session: serde_json::Value = match res.json::<serde_json::Value>().await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "failed to parse stripe response");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Stripe response error").into_response();
        }
    };
    
    let url = session.get("url").and_then(|v| v.as_str()).unwrap_or("");

    (StatusCode::OK, Json(serde_json::json!({ "url": url }))).into_response()
}

/// POST /api/v1/billing/create-portal-session
///
/// Creates a Stripe Customer Portal Session for the authenticated tenant.
pub async fn create_portal_session(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;

    let stripe_secret = match std::env::var("STRIPE_SECRET_KEY") {
        Ok(s) => s,
        Err(_) => {
            tracing::error!("STRIPE_SECRET_KEY not set");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Billing configuration error").into_response();
        }
    };

    let row = match sqlx::query("SELECT stripe_customer_id FROM api_keys WHERE tenant_id = $1")
        .bind(&tenant_id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return (StatusCode::NOT_FOUND, "Tenant not found").into_response(),
        Err(e) => {
            tracing::error!(error = %e, "DB error fetching stripe_customer_id");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
        }
    };

    let customer_id: Option<String> = sqlx::Row::try_get(&row, "stripe_customer_id").unwrap_or(None);
    
    let customer_id = match customer_id {
        Some(cid) if !cid.is_empty() => cid,
        _ => {
            tracing::warn!("Tenant {} has no active Stripe customer ID to open portal", tenant_id);
            return (StatusCode::BAD_REQUEST, "No active subscription found").into_response();
        }
    };

    let client = reqwest::Client::new();
    
    let mut params = std::collections::HashMap::new();
    params.insert("customer", customer_id);
    params.insert("return_url", format!("{}/dashboard/billing", state.public_url));

    let res = match client.post("https://api.stripe.com/v1/billing_portal/sessions")
        .basic_auth(stripe_secret, Some(""))
        .form(&params)
        .send()
        .await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(error = %e, "failed to call stripe api");
                return (StatusCode::BAD_GATEWAY, "Stripe communication error").into_response();
            }
        };

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        tracing::error!(error = %err_text, "stripe api error");
        return (StatusCode::BAD_GATEWAY, "Stripe returned an error").into_response();
    }

    let session: serde_json::Value = match res.json::<serde_json::Value>().await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "failed to parse stripe response");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Stripe response error").into_response();
        }
    };
    
    let url = session.get("url").and_then(|v| v.as_str()).unwrap_or("");

    (StatusCode::OK, Json(serde_json::json!({ "url": url }))).into_response()
}
