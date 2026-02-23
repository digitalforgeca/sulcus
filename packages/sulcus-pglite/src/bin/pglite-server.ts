#!/usr/bin/env node
/**
 * sulcus-pglite CLI — starts a PGlite server exposing the PostgreSQL wire protocol
 *
 * Usage:
 *   node dist/bin/pglite-server.js [options]
 *
 * Options:
 *   --storage=<spec>   Storage backend (default: "memory")
 *                        memory          — in-process, no persistence
 *                        idb             — IndexedDB (browser / VS Code web)
 *                        idb:<name>      — IndexedDB with custom DB name
 *                        fs:<dir>        — Node.js filesystem (OpenClaw)
 *   --schema=<target>  Migration schema to apply (default: "local")
 *                        local           — vMMU + node graph (sulcus-local)
 *                        server          — golden index + WAL (sulcus-server)
 *   --port=<n>         TCP port (default: 5433)
 *   --host=<addr>      Bind address (default: 127.0.0.1)
 *   --help             Print this help and exit
 *
 * Environment variables (override defaults):
 *   SULCUS_STORAGE      Storage spec (e.g. "fs:./data/sulcus")
 *   SULCUS_SCHEMA       Migration target ("local" or "server")
 *   SULCUS_BIND_ADDR    Bind address as host:port (default 127.0.0.1:5433)
 *   SULCUS_DATABASE_URL  If set, connection string is printed to match this
 *
 * Exit signals:
 *   SIGTERM / SIGINT closes the server gracefully.
 *
 * The Rust process should wait for the line:
 *   [sulcus-pglite] ready port=<N>
 * before connecting.
 */

import { SulcusPGlite } from "../index.js";
import type { MigrationTarget } from "../migrate.js";

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of argv.slice(2)) {
    if (arg === "--help" || arg === "-h") {
      result["help"] = "1";
    } else if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      result[key] = rest.join("=") || "1";
    }
  }
  return result;
}

function printHelp() {
  console.log(`
sulcus-pglite — PGlite server for Sulcus

USAGE
  sulcus-pglite [--storage=<spec>] [--schema=<target>] [--port=<n>] [--host=<addr>]

STORAGE SPECS
  memory          In-process only, no persistence (default)
  idb             IndexedDB — browser / VS Code web extension
  idb:<name>      IndexedDB with custom database name
  fs:<dir>        Filesystem — OpenClaw / local models (e.g. fs:./data/sulcus)

SCHEMAS
  local           vMMU + node graph schema (for sulcus-local, default)
  server          Golden index + server WAL schema (for sulcus-server)

EXAMPLES
  # OpenClaw: filesystem-backed, local schema, default port 5433
  sulcus-pglite --storage=fs:./data/sulcus

  # Browser apps: IDB storage, no TCP server needed (use programmatic API)
  # See @sulcus/pglite-server npm package

  # CI tests: in-memory, server schema
  sulcus-pglite --storage=memory --schema=server --port=5434

RUST CONNECTION
  After startup, set SULCUS_DATABASE_URL=postgres://sulcus@127.0.0.1:<port>/sulcus
`);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args["help"]) {
    printHelp();
    process.exit(0);
  }

  const storage = args["storage"] ?? process.env["SULCUS_STORAGE"] ?? "memory";
  const schema = (args["schema"] ??
    process.env["SULCUS_SCHEMA"] ??
    "local") as MigrationTarget;
  const bindAddr = process.env["SULCUS_BIND_ADDR"] ?? "127.0.0.1:5433";
  const colonIdx = bindAddr.lastIndexOf(":");
  let host =
    args["host"] ?? (colonIdx >= 0 ? bindAddr.slice(0, colonIdx) : "127.0.0.1");
  let port = parseInt(
    args["port"] ?? (colonIdx >= 0 ? bindAddr.slice(colonIdx + 1) : "5433"),
    10,
  );

  console.log(`[sulcus-pglite] starting storage=${storage} schema=${schema}`);

  const handle = await SulcusPGlite.start({ storage, schema, port, host });

  // Signal to the parent process (Rust binary or scripts) that we are ready.
  // The Rust startup code looks for this exact line.
  console.log(`[sulcus-pglite] ready port=${port}`);
  console.log(`[sulcus-pglite] SULCUS_DATABASE_URL=${handle.connectionString}`);

  // Print the connection string to stdout for easy shell integration:
  //   export SULCUS_DATABASE_URL=$(sulcus-pglite --storage=fs:./data | grep SULCUS_DATABASE_URL | cut -d= -f2-)
  process.stdout.write(
    `export SULCUS_DATABASE_URL=${handle.connectionString}\n`,
  );

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[sulcus-pglite] shutting down...");
    await handle.close();
    process.exit(0);
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  // Keep the process alive (the TCP server is already listening).
}

main().catch((err) => {
  console.error("[sulcus-pglite] fatal error:", err);
  process.exit(1);
});
