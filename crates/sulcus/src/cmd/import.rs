use anyhow::{bail, Context, Result};
use std::path::Path;
use sulcus_cloud::SulcusClient;
use sulcus_core::RememberParams;

/// Valid memory types for import.
const VALID_TYPES: &[&str] = &[
    "episodic",
    "semantic",
    "preference",
    "procedural",
    "fact",
    "synthesis",
];

/// A parsed memory block from a markdown file.
#[derive(Debug)]
struct MemoryBlock {
    content: String,
    memory_type: String,
}

pub async fn run(file: &str) -> Result<()> {
    let path = Path::new(file);
    if !path.exists() {
        bail!("File not found: {file}");
    }

    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read {file}"))?;

    if raw.trim().is_empty() {
        bail!("File is empty: {file}");
    }

    let blocks = parse_markdown(&raw);

    if blocks.is_empty() {
        bail!("No memory blocks found in {file}.\n\
               Expected sections separated by `---` with optional [type] markers.\n\
               See `sulcus export` for the expected format.");
    }

    println!();
    println!("  📥 Importing {} memories from {}", blocks.len(), file);
    println!();

    let client = SulcusClient::from_env()?;

    let mut success = 0u32;
    let mut failed = 0u32;

    for (i, block) in blocks.iter().enumerate() {
        let icon = type_icon(&block.memory_type);
        let preview = block
            .content
            .lines()
            .next()
            .unwrap_or("(empty)")
            .chars()
            .take(60)
            .collect::<String>();

        print!("  [{:>3}/{}] {icon} {preview}", i + 1, blocks.len());
        if preview.len() < block.content.lines().next().map_or(0, |l| l.len()) {
            print!("…");
        }

        let params = RememberParams {
            content: block.content.clone(),
            memory_type: block.memory_type.clone(),
            heat: None,
            namespace: None,
        };

        match client.remember(&params).await {
            Ok(_) => {
                println!("  ✅");
                success += 1;
            }
            Err(e) => {
                println!("  ❌ {e}");
                failed += 1;
            }
        }
    }

    println!();
    println!("  ── Import complete ──");
    println!("  ✅ Stored:  {success}");
    if failed > 0 {
        println!("  ❌ Failed:  {failed}");
    }
    println!("  📊 Total:   {}", blocks.len());
    println!();

    Ok(())
}

// ---------------------------------------------------------------------------
// Markdown Parser
// ---------------------------------------------------------------------------

/// Parse a markdown document into memory blocks.
///
/// Supported formats:
///
/// **Format A — Sulcus export format (round-trip)**
/// Sections separated by `---` with a `### [type]` or `## [type]` header:
///
/// ```text
/// ---
/// ### 🧠 [semantic]
/// Content here.
/// ---
/// ```
///
/// **Format B — Simple sections**
/// Sections separated by `---` without type markers (defaults to `semantic`):
///
/// ```text
/// ---
/// Some knowledge to import.
/// ---
/// ```
///
/// **Format C — Heading-based (no separators)**
/// Each `## Heading` or `### Heading` starts a new block:
///
/// ```text
/// ## My Knowledge
/// Content goes here.
///
/// ## Another Topic
/// More content.
/// ```
///
/// **Format D — Plain text**
/// No separators or headings: entire file is one memory.
fn parse_markdown(raw: &str) -> Vec<MemoryBlock> {
    let text = raw.trim();

    // Strip a leading `# Title` line (e.g. "# Sulcus Memory Export").
    let text = strip_title(text);

    // Strip HTML comments (e.g. <!-- namespace: ... -->).
    let text = strip_html_comments(&text);

    let text = text.trim();

    // Try separator-based parsing first (Format A/B).
    if text.contains("\n---") || text.starts_with("---") {
        let blocks = parse_separator_sections(text);
        if !blocks.is_empty() {
            return blocks;
        }
    }

    // Try heading-based parsing (Format C).
    if has_section_headings(text) {
        let blocks = parse_heading_sections(text);
        if !blocks.is_empty() {
            return blocks;
        }
    }

    // Fall back to treating the whole file as one memory (Format D).
    if !text.is_empty() {
        vec![MemoryBlock {
            content: text.to_string(),
            memory_type: "semantic".to_string(),
        }]
    } else {
        vec![]
    }
}

/// Parse sections delimited by `---` (horizontal rules).
fn parse_separator_sections(text: &str) -> Vec<MemoryBlock> {
    let mut blocks = Vec::new();

    // Split on lines that are just `---` (with optional whitespace).
    let sections: Vec<String> = text
        .split('\n')
        .collect::<Vec<_>>()
        .split(|line| line.trim() == "---")
        .map(|lines| lines.join("\n"))
        .collect();

    for section in sections {
        let section = section.trim();
        if section.is_empty() {
            continue;
        }

        let (memory_type, content) = extract_type_from_section(section);
        let content = content.trim();

        if content.is_empty() {
            continue;
        }

        blocks.push(MemoryBlock {
            content: content.to_string(),
            memory_type,
        });
    }

    blocks
}

/// Parse sections delimited by `##` or `###` headings.
fn parse_heading_sections(text: &str) -> Vec<MemoryBlock> {
    let mut blocks = Vec::new();
    let lines: Vec<&str> = text.lines().collect();

    let mut current_type = "semantic".to_string();
    let mut current_lines: Vec<&str> = Vec::new();

    for line in &lines {
        if line.starts_with("## ") || line.starts_with("### ") {
            // Flush previous block.
            flush_block(&mut blocks, &current_type, &current_lines);
            current_lines.clear();

            // Extract type from heading if present.
            let (mt, heading_content) = extract_type_from_heading(line);
            current_type = mt;

            // Include heading content as first line if it has useful text.
            let heading_text = heading_content.trim();
            if !heading_text.is_empty() {
                current_lines.push(heading_text);
            }
        } else {
            current_lines.push(line);
        }
    }

    // Flush final block.
    flush_block(&mut blocks, &current_type, &current_lines);

    blocks
}

/// Check if the text has `##` or `###` headings (suggesting Format C).
fn has_section_headings(text: &str) -> bool {
    text.lines()
        .any(|line| line.starts_with("## ") || line.starts_with("### "))
}

/// Extract memory type from a section that may start with a type-annotated heading.
///
/// Recognizes patterns like:
///   `### 🧠 [semantic]`
///   `## [episodic] Event description`
///   `### [fact]`
fn extract_type_from_section(section: &str) -> (String, String) {
    let first_line = section.lines().next().unwrap_or("");

    if first_line.starts_with("## ") || first_line.starts_with("### ") {
        let (memory_type, heading_content) = extract_type_from_heading(first_line);
        let rest: String = section
            .lines()
            .skip(1)
            .collect::<Vec<_>>()
            .join("\n");

        // Combine heading content (if any) with body.
        let content = if heading_content.trim().is_empty() {
            rest
        } else {
            format!("{}\n{}", heading_content.trim(), rest)
        };

        (memory_type, content)
    } else {
        ("semantic".to_string(), section.to_string())
    }
}

/// Extract memory type from a heading line.
///
/// Returns (memory_type, remaining_heading_text).
fn extract_type_from_heading(line: &str) -> (String, &str) {
    // Strip leading `##` or `###`.
    let content = line
        .trim_start_matches('#')
        .trim();

    // Strip leading emoji (1-4 chars that aren't ASCII).
    let content = strip_leading_emoji(content);

    // Look for [type] at the start.
    if content.starts_with('[') {
        if let Some(close) = content.find(']') {
            let candidate = &content[1..close];
            if VALID_TYPES.contains(&candidate) {
                let rest = content[close + 1..].trim();
                return (candidate.to_string(), rest);
            }
        }
    }

    ("semantic".to_string(), content)
}

/// Strip leading emoji characters from a string.
fn strip_leading_emoji(s: &str) -> &str {
    let s = s.trim_start();
    let mut chars = s.chars();
    if let Some(c) = chars.next() {
        if !c.is_ascii() {
            // Skip the emoji and any trailing space/VS16.
            let rest = chars.as_str();
            // Also skip variation selector 16 (U+FE0F) if present.
            let rest = rest.trim_start_matches('\u{FE0F}');
            return rest.trim_start();
        }
    }
    s
}

/// Strip a leading `# Title` line from the document.
fn strip_title(text: &str) -> String {
    let mut lines = text.lines();
    if let Some(first) = lines.next() {
        if first.starts_with("# ") && !first.starts_with("## ") {
            return lines.collect::<Vec<_>>().join("\n");
        }
    }
    text.to_string()
}

/// Strip HTML comments like `<!-- ... -->`.
fn strip_html_comments(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(start) = rest.find("<!--") {
        result.push_str(&rest[..start]);
        if let Some(end) = rest[start..].find("-->") {
            rest = &rest[start + end + 3..];
        } else {
            // Unterminated comment — keep the rest.
            rest = &rest[start..];
            break;
        }
    }
    result.push_str(rest);
    result
}

/// Flush accumulated lines into a memory block if non-empty.
fn flush_block(blocks: &mut Vec<MemoryBlock>, memory_type: &str, lines: &[&str]) {
    let content = lines.join("\n");
    let content = content.trim();
    if !content.is_empty() {
        blocks.push(MemoryBlock {
            content: content.to_string(),
            memory_type: memory_type.to_string(),
        });
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_separator_format_with_types() {
        let md = r#"# Sulcus Memory Export

---

### 🧠 [semantic]
Rust is a systems programming language.

---

### 📅 [episodic]
Deployed Sulcus v2.0 today.

---
"#;

        let blocks = parse_markdown(md);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].memory_type, "semantic");
        assert!(blocks[0].content.contains("Rust is a systems"));
        assert_eq!(blocks[1].memory_type, "episodic");
        assert!(blocks[1].content.contains("Deployed Sulcus"));
    }

    #[test]
    fn test_separator_format_no_types() {
        let md = "---\nFirst memory.\n---\nSecond memory.\n---";
        let blocks = parse_markdown(md);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].memory_type, "semantic");
        assert_eq!(blocks[1].memory_type, "semantic");
    }

    #[test]
    fn test_heading_format() {
        let md = r#"## Topic One
Content for topic one.

## Topic Two
Content for topic two.
"#;
        let blocks = parse_markdown(md);
        assert_eq!(blocks.len(), 2);
    }

    #[test]
    fn test_plain_text_fallback() {
        let md = "Just a single block of text to remember.";
        let blocks = parse_markdown(md);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].memory_type, "semantic");
    }

    #[test]
    fn test_empty_file() {
        let blocks = parse_markdown("");
        assert!(blocks.is_empty());
    }

    #[test]
    fn test_strip_html_comments() {
        let md = "# Title\n<!-- metadata -->\n---\nContent.\n---";
        let blocks = parse_markdown(md);
        assert_eq!(blocks.len(), 1);
        assert!(blocks[0].content.contains("Content."));
    }

    #[test]
    fn test_type_extraction_with_emoji() {
        let (mt, rest) = extract_type_from_heading("### 🧠 [semantic] Knowledge title");
        assert_eq!(mt, "semantic");
        assert_eq!(rest, "Knowledge title");
    }

    #[test]
    fn test_type_extraction_no_emoji() {
        let (mt, rest) = extract_type_from_heading("### [fact] A hard fact");
        assert_eq!(mt, "fact");
        assert_eq!(rest, "A hard fact");
    }

    #[test]
    fn test_type_extraction_invalid() {
        let (mt, _rest) = extract_type_from_heading("### [unknown] Something");
        assert_eq!(mt, "semantic"); // fallback
    }
}
