# OpenClaw → Sulcus Integration

## Purpose

This document describes how to integrate OpenClaw (or any agent) with the **local Sulcus sidecar** using the Model Context Protocol (MCP) over stdio. All examples call the _real_ `sulcus` binary and persist data to a local PostgreSQL-compatible backend — no mocks.

> **Note:** This doc covers the local binary's MCP tool surface (`record_memory`, `search_memory`, etc.).
> For the **cloud MCP server** tool surface (`sulcus_remember`, `sulcus_search`, etc.),
> see [`integrations/mcp-server/README.md`](integrations/mcp-server/README.md).

## Quick summary (1‑line)

Run `sulcus` as a sidecar, exchange line-delimited JSON MCP requests on stdin/stdout, and use Sulcus' `active_index` to augment prompts and store memories.

## Why this is useful

- Sulcus provides a persistent local memory the agent can query and update live.
- Use `active_index` (hot nodes) as short-term context to improve relevance and reduce hallucinations.
- Works offline and stores real results in PGlite/Postgres-compatible storage for reproducibility and audits.

## Protocol (MCP) — message examples

- Request (discover tools):

```json
{ "jsonrpc": "2.0", "id": "t1", "method": "tools/list" }
```

- Request (record memory):

```json
{
  "jsonrpc": "2.0",
  "id": "m1",
  "method": "tools/call",
  "params": {
    "name": "record_memory",
    "arguments": {
      "content": "user: fixed bug in auth",
      "fold_name": "default"
    }
  }
}
```

- Request (fetch active index resource):

```json
{
  "jsonrpc": "2.0",
  "id": "r1",
  "method": "resources/read",
  "params": { "uri": "memory://active_index", "limit": 5 }
}
```

Each request is a single JSON line; each response is a single JSON line.

## Quickstart — run a live example (5 minutes)

1. Build and run Sulcus sidecar (real, persistent DB):

```bash
cargo build -p sulcus
# uses SULCUS_DATABASE_URL env var (or embedded local mode if unset)
cargo run -p sulcus -- serve
# or with an explicit URL:
SULCUS_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:4201/postgres cargo run -p sulcus -- serve
```

2. Try the Node/OpenClaw examples (they spawn the _real_ sidecar):

```bash
cd tools/openclaw-integration
npm install
npm run test:node        # validates OpenClaw package + Sulcus Node MCP example
npm run example:openclaw # small OpenClaw-style prompt-augmentation demo
```

3. Run Rust integration tests (also exercise live sidecar behavior):

```bash
cargo test -p sulcus --test openclaw_integration -- --nocapture
```

## Developer integration patterns

- Spawn `sulcus` as a child process and keep it running for the agent session.
- Use `tools/list` at startup to discover supported methods.
- Record important events with `tools/call` → `record_memory`.
- Before generating, fetch `memory://active_index` and prepend the top-N entries to your prompt.
- After generation, record the assistant reply with `record_memory`.

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

- Rust integration: `crates/sulcus/tests/openclaw_integration.rs` — spawns `sulcus` and verifies MCP methods.
- Runtime tests: `crates/sulcus/tests/runtime.rs` — verifies `SULCUS_DATABASE_URL` connection handling + thermodynamics worker.
- Node harness: `tools/openclaw-integration/mcp-test.mjs` and `openclaw-example.mjs` — useful for rapid local dev and manual QA.

## Security & safety

- Sulcus persists memory in PostgreSQL. Point `SULCUS_DATABASE_URL` at any Postgres instance (local or remote).
- Do NOT ship API keys or secrets into stored memory unless you encrypt them; Sulcus persists whatever you write.

## Troubleshooting

- Database connection errors → either unset `SULCUS_DATABASE_URL` to use embedded local mode, or point it to a reachable PostgreSQL-compatible DSN.
- Node harness timeouts → ensure `cargo build -p sulcus` completed and `node` is available.

## Best practices for agents (OpenClaw usage)

- Record conversational turns as memories (`user:` / `assistant:`) so Sulcus can track context and heat.
- Use `active_index` (top-20) for short-term retrieval; rely on semantic search for larger recall when available.
- Mark ephemeral or private data with a tag (not implemented as a first-class field yet) and avoid persisting secrets.

## Files & reference

- `crates/sulcus/src/mcp.rs` — MCP handlers (live stdio protocol)
- `tools/openclaw-integration/mcp-test.mjs` — Node validation harness
- `tools/openclaw-integration/openclaw-example.mjs` — example showing prompt augmentation
- `crates/sulcus/tests/openclaw_integration.rs` — Rust end-to-end test
- `crates/sulcus/tests/runtime.rs` — DB-path handling + worker tests

## Next steps (recommended)

- Convert `openclaw-example.mjs` into a small helper library / npm package for plugin authors.
- Add a short `sulcus` plugin scaffolding for OpenClaw to reduce integration friction.

If you want, I can add the npm helper now (exports: `startSulcusSidecar()`, `mcpRequest()`, `getActiveIndex()`).

To utilize SULCUS without destroying Anthropic's Key-Value Prompt Cache, the agent Orchestrator MUST assemble the prompt exactly as follows:

[STATIC BLOCK - CACHED]
<system_instructions>
You are an autonomous agent. You have a Semantic vMMU attached via MCP.
Look at your <active_memory_index> below. If you need the exact syntax or raw data of a node, call `fetch_payload(node_id)`.
[... insert all standard agent rules and tools here ...]
</system_instructions>
<chat_history>
[... insert static conversation history here ...]
</chat_history>

<cache_control type="ephemeral" />

<active_memory_index>
[ {"id": "123", "label": "auth", "pointer_summary": "AWS VPC keys..." }, ... ]
</active_memory_index>

<user_prompt>
"Execute the database migration."
</user_prompt>
