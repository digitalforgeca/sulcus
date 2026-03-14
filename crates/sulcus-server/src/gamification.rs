//! Gamification: XP ledger, level thresholds, and badge awards.
//!
//! # Endpoints
//! - `GET /api/v1/gamification/profile` — current XP / level / badges for the tenant
//!
//! # Free functions
//! - `award_xp`              — insert into xp_ledger, recompute level, check badges
//! - `check_and_award_badges` — evaluate badge conditions; persist newly earned ones

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgPool;

use crate::SharedState;

// ---------------------------------------------------------------------------
// XP & Level constants
// ---------------------------------------------------------------------------

/// XP awarded for each reason code.
pub fn xp_for_reason(reason: &str) -> i32 {
    match reason {
        "memory.add" => 10,
        "memory.pin" => 5,
        "sync" => 2,
        "edge_added" => 3,
        "days_active" => 20,
        _ => 1,
    }
}

/// (threshold_xp, level_number, level_name)
const LEVELS: &[(i32, u8, &str)] = &[
    (0, 1, "Absolute Zero"),
    (100, 2, "Warm"),
    (500, 3, "Active"),
    (1500, 4, "Hot"),
    (5000, 5, "Plasma"),
    (15000, 6, "Supernova"),
];

/// Compute the level number and name for a given total XP value.
pub fn level_for_xp(total_xp: i32) -> (u8, &'static str, Option<i32>) {
    let mut current_level = 1u8;
    let mut current_name = "Absolute Zero";
    let mut next_threshold: Option<i32> = Some(100);

    for (i, &(threshold, level, name)) in LEVELS.iter().enumerate() {
        if total_xp >= threshold {
            current_level = level;
            current_name = name;
            next_threshold = LEVELS.get(i + 1).map(|&(t, _, _)| t);
        }
    }

    (current_level, current_name, next_threshold)
}

/// Compute progress percentage toward the next level (0–100).
pub fn progress_pct(total_xp: i32) -> u8 {
    // Find the current level's threshold and the next level's threshold.
    let mut current_threshold = 0i32;
    let mut next_threshold = 100i32;

    for (i, &(threshold, _, _)) in LEVELS.iter().enumerate() {
        if total_xp >= threshold {
            current_threshold = threshold;
            next_threshold = LEVELS.get(i + 1).map(|&(t, _, _)| t).unwrap_or(i32::MAX);
        }
    }

    if next_threshold == i32::MAX {
        return 100; // max level
    }

    let span = (next_threshold - current_threshold).max(1);
    let progress = (total_xp - current_threshold).max(0);
    ((progress as f64 / span as f64) * 100.0).min(100.0) as u8
}

// ---------------------------------------------------------------------------
// Badge definitions
// ---------------------------------------------------------------------------

const ALL_BADGES: &[&str] = &[
    "First Memory",
    "100 Syncs",
    "Graph Architect",
    "Curator",
    "Early Adopter",
];

/// Check which badges the tenant has earned but not yet been awarded.
/// Returns the names of newly awarded badges.
pub async fn check_and_award_badges(pool: &PgPool, tenant_id: &str) -> anyhow::Result<Vec<String>> {
    // Fetch current badges
    let existing_badges: Vec<String> = sqlx::query_scalar(
        "SELECT COALESCE(badges, '{}') FROM tenant_profile WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or_default();

    let mut newly_earned: Vec<String> = Vec::new();

    for &badge in ALL_BADGES {
        if existing_badges.contains(&badge.to_string()) {
            continue; // already have it
        }

        let earned = match badge {
            "First Memory" => {
                // At least one memory.add in xp_ledger
                let count: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM xp_ledger WHERE tenant_id = $1 AND reason = 'memory.add'",
                )
                .bind(tenant_id)
                .fetch_one(pool)
                .await
                .unwrap_or(0);
                count >= 1
            }
            "100 Syncs" => {
                let count: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM xp_ledger WHERE tenant_id = $1 AND reason = 'sync'",
                )
                .bind(tenant_id)
                .fetch_one(pool)
                .await
                .unwrap_or(0);
                count >= 100
            }
            "Graph Architect" => {
                let count: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM xp_ledger WHERE tenant_id = $1 AND reason = 'edge_added'",
                )
                .bind(tenant_id)
                .fetch_one(pool)
                .await
                .unwrap_or(0);
                count >= 10
            }
            "Curator" => {
                let count: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM xp_ledger WHERE tenant_id = $1 AND reason = 'memory.pin'",
                )
                .bind(tenant_id)
                .fetch_one(pool)
                .await
                .unwrap_or(0);
                count >= 10
            }
            "Early Adopter" => {
                // Tenant's first API key was created before 2026-06-01
                let cutoff = NaiveDate::from_ymd_opt(2026, 6, 1)
                    .unwrap()
                    .and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_utc();
                let first_created: Option<DateTime<Utc>> =
                    sqlx::query_scalar("SELECT min(created_at) FROM api_keys WHERE tenant_id = $1")
                        .bind(tenant_id)
                        .fetch_optional(pool)
                        .await
                        .ok()
                        .flatten();
                first_created.map(|ts| ts < cutoff).unwrap_or(false)
            }
            _ => false,
        };

        if earned {
            newly_earned.push(badge.to_string());
        }
    }

    if !newly_earned.is_empty() {
        // Append newly earned badges to tenant_profile
        sqlx::query(
            "UPDATE tenant_profile \
             SET badges = array_cat(badges, $2::text[]), updated_at = now() \
             WHERE tenant_id = $1",
        )
        .bind(tenant_id)
        .bind(&newly_earned)
        .execute(pool)
        .await?;
    }

    Ok(newly_earned)
}

// ---------------------------------------------------------------------------
// award_xp — core business logic
// ---------------------------------------------------------------------------

/// Award XP to a tenant for `reason`.
///
/// 1. Inserts a row into `xp_ledger`.
/// 2. Recomputes `total_xp` and `level` in `tenant_profile` (UPSERT).
/// 3. Checks and awards any newly unlocked badges.
pub async fn award_xp(pool: &PgPool, tenant_id: &str, reason: &str, xp: i32) -> anyhow::Result<()> {
    // 1. Insert into ledger
    sqlx::query("INSERT INTO xp_ledger (tenant_id, reason, xp) VALUES ($1, $2, $3)")
        .bind(tenant_id)
        .bind(reason)
        .bind(xp)
        .execute(pool)
        .await?;

    // 2. Recompute totals and UPSERT profile
    let total_xp: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(xp), 0) FROM xp_ledger WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);

    let total_xp_i32 = total_xp as i32;
    let (level, _, _) = level_for_xp(total_xp_i32);

    sqlx::query(
        "INSERT INTO tenant_profile (tenant_id, total_xp, level, badges, updated_at) \
         VALUES ($1, $2, $3, '{}', now()) \
         ON CONFLICT (tenant_id) DO UPDATE \
         SET total_xp = EXCLUDED.total_xp, \
             level    = EXCLUDED.level, \
             updated_at = now()",
    )
    .bind(tenant_id)
    .bind(total_xp_i32)
    .bind(level as i32)
    .execute(pool)
    .await?;

    // 3. Check badges (fire-and-forget style — errors are non-fatal)
    if let Err(e) = check_and_award_badges(pool, tenant_id).await {
        tracing::warn!(error = %e, tenant_id, "badge check failed (non-fatal)");
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// GET /api/v1/gamification/profile
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct XpEntry {
    pub reason: String,
    pub xp: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct GamificationProfile {
    pub total_xp: i32,
    pub level: u8,
    pub level_name: String,
    pub level_title: String,
    pub next_level_xp: Option<i32>,
    pub progress_pct: u8,
    pub badges: Vec<String>,
    pub recent_xp: Vec<XpEntry>,
}

pub async fn get_profile(
    State(state): State<SharedState>,
    Extension(tenant_ctx): Extension<crate::middleware::TenantContext>,
) -> impl IntoResponse {
    let tenant_id = tenant_ctx.id;
    let pool = &state.pool;

    // Fetch profile (may not exist yet if tenant has earned no XP)
    let profile_row = sqlx::query_as::<_, (i32, i32, Vec<String>)>(
        "SELECT total_xp, level, badges FROM tenant_profile WHERE tenant_id = $1",
    )
    .bind(&tenant_id)
    .fetch_optional(pool)
    .await;

    let (total_xp, badges) = match profile_row {
        Ok(Some((xp, _level, b))) => (xp, b),
        Ok(None) => (0, vec![]),
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch gamification profile");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Database error").into_response();
        }
    };

    let (level, level_name, next_level_xp) = level_for_xp(total_xp);
    let pct = progress_pct(total_xp);

    // Fetch last 10 XP entries
    let recent_xp_rows = sqlx::query_as::<_, (String, i32, DateTime<Utc>)>(
        "SELECT reason, xp, created_at FROM xp_ledger \
         WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT 10",
    )
    .bind(&tenant_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let recent_xp = recent_xp_rows
        .into_iter()
        .map(|(reason, xp, created_at)| XpEntry {
            reason,
            xp,
            created_at,
        })
        .collect();

    let profile = GamificationProfile {
        total_xp,
        level,
        level_name: level_name.to_string(),
        level_title: level_name.to_string(),
        next_level_xp,
        progress_pct: pct,
        badges,
        recent_xp,
    };

    (StatusCode::OK, Json(profile)).into_response()
}
