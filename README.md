# Sulcus — Local Memory sidecar for AI agents 🤖🧠

## In one sentence (for grown-ups)

Sulcus is a tiny local service that _remembers text_ (SQLite + vectors) and answers realtime requests from agents (MCP over stdio). It stores real memories in a real database and is used live by agents such as OpenClaw.

## Explain Like I'm 5 ✨

- Sulcus is a little box that remembers things for your robot buddy (OpenClaw).
- The robot asks Sulcus questions using simple messages, and Sulcus answers from its real notebook — not make-believe.
- When the robot learns something, it tells Sulcus and Sulcus writes it down so it won't forget.

## Key facts (short) ✅

- Communication: `MCP` (Model Context Protocol) — line-delimited JSON on `stdin` / `stdout`.
- Storage: local **SQLite** database (real, persistent files) — no mocks.
- Sidecar: run `sulcus-local` as a subprocess next to your agent (OpenClaw example provided).
- Tested: Rust unit/integration tests exercise the live DB + thermodynamics engine.

---

## Quick start — run it locally (real, live) 🔧

1. Build the project:

```bash
cargo build -p sulcus-local
```

2. Run the local sidecar (it will create `~/.sulcus/memory.db` by default):

```bash
# use default path (~/.sulcus/memory.db)
cargo run -p sulcus-local -- serve

# OR: use a custom Postgres URL
SULCUS_DATABASE_URL=postgres://sulcus:sulcus@localhost/sulcus cargo run -p sulcus-local -- serve
```

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

## What the OpenClaw example does (real steps)

- Launches a live `sulcus-local` sidecar (via `cargo run` or the binary).
- Calls `describe_tools`, `add_memory`, and `resource (memory://active_index)` over MCP.
- Uses the returned `active_index` to build an augmented prompt and then records the assistant reply back into Sulcus.
- All operations are persisted in SQLite and exercised by integration tests — no fakes.

Files to look at:

- `crates/sulcus-local/src/mcp.rs` — MCP handlers (live stdio protocol)
- `crates/sulcus-local/tests/openclaw_integration.rs` — Rust integration test (real sidecar)
- `crates/sulcus-local/tests/runtime.rs` — runtime tests including DB-path handling
- `tools/openclaw-integration/mcp-test.mjs` — Node harness (drives live sidecar)
- `tools/openclaw-integration/openclaw-example.mjs` — small OpenClaw-like prompt-augmentation example

---

## Important: this is _live_ and _persistent_ — not mocked ⚠️

- Tests and examples spawn the actual `sulcus-local` binary and connect to a real PostgreSQL database. Memory entries you add are written to the DB and read back.
- Set `SULCUS_DATABASE_URL` to point at a test database; tests skip gracefully if it is not set.

---

## Troubleshooting tips

- If `sulcus-local` fails to connect to Postgres:
  - Ensure PostgreSQL is running and `SULCUS_DATABASE_URL` is set correctly.
  - Try `SULCUS_DATABASE_URL=postgres://sulcus:sulcus@localhost/sulcus cargo run -p sulcus-local -- serve`.
- If Node harness times out: ensure `cargo build -p sulcus-local` has been run and `node` is available.

---

## Next ideas (suggested)

- Convert `openclaw-example.mjs` into a tiny helper module for real OpenClaw plugins. 💡
- Add automated e2e coverage in CI (optional — not required right now).

---

If you'd like, I can now: 1) make the example a reusable npm helper, or 2) add a short `OpenClaw` README with copy/paste prompts for agents. Which do you want next? 🔁
