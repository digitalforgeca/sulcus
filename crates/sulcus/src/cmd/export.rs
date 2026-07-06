use anyhow::{Context, Result};
use std::io::Write;
use sulcus_cloud::SulcusClient;
use sulcus_core::ListParams;

/// Maximum page size per API request.
const PAGE_SIZE: u32 = 100;

pub async fn run(output: Option<&str>) -> Result<()> {
    let client = SulcusClient::from_env()?;
    let namespace = client.namespace().to_string();

    eprintln!("  📤 Exporting memories from namespace \"{namespace}\"…");

    // Paginate through all memories.
    let mut all_memories: Vec<serde_json::Value> = Vec::new();
    let mut page: u32 = 1;

    loop {
        let params = ListParams {
            page,
            page_size: PAGE_SIZE,
            memory_type: None,
            namespace: None,
            pinned: None,
        };

        let result = client.list(&params).await?;

        // Extract the items array from the response.
        let items = extract_items(&result);

        if items.is_empty() {
            break;
        }

        let count = items.len();
        all_memories.extend(items);

        eprintln!("  … page {page}: {count} memories (total: {})", all_memories.len());

        // If we got fewer than page_size, we've reached the end.
        if (count as u32) < PAGE_SIZE {
            break;
        }

        page += 1;

        // Safety valve — cap at 100 pages (10,000 memories).
        if page > 100 {
            eprintln!("  ⚠ Reached 10,000 memory cap — stopping pagination.");
            break;
        }
    }

    if all_memories.is_empty() {
        eprintln!("  No memories found.");
        return Ok(());
    }

    eprintln!("  ✅ {} memories fetched. Formatting…", all_memories.len());

    // Format as markdown.
    let markdown = format_markdown(&all_memories, &namespace);

    // Write output.
    match output {
        Some(path) => {
            std::fs::write(path, &markdown)
                .with_context(|| format!("Failed to write to {path}"))?;
            eprintln!("  📄 Written to {path} ({} bytes)", markdown.len());
        }
        None => {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            handle.write_all(markdown.as_bytes())?;
            handle.flush()?;
        }
    }

    // Print summary to stderr so it doesn't mix with stdout output.
    let mut type_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for mem in &all_memories {
        let mt = mem.get("memory_type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        *type_counts.entry(mt.to_string()).or_default() += 1;
    }

    eprintln!();
    eprintln!("  ── Export summary ──");
    eprintln!("  📊 Total:     {}", all_memories.len());

    // Sort types by count descending for display.
    let mut sorted: Vec<_> = type_counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    for (mt, count) in &sorted {
        eprintln!("     {} {mt}: {count}", type_icon(mt));
    }
    eprintln!();

    Ok(())
}

// ---------------------------------------------------------------------------
// Markdown Formatting
// ---------------------------------------------------------------------------

/// Format all memories as a round-trip-compatible markdown document.
///
/// Output format matches what `sulcus import` expects (Format A):
///
/// ```text
/// # Sulcus Memory Export
/// <!-- namespace: ariadne -->
/// <!-- exported: 2026-07-05T20:30:00Z -->
/// <!-- count: 42 -->
///
/// ---
///
/// ### 🧠 [semantic]
/// Content of the memory goes here.
///
/// ---
///
/// ### 📅 [episodic]
/// Another memory block.
///
/// ---
/// ```
fn format_markdown(memories: &[serde_json::Value], namespace: &str) -> String {
    let now = chrono_now_iso();
    let count = memories.len();

    let mut out = String::with_capacity(count * 200);

    // Header.
    out.push_str("# Sulcus Memory Export\n");
    out.push_str(&format!("<!-- namespace: {namespace} -->\n"));
    out.push_str(&format!("<!-- exported: {now} -->\n"));
    out.push_str(&format!("<!-- count: {count} -->\n"));
    out.push('\n');

    for mem in memories {
        let label = mem.get("label")
            .or_else(|| mem.get("pointer_summary"))
            .and_then(|v| v.as_str())
            .unwrap_or("(empty)");

        let mem_type = mem.get("memory_type")
            .and_then(|v| v.as_str())
            .unwrap_or("semantic");

        let heat = mem.get("current_heat")
            .or_else(|| mem.get("heat"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        let pinned = mem.get("is_pinned")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let id = mem.get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("?");

        let icon = type_icon(mem_type);

        // Separator.
        out.push_str("---\n\n");

        // Type header with icon.
        out.push_str(&format!("### {icon} [{mem_type}]"));

        // Metadata suffix (heat + pinned) as a comment so import ignores it.
        let pin_tag = if pinned { " 📌" } else { "" };
        out.push_str(&format!("  <!-- heat: {:.0}%{pin_tag} id: {id} -->\n", heat * 100.0));

        // Content body.
        out.push_str(label);
        out.push_str("\n\n");
    }

    // Final separator.
    out.push_str("---\n");

    out
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract items array from a list API response.
///
/// The API may return items under different keys depending on version.
fn extract_items(result: &serde_json::Value) -> Vec<serde_json::Value> {
    // Try "items", "nodes", "results", or top-level array.
    if let Some(arr) = result.get("items").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(arr) = result.get("nodes").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(arr) = result.get("results").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(arr) = result.as_array() {
        arr.clone()
    } else {
        vec![]
    }
}

/// Get a type icon for markdown rendering.
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

/// Get current UTC time as ISO-8601 string without chrono dependency.
fn chrono_now_iso() -> String {
    // Use std::time to get seconds since epoch, then format manually.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();

    // Convert epoch seconds to ISO-8601.
    // Simple calculation — good enough for export timestamps.
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Convert days to year/month/day using a basic Gregorian algorithm.
    let (year, month, day) = days_to_ymd(days_since_epoch);

    format!(
        "{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}Z"
    )
}

/// Convert days since Unix epoch (1970-01-01) to (year, month, day).
fn days_to_ymd(days: u64) -> (u64, u64, u64) {
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_format_single_memory() {
        let memories = vec![json!({
            "id": "abc-123",
            "label": "Rust is great for CLI tools.",
            "memory_type": "semantic",
            "current_heat": 0.8,
            "is_pinned": false,
        })];

        let md = format_markdown(&memories, "test");

        assert!(md.starts_with("# Sulcus Memory Export\n"));
        assert!(md.contains("<!-- namespace: test -->"));
        assert!(md.contains("<!-- count: 1 -->"));
        assert!(md.contains("### 🧠 [semantic]"));
        assert!(md.contains("Rust is great for CLI tools."));
        assert!(md.contains("heat: 80%"));
    }

    #[test]
    fn test_format_multiple_types() {
        let memories = vec![
            json!({
                "id": "1",
                "label": "A fact",
                "memory_type": "fact",
                "current_heat": 0.5,
                "is_pinned": true,
            }),
            json!({
                "id": "2",
                "label": "An event",
                "memory_type": "episodic",
                "current_heat": 0.3,
                "is_pinned": false,
            }),
        ];

        let md = format_markdown(&memories, "ns");

        assert!(md.contains("### 📌 [fact]"));
        assert!(md.contains("### 📅 [episodic]"));
        assert!(md.contains("📌")); // pinned marker
        assert!(md.contains("A fact"));
        assert!(md.contains("An event"));
    }

    #[test]
    fn test_format_round_trip_header() {
        let memories = vec![json!({
            "id": "x",
            "label": "test content",
            "memory_type": "preference",
            "current_heat": 0.95,
            "is_pinned": false,
        })];

        let md = format_markdown(&memories, "ariadne");

        // Verify the import parser can read this back.
        // The format should have --- separators and [type] markers.
        assert!(md.contains("---\n\n### 💜 [preference]"));
    }

    #[test]
    fn test_extract_items_nested() {
        let resp = json!({ "items": [{"id": "1"}, {"id": "2"}] });
        let items = extract_items(&resp);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn test_extract_items_array() {
        let resp = json!([{"id": "1"}]);
        let items = extract_items(&resp);
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn test_extract_items_empty() {
        let resp = json!({ "error": "nope" });
        let items = extract_items(&resp);
        assert!(items.is_empty());
    }

    #[test]
    fn test_days_to_ymd_epoch() {
        let (y, m, d) = days_to_ymd(0);
        assert_eq!((y, m, d), (1970, 1, 1));
    }

    #[test]
    fn test_days_to_ymd_2026() {
        // 2026-07-05 = day 20639 from epoch
        let (y, m, d) = days_to_ymd(20639);
        assert_eq!((y, m, d), (2026, 7, 5));
    }

    #[test]
    fn test_format_fallback_fields() {
        // Test with pointer_summary instead of label, and heat instead of current_heat.
        let memories = vec![json!({
            "id": "z",
            "pointer_summary": "Fallback content",
            "memory_type": "procedural",
            "heat": 0.6,
        })];

        let md = format_markdown(&memories, "test");
        assert!(md.contains("Fallback content"));
        assert!(md.contains("[procedural]"));
        assert!(md.contains("heat: 60%"));
    }
}
