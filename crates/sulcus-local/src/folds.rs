use anyhow::Context;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::SqliteStorage;

/// Node payload exported in a Fold
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportNode {
    pub id: String,
    pub label: String,
    pub pointer_summary: String,
    pub base_utility: f32,
    pub current_heat: f32,
    pub is_pinned: bool,
    /// optional raw content (territory)
    pub raw_content: Option<String>,
    /// vector stored as base64 to keep JSON deterministic
    pub vector_b64: Option<String>,
}

/// Edge exported in a Fold
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportEdge {
    pub source_id: String,
    pub target_id: String,
    pub relationship_type: String,
    pub edge_weight: f32,
}

/// Fold payload serialized to disk for export/import
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FoldPayload {
    pub name: String,
    pub nodes: Vec<ExportNode>,
    pub edges: Vec<ExportEdge>,
}

/// Export a named fold to a JSON file. Includes nodes, payloads, vectors and edges
pub async fn export_fold(storage: &SqliteStorage, fold_name: &str, file_path: &str) -> anyhow::Result<()> {
    // resolve fold id
    let row = sqlx::query("SELECT id FROM folds WHERE name = ?")
        .bind(fold_name)
        .fetch_optional(storage.pool())
        .await?;

    let fold_id = if let Some(r) = row {
        r.try_get::<String, _>("id")?
    } else {
        return Err(anyhow::anyhow!("fold not found: {}", fold_name));
    };

    // gather node ids in fold
    let rows = sqlx::query("SELECT node_id FROM node_folds WHERE fold_id = ?")
        .bind(&fold_id)
        .fetch_all(storage.pool())
        .await?;

    let node_ids: Vec<String> = rows.into_iter().filter_map(|r| r.try_get::<String, _>("node_id").ok()).collect();

    if node_ids.is_empty() {
        // write empty fold payload
        let payload = FoldPayload { name: fold_name.to_string(), nodes: Vec::new(), edges: Vec::new() };
        let s = serde_json::to_string_pretty(&payload)?;
        std::fs::write(file_path, s)?;
        return Ok(());
    }

    // fetch nodes + payloads + embeddings
    let mut nodes: Vec<ExportNode> = Vec::with_capacity(node_ids.len());
    for nid in node_ids.iter() {
        let node_row = sqlx::query("SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned FROM nodes WHERE id = ?")
            .bind(nid)
            .fetch_one(storage.pool())
            .await?;
        let id: String = node_row.try_get("id")?;
        let label: String = node_row.try_get("label")?;
        let pointer_summary: String = node_row.try_get("pointer_summary")?;
        let base_utility: f32 = node_row.try_get("base_utility")?;
        let current_heat: f32 = node_row.try_get("current_heat")?;
        let is_pinned_i: i64 = node_row.try_get("is_pinned")?;
        let is_pinned = is_pinned_i != 0;

        let raw_content = sqlx::query("SELECT raw_content FROM payloads WHERE node_id = ?")
            .bind(&id)
            .fetch_optional(storage.pool())
            .await?
            .and_then(|r| r.try_get::<Option<String>, _>("raw_content").ok())
            .flatten();

        let vector_b64 = sqlx::query("SELECT vector FROM embeddings WHERE node_id = ?")
            .bind(&id)
            .fetch_optional(storage.pool())
            .await?
            .and_then(|r| r.try_get::<Option<Vec<u8>>, _>("vector").ok())
            .flatten()
            .map(|b| base64::engine::general_purpose::STANDARD.encode(&b));

        nodes.push(ExportNode {
            id,
            label,
            pointer_summary,
            base_utility,
            current_heat,
            is_pinned,
            raw_content,
            vector_b64,
        });
    }

    // fetch edges where both endpoints are in the fold
    let placeholders = node_ids.iter().map(|_| "?").collect::<Vec<&str>>().join(",");
    let query = format!("SELECT source_id, target_id, relationship_type, edge_weight FROM edges WHERE source_id IN ({}) AND target_id IN ({})", placeholders, placeholders);
    let mut q = sqlx::query(&query);
    for nid in node_ids.iter() {
        q = q.bind(nid);
    }
    for nid in node_ids.iter() {
        q = q.bind(nid);
    }
    let edge_rows = q.fetch_all(storage.pool()).await?;
    let mut edges: Vec<ExportEdge> = Vec::with_capacity(edge_rows.len());
    for er in edge_rows.into_iter() {
        let source_id: String = er.try_get("source_id")?;
        let target_id: String = er.try_get("target_id")?;
        let relationship_type: String = er.try_get("relationship_type")?;
        let edge_weight: f32 = er.try_get("edge_weight")?;
        edges.push(ExportEdge { source_id, target_id, relationship_type, edge_weight });
    }

    let payload = FoldPayload { name: fold_name.to_string(), nodes, edges };
    let s = serde_json::to_string_pretty(&payload)?;
    std::fs::write(file_path, s)?;
    Ok(())
}

/// Import a fold JSON file and upsert contained nodes/edges/vectors into local DB.
/// The fold name from the payload will be created or reused and nodes added to it.
pub async fn import_fold(storage: &SqliteStorage, file_path: &str) -> anyhow::Result<()> {
    let s = std::fs::read_to_string(file_path).context("failed to read fold file")?;
    let payload: FoldPayload = serde_json::from_str(&s).context("invalid fold json")?;

    let pool = storage.pool();
    let mut tx = pool.begin().await?;

    // ensure fold exists (id generated or reused)
    let fold_id = match sqlx::query("SELECT id FROM folds WHERE name = ?")
        .bind(&payload.name)
        .fetch_optional(&mut *tx)
        .await?
    {
        Some(r) => r.try_get::<String, _>("id")?,
        None => {
            let new_id = Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO folds (id, name) VALUES (?, ?)")
                .bind(&new_id)
                .bind(&payload.name)
                .execute(&mut *tx)
                .await?;
            new_id
        }
    };

    // upsert nodes + payloads + embeddings
    for n in payload.nodes.iter() {
        let id = Uuid::parse_str(&n.id)?;
        sqlx::query(r#"INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat, is_pinned, created_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET label = excluded.label, pointer_summary = excluded.pointer_summary, base_utility = excluded.base_utility, current_heat = excluded.current_heat, is_pinned = excluded.is_pinned"#)
            .bind(id.to_string())
            .bind(&n.label)
            .bind(&n.pointer_summary)
            .bind(n.base_utility)
            .bind(n.current_heat)
            .bind(n.is_pinned as i64)
            .execute(&mut *tx)
            .await?;

        if let Some(ref raw) = n.raw_content {
            sqlx::query("INSERT INTO payloads (node_id, raw_content) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET raw_content = excluded.raw_content")
                .bind(id.to_string())
                .bind(raw)
                .execute(&mut *tx)
                .await?;
        }

        if let Some(ref v64) = n.vector_b64 {
            let vec_bytes = base64::engine::general_purpose::STANDARD.decode(v64)?;
            sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET vector = excluded.vector")
                .bind(id.to_string())
                .bind(vec_bytes)
                .execute(&mut *tx)
                .await?;
        }

        // assign to fold
        sqlx::query("INSERT INTO node_folds (node_id, fold_id) VALUES (?, ?) ON CONFLICT(node_id, fold_id) DO NOTHING")
            .bind(id.to_string())
            .bind(&fold_id)
            .execute(&mut *tx)
            .await?;
    }

    // upsert edges
    for e in payload.edges.iter() {
        // validate uuids
        let _ = Uuid::parse_str(&e.source_id)?;
        let _ = Uuid::parse_str(&e.target_id)?;
        sqlx::query("INSERT INTO edges (source_id, target_id, relationship_type, edge_weight) VALUES (?, ?, ?, ?) ON CONFLICT(source_id, target_id) DO UPDATE SET relationship_type = excluded.relationship_type, edge_weight = excluded.edge_weight")
            .bind(&e.source_id)
            .bind(&e.target_id)
            .bind(&e.relationship_type)
            .bind(e.edge_weight)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}
