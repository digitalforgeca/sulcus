# OpenClaw → Sulcus Integration

## Purpose

This document describes how to integrate OpenClaw (or any agent) with Sulcus using the Model Context Protocol (MCP) over stdio. All examples call the _real_ `sulcus-local` sidecar and persist data to SQLite — no mocks.

## Quick summary (1‑line)

Run `sulcus-local` as a sidecar, exchange line-delimited JSON MCP requests on stdin/stdout, and use Sulcus' `active_index` to augment prompts and store memories.

## Why this is useful

- Sulcus provides a persistent local memory the agent can query and update live.
- Use `active_index` (hot nodes) as short-term context to improve relevance and reduce hallucinations.
- Works offline and stores real results in SQLite for reproducibility and audits.

## Protocol (MCP) — message examples

- Request (describe tools):

```json
{ "id": "t1", "method": "describe_tools" }
```

- Request (add memory):

```json
{
  "id": "m1",
  "method": "add_memory",
  "params": { "content": "user: fixed bug in auth" }
}
```

- Request (fetch active index):

```json
{
  "id": "r1",
  "method": "resource",
  "params": { "resource": "memory://active_index", "limit": 5 }
}
```

Each request is a single JSON line; each response is a single JSON line.

## Quickstart — run a live example (5 minutes)

1. Build and run Sulcus sidecar (real, persistent DB):

```bash
cargo build -p sulcus-local
# default: ~/.sulcus/memory.db
cargo run -p sulcus-local -- serve
# or custom DB:
SULCUS_DB_PATH=./sulcus-test.db cargo run -p sulcus-local -- serve
```

2. Try the Node/OpenClaw examples (they spawn the _real_ sidecar):

```bash
cd tools/openclaw-integration
npm install
npm run test:node        # validates MCP: describe_tools, add_memory, resource
npm run example:openclaw # small OpenClaw-style prompt-augmentation demo
```

3. Run Rust integration tests (also exercise live sidecar behavior):

```bash
cargo test -p sulcus-local --test openclaw_integration -- --nocapture
```

## Developer integration patterns

- Spawn `sulcus-local` as a child process and keep it running for the agent session.
- Use `describe_tools` at startup to discover supported methods.
- Record important events as memories with `add_memory(content)` (heat defaults to 100.0).
- Before generating, fetch `memory://active_index` and prepend the top-N entries to your prompt.
- After generation, `add_memory` the assistant reply (keeps the memory graph consistent).

## Minimal Node example (see `openclaw-example.mjs`)

- Fetch `active_index` → insert into prompt → call model → record assistant reply.
- Full example: `tools/openclaw-integration/openclaw-example.mjs`.

## Prompt pattern recommendations (safe + deterministic)

- Always include a brief header that states "Use these memories to answer".
- Cite memory items by index to make provenance explicit:
  - "See memory 1, memory 2" or include the `id` if needed.
- Keep inserted memory summaries short (trim to 200 chars) — Sulcus stores short `summary` fields.

## Suggested prompt template

Use this template when augmenting the LLM input:

```
You are an assistant. Use the following relevant memories from Sulcus to answer the user's question.

Relevant memories:
1. <summary>
2. <summary>

User question:
<user question>

Answer concisely and cite memory items when relevant.
```

## Testing & validation

- Rust integration: `crates/sulcus-local/tests/openclaw_integration.rs` — spawns `sulcus-local` and verifies MCP methods.
- Runtime tests: `crates/sulcus-local/tests/runtime.rs` — verifies `SULCUS_DB_PATH` parent-dir/file handling + thermodynamics worker.
- Node harness: `tools/openclaw-integration/mcp-test.mjs` and `openclaw-example.mjs` — useful for rapid local dev and manual QA.

## Security & safety

- Sulcus stores local files (default `~/.sulcus/memory.db`). For ephemeral runs use `SULCUS_DB_PATH` pointed at a temp file.
- Do NOT ship API keys or secrets into stored memory unless you encrypt them; Sulcus persists whatever you write.

## Troubleshooting

- `unable to open database file` → ensure parent directory exists or use `SULCUS_DB_PATH` pointing to a writable path. `start_background` now auto-creates parent dirs and the file for custom paths.
- Node harness timeouts → ensure `cargo build -p sulcus-local` completed and `node` is available.

## Best practices for agents (OpenClaw usage)

- Record conversational turns as memories (`user:` / `assistant:`) so Sulcus can track context and heat.
- Use `active_index` (top-20) for short-term retrieval; rely on semantic search for larger recall when available.
- Mark ephemeral or private data with a tag (not implemented as a first-class field yet) and avoid persisting secrets.

## Files & reference

- `crates/sulcus-local/src/mcp.rs` — MCP handlers (live stdio protocol)
- `tools/openclaw-integration/mcp-test.mjs` — Node validation harness
- `tools/openclaw-integration/openclaw-example.mjs` — example showing prompt augmentation
- `crates/sulcus-local/tests/openclaw_integration.rs` — Rust end-to-end test
- `crates/sulcus-local/tests/runtime.rs` — DB-path handling + worker tests

## Next steps (recommended)

- Convert `openclaw-example.mjs` into a small helper library / npm package for plugin authors.
- Add a short `sulcus` plugin scaffolding for OpenClaw to reduce integration friction.

If you want, I can add the npm helper now (exports: `startSulcusSidecar()`, `mcpRequest()`, `getActiveIndex()`).
