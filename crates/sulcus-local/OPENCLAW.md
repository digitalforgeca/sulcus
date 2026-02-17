OpenClaw integration (stdio / MCP)

## Overview

Sulcus exposes a small, deterministic Model Context Protocol (MCP) over line-delimited JSON on stdin/stdout. OpenClaw (or any agent) can integrate by spawning `sulcus-local` as a sidecar and exchanging JSON requests/responses.

Why stdio/MCP?

- Simple, language-agnostic (works from Node, Python, Rust, etc.)
- Deterministic: `describe_tools`, `add_memory`, `summarize`, `resource` are supported
- Offline-first: no network required for local memory

## Quick example (Node.js)

```js
const { spawn } = require("child_process");
const cp = spawn("sulcus-local", ["serve"], {
  env: { ...process.env, SULCUS_DB_PATH: "/tmp/sulcus-openclaw.db" },
});

cp.stdout.setEncoding("utf8");
cp.stdout.on("data", (data) => {
  for (const line of data.split("\n").filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      console.log("MCP response", msg);
    } catch (err) {
      console.error("non-json:", line);
    }
  }
});

// add memory
cp.stdin.write(
  JSON.stringify({
    id: "1",
    method: "add_memory",
    params: { content: "User said: hello" },
  }) + "\n",
);

// query active index
cp.stdin.write(
  JSON.stringify({
    id: "2",
    method: "resource",
    params: { resource: "memory://active_index", limit: 10 },
  }) + "\n",
);
```

## Shell example (quick test)

Send a JSON request and read the JSON response using `jq`:

```sh
printf '%s\n' '{"id":"t","method":"describe_tools"}' | sulcus-local serve | jq '.'
```

## MCP methods supported

- `describe_tools` → returns JSON manifest (tools list)
- `add_memory` → params: `{ content: string }` → returns `{ node_id }`
- `summarize` → params: `{ text, max_chars }` → returns `{ summary }`
- `resource` (memory://active_index) → returns hot nodes array

## Configuration file (INI)

You can provide runtime configuration via an optional INI file. Precedence is:
`environment variables` > `CLI args` > `INI file` > `defaults`.

Default locations checked (in order):

- path from `SULCUS_CONFIG` env var
- `$XDG_CONFIG_HOME/sulcus/sulcus.ini` (commonly `~/.config/sulcus/sulcus.ini`)
- `~/.sulcus/sulcus.ini`
- `/etc/sulcus/sulcus.ini`

Example `sulcus.ini`:

[sulcus]

# where to store the SQLite DB (overridden by SULCUS_DB_PATH env)

db_path = /home/me/.sulcus/memory.db

# thermodynamics tick interval in ms

therm_interval_ms = 60000

# thermodynamics tuning parameters (optional)

decay = 0.85
prune_threshold = 1.0
active_limit = 50

# optional server sync settings (still require SULCUS_SERVER_URL to enable)

server_url = https://sulcus.example.com
server_api_key = sk-agent-XXX

## Tips to maximize OpenClaw memory capabilities

- Use a persistent `db_path` (not ephemeral) so OpenClaw's long-term memory survives restarts. ✅
- Increase `active_limit` if the agent needs a larger working set (higher short-term context). ⚠️
  - Metric: `active_index_size` — returned by `resource (memory://active_index)`; directly controlled by `active_limit`.
  - A larger `active_limit` increases the agent's recall coverage of recent memories (see test `openclaw_config_integration.rs`).
- Tune `decay` and `prune_threshold` to keep important nodes "hot" longer.
- Enable `SULCUS_SERVER_URL` + `SULCUS_API_KEY` for optional multi-device/team sync.
- Start `sulcus-local` as a long-lived subprocess and call `describe_tools` at startup to discover capabilities.

See `crates/sulcus-local/tests/openclaw_integration.rs` for an end-to-end MCP example.

## Examples (Node / Python)

We include two small example clients that act like OpenClaw and exercise the full MCP surface (see `crates/sulcus-local/examples`):

- `crates/sulcus-local/examples/openclaw-node/index.js` (Node.js)
- `crates/sulcus-local/examples/openclaw-python/openclaw_client.py` (Python)

Run them directly (they spawn `sulcus-local` as a subprocess and print `OPENCLAW-OK` on success):

node crates/sulcus-local/examples/openclaw-node/index.js $(which sulcus-local)
python3 crates/sulcus-local/examples/openclaw-python/openclaw_client.py $(which sulcus-local)

## Integration tips for OpenClaw

- Launch `sulcus-local` as a subprocess from your agent runtime and keep it running for the session.
- Exchange JSON lines (one request per line, one response per line).
- Use `describe_tools` at startup to inspect capabilities.
- Treat the `active_index` as the agent's short-term working memory.

## Tests

There are Rust integration tests that run the example clients and assert full MCP coverage:

cargo test -p sulcus-local --test openclaw_examples

The example clients exercise every MCP method implemented by `sulcus-local` (except `sync_now`, which requires a configured `SULCUS_SERVER_URL`).

## Security & sandboxing

- `sulcus-local` stores memory locally in SQLite by default (`~/.sulcus/memory.db`) unless `SULCUS_DB_PATH` is provided.
- For ephemeral sessions, point `SULCUS_DB_PATH` to a temp file or in-memory db.

If you want, I can add more language bindings or a packaged npm/python package for OpenClaw integration.
