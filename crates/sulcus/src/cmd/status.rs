use anyhow::Result;
use sulcus_cloud::SulcusClient;

pub async fn run() -> Result<()> {
    let client = SulcusClient::from_env()?;

    // Fetch both status endpoints concurrently.
    let (server_res, memory_res) = tokio::join!(client.status(), client.memory_status());

    println!("╭─────────────────────────────────────────╮");
    println!("│  🧠 Sulcus Status                       │");
    println!("╰─────────────────────────────────────────╯");
    println!();

    // -- Connection Info --------------------------------------------------
    println!("  Endpoint   {}", client.base_url());
    println!("  Namespace  {}", client.namespace());
    println!();

    // -- Server Status ----------------------------------------------------
    match server_res {
        Ok(status) => {
            let version = status
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let uptime = status
                .get("uptime")
                .and_then(|v| v.as_str())
                .or_else(|| status.get("uptime_seconds").and_then(|v| {
                    v.as_f64().map(|_| ()) // just test if it's a number
                }).and(None)) // we'll format it below
                .unwrap_or("unknown");

            println!("  Server");
            println!("    Status   ✅ connected");
            println!("    Version  {version}");

            // Try to format uptime from seconds if available.
            if let Some(secs) = status.get("uptime_seconds").and_then(|v| v.as_f64()) {
                println!("    Uptime   {}", format_duration(secs));
            } else if uptime != "unknown" {
                println!("    Uptime   {uptime}");
            }

            // Show any extra top-level fields that look interesting.
            if let Some(db) = status.get("database").and_then(|v| v.as_str()) {
                println!("    Database {db}");
            }
            if let Some(obj) = status.as_object() {
                for key in ["embedding_model", "siu_version", "features"] {
                    if let Some(val) = obj.get(key) {
                        let display = if val.is_string() {
                            val.as_str().unwrap().to_string()
                        } else {
                            val.to_string()
                        };
                        let label = key.replace('_', " ");
                        let label = capitalize(&label);
                        println!("    {label:<9}{display}");
                    }
                }
            }
        }
        Err(e) => {
            println!("  Server");
            println!("    Status   ❌ unreachable");
            println!("    Error    {e}");
        }
    }
    println!();

    // -- Memory Status ----------------------------------------------------
    match memory_res {
        Ok(mem) => {
            println!("  Memory");

            let total = mem.get("total_memories").and_then(|v| v.as_u64());
            let hot = mem.get("hot_memories").and_then(|v| v.as_u64());
            let cold = mem.get("cold_memories").and_then(|v| v.as_u64());
            let avg_heat = mem.get("average_heat").and_then(|v| v.as_f64());
            let pinned = mem.get("pinned_count").and_then(|v| v.as_u64());

            if let Some(t) = total {
                println!("    Total    {t}");
            }
            if let Some(h) = hot {
                println!("    Hot      {h}");
            }
            if let Some(c) = cold {
                println!("    Cold     {c}");
            }
            if let Some(p) = pinned {
                println!("    Pinned   {p}");
            }
            if let Some(avg) = avg_heat {
                println!("    Avg Heat {:.1}%", avg * 100.0);
            }

            // Show memory type breakdown if available.
            if let Some(breakdown) = mem.get("by_type").and_then(|v| v.as_object()) {
                println!();
                println!("  By Type");
                for (mt, count) in breakdown {
                    let c = count.as_u64().unwrap_or(0);
                    if c > 0 {
                        let icon = type_icon(mt);
                        println!("    {icon} {mt:<14}{c}");
                    }
                }
            }

            // Show hot nodes preview if available.
            if let Some(hot_nodes) = mem.get("hot_nodes").and_then(|v| v.as_array()) {
                if !hot_nodes.is_empty() {
                    println!();
                    println!("  🔥 Hottest Memories");
                    for node in hot_nodes.iter().take(5) {
                        let label = node
                            .get("label")
                            .and_then(|v| v.as_str())
                            .unwrap_or("(untitled)");
                        let heat = node
                            .get("current_heat")
                            .or_else(|| node.get("heat"))
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        let truncated = truncate_str(label, 50);
                        println!("    {:.0}% {truncated}", heat * 100.0);
                    }
                }
            }
        }
        Err(e) => {
            println!("  Memory");
            println!("    Status   ❌ unavailable");
            println!("    Error    {e}");
        }
    }

    println!();
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn format_duration(seconds: f64) -> String {
    let secs = seconds as u64;
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    let mins = (secs % 3600) / 60;

    if days > 0 {
        format!("{days}d {hours}h {mins}m")
    } else if hours > 0 {
        format!("{hours}h {mins}m")
    } else {
        format!("{mins}m")
    }
}

fn truncate_str(s: &str, max: usize) -> String {
    // Truncate at first newline, then by length.
    let s = s.split('\n').next().unwrap_or(s);
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max - 1])
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

fn type_icon(memory_type: &str) -> &'static str {
    match memory_type {
        "episodic" => "📅",
        "semantic" => "🧠",
        "preference" => "💜",
        "procedural" => "⚙️",
        "fact" => "📌",
        _ => "📝",
    }
}
