//! Sentence-splitting logic for text decomposition.
//!
//! # Design Note
//! `siu_decompose` returns fragments with `type: null` and `confidence: null`.
//! The host process is responsible for:
//!   1. Calling `sulcus_vectors_text` on each fragment to get a 384-dim embedding.
//!   2. Passing that embedding to `siu_classify` to populate type and confidence.
//!
//! This keeps the two dylibs fully decoupled — sulcus-siu never needs the embed handle.

use crate::types::DecompositionFragment;

/// Split `text` into sentence fragments using simple punctuation-based rules.
///
/// Splits on:
/// - `. ` (period + space)
/// - `! ` (exclamation + space)
/// - `? ` (question mark + space)
/// - `\n` (newlines, including `\r\n`)
///
/// Empty or whitespace-only fragments are discarded. Trailing punctuation is
/// preserved so that the fragment is self-contained.
pub fn decompose(text: &str) -> Vec<DecompositionFragment> {
    // Normalise CRLF → LF first.
    let normalised = text.replace("\r\n", "\n").replace('\r', "\n");

    // We scan character by character, collecting fragments.
    let mut fragments: Vec<String> = Vec::new();
    let mut current = String::new();

    let chars: Vec<char> = normalised.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let ch = chars[i];

        if ch == '\n' {
            // Newline boundary — flush current fragment.
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                fragments.push(trimmed);
            }
            current.clear();
            i += 1;
        } else if (ch == '.' || ch == '!' || ch == '?') && i + 1 < len && chars[i + 1] == ' ' {
            // Sentence-ending punctuation followed by a space — include the
            // punctuation in the current fragment, then flush.
            current.push(ch);
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                fragments.push(trimmed);
            }
            current.clear();
            // Skip the trailing space so the next fragment doesn't start with one.
            i += 2;
        } else {
            current.push(ch);
            i += 1;
        }
    }

    // Flush any remaining text (e.g., last sentence without trailing space).
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        fragments.push(trimmed);
    }

    // Map into DecompositionFragment with null classification fields.
    // The host is expected to embed each fragment and call siu_classify to fill these.
    fragments
        .into_iter()
        .map(|f| DecompositionFragment {
            fragment: f,
            memory_type: None,
            confidence: None,
            labels: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_period_space() {
        let frags = decompose("Hello world. Foo bar. Baz.");
        assert_eq!(frags[0].fragment, "Hello world.");
        assert_eq!(frags[1].fragment, "Foo bar.");
        // Last fragment has no trailing space, so it's flushed as-is.
        assert_eq!(frags[2].fragment, "Baz.");
    }

    #[test]
    fn splits_on_newlines() {
        let frags = decompose("line one\nline two\nline three");
        assert_eq!(frags.len(), 3);
        assert_eq!(frags[1].fragment, "line two");
    }

    #[test]
    fn discards_empty_fragments() {
        let frags = decompose("   \n\n  hello.  \n  ");
        assert_eq!(frags.len(), 1);
        assert_eq!(frags[0].fragment, "hello.");
    }

    #[test]
    fn classification_fields_are_null() {
        let frags = decompose("Some text.");
        assert!(frags[0].memory_type.is_none());
        assert!(frags[0].confidence.is_none());
    }
}
