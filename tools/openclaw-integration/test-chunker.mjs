#!/usr/bin/env node
/**
 * test-chunker.mjs
 *
 * End-to-end test for ContextChunkerSkill running against a PGlite backend.
 * No Rust binary spawn. Uses @electric-sql/pglite directly.
 *
 * Prerequisites
 * ─────────────
 *   1. npm install          (installs @electric-sql/pglite)
 *   2. Ollama (optional, for live LLM calls):
 *        ollama serve && ollama pull qwen2.5
 *
 * Run
 * ───
 *   node test-chunker.mjs
 *   LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5:7b node test-chunker.mjs
 *
 * What it does
 * ───────────
 *   1. Opens an in-memory PGlite database (no files written)
 *   2. Shows the compact tool directory — separate from document context
 *   3. Builds a synthetic “large context” (~32 000 chars)
 *   4. Previews chunks and per-chunk system prompts (tool dir visible)
 *   5. If Ollama is reachable: runs full chunk→LLM→merge flow
 *   6. Stores chunk answers in PGlite active_index
 *   7. DRY-RUN exit if Ollama is offline
 */

import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config from env ───────────────────────────────────────────────────────────

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1';
const LLM_MODEL    = process.env.LLM_MODEL    ?? 'qwen2.5';
const CHUNK_CHARS  = parseInt(process.env.CHUNK_CHARS ?? '12000', 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

function hr(label) {
  const bar = '─'.repeat(60);
  console.log(`\n${bar}`);
  if (label) console.log(`  ${label}`);
  console.log(bar);
}

function truncateDisplay(s, n = 300) {
  return s.length <= n ? s : `${s.slice(0, n)}…[+${s.length - n} chars]`;
}

/**
 * Quick probe: can we reach the LLM endpoint at all?
 * Returns true if the /v1/models endpoint answers 200 or 404 (server up),
 * false if connection refused (Ollama not running).
 */
async function probeLlm(baseUrl) {
  return new Promise((resolve) => {
    const url = new URL('/v1/models', baseUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url.toString(), (res) => {
      res.resume(); // drain
      resolve(true);
    });
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// ── Generate a big synthetic context ─────────────────────────────────────────

/**
 * Build a synthetic multi-section document large enough to require chunking.
 * Each section covers a different topic so we can verify the answers reference
 * the right section.
 */
function buildLargeContext(targetChars = 30_000) {
  const SECTIONS = [
    {
      title: 'SULCUS Architecture Overview',
      body: `SULCUS is a Rust-based "Memory-as-a-Service" platform for AI agents.
It exposes memory operations via the Model Context Protocol (MCP) over stdio (local) or SSE (server).
The core concept is the Semantic VMMU — a Virtual Memory Management Unit that manages concept-level
pointers rather than raw bytes. Each memory item is called a Node. A Node contains:

  - id: UUID v4
  - label: short human-readable name
  - pointer_summary: a semantic "map" entry (\u226400 chars) the LLM scans
  - base_utility: a static importance score (0..1)
  - current_heat: a dynamic temperature computed by the thermodynamics engine
  - memory_type: episodic | semantic | preference | procedural
  - raw_content: the full "territory" text (fetched only on demand via fetch_payload)

The active_index lists the hottest nodes and is the primary context injection point.
The thermodynamics engine decays heat every tick (default 0.85 multiplier) and spikes
heat to 1.0 whenever a node is accessed. Nodes below a configurable cold threshold are
evicted to tombstone-only entries (cold_storage soft-delete).

SULCUS runs 100% offline. The JS skill layer uses PGlite (in-process Postgres WASM) for
vector similarity search and memory storage. The Rust binary (sulcus-local) uses a
PostgreSQL-compatible backend (local PGlite bridge or Postgres), and the JS layer never
touches storage internals directly. An optional
delta-sync feature pushes changes to a central Postgres server for multi-agent
collaboration. The embedding pipeline uses fastembed for CPU-only vector generation.`,

    },
    {
      title: 'Security Model',
      body: `SULCUS enforces strict tenant isolation at the database level.
Every GET, POST, or MCP call is scoped to a single Organization identified by its
internal UUID. Cross-tenant reads return HTTP 404 (not 403) to mask existence.

API keys follow a "one-time reveal" pattern: the plaintext key (sk-agent-\u2026) is
returned exactly once upon creation and then stored only as an Argon2 hash.
Rate limiting is applied via tower_governor: 100 syncs per minute per Organisation.
Embeddings are generated locally — raw text never leaves the machine unless the
user explicitly enables server sync.

The WAL (Write-Ahead Log) for memory operations is append-only; soft-delete
(retire_memory) adds a tombstone without destroying the audit trail.
TLS is enforced on the server-facing SSE endpoint; localhost-only mode bypasses TLS.
Secret management rules: never store API keys in plaintext, never log them, rotate on demand.`,
    },
    {
      title: 'MCP Tool Reference',
      body: `The following MCP tools are exposed by sulcus-local serve:

add_memory(content, memory_type?) \u2192 { node_id }
  Ingest a text memory. Generates an embedding, inserts a Node, and spikes heat to 1.0.
  memory_type defaults to "episodic".

fetch_payload(node_id) \u2192 { raw_content }
  Retrieve the full territory text for a node. Also bumps base_utility +0.15 and
  resets current_heat to 1.0 (page-fault semantics).

commit_memory(label, pointer_summary, raw_content?, connected_node_ids?, memory_type?) \u2192 { node_id }
  Low-level upsert: explicit label + summary + optional payload.

update_memory(node_id, label?, pointer_summary?, raw_content?, memory_type?) \u2192 { ok }
  CRDT-safe field update using Hybrid Logical Clocks. Concurrent edits from different
  clients converge to the highest-clock value.

forget_memory(node_id) \u2192 { ok }
  Hard-delete: removes node, payload, embeddings, edges, and active_index entry.
  Writes a tombstone to cold_storage. Evicts from the in-process vec_cache.

search_memory(query, limit?, memory_type?) \u2192 { results: [{id, label, pointer_summary, heat, score}] }
  Hybrid search: cosine similarity against the in-memory vec_cache (60% weight) plus
  Postgres FTS ts_rank (40% weight). Returns top-k sorted by combined score.

build_context(prompt, token_budget?) \u2192 { xml }
  Ignite relevant nodes, run a tick, then return an XML block bucketed by memory_type
  for direct injection into an LLM system prompt.

tick(decay?, prune_threshold?, active_limit?) \u2192 { ok }
  Run one thermodynamics cycle. Multiplies all current_heat values by decay.

summarize(text, max_chars?) \u2192 { summary }
  Deterministic extractive summary via char_indices truncation. Safe for code, JSON,
  and IP addresses (no sentence-split mangling).`,
    },
    {
      title: 'CRDT and Sync Protocol',
      body: `SULCUS uses Hybrid Logical Clocks (HLC) for CRDT-compliant field updates.
Each field in a Node (label, pointer_summary, base_utility, is_pinned) is treated as
a Last-Write-Wins (LWW) register keyed by a (actor_id, timestamp) pair.

The actor_id is a stable 8-byte identifier stored in the client_meta table so it
persists across restarts. This prevents the bug where the node's own UUID was used
as the actor, which would deduplicate updates from different nodes that happened to
share byte-prefix similarity.

Delta sync works as follows:

  1. The local client maintains a server_cursor (last synced WAL sequence number).
  2. On sync_now(), it fetches all WAL entries with seq > server_cursor from the server.
  3. It upserts each remote entry locally, applying the CRDT merge rules.
  4. It pushes all local entries with seq > last known remote seq.
  5. It updates server_cursor to the new max seq.

Conflict resolution: for each field, whichever write has the higher HLC timestamp wins.
HLC combines a physical wall-clock millisecond with a logical counter, ensuring
monotonicity even when clocks drift.

The fold_result field (produced by LLM summarisation folds) shares the "pointer_summary"
clock key so it participates correctly in the same LWW competition as direct writes —
the highest-clock value wins regardless of origin.`,
    },
    {
      title: 'Thermodynamics Engine',
      body: `The thermodynamics engine is the heart of SULCUS's context management.

Heat represents the "relevance temperature" of a node. The engine runs periodically
or on demand (via the tick MCP call). Each tick:

  1. Multiplies every node's current_heat by the decay factor (default 0.85).
  2. Removes nodes whose current_heat drops below prune_threshold (default 1.0e-3).
  3. Rebuilds the active_index with the top N hottest nodes.

Ignition: when a user prompt is provided to build_context, an ignite pass runs first.
It embeds the prompt, finds the top-k most similar nodes via cosine search against the
in-memory vec_cache, and spikes their heat to 1.0 before the tick.

Spreading activation: heat propagates along edges. If node A has heat 0.8 and an edge
to node B with weight 0.5, node B receives an activation boost of 0.8 * 0.5 = 0.4.
This means related memories are co-retrieved when a relevant anchor fires.

The vec_cache is an in-process Arc<RwLock<HashMap<Uuid, Vec<f32>>>> that avoids
full BLOB table scans during thermodynamics. All cosine calculations run under a
single read lock without cloning the 75 MB embedding table into the caller.`,
    },
    {
      title: 'Deployment Guide',
      body: `Local deployment (default):

  1. cargo build --release -p sulcus-local
  2. export SULCUS_DATABASE_URL=postgres://sulcus:sulcus@127.0.0.1:4201/sulcus_test
  3. ./target/release/sulcus-local serve

The binary runs forever, reading JSON-RPC from stdin and writing responses to stdout.
An MCP client (OpenClaw, a custom script, etc.) spawns it as a sidecar process.

Server deployment (Postgres):

  1. Start Postgres: docker compose -f docker-compose.postgres.yml up -d
  2. cargo build --release -p sulcus-server
  3. export SULCUS_DATABASE_URL=postgres://sulcus@127.0.0.1:4201/sulcus
  4. ./target/release/sulcus-server

The server exposes SSE at /sse and an MCP POST endpoint at /message.
Multiple agents can connect concurrently; each session has its own context.

Environment variables summary:
  SULCUS_DATABASE_URL    — PostgreSQL-compatible DSN (Postgres/PGlite)
  SULCUS_SERVER_URL      — Remote server URL for delta sync
  SULCUS_CONFIG          — Path to sulcus.ini config file
  SULCUS_THERM_INTERVAL  — Tick interval in ms (default: 60000)
  SULCUS_DECAY           — Decay factor per tick (default: 0.85)
  SULCUS_ACTIVE_LIMIT    — Max active_index entries (default: 50)`,
    },
  ];

  // Cycle through sections until we reach targetChars.
  let doc = '';
  let sectionIdx = 0;
  while (doc.length < targetChars) {
    const s = SECTIONS[sectionIdx % SECTIONS.length];
    doc += `\n\n## ${s.title}\n\n${s.body}`;
    sectionIdx++;
  }
  return doc.slice(0, targetChars);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { createPGliteClient }                                    = await import('./pglite-backend.mjs');
  const { ContextChunkerSkill, splitChunks, buildToolDirectory }  = await import('./context-chunker-skill.mjs');

  hr('SULCUS Context-Chunker Skill — PGlite integration test');
  console.log(`LLM endpoint : ${LLM_BASE_URL}`);
  console.log(`LLM model    : ${LLM_MODEL}`);
  console.log(`Chunk size   : ${CHUNK_CHARS} chars`);
  console.log(`DB backend   : PGlite (in-memory, no Rust binary needed)`);

  // ── 1. Verify LLM reachability ────────────────────────────────────────────
  hr('Step 1 — probing LLM endpoint');
  const llmOnline = await probeLlm(LLM_BASE_URL);
  if (!llmOnline) {
    console.warn(`\n⚠  LLM endpoint ${LLM_BASE_URL} is not reachable.`);
    console.warn('   Ollama not running? Try:  ollama serve && ollama pull qwen2.5');
    console.warn('\n   Running in DRY-RUN mode — showing chunks and tool directory.\n');
  } else {
    console.log(`✓  LLM endpoint is online.`);
  }

  // ── 2. Open PGlite ────────────────────────────────────────────────────────
  hr('Step 2 — opening PGlite database');
  let sulcus;
  try {
    // In-memory; no files, no Postgres server, no Rust binary.
    sulcus = await createPGliteClient();
    console.log('✓  PGlite ready.');
  } catch (err) {
    console.error('✗  Failed to open PGlite:', err.message);
    console.error('    Have you run `npm install` in tools/openclaw-integration/?');
    process.exit(1);
  }

  // ── 3. Show compact tool directory (separate from content context) ─────────
  hr('Step 3 — tool directory (injected into system prompt, NOT into chunks)');
  const tools   = await sulcus.describeTools();
  const toolDir = buildToolDirectory(tools);
  console.log(toolDir);
  console.log(`\n ℹ  ${tools.length} tools listed. Each chunk's system prompt carries this compact`);
  console.log(`    directory (≈${toolDir.length} chars) instead of the full JSON Schema (≈${JSON.stringify(tools).length} chars).`);

  // ── 4. Build synthetic context ────────────────────────────────────────────
  hr('Step 4 — building large synthetic context');
  const context = buildLargeContext(32_000);
  console.log(`Context size : ${context.length} chars`);

  const previewChunks = splitChunks(context, CHUNK_CHARS);
  console.log(`Chunks       : ${previewChunks.length} chunk(s) of ≤${CHUNK_CHARS} chars`);
  previewChunks.forEach((c, i) => {
    console.log(`  Chunk ${i + 1}: ${c.length} chars  →  "${c.slice(0, 60).replace(/\s+/g, ' ')}…"`);
  });

  // Show what the system prompt for chunk 1 would look like
  const chunker = new ContextChunkerSkill(sulcus, {
    llmBaseUrl:          LLM_BASE_URL,
    llmModel:            LLM_MODEL,
    chunkChars:          CHUNK_CHARS,
    storeChunksInMemory: true,
  });
  await chunker.getToolDirectory(); // prime cache
  console.log(`\nSystem prompt preview (chunk 1/${previewChunks.length}) — tool dir is at top, content is separate:`);
  const sysPreview = await chunker._buildSystem('sample question', toolDir);
  console.log(truncateDisplay(sysPreview, 600));

  if (!llmOnline) {
    hr('DRY-RUN complete (LLM offline)');
    console.log('Tool directory and chunks shown above.');
    console.log('Start Ollama and re-run for live answers:  ollama serve && ollama pull qwen2.5');
    await sulcus.close();
    process.exit(0);
  }

  // ── 5. Ask the question through chunked context ───────────────────────────
  hr('Step 5 — asking the model about the chunked context');

  const question = 'What are the main security features of SULCUS, and how does the CRDT sync protocol handle conflicts?';
  console.log(`\nQuestion: ${question}\n`);

  const start   = Date.now();
  const result  = await chunker.ask(question, context);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  hr(`Results (${result.chunks} chunk(s), ${elapsed}s)`);

  if (result.chunks > 1) {
    console.log('\nPer-chunk answers:');
    result.chunkAnswers.forEach((a, i) => {
      console.log(`\n  [Chunk ${i + 1}]\n  ${truncateDisplay(a, 400)}`);
    });
  }

  console.log('\n━━ FINAL MERGED ANSWER ━━\n');
  console.log(result.answer);

  // ── 6. Show what PGlite stored ────────────────────────────────────────────
  hr('Step 6 — PGlite active_index after storing chunk results');
  const hot = await sulcus.getActiveIndex(10);
  if (hot.length === 0) {
    console.log('(active index is empty)');
  } else {
    hot.forEach((n, i) => {
      console.log(`  ${i + 1}. [heat=${(n.heat ?? 0).toFixed(2)}] ${n.pointer_summary ?? n.label ?? n.id}`);
    });
  }

  if (result.nodeIds.length > 0) {
    console.log(`\nPGlite node IDs written: ${result.nodeIds.filter(Boolean).join(', ')}`);
  }

  hr('Done');
  await sulcus.close();
}

main().catch((err) => {
  console.error('\n[fatal]', err.message);
  process.exit(1);
});
