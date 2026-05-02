OpenClaw integration (stdio / MCP)

## Overview

Sulcus exposes a small, deterministic Model Context Protocol (MCP) over line-delimited JSON on stdin/stdout. OpenClaw (or any agent) can integrate by spawning `sulcus` as a sidecar and exchanging JSON requests/responses.

Why stdio/MCP?

- Simple, language-agnostic (works from Node, Python, Rust, etc.)
- Deterministic: `tools/list`, `tools/call`, and `resources/read` are supported
- Offline-first: no network required for local memory

## Quick example (Node.js)

```js
const { spawn } = require("child_process");
const cp = spawn("sulcus", ["serve"], {
  env: {
    ...process.env,
    SULCUS_DATABASE_URL: "postgres://sulcus@127.0.0.1:4201/sulcus",
  },
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
    jsonrpc: "2.0",
    id: "1",
    method: "tools/call",
    params: {
      name: "record_memory",
      arguments: { content: "User said: hello", fold_name: "default" },
    },
  }) + "\n",
);

// query active index
cp.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: "2",
    method: "resources/read",
    params: { uri: "memory://active_index", limit: 10 },
  }) + "\n",
);
```

## Shell example (quick test)

Send a JSON request and read the JSON response using `jq`:

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":"t","method":"tools/list"}' | sulcus stdio | jq '.'
```

## MCP methods supported

- `tools/list` → returns tool manifest
- `tools/call` (`record_memory`) → params: `{ content, fold_name }` → returns `{ node_id }`
- `resources/read` (`memory://active_index`) → returns hot nodes array as JSON text

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

# PostgreSQL connection URL (overrides SULCUS_DATABASE_URL env var)

database_url = postgres://sulcus@127.0.0.1:4201/sulcus

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

- Use a persistent `SULCUS_DATABASE_URL` (or leave unset for embedded local mode) so OpenClaw memory survives restarts. ✅
- Increase `active_limit` if the agent needs a larger working set (higher short-term context). ⚠️
  - Metric: `active_index_size` — returned by `resource (memory://active_index)`; directly controlled by `active_limit`.
  - A larger `active_limit` increases the agent's recall coverage of recent memories (see test `openclaw_config_integration.rs`).
- Tune `decay` and `prune_threshold` to keep important nodes "hot" longer.
- Prometheus: enable the built-in exporter by setting `SULCUS_METRICS_ADDR` (for example `SULCUS_METRICS_ADDR=0.0.0.0:9101 sulcus serve`). Accepts `host:port` or bare port number.
  - Exposed metrics: `sulcus_active_index_size`, `sulcus_num_nodes`, `sulcus_memory_ops_total`, `sulcus_db_size_bytes`.
  - These metrics are also available programmatically via the MCP `metrics` method.
- Enable `SULCUS_SERVER_URL` + `SULCUS_API_KEY` for optional multi-device/team sync.
- Start `sulcus` as a long-lived subprocess and call `describe_tools` at startup to discover capabilities.

See `crates/sulcus/tests/openclaw_integration.rs` for an end-to-end MCP example.

## Examples (Node / Python)

We include two small example clients that act like OpenClaw and exercise the full MCP surface (see `crates/sulcus/examples`):

- `crates/sulcus/examples/openclaw-node/index.js` (Node.js)
- `crates/sulcus/examples/openclaw-python/openclaw_client.py` (Python)

Run them directly (they spawn `sulcus` as a subprocess and print `OPENCLAW-OK` on success):

node crates/sulcus/examples/openclaw-node/index.js $(which sulcus)
python3 crates/sulcus/examples/openclaw-python/openclaw_client.py $(which sulcus)

## Integration tips for OpenClaw

- Launch `sulcus` as a subprocess from your agent runtime and keep it running for the session.
- Exchange JSON lines (one request per line, one response per line).
- Use `tools/list` at startup to inspect capabilities.
- Treat the `active_index` as the agent's short-term working memory.

## Tests

There are Rust integration tests that run the example clients and assert full MCP coverage:

cargo test -p sulcus --test openclaw_examples

The example clients exercise every MCP method implemented by `sulcus` (except `sync_now`, which requires a configured `SULCUS_SERVER_URL`).

## Security & sandboxing

- `sulcus` stores memory in PostgreSQL. Set `SULCUS_DATABASE_URL` to point at your Postgres instance.
- For ephemeral sessions, point `SULCUS_DATABASE_URL` at a dedicated test database.

If you want, I can add more language bindings or a packaged npm/python package for OpenClaw integration.
