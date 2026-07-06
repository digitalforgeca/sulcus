use anyhow::Result;
use sulcus_cloud::SulcusClient;
use sulcus_core::SearchParams;

pub async fn run(
    query: &str,
    limit: u32,
    memory_type: Option<&str>,
    min_heat: Option<f64>,
) -> Result<()> {
    let client = SulcusClient::from_env()?;

    let params = SearchParams {
        query: query.to_string(),
        limit,
        memory_type: memory_type.map(|s| s.to_string()),
    };

    let result = client.search(&params).await?;

    // The API may return results as a top-level array, or nested under
    // "results", "items", or "nodes". Handle all known shapes.
    let results = if let Some(arr) = result.as_array() {
        arr.clone()
    } else if let Some(arr) = result.get("results").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(arr) = result.get("items").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(arr) = result.get("nodes").and_then(|v| v.as_array()) {
        arr.clone()
    } else {
        // Unknown shape — dump as JSON for debugging.
        println!("{}", serde_json::to_string_pretty(&result)?);
        return Ok(());
    };

    if results.is_empty() {
        println!("  No results for \"{query}\"");
        return Ok(());
    }

    // Apply client-side min_heat filter if requested.
    let results: Vec<_> = if let Some(min) = min_heat {
        results
            .into_iter()
            .filter(|r| {
                let heat = extract_heat(r);
                heat >= min
            })
            .collect()
    } else {
        results
    };

    if results.is_empty() {
        println!("  No results above {:.0}% heat for \"{query}\"", min_heat.unwrap_or(0.0) * 100.0);
        return Ok(());
    }

    println!(
        "╭─────────────────────────────────────────╮"
    );
    println!(
        "│  🔍 Search: {:<28}│",
        truncate_str(query, 28)
    );
    println!(
        "╰─────────────────────────────────────────╯"
    );
    println!();

    for (i, item) in results.iter().enumerate() {
        // Results may be wrapped in {node, score} or be flat memory objects.
        let (node, score) = if let Some(n) = item.get("node") {
            let s = item.get("score").and_then(|v| v.as_f64());
            (n, s)
        } else {
            (item, item.get("score").and_then(|v| v.as_f64()))
        };

        let id = node
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("?");

        let label = node
            .get("label")
            .or_else(|| node.get("pointer_summary"))
            .and_then(|v| v.as_str())
            .unwrap_or("(no content)");

        let heat = extract_heat_from_node(node);
        let mem_type = node
            .get("memory_type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let pinned = node
            .get("is_pinned")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Result header
        let pin_marker = if pinned { " 📌" } else { "" };
        let icon = type_icon(mem_type);
        print!("  {icon} [{i}] {mem_type}{pin_marker}");
        if let Some(s) = score {
            print!("  (score: {:.2})", s);
        }
        println!("  🔥 {:.0}%", heat * 100.0);

        // Content — show first 3 lines, truncated.
        let lines: Vec<&str> = label.lines().take(3).collect();
        for line in &lines {
            println!("     {}", truncate_str(line, 70));
        }
        if label.lines().count() > 3 {
            println!("     …");
        }

        // ID (dimmed)
        println!("     \x1b[2m{id}\x1b[0m");
        println!();
    }

    let shown = results.len();
    println!("  {shown} result{}", if shown == 1 { "" } else { "s" });
    println!();

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract heat from a search result (may be top-level or nested in "node").
fn extract_heat(item: &serde_json::Value) -> f64 {
    if let Some(node) = item.get("node") {
        extract_heat_from_node(node)
    } else {
        extract_heat_from_node(item)
    }
}

fn extract_heat_from_node(node: &serde_json::Value) -> f64 {
    node.get("current_heat")
        .or_else(|| node.get("heat"))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0)
}

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
