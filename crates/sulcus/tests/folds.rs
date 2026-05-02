mod common;

use sqlx::Row;
use sulcus_core::StorageBackend;
use sulcus::{export_fold, import_fold};
use uuid::Uuid;

#[tokio::test]
async fn export_and_import_fold_roundtrip() -> anyhow::Result<()> {
    let storage = common::make_storage().await?;

    // create nodes and payloads
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: a,
            label: "A".into(),
            pointer_summary: "A sum".into(),
            base_utility: 0.1,
            current_heat: 0.5,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage
        .upsert_node(sulcus_core::graph::Node {
            id: b,
            label: "B".into(),
            pointer_summary: "B sum".into(),
            base_utility: 0.2,
            current_heat: 0.2,
            is_pinned: false,
            memory_type: "episodic".into(),
            modality: sulcus_core::graph::Node::default_modality(),
            source_mime: None,
            namespace: sulcus_core::graph::Node::default_namespace(),
        })
        .await?;
    storage.insert_payload(a, "content-a").await?;
    storage.insert_payload(b, "content-b").await?;

    // embeddings
    let emb_a = vec![0.1f32; 384];
    let emb_b = vec![0.9f32; 384];
    let blob_a: Vec<u8> = bytemuck::cast_slice(&emb_a).to_vec();
    let blob_b: Vec<u8> = bytemuck::cast_slice(&emb_b).to_vec();
    sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
        .bind(a.to_string()).bind(blob_a).execute(storage.pool()).await?;
    sqlx::query("INSERT INTO embeddings (node_id, vector) VALUES ($1, $2) ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector")
        .bind(b.to_string()).bind(blob_b).execute(storage.pool()).await?;

    // edges
    storage.insert_edge(a, b, "semantic", 0.5).await?;

    // create fold and assign
    let fold_id = Uuid::new_v4().to_string();
    let fold_name = format!("test-fold-{}", Uuid::new_v4());
    sqlx::query("INSERT INTO folds (id, name) VALUES ($1, $2)")
        .bind(&fold_id)
        .bind(&fold_name)
        .execute(storage.pool())
        .await?;
    sqlx::query("INSERT INTO node_folds (node_id, fold_id) VALUES ($1, $2)")
        .bind(a.to_string())
        .bind(&fold_id)
        .execute(storage.pool())
        .await?;
    sqlx::query("INSERT INTO node_folds (node_id, fold_id) VALUES ($1, $2)")
        .bind(b.to_string())
        .bind(&fold_id)
        .execute(storage.pool())
        .await?;

    // export fold
    let out = tempfile::NamedTempFile::new()?;
    let out_path = out.path().to_str().unwrap().to_string();
    export_fold(&storage, &fold_name, &out_path).await?;

    // remove nodes + edges to ensure import restores them
    sqlx::query("DELETE FROM node_folds WHERE fold_id = $1")
        .bind(&fold_id)
        .execute(storage.pool())
        .await?;
    sqlx::query("DELETE FROM edges WHERE source_id = $1 OR target_id = $2")
        .bind(a.to_string())
        .bind(a.to_string())
        .execute(storage.pool())
        .await?;
    sqlx::query("DELETE FROM nodes WHERE id = ANY($1)")
        .bind(vec![a.to_string(), b.to_string()])
        .execute(storage.pool())
        .await?;
    sqlx::query("DELETE FROM embeddings WHERE node_id = ANY($1)")
        .bind(vec![a.to_string(), b.to_string()])
        .execute(storage.pool())
        .await?;
    sqlx::query("DELETE FROM payloads WHERE node_id = ANY($1)")
        .bind(vec![a.to_string(), b.to_string()])
        .execute(storage.pool())
        .await?;

    // import
    import_fold(&storage, &out_path).await?;

    // verify nodes restored and assigned to fold
    let na = storage.get_node(a).await?.unwrap();
    let nb = storage.get_node(b).await?.unwrap();
    assert_eq!(na.pointer_summary, "A sum");
    assert_eq!(nb.pointer_summary, "B sum");

    let payload_a = storage.get_payload(a).await?;
    assert_eq!(payload_a.unwrap(), "content-a");

    let emb_row = sqlx::query("SELECT vector FROM embeddings WHERE node_id = $1")
        .bind(a.to_string())
        .fetch_one(storage.pool())
        .await?;
    let vec_bytes: Vec<u8> = emb_row.try_get("vector")?;
    let vec_f: &[f32] = bytemuck::cast_slice(&vec_bytes);
    assert!((vec_f[0] - 0.1).abs() < 1e-6);

    // edges restored
    let edges = sqlx::query("SELECT source_id, target_id FROM edges WHERE source_id = $1")
        .bind(a.to_string())
        .fetch_all(storage.pool())
        .await?;
    assert!(!edges.is_empty());

    // node_folds entries
    let nf = sqlx::query("SELECT node_id FROM node_folds WHERE fold_id = $1")
        .bind(&fold_id)
        .fetch_all(storage.pool())
        .await?;
    assert_eq!(nf.len(), 2);

    Ok(())
}
