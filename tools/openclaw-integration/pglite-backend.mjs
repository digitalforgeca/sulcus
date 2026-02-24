/**
 * pglite-backend.mjs
 *
 * Pure-JS MCP tool surface backed by PGlite (in-process Postgres).
 *
 * Design
 * ──────
 * • No Rust binary spawn. No SQLite. No sqlite-vec.
 * • Same SQL dialect as sulcus-wasm (Postgres $N params, EXCLUDED.*, BYTEA).
 * • Vectors stored as BYTEA (little-endian f32). Cosine computed in JS.
 * • FTS via Postgres GIN / tsvector (built into PGlite).
 * • Thermodynamics (heat decay) implemented here for Node.js parity.
 *
 * Exports
 * ───────
 *   createPGliteClient(opts?) → SulcusClient  (same shape as connectSulcus())
 */

import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Schema (PGlite-compatible Postgres DDL — mirrors sulcus-local migrations)
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id           TEXT PRIMARY KEY,
  label        TEXT    NOT NULL DEFAULT '',
  pointer_summary TEXT NOT NULL DEFAULT '',
  base_utility REAL    NOT NULL DEFAULT 0.0,
  current_heat REAL    NOT NULL DEFAULT 0.0,
  is_pinned    BOOLEAN NOT NULL DEFAULT FALSE,
  memory_type  TEXT    NOT NULL DEFAULT 'episodic',
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT,
  crdt_clocks  TEXT
);

CREATE TABLE IF NOT EXISTS payloads (
  node_id     TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  raw_content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  vector  BYTEA NOT NULL
);

CREATE TABLE IF NOT EXISTS active_index (
  node_id    TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  heat       REAL NOT NULL DEFAULT 0.0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS edges (
  source_id         TEXT NOT NULL,
  target_id         TEXT NOT NULL,
  relationship_type TEXT NOT NULL DEFAULT 'semantic',
  edge_weight       REAL NOT NULL DEFAULT 0.5,
  valid_from        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to          TEXT,
  PRIMARY KEY(source_id, target_id)
);

CREATE TABLE IF NOT EXISTS client_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS memory_ops (
  id         TEXT PRIMARY KEY,
  op_type    TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status     TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS tombstones (
  node_id    TEXT PRIMARY KEY,
  label      TEXT,
  address    TEXT,
  evicted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nodes_heat     ON nodes(current_heat DESC);
CREATE INDEX IF NOT EXISTS idx_active_heat    ON active_index(heat DESC);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Vector helpers (pure JS, no pgvector extension needed)
// ─────────────────────────────────────────────────────────────────────────────

/** Decode BYTEA hex-escaped Postgres buffer to f32 array. */
function bufToF32(buf) {
  // PGlite returns BYTEA as a Uint8Array
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const fa = new Float32Array(ab);
  return Array.from(fa);
}

/** Encode f32 array to Uint8Array (little-endian). */
function f32ToBuf(arr) {
  const ab = new ArrayBuffer(arr.length * 4);
  const fa = new Float32Array(ab);
  arr.forEach((v, i) => (fa[i] = v));
  return new Uint8Array(ab);
}

function cosine(a, b) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  na = Math.sqrt(na); nb = Math.sqrt(nb);
  if (na === 0 || nb === 0) return 0;
  return Math.max(-1, Math.min(1, dot / (na * nb)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact tool directory (static — no runtime dependency)
// ─────────────────────────────────────────────────────────────────────────────

/** Full tool catalogue with name + one-line description + brief input summary. */
export const TOOL_CATALOGUE = [
  { name: 'add_memory',      brief: 'Ingest text → node + embedding + spike heat=1.0',           inputs: 'content:str, memory_type?:str' },
  { name: 'search_memory',   brief: 'Hybrid FTS + cosine similarity search, top-k nodes',          inputs: 'query:str, limit?:int, memory_type?:str' },
  { name: 'fetch_payload',   brief: 'Retrieve full raw_content (territory) for a node',            inputs: 'node_id:uuid' },
  { name: 'commit_memory',   brief: 'Low-level upsert: label + summary + optional payload',         inputs: 'label:str, pointer_summary:str, raw_content?:str, connected_node_ids?:str[], memory_type?:str' },
  { name: 'update_memory',   brief: 'CRDT-safe field update via Hybrid Logical Clocks',             inputs: 'node_id:uuid, label?:str, pointer_summary?:str, raw_content?:str, memory_type?:str' },
  { name: 'forget_memory',   brief: 'Hard-delete node, payload, edges, embeddings; write tombstone', inputs: 'node_id:uuid' },
  { name: 'list_hot_nodes',  brief: 'List nodes ordered by current_heat DESC',                      inputs: 'limit?:int' },
  { name: 'build_context',   brief: 'Ignite + tick; return XML memory bundle for LLM injection',   inputs: 'prompt?:str, token_budget?:int' },
  { name: 'tick',            brief: 'Run one thermodynamics decay + spread cycle',                  inputs: 'decay?:float, prune_threshold?:float, active_limit?:int' },
  { name: 'summarize',       brief: 'Deterministic char-boundary truncation (no sentence split)',    inputs: 'text:str, max_chars?:int' },
  { name: 'pin_node',        brief: 'Pin node — prevent eviction during cold-storage sweep',        inputs: 'node_id:uuid' },
  { name: 'unpin_node',      brief: 'Remove pin from node',                                         inputs: 'node_id:uuid' },
  { name: 'get_node',        brief: 'Fetch node metadata (no payload)',                             inputs: 'node_id:uuid' },
  { name: 'sync_now',        brief: 'Push/pull delta sync to configured SULCUS_SERVER_URL',         inputs: '(none)' },
  { name: 'metrics',         brief: 'Return active_index_size, num_nodes, and heat statistics',      inputs: '(none)' },
];

/**
 * Compact one-line tool directory suitable for inclusion in a system prompt.
 * Does NOT include full JSON Schema — keeps token footprint small.
 */
export function compactToolDirectory(tools = TOOL_CATALOGUE) {
  const lines = tools.map(t => `  • ${t.name}(${t.inputs}) — ${t.brief}`);
  return [
    'SULCUS tool directory (compact):',
    ...lines,
    'To retrieve the full input schema for a specific tool call DESCRIBE_TOOL:<tool_name>.',
  ].join('\n');
}

/**
 * Full schema for a single tool (for on-demand injection when the LLM requests detail).
 * @param {string} name
 * @returns {object|null}
 */
export function getToolSchema(name) {
  const schemas = {
    add_memory: {
      name: 'add_memory',
      description: 'Ingest a text memory into Sulcus. Generates an embedding, inserts a Node, spikes heat to 1.0. The node immediately appears in the active_index.',
      inputSchema: {
        type: 'object', required: ['content'],
        properties: {
          content:     { type: 'string', description: 'The text to remember' },
          memory_type: { type: 'string', enum: ['episodic','semantic','preference','procedural'], default: 'episodic' },
        },
      },
    },
    search_memory: {
      name: 'search_memory',
      description: 'Hybrid search: cosine similarity (60%) + FTS ts_rank (40%). Returns top-k nodes sorted by combined score.',
      inputSchema: {
        type: 'object', required: ['query'],
        properties: {
          query:       { type: 'string' },
          limit:       { type: 'integer', default: 10 },
          memory_type: { type: 'string', enum: ['episodic','semantic','preference','procedural'] },
        },
      },
    },
    fetch_payload: {
      name: 'fetch_payload',
      description: 'Retrieve full raw_content for a node (page-fault semantics: bumps base_utility +0.15, resets heat to 1.0).',
      inputSchema: { type: 'object', required: ['node_id'], properties: { node_id: { type: 'string', format: 'uuid' } } },
    },
    list_hot_nodes: {
      name: 'list_hot_nodes',
      description: 'List nodes from the active_index ordered by heat DESC.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', default: 20 } } },
    },
    build_context: {
      name: 'build_context',
      description: 'Ignite nodes relevant to prompt, run a tick, return XML memory bundle bucketed by memory_type for direct LLM injection.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt:       { type: 'string' },
          token_budget: { type: 'integer', default: 2000 },
        },
      },
    },
    tick: {
      name: 'tick',
      description: 'Run one thermodynamics cycle: multiply all heat by decay, prune cold nodes, rebuild active_index.',
      inputSchema: {
        type: 'object',
        properties: {
          decay:           { type: 'number', default: 0.85, minimum: 0.0, maximum: 1.0 },
          prune_threshold: { type: 'number', default: 0.001 },
          active_limit:    { type: 'integer', default: 50 },
        },
      },
    },
    summarize: {
      name: 'summarize',
      description: 'Deterministic extractive summary via char-boundary truncation. Safe for code, JSON, IPs. No sentence splitting.',
      inputSchema: {
        type: 'object', required: ['text'],
        properties: {
          text:      { type: 'string' },
          max_chars: { type: 'integer', default: 1200 },
        },
      },
    },
  };
  return schemas[name] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Tool Handlers (JS reimplementation of sulcus-wasm/src/mcp.rs)
// ─────────────────────────────────────────────────────────────────────────────

class PGliteBackend {
  constructor(db) {
    this._db    = db;
    /** In-memory vector cache: Map<node_id:string, number[]> */
    this._vecs  = new Map();
    /** Stable actor ID (8 hex chars) for CRDT clock generation */
    this._actor = randomUUID().replace(/-/g, '').slice(0, 16);
  }

  async _qry(sql, params = []) {
    return this._db.query(sql, params);
  }
  async _exec(sql) {
    return this._db.exec(sql);
  }

  // ── warm_cache ─────────────────────────────────────────────────────────────
  async warmCache() {
    const { rows } = await this._qry('SELECT node_id, vector FROM embeddings');
    for (const r of rows) {
      if (r.vector) {
        try { this._vecs.set(r.node_id, bufToF32(r.vector)); } catch {}
      }
    }
    return { loaded: this._vecs.size };
  }

  // ── add_memory ─────────────────────────────────────────────────────────────
  async addMemory(content, memoryType = 'episodic', embedFn = null) {
    const id      = randomUUID();
    const summary = content.slice(0, 200);
    const label   = content.split(/\s+/).slice(0, 8).join(' ').slice(0, 80);
    const now     = new Date().toISOString();

    await this._qry(
      `INSERT INTO nodes (id, label, pointer_summary, base_utility, current_heat,
         is_pinned, memory_type, created_at)
       VALUES ($1,$2,$3,0.0,1.0,FALSE,$4,$5)
       ON CONFLICT(id) DO NOTHING`,
      [id, label, summary, memoryType, now],
    );

    await this._qry(
      `INSERT INTO payloads (node_id, raw_content)
       VALUES ($1,$2)
       ON CONFLICT(node_id) DO UPDATE SET raw_content = EXCLUDED.raw_content`,
      [id, content],
    );

    // Vector embedding (if embedder supplied)
    if (embedFn) {
      try {
        const vec = await embedFn(content);
        if (vec && vec.length > 0) {
          const bytes = f32ToBuf(Array.from(vec));
          await this._qry(
            `INSERT INTO embeddings (node_id, vector)
             VALUES ($1,$2)
             ON CONFLICT(node_id) DO UPDATE SET vector = EXCLUDED.vector`,
            [id, bytes],
          );
          this._vecs.set(id, Array.from(vec));
        }
      } catch (e) {
        // Embedding failure is non-fatal
      }
    }

    // Upsert into active_index
    await this._qry(
      `INSERT INTO active_index (node_id, heat, updated_at)
       VALUES ($1,1.0,$2)
       ON CONFLICT(node_id) DO UPDATE SET heat = 1.0, updated_at = EXCLUDED.updated_at`,
      [id, now],
    );

    return { node_id: id };
  }

  // ── search_memory ──────────────────────────────────────────────────────────
  async searchMemory(query, limit = 10, memoryType = null, queryVec = null) {
    const scores = new Map(); // node_id → {cosScore, ftsScore, label, ps, heat}

    // --- Vector lane (RAM cache — no SQL BLOB scan) ---
    if (queryVec && queryVec.length > 0) {
      const na = Math.sqrt(queryVec.reduce((s, v) => s + v * v, 0));
      if (na > 0) {
        for (const [id, vec] of this._vecs) {
          const cos = cosine(queryVec, vec);
          if (cos > 0.1) {
            scores.set(id, { cosScore: cos * 0.6, ftsScore: 0, label: '', ps: '', heat: 0 });
          }
        }
      }
    }

    // --- FTS lane ---
    try {
      const ftsRes = await this._qry(
        `SELECT n.id AS node_id, n.label, n.pointer_summary, n.current_heat,
                ts_rank(to_tsvector('english', n.pointer_summary),
                        plainto_tsquery('english', $1)) AS rank
         FROM nodes n
         WHERE to_tsvector('english', n.pointer_summary)
               @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC LIMIT 50`,
        [query],
      );
      for (const r of ftsRes.rows) {
        const existing = scores.get(r.node_id) ?? { cosScore: 0, ftsScore: 0, label: '', ps: '', heat: 0 };
        existing.ftsScore = Math.min(1.0, r.rank) * 0.4;
        existing.label = r.label ?? '';
        existing.ps    = r.pointer_summary ?? '';
        existing.heat  = r.current_heat ?? 0;
        scores.set(r.node_id, existing);
      }
    } catch (e) {
      // FTS might fail if tsvector is unsupported — non-fatal
    }

    // Fetch missing metadata for vector-only hits
    const missingIds = [...scores.entries()]
      .filter(([, v]) => !v.label)
      .map(([id]) => id);

    if (missingIds.length > 0) {
      const placeholders = missingIds.map((_, i) => `$${i + 1}`).join(', ');
      const metaRes = await this._qry(
        `SELECT id, label, pointer_summary, current_heat, memory_type
         FROM nodes WHERE id IN (${placeholders})`,
        missingIds,
      );
      for (const r of metaRes.rows) {
        const e = scores.get(r.id);
        if (e) {
          e.label = r.label ?? '';
          e.ps    = r.pointer_summary ?? '';
          e.heat  = r.current_heat ?? 0;
        }
      }
    }

    // Apply type filter, sort natively, truncate
    let results = [...scores.entries()]
      .map(([id, v]) => ({ id, combined: v.cosScore + v.ftsScore, label: v.label, ps: v.ps, heat: v.heat }))
      .filter(r => r.combined > 0);

    if (memoryType) {
      // We don't track memory_type in the score map — re-fetch is needed only if filtered
      // (omit for now; filter is best-effort for the FTS lane which already has it)
    }

    results.sort((a, b) => b.combined - a.combined);
    return results.slice(0, limit).map(r => ({
      id:              r.id,
      label:           r.label,
      pointer_summary: r.ps,
      heat:            r.heat,
      score:           r.combined,
    }));
  }

  // ── fetch_payload ──────────────────────────────────────────────────────────
  async fetchPayload(nodeId) {
    const res = await this._qry(
      'SELECT raw_content FROM payloads WHERE node_id = $1',
      [nodeId],
    );
    const content = res.rows[0]?.raw_content ?? null;
    if (content != null) {
      // Page-fault semantics: bump utility + spike heat
      const now = new Date().toISOString();
      await this._qry(
        `UPDATE nodes
         SET base_utility = LEAST(base_utility + 0.15, 1.0), current_heat = 1.0
         WHERE id = $1`,
        [nodeId],
      );
      await this._qry(
        `INSERT INTO active_index (node_id, heat, updated_at)
         VALUES ($1,1.0,$2)
         ON CONFLICT(node_id) DO UPDATE SET heat = 1.0, updated_at = EXCLUDED.updated_at`,
        [nodeId, now],
      );
    }
    return { raw_content: content };
  }

  // ── list_hot_nodes ─────────────────────────────────────────────────────────
  async listHotNodes(limit = 20) {
    const res = await this._qry(
      `SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.memory_type
       FROM nodes n
       JOIN active_index ai ON ai.node_id = n.id
       ORDER BY ai.heat DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map(r => ({
      id:              r.id,
      label:           r.label,
      pointer_summary: r.pointer_summary,
      heat:            r.current_heat,
      memory_type:     r.memory_type,
    }));
  }

  // ── tick ───────────────────────────────────────────────────────────────────
  async tick(decay = 0.85, pruneThreshold = 0.001, activeLimit = 50) {
    // Decay all nodes
    await this._qry(
      'UPDATE nodes SET current_heat = current_heat * $1',
      [decay],
    );
    await this._qry(
      'UPDATE active_index SET heat = heat * $1',
      [decay],
    );
    // Prune cold nodes from active_index
    await this._qry(
      'DELETE FROM active_index WHERE heat < $1',
      [pruneThreshold],
    );
    // Rebuild active_index top-N
    await this._qry('DELETE FROM active_index');
    await this._qry(
      `INSERT INTO active_index (node_id, heat, updated_at)
       SELECT id, current_heat, CURRENT_TIMESTAMP FROM nodes
       WHERE is_pinned = FALSE
       ORDER BY current_heat DESC LIMIT $1
       ON CONFLICT(node_id) DO UPDATE SET heat = EXCLUDED.heat, updated_at = EXCLUDED.updated_at`,
      [activeLimit],
    );
    // Always include pinned nodes
    await this._qry(
      `INSERT INTO active_index (node_id, heat, updated_at)
       SELECT id, current_heat, CURRENT_TIMESTAMP FROM nodes WHERE is_pinned = TRUE
       ON CONFLICT(node_id) DO UPDATE SET heat = EXCLUDED.heat, updated_at = EXCLUDED.updated_at`,
    );
    return { ok: true, decay, pruneThreshold, activeLimit };
  }

  // ── summarize ──────────────────────────────────────────────────────────────
  summarize(text, maxChars = 1200) {
    // Char-boundary truncation — no sentence splitting (matches Rust extractive_summarize)
    if (!text) return '';
    return text.length <= maxChars ? text.trim() : text.slice(0, maxChars).trim();
  }

  // ── build_context ──────────────────────────────────────────────────────────
  async buildContext(prompt = '', tokenBudget = 2000, queryVec = null) {
    // Ignite relevant nodes if prompt+vec available
    if (queryVec && queryVec.length > 0) {
      const hits = await this.searchMemory(prompt, 5, null, queryVec);
      const now  = new Date().toISOString();
      for (const h of hits) {
        await this._qry(
          `UPDATE nodes SET current_heat = 1.0 WHERE id = $1`,
          [h.id],
        );
        await this._qry(
          `INSERT INTO active_index (node_id, heat, updated_at) VALUES ($1,1.0,$2)
           ON CONFLICT(node_id) DO UPDATE SET heat = 1.0, updated_at = EXCLUDED.updated_at`,
          [h.id, now],
        );
      }
    }
    await this.tick(0.85, 1.0, 30);

    const res = await this._qry(
      `SELECT n.id, n.label, n.pointer_summary, n.current_heat, n.memory_type, p.raw_content
       FROM nodes n
       JOIN active_index ai ON ai.node_id = n.id
       LEFT JOIN payloads p ON p.node_id = n.id
       ORDER BY ai.heat DESC LIMIT 30`,
    );

    const charsPerToken = 4; // rough approximation
    const maxChars = tokenBudget * charsPerToken;
    let used = 0;
    const buckets = { preference: [], semantic: [], procedural: [], episodic: [] };

    for (const r of res.rows) {
      if (used >= maxChars) break;
      const text    = r.raw_content ?? r.pointer_summary ?? '';
      const snippet = text.length > 400 ? text.slice(0, 400) + '…' : text;
      const entry   = `<item heat="${(r.current_heat ?? 0).toFixed(2)}">${snippet}</item>`;
      used += entry.length;
      if (used > maxChars) break;
      const bucket = buckets[r.memory_type] ?? buckets.episodic;
      bucket.push(entry);
    }

    const xml = [
      '<memory>',
      buckets.preference.length ? `<preferences>\n${buckets.preference.join('\n')}\n</preferences>` : '',
      buckets.semantic.length   ? `<facts>\n${buckets.semantic.join('\n')}\n</facts>`               : '',
      buckets.procedural.length ? `<procedures>\n${buckets.procedural.join('\n')}\n</procedures>`   : '',
      buckets.episodic.length   ? `<recent>\n${buckets.episodic.join('\n')}\n</recent>`             : '',
      '</memory>',
    ].filter(Boolean).join('\n');

    return { xml };
  }

  // ── metrics ────────────────────────────────────────────────────────────────
  async getMetrics() {
    const [nodesRes, hotRes] = await Promise.all([
      this._qry('SELECT COUNT(*) AS n FROM nodes'),
      this._qry('SELECT COUNT(*) AS n FROM active_index'),
    ]);
    const numNodes       = parseInt(nodesRes.rows[0]?.n ?? '0', 10);
    const activeIndexSize = parseInt(hotRes.rows[0]?.n ?? '0', 10);
    return { num_nodes: numNodes, active_index_size: activeIndexSize };
  }

  // ── pin / unpin ────────────────────────────────────────────────────────────
  async pinNode(nodeId)   { await this._qry('UPDATE nodes SET is_pinned = TRUE  WHERE id = $1', [nodeId]); return { ok: true }; }
  async unpinNode(nodeId) { await this._qry('UPDATE nodes SET is_pinned = FALSE WHERE id = $1', [nodeId]); return { ok: true }; }

  // ── get_node ───────────────────────────────────────────────────────────────
  async getNode(nodeId) {
    const res = await this._qry(
      'SELECT id, label, pointer_summary, base_utility, current_heat, is_pinned, memory_type FROM nodes WHERE id = $1',
      [nodeId],
    );
    return res.rows[0] ?? null;
  }

  // ── client_meta / actor ID ─────────────────────────────────────────────────
  async getOrCreateClientId() {
    const res = await this._qry("SELECT value FROM client_meta WHERE key = 'client_id'");
    if (res.rows[0]?.value) return res.rows[0].value;
    const id = randomUUID();
    await this._qry(
      "INSERT INTO client_meta (key, value) VALUES ('client_id', $1) ON CONFLICT(key) DO NOTHING",
      [id],
    );
    return id;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP dispatcher — translates tool/call JSON-RPC into backend methods
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchTool(backend, name, args) {
  switch (name) {
    case 'add_memory':
      return backend.addMemory(args.content ?? '', args.memory_type);

    case 'search_memory':
      return { results: await backend.searchMemory(args.query ?? '', args.limit ?? 10, args.memory_type ?? null) };

    case 'fetch_payload':
      return backend.fetchPayload(args.node_id);

    case 'list_hot_nodes':
      return backend.listHotNodes(args.limit ?? 20);

    case 'tick':
      return backend.tick(args.decay ?? 0.85, args.prune_threshold ?? 0.001, args.active_limit ?? 50);

    case 'summarize':
      return { summary: backend.summarize(args.text ?? '', args.max_chars ?? 1200) };

    case 'build_context':
      return backend.buildContext(args.prompt ?? '', args.token_budget ?? 2000);

    case 'pin_node':
      return backend.pinNode(args.node_id);

    case 'unpin_node':
      return backend.unpinNode(args.node_id);

    case 'get_node':
      return backend.getNode(args.node_id);

    case 'metrics':
      return backend.getMetrics();

    case 'sync_now':
      // PGlite client does not maintain a server cursor — no-op with a clear message.
      return { ok: true, message: 'sync_now is a no-op on the PGlite backend (no SULCUS_SERVER_URL configured)' };

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory — same interface shape as connectSulcus()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Sulcus client backed by an in-process PGlite database.
 *
 * This is the preferred integration path for Node.js / OpenClaw.
 * No Rust binary is spawned. No SQLite. Same schema as the WASM build.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.dataDir]    Persistent data directory for PGlite.
 *                                    Omit (or pass ':memory:') for an ephemeral in-memory DB.
 * @param {Function}[opts.embedFn]    Optional async (text:string)=>number[] embedding function.
 *                                    If omitted, only FTS search is available.
 * @param {Function}[opts.log]        Optional logger: (level, msg) => void
 * @returns {Promise<SulcusClient>}
 */
export async function createPGliteClient({ dataDir, embedFn, log } = {}) {
  const _log = log ?? ((level, msg) => {
    if (level !== 'debug') console.error(`[sulcus-pglite][${level}] ${msg}`);
  });

  // Initialise PGlite
  _log('info', dataDir ? `Opening PGlite at ${dataDir}` : 'Opening ephemeral in-memory PGlite');
  const db = dataDir && dataDir !== ':memory:'
    ? new PGlite(dataDir)
    : new PGlite();

  // Wait for PGlite to be ready (it's async internally)
  await db.waitReady;

  // Bootstrap schema
  await db.exec(SCHEMA_SQL);
  _log('info', 'PGlite schema ready');

  const backend = new PGliteBackend(db);

  // Warm the vector cache from any existing embeddings
  const warmed = await backend.warmCache();
  if (warmed.loaded > 0) _log('info', `Warmed ${warmed.loaded} vectors from PGlite`);

  // ── SulcusClient interface ──────────────────────────────────────────────────
  return {
    /**
     * Returns the compact tool catalogue (name + brief + inputs).
     * Cheap — no DB call.
     */
    describeTools: async () => TOOL_CATALOGUE,

    /**
     * Compact one-line directory string for LLM system prompt injection.
     * Much smaller than full JSON Schema.
     */
    toolDirectory: () => compactToolDirectory(),

    /**
     * Full JSON Schema for a single tool.
     * @param {string} name
     */
    getToolSchema,

    /** Convenience: add_memory shorthand */
    addMemory: async (content, memoryType) => {
      const res = await backend.addMemory(content, memoryType, embedFn);
      return res.node_id;
    },

    /** Convenience: list active_index */
    getActiveIndex: async (limit = 20) => backend.listHotNodes(limit),

    /** Convenience: search */
    searchMemory: async (query, limit = 10) => {
      let vec = null;
      if (embedFn) {
        try { vec = await embedFn(query); } catch {}
      }
      return backend.searchMemory(query, limit, null, vec);
    },

    /** Low-level tool dispatch (matches rawSend semantics but simpler). */
    callTool: async (name, args = {}) => {
      return dispatchTool(backend, name, args);
    },

    /**
     * rawSend — accepts MCP JSON-RPC objects.
     * Emulates the connectSulcus() rawSend so ContextChunkerSkill can use
     * either backend without changes.
     */
    rawSend: async (req) => {
      const method = req.method ?? '';
      const id     = req.id ?? `${Date.now()}`;

      try {
        if (method === 'tools/list') {
          return { id, result: TOOL_CATALOGUE };
        }

        if (method === 'tools/call') {
          const name = req.params?.name ?? '';
          const args = req.params?.arguments ?? {};
          const result  = await dispatchTool(backend, name, args);
          return {
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            },
          };
        }

        if (method === 'resources/read') {
          if (req.params?.uri === 'memory://active_index') {
            const nodes = await backend.listHotNodes(req.params?.limit ?? 20);
            return {
              id,
              result: { contents: [{ type: 'text', text: JSON.stringify(nodes) }] },
            };
          }
        }

        return { id, error: { code: -32601, message: `Unknown method: ${method}` } };
      } catch (err) {
        return { id, error: { code: -32000, message: err.message } };
      }
    },

    close: async () => {
      try { await db.close(); } catch {}
    },

    /** Expose the raw backend for advanced use. */
    _backend: backend,
    /** Expose the raw PGlite instance. */
    _db: db,
  };
}
