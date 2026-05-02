//! Pure fold logic functions — zero I/O, zero async, no DB or network deps.
//!
//! These are extracted from `sulcus` to enable testing and reuse without
//! pulling in `sqlx`, `reqwest`, or `tokio`.  Any function that touches the DB,
//! filesystem, or network remains in `sulcus`.

use sulcus_types::folds::{ExportEdge, ExportNode};
#[cfg(test)]
use sulcus_types::folds::FOLD_SUMMARY_MAX;

// ─── Extractive / prompt helpers ─────────────────────────────────────────────

/// Craft a memory-type-aware prompt for the local LLM.
///
/// Pure string formatting — no I/O.
pub fn summarize_prompt(content: &str, mtype: &str) -> String {
    let instruction = match mtype {
        "semantic" => {
            "Extract the single core knowledge claim from this passage. Be concise (1-2 sentences)."
        }
        "preference" => {
            "State this user preference as one direct sentence starting with 'User prefers...'."
        }
        "procedural" => "Describe this procedure as 2-3 numbered steps. Omit preamble.",
        _ => "Summarize this memory in 2-3 sentences. Preserve key facts and named entities.",
    };
    format!("{instruction}\n\nMemory ({mtype}):\n{content}\n\nSummary:")
}

/// Deterministic extractive summarization fallback (truncation).
///
/// Hard-truncates `text` to at most `max_chars` characters, respecting UTF-8
/// char boundaries.  Does **not** sentence-split — sentence-splitting on
/// `['.','?','!']` mangles IP addresses, code, and Markdown.
///
/// Pure function, zero I/O.
pub fn extractive_summarize_fallback(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.is_empty() {
        return String::new();
    }

    let cut = text
        .char_indices()
        .take_while(|(i, _)| *i < max_chars)
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(text.len());
    text[..cut].trim().to_string()
}

// ─── Markdown link parser ─────────────────────────────────────────────────────

/// Parse a markdown link line produced by `export_markdown`:
/// `- \`<uuid>\` via \`<rel_type>\` (weight: 0.90)`
///
/// Returns `(target_id, relationship_type, weight)` or `None` if the line
/// doesn't match the expected format.
///
/// Pure parser, zero I/O.
pub fn parse_link_line(line: &str) -> Option<(String, String, f32)> {
    let rest = line.trim().strip_prefix("- `")?;
    let (target_id, rest) = rest.split_once('`')?;
    let rest = rest.trim().strip_prefix("via `")?;
    let (rel_type, rest) = rest.split_once('`')?;
    let weight: f32 = rest
        .trim()
        .strip_prefix("(weight: ")?
        .strip_suffix(')')?
        .parse()
        .ok()?;
    Some((target_id.to_string(), rel_type.to_string(), weight))
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

/// Render a slice of [`ExportNode`]s and [`ExportEdge`]s to the SULCUS Markdown
/// export format.
///
/// This is the pure string-construction half of `export_markdown` (the DB-fetch
/// half stays in `sulcus`).  The caller is responsible for supplying an
/// `exported_at` timestamp string and an optional fold name.
///
/// Pure function, zero I/O.
pub fn render_nodes_to_markdown(
    nodes: &[ExportNode],
    edges: &[ExportEdge],
    exported_at: &str,
    fold_name: Option<&str>,
) -> String {
    let node_count = nodes.len();
    let edge_count = edges.len();

    // Index edges by source for O(1) lookup per node.
    let mut edges_by_source: std::collections::HashMap<&str, Vec<&ExportEdge>> =
        std::collections::HashMap::new();
    for e in edges.iter() {
        edges_by_source
            .entry(e.source_id.as_str())
            .or_default()
            .push(e);
    }

    let mut md = String::with_capacity(node_count * 512 + 256);

    // YAML frontmatter.
    md.push_str("---\n");
    md.push_str("sulcus_version: 1\n");
    md.push_str(&format!("exported_at: {}\n", exported_at));
    md.push_str(&format!("node_count: {}\n", node_count));
    md.push_str(&format!("edge_count: {}\n", edge_count));
    if let Some(name) = fold_name {
        md.push_str(&format!("fold: {}\n", name));
    }
    md.push_str("---\n\n");
    md.push_str("# SULCUS Memory Export\n\n");

    for node in nodes.iter() {
        md.push_str(&format!("## {}\n\n", node.label));

        // Machine-readable metadata in an HTML comment — invisible in renderers,
        // parseable by `parse_markdown_export`.
        md.push_str("<!-- sulcus:node\n");
        md.push_str(&format!("id: {}\n", node.id));
        md.push_str(&format!("memory_type: {}\n", node.memory_type));
        md.push_str(&format!("modality: {}\n", node.modality));
        md.push_str(&format!("namespace: {}\n", node.namespace));
        md.push_str(&format!("base_utility: {:.4}\n", node.base_utility));
        md.push_str(&format!("current_heat: {:.4}\n", node.current_heat));
        md.push_str(&format!("is_pinned: {}\n", node.is_pinned));
        md.push_str("-->\n\n");

        // Summary as a blockquote (visible in any markdown renderer).
        for line in node.pointer_summary.lines() {
            md.push_str(&format!("> {}\n", line));
        }
        md.push('\n');

        // Full text content if available.
        if let Some(ref content) = node.raw_content {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                md.push_str(trimmed);
                md.push_str("\n\n");
            }
        }

        // Outgoing edges.
        if let Some(node_edges) = edges_by_source.get(node.id.as_str()) {
            if !node_edges.is_empty() {
                md.push_str("**Links:**\n");
                for e in node_edges.iter() {
                    md.push_str(&format!(
                        "- `{}` via `{}` (weight: {:.2})\n",
                        e.target_id, e.relationship_type, e.edge_weight
                    ));
                }
                md.push('\n');
            }
        }

        md.push_str("---\n\n");
    }

    md
}

// ─── Markdown import parser ───────────────────────────────────────────────────

/// A node parsed from a SULCUS Markdown export.
///
/// Mirrors the internal `PNode` from `sulcus::import_markdown` but is
/// public so callers can inspect or persist the result themselves.
#[derive(Debug, Clone, Default)]
pub struct ParsedNode {
    /// Node UUID if present in the `<!-- sulcus:node ... -->` block.
    pub id: Option<String>,
    pub label: String,
    pub memory_type: String,
    pub modality: String,
    pub namespace: String,
    pub base_utility: f32,
    pub current_heat: f32,
    pub is_pinned: bool,
    /// Lines from `> summary` blockquotes, joined with `\n` to form `pointer_summary`.
    pub summary_lines: Vec<String>,
    /// Non-empty, non-header, non-separator body lines (the `raw_content`).
    pub content_lines: Vec<String>,
    /// Raw link lines in the form `- \`<uuid>\` via \`<rel>\` (weight: N)`.
    pub link_lines: Vec<String>,
}

impl ParsedNode {
    fn new(label: String) -> Self {
        Self {
            label,
            memory_type: "episodic".to_string(),
            modality: "text".to_string(),
            namespace: "default".to_string(),
            base_utility: 0.5,
            ..Default::default()
        }
    }

    /// Convenience: join `summary_lines` into a single `pointer_summary` string.
    pub fn pointer_summary(&self) -> String {
        self.summary_lines.join("\n")
    }

    /// Convenience: join `content_lines` into trimmed `raw_content`, or `None`
    /// if there is no content.
    pub fn raw_content(&self) -> Option<String> {
        let s = self.content_lines.join("\n").trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    }
}

/// Parse a SULCUS Markdown export (produced by [`render_nodes_to_markdown`] or
/// `sulcus::export_markdown`) into a `Vec<ParsedNode>`.
///
/// Vectors are intentionally absent from the format; the caller must re-embed.
///
/// Pure state machine — no I/O, no async.
pub fn parse_markdown_export(text: &str) -> Vec<ParsedNode> {
    enum St {
        Preamble,
        Node(ParsedNode),
        Meta(ParsedNode),
    }

    let mut state = St::Preamble;
    let mut collected: Vec<ParsedNode> = Vec::new();
    let mut in_frontmatter = false;
    let mut frontmatter_done = false;
    let mut in_links = false;

    for line in text.lines() {
        // Handle YAML frontmatter.
        if !frontmatter_done {
            if line == "---" {
                if !in_frontmatter {
                    in_frontmatter = true;
                } else {
                    frontmatter_done = true;
                }
                continue;
            }
            if in_frontmatter {
                continue;
            }
        }

        match state {
            St::Preamble => {
                if let Some(label) = line.strip_prefix("## ") {
                    in_links = false;
                    state = St::Node(ParsedNode::new(label.trim().to_string()));
                }
            }
            St::Node(ref mut node) => {
                if let Some(label) = line.strip_prefix("## ") {
                    // Flush current node, start a new one.
                    let finished =
                        std::mem::replace(node, ParsedNode::new(label.trim().to_string()));
                    collected.push(finished);
                    in_links = false;
                } else if line.starts_with("<!-- sulcus:node") {
                    let finished = std::mem::replace(node, ParsedNode::new(String::new()));
                    state = St::Meta(finished);
                } else if let Some(summary) = line.strip_prefix("> ") {
                    in_links = false;
                    node.summary_lines.push(summary.to_string());
                } else if line == "**Links:**" {
                    in_links = true;
                } else if in_links {
                    if !line.is_empty() {
                        node.link_lines.push(line.to_string());
                    }
                } else if !line.is_empty() && !line.starts_with('#') && line != "---" {
                    node.content_lines.push(line.to_string());
                }
            }
            St::Meta(ref mut node) => {
                if line == "-->" {
                    // Swap the enriched meta-node back and resume Node state.
                    let meta_done = std::mem::replace(node, ParsedNode::new(String::new()));
                    state = St::Node(meta_done);
                } else if let Some((k, v)) = line.split_once(':') {
                    match k.trim() {
                        "id" => node.id = Some(v.trim().to_string()),
                        "memory_type" => node.memory_type = v.trim().to_string(),
                        "modality" => node.modality = v.trim().to_string(),
                        "namespace" => node.namespace = v.trim().to_string(),
                        "base_utility" => node.base_utility = v.trim().parse().unwrap_or(0.5),
                        "current_heat" => node.current_heat = v.trim().parse().unwrap_or(0.0),
                        "is_pinned" => node.is_pinned = v.trim() == "true",
                        _ => {}
                    }
                }
            }
        }
    }

    // Flush the final node.
    if let St::Node(node) | St::Meta(node) = state {
        collected.push(node);
    }

    collected
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extractive_summarize_fallback_empty() {
        assert_eq!(extractive_summarize_fallback("", 100), "");
    }

    #[test]
    fn extractive_summarize_fallback_short() {
        assert_eq!(extractive_summarize_fallback("hello", 100), "hello");
    }

    #[test]
    fn extractive_summarize_fallback_truncates() {
        let result = extractive_summarize_fallback("hello world", 5);
        assert_eq!(result, "hello");
    }

    #[test]
    fn summarize_prompt_semantic() {
        let p = summarize_prompt("The sky is blue.", "semantic");
        assert!(p.contains("core knowledge claim"));
        assert!(p.contains("The sky is blue."));
    }

    #[test]
    fn summarize_prompt_default() {
        let p = summarize_prompt("some memory", "episodic");
        assert!(p.contains("2-3 sentences"));
    }

    #[test]
    fn parse_link_line_valid() {
        let line =
            "- `550e8400-e29b-41d4-a716-446655440000` via `prefers` (weight: 0.90)";
        let result = parse_link_line(line);
        assert!(result.is_some());
        let (id, rel, w) = result.unwrap();
        assert_eq!(id, "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(rel, "prefers");
        assert!((w - 0.90).abs() < 1e-4);
    }

    #[test]
    fn parse_link_line_invalid() {
        assert!(parse_link_line("not a link").is_none());
    }

    #[test]
    fn render_and_parse_roundtrip() {
        let nodes = vec![ExportNode {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            label: "Test node".to_string(),
            pointer_summary: "A test summary.".to_string(),
            base_utility: 0.8,
            current_heat: 0.6,
            is_pinned: false,
            memory_type: "semantic".to_string(),
            modality: "text".to_string(),
            source_mime: None,
            namespace: "default".to_string(),
            raw_content: Some("Full content here.".to_string()),
            vector_b64: None,
        }];
        let edges = vec![];

        let md = render_nodes_to_markdown(&nodes, &edges, "2026-01-01T00:00:00Z", None);
        let parsed = parse_markdown_export(&md);

        assert_eq!(parsed.len(), 1);
        let n = &parsed[0];
        assert_eq!(n.label, "Test node");
        assert_eq!(n.id.as_deref(), Some("550e8400-e29b-41d4-a716-446655440000"));
        assert_eq!(n.memory_type, "semantic");
        assert_eq!(n.pointer_summary(), "A test summary.");
        assert_eq!(n.raw_content().as_deref(), Some("Full content here."));
    }

    #[test]
    fn fold_summary_max_is_accessible() {
        // Ensure the constant from sulcus-types is importable here.
        assert!(FOLD_SUMMARY_MAX > 0);
    }
}
