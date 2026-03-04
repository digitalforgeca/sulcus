//! Stripe billing webhook handler.

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};

use crate::SharedState;

/// POST /api/v1/billing/stripe-webhook
///
/// Receives Stripe events, verifies the Stripe-Signature header (placeholder —
/// replace with real HMAC-SHA256 verification via the `stripe` crate), and
/// updates `api_keys.ops_limit` or `plan_tier` accordingly.
pub async fn stripe_webhook(
    State(state): State<SharedState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    // --- 1. Verify Stripe-Signature header (placeholder) ---------------------
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

    tracing::debug!(
        sig = %sig_header,
        "stripe webhook: signature present (verification is a placeholder)"
    );

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
        // Subscription created or updated — map Stripe price → plan_tier.
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
        }

        // Subscription cancelled or payment failed — downgrade to free.
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

        other => {
            tracing::debug!(event_type = %other, "stripe webhook: unhandled event type");
        }
    }

    StatusCode::OK.into_response()
}
