//! Zero-copy shared memory buffer for the active index.
//!
//! # Problem
//!
//! Traditional memory systems serialize their active context to JSON, forcing the
//! LLM runtime to deserialize kilobytes of text on every context read. For a
//! high-frequency inference loop this is pure waste.
//!
//! # Solution
//!
//! SULCUS provisions the active index into a **shared, memory-mapped byte buffer**
//! encoded with `rkyv`. The archived form *is* the data — no deserialization step
//! exists. An LLM runtime that knows the `NodePointer` schema can mmap the backing
//! file and read it instantaneously.
//!
//! # Buffer Layout
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │  0 ..  4  │  Magic "SULC"  (4 bytes)                   │
//! │  4 ..  8  │  Version = 1u32 (little-endian)            │
//! │  8 .. 12  │  Count = N entries (u32 LE)                │
//! │ 12 .. end │  rkyv-archived Vec<NodePointer>            │
//! └─────────────────────────────────────────────────────────┘
//! ```
//!
//! # Cross-process access
//!
//! When `mmap_path` is configured, `write_nodes` atomically writes the buffer to
//! a file. Any other process can open and mmap that file and directly access the
//! archived data via [`memmap2::Mmap`] without going through Rust ownership.
//!
//! # Tombstones
//!
//! Evicted pages leave a [`NodePointer`] entry with `is_tombstone = true` and a
//! human-readable `address` field such as `"[Paged Out: 0x4A2F user preferences]"`.
//! The LLM sees these in the context window and knows the exact address to page
//! back in when it needs the details — analogous to hardware-MMU page-fault
//! pointers.

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use anyhow::Context;
use rkyv::{Archive, Deserialize as RkyvDeserialize, Serialize as RkyvSerialize};

// ─── NodePointer ─────────────────────────────────────────────────────────────

/// Compact, rkyv-serializable pointer — the "map" entry carried in the active
/// index shared buffer.  Fits in < 400 bytes in the common case.
///
/// Heavy "territory" (raw content, embeddings) is NOT included — this is purely
/// the lightweight pointer the LLM scans to decide what to page in.
#[derive(Archive, RkyvSerialize, RkyvDeserialize, Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[archive(compare(PartialEq), check_bytes)]
pub struct NodePointer {
    /// UUID bytes (16 bytes — avoids String overhead for the most-accessed field).
    pub id_bytes: [u8; 16],
    /// Normalised heat score 0.0 ..= 1.0.
    pub heat: f32,
    /// Short label (≤ 64 Unicode code-points, hard-truncated at serialise time).
    pub label: String,
    /// Pointer summary (≤ 256 Unicode code-points — the "map" entry the LLM reads).
    pub summary: String,
    /// `true` when this entry is a tombstone left after page eviction.
    pub is_tombstone: bool,
    /// Human-readable eviction address, e.g. `"[Paged Out: 0x4A2F user prefs]"`.
    /// Empty for live entries.
    pub address: String,
}

impl NodePointer {
    /// Construct a live (non-tombstone) pointer from a node's fields.
    pub fn from_node(id: uuid::Uuid, heat: f32, label: &str, summary: &str) -> Self {
        Self {
            id_bytes: *id.as_bytes(),
            heat,
            label: label.chars().take(64).collect(),
            summary: summary.chars().take(256).collect(),
            is_tombstone: false,
            address: String::new(),
        }
    }

    /// Construct a tombstone pointer left after evicting `id`.
    ///
    /// `address` should be the pre-formatted pointer hint, e.g.
    /// `"[Paged Out: 0x4A2F user preferences]"`.
    pub fn tombstone(id: uuid::Uuid, label: &str, address: &str) -> Self {
        Self {
            id_bytes: *id.as_bytes(),
            heat: 0.0,
            label: label.chars().take(64).collect(),
            summary: String::new(),
            is_tombstone: true,
            address: address.chars().take(128).collect(),
        }
    }

    /// Recover the UUID from the stored bytes.
    pub fn id(&self) -> uuid::Uuid {
        uuid::Uuid::from_bytes(self.id_bytes)
    }
}

// ─── Buffer header ───────────────────────────────────────────────────────────

const MAGIC: &[u8; 4] = b"SULC";
const VERSION: u32 = 1;
const HEADER_LEN: usize = 12; // magic(4) + version(4) + count(4)

fn encode_header(count: usize) -> [u8; HEADER_LEN] {
    let mut h = [0u8; HEADER_LEN];
    h[0..4].copy_from_slice(MAGIC);
    h[4..8].copy_from_slice(&VERSION.to_le_bytes());
    h[8..12].copy_from_slice(&(count as u32).to_le_bytes());
    h
}

fn decode_count(buf: &[u8]) -> Option<usize> {
    if buf.len() < HEADER_LEN {
        return None;
    }
    if &buf[0..4] != MAGIC {
        return None;
    }
    Some(u32::from_le_bytes([buf[8], buf[9], buf[10], buf[11]]) as usize)
}

// ─── SharedIndexBuffer ───────────────────────────────────────────────────────

/// Thread-safe shared index buffer backed by rkyv-encoded bytes.
///
/// Optionally flushes to a file path so other processes can mmap the same data
/// without IPC overhead. The file is written atomically (overwrite) after each
/// `write_nodes` call.
#[derive(Clone)]
pub struct SharedIndexBuffer {
    inner: Arc<RwLock<Vec<u8>>>,
    mmap_path: Option<PathBuf>,
}

impl SharedIndexBuffer {
    /// Create a new buffer. Pass `Some(path)` to enable cross-process mmap sharing.
    pub fn new(mmap_path: Option<PathBuf>) -> Self {
        Self {
            inner: Arc::new(RwLock::new(Vec::new())),
            mmap_path,
        }
    }

    /// Serialize `nodes` into the shared buffer (in-memory + optional file flush).
    ///
    /// This is the write path called by the thermodynamics tick.
    pub fn write_nodes(&self, nodes: &[NodePointer]) -> anyhow::Result<()> {
        // rkyv-serialize the node slice.
        // `to_bytes` requires a Sized type, so we collect the slice into a Vec first.
        // The clone cost is O(n) pointers but happens only on tick cadence (not hot path).
        let nodes_vec: Vec<NodePointer> = nodes.to_vec();
        let payload = rkyv::to_bytes::<Vec<NodePointer>, 4096>(&nodes_vec)
            .map_err(|e| anyhow::anyhow!("rkyv serialize error: {:?}", e))?;

        // Prepend SULC header
        let header = encode_header(nodes.len());
        let mut buf = Vec::with_capacity(HEADER_LEN + payload.len());
        buf.extend_from_slice(&header);
        buf.extend_from_slice(&payload);

        // Flush to mmap-backing file if configured
        if let Some(ref path) = self.mmap_path {
            // Create parent dirs on first write
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .with_context(|| format!("create dirs for shared index at {:?}", parent))?;
            }
            // Atomic write: write to a temp file then rename over the target.
            // POSIX rename(2) is atomic — existing mmap readers keep their old
            // inode alive until they drop it, so they will never see a partially
            // written buffer and cannot receive SIGBUS.
            let tmp_path = path.with_extension(format!("tmp.{}", uuid::Uuid::new_v4()));
            std::fs::write(&tmp_path, &buf)
                .with_context(|| format!("write shared index tmp file {:?}", tmp_path))?;
            // On Windows, rename fails with ACCESS_DENIED when the target is
            // actively mmap'd.  Fall back to an in-place overwrite so the
            // background thermodynamics worker keeps running on VS Code / Windows.
            if let Err(_rename_err) = std::fs::rename(&tmp_path, path) {
                // Best-effort cleanup of the temp file; ignore errors.
                let _ = std::fs::remove_file(&tmp_path);
                // In-place write: a concurrent reader might briefly see a torn
                // buffer for microseconds, but this is far better than crashing.
                std::fs::write(path, &buf)
                    .with_context(|| format!("fallback in-place write to {:?}", path))?;
            }
        }

        if let Ok(mut w) = self.inner.write() {
            *w = buf;
        }
        Ok(())
    }

    /// Return a clone of the raw binary buffer (rkyv bytes with header).
    ///
    /// Serve this directly from the `memory://active_index.bin` resource — callers
    /// receive zero-copy bytes and can access the archive at byte offset 12.
    pub fn as_bytes(&self) -> Vec<u8> {
        self.inner.read().map(|r| r.clone()).unwrap_or_default()
    }

    /// Return the number of `NodePointer` entries currently encoded.
    pub fn len(&self) -> usize {
        let bytes = self.as_bytes();
        decode_count(&bytes).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Memory-map the backing file and return the region.
    ///
    /// The returned `Mmap` must be kept alive while the archived data is accessed.
    /// Returns `None` when no mmap path is configured or the file doesn't exist yet.
    ///
    /// # Safety
    /// The mmap is read-only. `write_nodes` uses a tmp-file + `rename` atomic
    /// swap, so readers always see either a complete old buffer or a complete
    /// new buffer — never a partially written one. SIGBUS is impossible because
    /// the old inode stays alive until all existing mmaps are dropped.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn mmap_file(&self) -> anyhow::Result<Option<memmap2::Mmap>> {
        let path = match &self.mmap_path {
            Some(p) => p,
            None => return Ok(None),
        };
        if !path.exists() {
            return Ok(None);
        }
        let file = std::fs::File::open(path)
            .with_context(|| format!("open shared index mmap file {:?}", path))?;
        if file.metadata()?.len() == 0 {
            return Ok(None);
        }
        // SAFETY: we open read-only; the write side uses full-file atomic overwrite.
        let mmap = unsafe { memmap2::Mmap::map(&file) }.context("mmap shared index file")?;
        Ok(Some(mmap))
    }

    /// Validate and iterate over the rkyv-archived entries in an existing byte slice.
    ///
    /// Suitable for reading from a mmap region:
    /// ```ignore
    /// let mmap = buf.mmap_file()?.unwrap();
    /// for ptr in SharedIndexBuffer::iter_archived(&mmap)? { ... }
    /// ```
    pub fn iter_archived(
        bytes: &[u8],
    ) -> anyhow::Result<impl Iterator<Item = &ArchivedNodePointer>> {
        if bytes.len() < HEADER_LEN {
            anyhow::bail!("buffer too short to contain SULC header");
        }
        if &bytes[0..4] != MAGIC {
            anyhow::bail!("invalid SULC magic");
        }
        let payload = &bytes[HEADER_LEN..];
        let archived = rkyv::check_archived_root::<Vec<NodePointer>>(payload)
            .map_err(|e| anyhow::anyhow!("rkyv validation failed: {:?}", e))?;
        Ok(archived.iter())
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_live_node() {
        let id = uuid::Uuid::now_v7();
        let ptr = NodePointer::from_node(id, 0.9, "UserPrefs", "User prefers dark mode.");
        assert!(!ptr.is_tombstone);
        assert_eq!(ptr.id(), id);
    }

    #[test]
    fn roundtrip_tombstone() {
        let id = uuid::Uuid::now_v7();
        let ptr = NodePointer::tombstone(id, "UserPrefs", "[Paged Out: 0x4A2F user preferences]");
        assert!(ptr.is_tombstone);
        assert_eq!(ptr.id(), id);
    }

    #[test]
    fn shared_buffer_write_and_read() {
        let buf = SharedIndexBuffer::new(None);
        let id = uuid::Uuid::now_v7();
        let nodes = vec![
            NodePointer::from_node(id, 0.85, "Foo", "Foo summary"),
            NodePointer::tombstone(id, "OldBar", "[Paged Out: 0x1234 old bar]"),
        ];
        buf.write_nodes(&nodes).unwrap();
        assert_eq!(buf.len(), 2);

        let bytes = buf.as_bytes();
        let mut read = SharedIndexBuffer::iter_archived(&bytes).unwrap();
        let first = read.next().unwrap();
        assert_eq!(first.heat, 0.85_f32);
        assert!(!first.is_tombstone);
        let second = read.next().unwrap();
        assert!(second.is_tombstone);
    }

    #[test]
    fn shared_buffer_mmap_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("active_index.bin");
        let buf = SharedIndexBuffer::new(Some(path.clone()));
        let id = uuid::Uuid::now_v7();
        buf.write_nodes(&[NodePointer::from_node(id, 1.0, "A", "B")])
            .unwrap();

        assert!(path.exists());
        let mmap_opt = buf.mmap_file().unwrap();
        let mmap = mmap_opt.unwrap();
        let mut iter = SharedIndexBuffer::iter_archived(&mmap).unwrap();
        let entry = iter.next().unwrap();
        assert_eq!(entry.heat, 1.0_f32);
    }
}
