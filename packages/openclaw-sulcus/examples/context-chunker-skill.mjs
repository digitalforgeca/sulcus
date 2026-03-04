/**
 * context-chunker-skill.mjs
 *
 * OpenClaw skill: split an arbitrarily-large context into digestible chunks and
 * feed each slice to a local LLM (Ollama / any OpenAI-compatible endpoint).
 *
 * Design contract
 * ───────────────
 *  • No chunk ever exceeds `chunkChars` characters (default 12 000 ≈ safe for
 *    a 32-k-token Qwen2.5 window with room left for the system prompt).
 *  • Chunks are cut on natural boundaries (paragraph → sentence → hard) so
 *    the model never receives a sliced word.
 *  • A small overlap region (200 chars) bridges consecutive chunks to avoid
 *    losing cross-boundary context.
 *  • Every chunk result is stored in Sulcus via `add_memory` so the agent's
 *    thermodynamics engine keeps the most-relevant pieces warm.
 *  • The final answer is assembled from all chunk responses by a reduce pass
 *    (another LLM call that merges partial answers into one coherent reply).
 *
 * Usage (standalone)
 * ──────────────────
 *   import { connectSulcus }         from './openclaw-plugin.mjs';
 *   import { ContextChunkerSkill }   from './context-chunker-skill.mjs';
 *
 *   const sulcus  = await connectSulcus({ autoSpawn: true });
 *   const chunker = new ContextChunkerSkill(sulcus, {
 *     llmBaseUrl: 'http://localhost:11434/v1',   // Ollama default
 *     llmModel:   'qwen2.5',
 *   });
 *
 *   const result = await chunker.ask(
 *     'Summarise the security vulnerabilities in this codebase',
 *     massiveCodeContext,
 *   );
 *   console.log(result.answer);
 */

import https from 'https';
import http from 'http';

// ── Tool directory helpers ────────────────────────────────────────────────────

/**
 * Build a compact tool directory string from the tool catalogue.
 * Accepts either:
 *   • an array of { name, brief?, description?, inputs? } objects  (PGlite backend)
 *   • an array of { name, description } objects                    (Rust MCP backend)
 *
 * Output is intentionally terse — models get full schemas via describeToolForModel().
 *
 * @param {object[]} tools
 * @returns {string}
 */
export function buildToolDirectory(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return '';
  const lines = tools.map((t) => {
    const sig  = t.inputs ? `(${t.inputs})` : '';
    const desc = (t.brief ?? t.description ?? '').split('\n')[0].slice(0, 100);
    return `  • ${t.name}${sig} — ${desc}`;
  });
  return [
    '═══ SULCUS Tool Directory (compact) ═══',
    ...lines,
    '─'.repeat(40),
    'Use DESCRIBE_TOOL:<tool_name> if you need the full parameter schema for a tool.',
    '════════════════════════════════════════',
  ].join('\n');
}

/**
 * Return the full JSON Schema for a named tool, as a formatted string.
 * Falls back gracefully if the client does not expose getToolSchema().
 *
 * @param {object} sulcusClient
 * @param {string} toolName
 * @returns {Promise<string>}
 */
export async function describeToolForModel(sulcusClient, toolName) {
  // PGlite backend exposes getToolSchema() directly
  if (typeof sulcusClient.getToolSchema === 'function') {
    const schema = sulcusClient.getToolSchema(toolName);
    return schema ? JSON.stringify(schema, null, 2) : `Tool "${toolName}" not found.`;
  }
  // Rust MCP backend — send a tools/list and filter
  try {
    const res = await sulcusClient.rawSend({ method: 'tools/list' });
    const tools = Array.isArray(res?.result) ? res.result : (res?.result?.tools ?? []);
    const tool  = tools.find(t => t.name === toolName);
    return tool ? JSON.stringify(tool, null, 2) : `Tool "${toolName}" not found.`;
  } catch {
    return `Could not retrieve schema for "${toolName}".`;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_CHARS   = 12_000;   // ~3 k tokens for Qwen2.5-72B
const DEFAULT_OVERLAP_CHARS = 200;      // tail overlap to preserve seam context
const DEFAULT_TIMEOUT_MS    = 90_000;   // per chunk LLM call

// ── Low-level HTTP helper (no dependencies) ───────────────────────────────────

/**
 * POST JSON to an OpenAI-compatible `/v1/chat/completions` endpoint.
 * Returns the assistant content string.
 *
 * @param {string}   baseUrl      e.g. 'http://localhost:11434/v1'
 * @param {string}   model        e.g. 'qwen2.5'
 * @param {object[]} messages     OpenAI messages array
 * @param {number}   [timeoutMs]
 * @returns {Promise<string>}
 */
function llmCall(baseUrl, model, messages, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const url    = new URL('/v1/chat/completions', baseUrl);
    const body   = JSON.stringify({ model, messages, stream: false });
    const lib    = url.protocol === 'https:' ? https : http;
    const opts   = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const timer = setTimeout(() => {
      req.destroy(new Error(`LLM call timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const req = lib.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return reject(new Error(`LLM API error: ${JSON.stringify(parsed.error)}`));
          }
          resolve(parsed.choices?.[0]?.message?.content ?? '');
        } catch (e) {
          reject(new Error(`LLM parse error: ${e.message} — raw: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// ── Text splitter ────────────────────────────────────────────────────────────

/**
 * Split `text` into chunks of at most `maxChars` characters.
 * Priority order for split points:
 *   1. Double newline (paragraph boundary)
 *   2. Single newline
 *   3. '. ' / '! ' / '? ' (sentence boundary)
 *   4. Last space (word boundary)
 *   5. Hard cut (character boundary — last resort)
 *
 * Adjacent chunks share `overlapChars` characters from the end of the
 * previous chunk to preserve seam context.
 *
 * @param {string} text
 * @param {number} [maxChars=DEFAULT_CHUNK_CHARS]
 * @param {number} [overlapChars=DEFAULT_OVERLAP_CHARS]
 * @returns {string[]}
 */
export function splitChunks(text, maxChars = DEFAULT_CHUNK_CHARS, overlapChars = DEFAULT_OVERLAP_CHARS) {
  if (!text || text.length === 0) return [];
  if (text.length <= maxChars) return [text];

  const chunks = [];
  let pos = 0;

  while (pos < text.length) {
    let end = Math.min(pos + maxChars, text.length);

    if (end < text.length) {
      // Try to cut at a natural boundary, searching backwards from `end`
      const slice = text.slice(pos, end);

      const tryBreakAt = (pattern, minSearch) => {
        const idx = slice.lastIndexOf(pattern, minSearch ?? slice.length);
        return idx > 0 ? idx + pattern.length : -1;
      };

      let cutAt = -1;
      if (cutAt < 0) cutAt = tryBreakAt('\n\n');
      if (cutAt < 0) cutAt = tryBreakAt('\n');
      if (cutAt < 0) cutAt = tryBreakAt('. ');
      if (cutAt < 0) cutAt = tryBreakAt('! ');
      if (cutAt < 0) cutAt = tryBreakAt('? ');
      if (cutAt < 0) cutAt = tryBreakAt(' ');

      if (cutAt > 0) {
        end = pos + cutAt;
      }
      // else: hard cut at pos+maxChars (already set)
    }

    chunks.push(text.slice(pos, end));

    // Once we've consumed to the end of the text, stop.
    if (end >= text.length) break;

    // Advance with overlap so the next chunk sees the tail of this one.
    // Always move forward by at least 1 char to guarantee termination.
    pos = Math.max(pos + 1, end - overlapChars);
  }

  return chunks;
}

// ── Skill class ───────────────────────────────────────────────────────────────

export class ContextChunkerSkill {
  /**
   * @param {object} sulcusClient    Result of connectSulcus()
   * @param {object} [opts]
   * @param {string} [opts.llmBaseUrl='http://localhost:11434/v1']
   * @param {string} [opts.llmModel='qwen2.5']
   * @param {number} [opts.chunkChars=12000]
   * @param {number} [opts.overlapChars=200]
   * @param {number} [opts.timeoutMs=90000]
   * @param {boolean} [opts.storeChunksInMemory=true]  Save each chunk answer to Sulcus
   * @param {Function} [opts.log]
   */
  constructor(sulcusClient, opts = {}) {
    this._client   = sulcusClient;
    this._baseUrl  = opts.llmBaseUrl    ?? 'http://localhost:11434/v1';
    this._model    = opts.llmModel      ?? 'qwen2.5';
    this._maxChars = opts.chunkChars    ?? DEFAULT_CHUNK_CHARS;
    this._overlap  = opts.overlapChars  ?? DEFAULT_OVERLAP_CHARS;
    this._timeout  = opts.timeoutMs     ?? DEFAULT_TIMEOUT_MS;
    this._store    = opts.storeChunksInMemory !== false;
    this._log      = opts.log ?? ((level, msg, meta) => {
      const ts = new Date().toISOString();
      console.error(`[chunker][${level}] ${ts} ${msg}`, meta ? JSON.stringify(meta) : '');
    });
    /** Cached compact tool directory string (fetched once per instance). */
    this._toolDir  = null;
  }

  // ── Tool directory ──────────────────────────────────────────────────────────

  /**
   * Fetch and cache the compact tool directory for this client.
   * This is injected once into every chunk's system prompt so the model always
   * knows what tools are available WITHOUT the full JSON Schema consuming tokens.
   *
   * Tools and context are kept strictly separate:
   *   • System prompt  = role + compact tool directory (stable, small)
   *   • User messages  = context chunk + question     (variable, large)
   *
   * @returns {Promise<string>}
   */
  async getToolDirectory() {
    if (this._toolDir) return this._toolDir;
    try {
      let tools;
      // PGlite / native backend exposes describeTools() directly
      if (typeof this._client.describeTools === 'function') {
        tools = await this._client.describeTools();
      } else {
        // Rust MCP backend — send tools/list JSON-RPC
        const res = await this._client.rawSend({ method: 'tools/list' });
        tools = Array.isArray(res?.result) ? res.result : (res?.result?.tools ?? []);
      }
      this._toolDir = buildToolDirectory(Array.isArray(tools) ? tools : []);
    } catch (e) {
      this._log('warn', `Could not fetch tool list: ${e.message}`);
      this._toolDir = '';
    }
    return this._toolDir;
  }

  /**
   * Get the full schema for a named tool, formatted as a string.
   * @param {string} name
   * @returns {Promise<string>}
   */
  async getToolSchema(name) {
    return describeToolForModel(this._client, name);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Ask a question about a (potentially large) context.
   *
   * If the context fits in one chunk it is sent as-is.
   * If it's too large, it is split and each chunk is processed independently;
   * the partial answers are then consolidated by a final LLM merge call.
   *
   * @param {string} question     The user's question / instruction
   * @param {string} context      Arbitrarily large context text
   * @param {object} [opts]
   * @param {string} [opts.systemPrompt]  Override default system prompt
   * @param {number} [opts.maxChars]      Per-chunk size override
   * @returns {Promise<{
   *   answer:       string,        // Final merged answer
   *   chunks:       number,        // How many chunks were used
   *   chunkAnswers: string[],      // Raw per-chunk responses
   *   nodeIds:      string[],      // Sulcus node IDs stored (if storeChunksInMemory)
   * }>}
   */
  async ask(question, context, opts = {}) {
    const maxChars = opts.maxChars ?? this._maxChars;
    const chunks   = splitChunks(context, maxChars, this._overlap);

    // Fetch compact tool directory once — injected into system prompt, not chunks.
    // This separates "what tools exist" from "what is the document context".
    // Full schemas are available on demand via getToolSchema(name).
    const toolDir     = await this.getToolDirectory();
    const systemPrompt = opts.systemPrompt ?? this._buildSystem(question, toolDir);

    this._log('info', `ask(): ${chunks.length} chunk(s) for ${context.length} chars`, {
      model: this._model,
      question: question.slice(0, 80),
    });

    if (chunks.length === 0) {
      return { answer: '', chunks: 0, chunkAnswers: [], nodeIds: [] };
    }

    // ── Single chunk — pass through, no merge overhead ─────────────────────
    if (chunks.length === 1) {
      const answer  = await this._callChunk(question, chunks[0], systemPrompt, 1, 1);
      const nodeIds = this._store ? [await this._storeResult(question, answer, 1, 1)] : [];
      return { answer, chunks: 1, chunkAnswers: [answer], nodeIds };
    }

    // ── Multi-chunk — process each, then merge ─────────────────────────────
    const chunkAnswers = [];
    const nodeIds      = [];

    for (let i = 0; i < chunks.length; i++) {
      const partialAnswer = await this._callChunk(question, chunks[i], systemPrompt, i + 1, chunks.length);
      chunkAnswers.push(partialAnswer);
      this._log('info', `chunk ${i + 1}/${chunks.length} done`, { chars: chunks[i].length });

      if (this._store) {
        const nid = await this._storeResult(question, partialAnswer, i + 1, chunks.length);
        nodeIds.push(nid);
      }
    }

    const answer = await this._mergeChunkAnswers(question, chunkAnswers);

    if (this._store) {
      const nid = await this._storeResult(question, answer, 0 /* merged */, chunks.length);
      if (nid) nodeIds.push(nid);
    }

    return { answer, chunks: chunks.length, chunkAnswers, nodeIds };
  }

  /**
   * Summarise a large text using the Sulcus `summarize` MCP tool for short
   * texts and chunked LLM summarisation for anything larger.
   *
   * @param {string} text
   * @param {number} [targetChars=1200]
   * @returns {Promise<string>}
   */
  async summarise(text, targetChars = 1200) {
    // Short text — delegate to Sulcus deterministic extractive summariser
    if (text.length <= this._maxChars) {
      try {
        const res = await this._client.rawSend({
          method: 'tools/call',
          params: { name: 'summarize', arguments: { text, max_chars: targetChars } },
        });
        const inner = this._unwrapText(res, 'summarize');
        return inner.summary ?? inner;
      } catch {
        // fall through to LLM path
      }
    }

    // Large text — chunk and ask LLM to summarise each piece, then merge
    return this.ask(
      `Produce a concise summary of the following text in at most ${targetChars} characters.`,
      text,
      {
        systemPrompt: 'You are a precise summariser. Return only the summary, no preamble.',
      },
    ).then((r) => r.answer);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Build the system prompt.
   *
   * Tool directory is embedded here (once, in the system role) so it does NOT
   * count against the per-chunk context budget. Each content chunk is purely
   * context text + question — no tool boilerplate repeated per chunk.
   *
   * @param {string} question
   * @param {string} toolDir   Compact tool directory string (may be empty)
   * @returns {string}
   */
  _buildSystem(question, toolDir = '') {
    const parts = [
      'You are a helpful assistant with access to Sulcus memory tools and context provided in chunks.',
      'Answer the user\'s question using only the provided context.',
      'If the context does not contain enough information, say so explicitly.',
      'Be concise and factual.',
    ];
    if (toolDir) {
      parts.push(
        '',
        toolDir,
        '',
        'If you need to invoke a Sulcus tool to answer a question, state:',
        '  TOOL_CALL: {"name": "<tool_name>", "arguments": {<args>}}',
        'If you need the full parameter schema for a tool, state:',
        '  DESCRIBE_TOOL:<tool_name>',
      );
    }
    return parts.join('\n');
  }

  /** @deprecated Use _buildSystem() */
  _defaultSystem(question) {
    return this._buildSystem(question, '');
  }

  async _callChunk(question, chunk, systemPrompt, chunkIdx, totalChunks) {
    const chunkLabel = totalChunks > 1
      ? `\n[Context chunk ${chunkIdx} of ${totalChunks}]\n`
      : '\n[Context]\n';

    const messages = [
      { role: 'system',    content: systemPrompt },
      { role: 'user',      content: `${chunkLabel}${chunk}\n\n[Question]\n${question}` },
    ];

    try {
      return await llmCall(this._baseUrl, this._model, messages, this._timeout);
    } catch (err) {
      this._log('warn', `chunk ${chunkIdx}/${totalChunks} LLM call failed: ${err.message}`);
      return `[chunk ${chunkIdx} error: ${err.message}]`;
    }
  }

  async _mergeChunkAnswers(question, partialAnswers) {
    this._log('info', `merging ${partialAnswers.length} partial answers`);

    const combinedPartials = partialAnswers
      .map((a, i) => `--- Partial answer ${i + 1} ---\n${a}`)
      .join('\n\n');

    const messages = [
      {
        role: 'system',
        content: [
          'You are a synthesis assistant.',
          'Merge the following partial answers (each based on a different segment of a long context) into one coherent, non-redundant final answer.',
          'Preserve all distinct facts. Remove exact duplicates. Do not add information not present in the partials.',
        ].join(' '),
      },
      {
        role: 'user',
        content: `Original question: "${question}"\n\n${combinedPartials}\n\nFinal merged answer:`,
      },
    ];

    try {
      return await llmCall(this._baseUrl, this._model, messages, this._timeout);
    } catch (err) {
      this._log('warn', `merge call failed: ${err.message} — returning concat`);
      return partialAnswers.join('\n\n---\n\n');
    }
  }

  async _storeResult(question, answer, chunkIdx, totalChunks) {
    const label = chunkIdx === 0
      ? `[merged] ${question.slice(0, 60)}`
      : `[chunk ${chunkIdx}/${totalChunks}] ${question.slice(0, 50)}`;

    const content = `Q: ${question}\n\nA (${chunkIdx === 0 ? 'merged' : `chunk ${chunkIdx}/${totalChunks}`}):\n${answer}`;

    try {
      const res = await this._client.rawSend({
        method:  'tools/call',
        params:  {
          name:      'add_memory',
          arguments: { content, label },
        },
      });
      const inner = this._unwrapText(res, 'add_memory');
      return inner?.node_id ?? inner;
    } catch (err) {
      this._log('warn', `failed to store chunk result in Sulcus: ${err.message}`);
      return null;
    }
  }

  _unwrapText(res, toolName) {
    const content = res?.result?.content;
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error(`${toolName}: unexpected MCP response shape`);
    }
    const text = content[0]?.text ?? '';
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

// ── Convenience factory ───────────────────────────────────────────────────────

/**
 * Create a ContextChunkerSkill attached to an existing sulcus client.
 *
 * @param {object} sulcusClient  Result of connectSulcus()
 * @param {object} [opts]        Same as ContextChunkerSkill constructor
 * @returns {ContextChunkerSkill}
 */
export function createChunkerSkill(sulcusClient, opts = {}) {
  return new ContextChunkerSkill(sulcusClient, opts);
}
