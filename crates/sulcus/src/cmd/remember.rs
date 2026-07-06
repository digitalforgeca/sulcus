use anyhow::{bail, Result};
use sulcus_core::{RememberParams, StorageBackend};

/// Valid memory types.
const VALID_TYPES: &[&str] = &[
    "episodic",
    "semantic",
    "preference",
    "procedural",
    "fact",
    "synthesis",
];

pub async fn run(backend: &dyn StorageBackend, text: &str, memory_type: &str, source: Option<&str>) -> Result<()> {
    // Validate memory type early.
    if !VALID_TYPES.contains(&memory_type) {
        bail!(
            "Invalid memory type '{}'. Valid types: {}",
            memory_type,
            VALID_TYPES.join(", ")
        );
    }

    // Build content — append source tag if provided.
    let content = if let Some(src) = source {
        format!("{text}\n\n[source: {src}]")
    } else {
        text.to_string()
    };

    let params = RememberParams {
        content,
        memory_type: memory_type.to_string(),
        heat: None,      // use backend default
        namespace: None,  // use backend default
    };

    let result = backend.remember(&params).await?;

    // Extract fields from the response.
    // API may return the node directly or nested under "node" or "data".
    let node = result
        .get("node")
        .or_else(|| result.get("data"))
        .unwrap_or(&result);

    let id = node
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("(unknown)");

    let heat = node
        .get("current_heat")
        .or_else(|| node.get("heat"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.8);

    let stored_type = node
        .get("memory_type")
        .and_then(|v| v.as_str())
        .unwrap_or(memory_type);

    let icon = type_icon(stored_type);

    // Pretty-print confirmation.
    println!();
    println!("  {icon} Memory stored");
    println!();

    // Show a preview of the content (first 2 lines, truncated).
    let lines: Vec<&str> = text.lines().take(2).collect();
    for line in &lines {
        println!("     {}", truncate_str(line, 70));
    }
    if text.lines().count() > 2 {
        println!("     …");
    }
    println!();

    // Heat: local uses 0-100, cloud uses 0-1
    let display_heat = if heat > 1.0 { heat } else { heat * 100.0 };
    println!("  Type:  {stored_type}");
    println!("  Heat:  {:.0}%", display_heat);
    if let Some(src) = source {
        println!("  Source: {src}");
    }
    println!("  ID:    \x1b[2m{id}\x1b[0m");
    println!();

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max - 1])
    }
}

fn type_icon(memory_type: &str) -> &'static str {
    match memory_type {
        "episodic" => "📅",
        "semantic" => "🧠",
        "preference" => "💜",
        "procedural" => "⚙️",
        "fact" => "📌",
        "synthesis" => "🔮",
        _ => "📝",
    }
}
