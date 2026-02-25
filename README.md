# Sulcus — Persistent Memory for Every AI Agent 🤖🧠

## In one sentence

Sulcus is a local-first Memory-as-a-Service sidecar: it remembers text (PGlite/Postgres-compatible + vectors) and answers realtime requests from any AI agent over the **Model Context Protocol (MCP)**.

## Works with every major LLM framework ✅

| Platform                                 | Integration              |                                                                 |
| ---------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| **Claude** (Anthropic)                   | Native MCP — zero config | [guide →](INTEGRATIONS.md#1-claude-desktop-1-click)             |
| **GPT-4o / o3** (OpenAI)                 | Function calling         | [guide →](INTEGRATIONS.md#3-openai-gpt-function-calling-python) |
| **Gemini** (Google)                      | Function calling         | [guide →](INTEGRATIONS.md#4-google-gemini-python)               |
| **Llama / Mistral / Qwen** (Ollama)      | 100% local, no cloud     | [guide →](INTEGRATIONS.md#9-ollama--local-models)               |
| **LangChain**                            | StructuredTool adapter   | [guide →](INTEGRATIONS.md#5-langchain-python)                   |
| **LlamaIndex**                           | FunctionTool adapter     | [guide →](INTEGRATIONS.md#6-llamaindex-python)                  |
| **AutoGen / AG2**                        | RegisterFunction         | [guide →](INTEGRATIONS.md#7-autogen--ag2-python)                |
| **Vercel AI SDK**                        | `tool()` adapter         | [guide →](INTEGRATIONS.md#8-vercel-ai-sdk-typescript)           |
| **Cursor / Cline / Windsurf / Continue** | MCP config               | [config →](tools/manifests/claude_mcp.json)                     |
| **Any language**                         | Raw JSON-RPC 2.0 stdio   | [guide →](INTEGRATIONS.md#11-raw-mcp-any-language)              |

Universal tool manifest (OpenAI function-calling JSON Schema): [`tools/manifests/openai_tools.json`](tools/manifests/openai_tools.json)

---

## How it works

```
Your LLM  ──tool_call──▶  sulcus-local  ──SQL──▶  PGlite/Postgres-compatible backend
               ◀──result───────────────────────────────────────────────────────
```

- **Stdio (local):** MCP over stdin/stdout — works as a subprocess next to any agent.
- **SSE (remote):** MCP over HTTP/SSE — works with web agents and multi-tenant teams.

## Key facts ✅

- Protocol: `MCP` (Model Context Protocol) — line-delimited JSON-RPC 2.0.
- Storage: local **PGlite/Postgres-compatible** database (real, persistent) — no mocks, no cloud required.
- Embeddings: local CPU inference via `fastembed` — works fully offline.
- Thermodynamics: memories have "heat"; hot nodes surface automatically, cold ones decay.
- Sync: optional delta sync to a SULCUS server for team collaboration.

---

## Quick start — run it locally (real, live) 🔧

1. Build the project:

```bash
cargo build -p sulcus-local
```

2. Run the local sidecar (encapsulated local mode, no DB setup required):

```bash
cargo run -p sulcus-local -- serve
```

Optional: to use an external PostgreSQL-compatible backend instead, set `SULCUS_DATABASE_URL` to a reachable DSN.
Default internal port mapping uses `420x` (`4201` for PGlite wire, `4203` for MCP SSE).

3. Run the Rust integration that simulates OpenClaw talking to Sulcus (live):

```bash
# runs the real sulcus-local binary and exchanges MCP JSON
cargo test -p sulcus-local --test openclaw_integration -- --nocapture
```

4. Node/OpenClaw examples (optional) — these spawn the real `sulcus-local` process and exercise real memory operations:

```bash
cd tools/openclaw-integration
npm install
npm run test:node        # Node harness that validates MCP over stdio
npm run example:openclaw # small example: fetch active_index, augment prompt, add memory
```

If the example prints `MCP validation passed` and shows the `active_index`, Sulcus and OpenClaw are talking for real. ✅

---

## Full integration guide

See [INTEGRATIONS.md](INTEGRATIONS.md) for complete, runnable examples for every LLM platform.

Ready-to-run examples in [`tools/integrations/`](tools/integrations/):

```bash
# Python (OpenAI, Anthropic, LangChain, LlamaIndex, AutoGen, Ollama)
pip install openai anthropic langchain langchain-openai ollama
python tools/integrations/openai_example.py
python tools/integrations/anthropic_example.py
python tools/integrations/ollama_example.py    # 100% local, no API key

# TypeScript (Vercel AI SDK)
npx tsx tools/integrations/vercel_ai_example.ts
```

Claude Desktop / Cursor / Cline / Windsurf — add to your MCP config:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus-local",
      "args": ["serve"]
    }
  }
}
```

See [`tools/manifests/claude_mcp.json`](tools/manifests/claude_mcp.json) for per-IDE templates.

---

## What the OpenClaw example does (real steps)

- Launches a live `sulcus-local` sidecar (via `cargo run` or the binary).
- Calls `describe_tools`, `add_memory`, and `resource (memory://active_index)` over MCP.
- Uses the returned `active_index` to build an augmented prompt and then records the assistant reply back into Sulcus.
- All operations are persisted in a PostgreSQL-compatible backend and exercised by integration tests — no fakes.

Files to look at:

- `crates/sulcus-local/src/mcp.rs` — MCP handlers (live stdio protocol)
- `crates/sulcus-local/tests/openclaw_integration.rs` — Rust integration test (real sidecar)
- `crates/sulcus-local/tests/runtime.rs` — runtime tests including DB connection handling
- `tools/openclaw-integration/mcp-test.mjs` — Node harness (drives live sidecar)
- `tools/openclaw-integration/openclaw-example.mjs` — small OpenClaw-like prompt-augmentation example

---

## Important: this is _live_ and _persistent_ — not mocked ⚠️

- Tests and examples spawn the actual `sulcus-local` binary and connect to a real PostgreSQL-compatible backend. Memory entries you add are written to the DB and read back.
- Runtime default is encapsulated local PGlite. For tests that require a dedicated external DB, set `SULCUS_DATABASE_URL`; those tests skip gracefully if it is not set.

---

## Troubleshooting tips

- If `sulcus-local` fails to start in default mode:
  - Ensure `node` and `npm` are available (used to bootstrap `packages/sulcus-pglite`).
  - Retry with `cargo run -p sulcus-local -- serve`.
- If using `SULCUS_DATABASE_URL`, ensure that DSN is reachable (recommended internal default: `postgres://sulcus@127.0.0.1:4201/sulcus`); `sulcus-local` will not silently fall back when an explicit URL is configured.
- If Node harness times out: ensure `cargo build -p sulcus-local` has been run and `node` is available.

---

## Next ideas (suggested)

- Convert `openclaw-example.mjs` into a tiny helper module for real OpenClaw plugins. 💡
- Add automated e2e coverage in CI (optional — not required right now).

---

If you'd like, I can now: 1) make the example a reusable npm helper, or 2) add a short `OpenClaw` README with copy/paste prompts for agents. Which do you want next? 🔁
