# Development Guide

## Prerequisites

- Rust (latest stable).
- `sqlx-cli`: `cargo install sqlx-cli`
- Docker (for running the local Postgres dev instance).

## 1. Booting the Local Brain (Open Source)

This runs the single-player CLI.

```bash
# Initialize local PostgreSQL-compatible DB
cd crates/sulcus-local
export SULCUS_DATABASE_URL=postgres://sulcus:sulcus@127.0.0.1:5433/sulcus_test
sqlx migrate run --database-url "$SULCUS_DATABASE_URL"
```

# Run the MCP Server

cargo run --bin sulcus-local

## 2. Booting the Cloud Brain (SaaS)

This runs the multi-tenant API.

Bash

# Start Postgres

docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres

# Run Migrations (server)

cd crates/sulcus-server
sqlx migrate run --database-url postgres://postgres:password@localhost:5432/sulcus_test

# Start the Server (Postgres-backed)

# enable server binary feature if needed (server-bin is default for cargo run in this repo)

cargo run -p sulcus-server --features server-bin

# Local-demo CLI commands (sulcus-local)

# seed a demo memory, rebuild active_index and print it

cargo run -p sulcus-local -- demo

# record an ADD memory op

cargo run -p sulcus-local -- add-memory "note summary" 42.0

# list local WAL memory_ops

cargo run -p sulcus-local -- list-ops

# show local active_index

cargo run -p sulcus-local -- show-active

# one-shot sync to configured SULCUS_SERVER_URL

export SULCUS_SERVER_URL="http://localhost:3000"
export SULCUS_API_KEY="test-key"
cargo run -p sulcus-local -- sync-now

# OpenClaw example clients (Node / Python)

# Node example (spawns sulcus-local and exercises MCP)

node crates/sulcus-local/examples/openclaw-node/index.js $(which sulcus-local)

# Python example

python3 crates/sulcus-local/examples/openclaw-python/openclaw_client.py $(which sulcus-local)

# Run integration tests that exercise the example clients

cargo test -p sulcus-local --test openclaw_examples

3. Testing the "Hard Line"
   To verify the Thermodynamics engine is working:

Run cargo test -p sulcus-core.

Check the test_spreading_activation unit test.

Ensure that heating "Node A" correctly increases the heat of "Node B" via the edge weight.
