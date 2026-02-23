/**
 * @sulcus/pglite-server — Public API
 *
 * Unified PGlite database layer for Sulcus that adapts to the runtime:
 *
 *   Browser / VS Code web extension
 *     → PGlite with IndexedDB storage (browser localStorage)
 *     → Persistent across page reloads, no filesystem access needed
 *
 *   OpenClaw / local models (Node.js / native binary)
 *     → PGlite with node-fs filesystem storage
 *     → Full SQL, persisted to disk, zero external dependencies
 *
 *   Tests / ephemeral agents
 *     → PGlite in-memory (no storage backend)
 *
 * The Rust sulcus-local and sulcus-server processes connect via the standard
 * PostgreSQL wire protocol (port 5433 by default) — the same sqlx PgPool
 * they use for real Postgres works unchanged.
 *
 * ## Quick start (Node.js)
 *
 * ```ts
 * import { SulcusPGlite } from '@sulcus/pglite-server';
 *
 * // Filesystem storage — survives restarts (OpenClaw / local models)
 * const db = await SulcusPGlite.start({ storage: 'fs:./data/sulcus' });
 *
 * // Browser / VS Code — IndexedDB
 * const db = await SulcusPGlite.start({ storage: 'idb' });
 *
 * // Connect from Rust: SULCUS_DATABASE_URL=postgres://sulcus@127.0.0.1:5433/sulcus
 * ```
 */

export { createPGlite, resolveDataDir } from "./storage.js";
export { runMigrations } from "./migrate.js";
export { startServer } from "./server.js";
export type { ServerOptions, SulcusPGliteServer } from "./server.js";
export type { MigrationTarget } from "./migrate.js";

import { createPGlite } from "./storage.js";
import { runMigrations, type MigrationTarget } from "./migrate.js";
import { startServer, type ServerOptions } from "./server.js";
import type { PGlite } from "@electric-sql/pglite";

// ---------------------------------------------------------------------------
// High-level facade
// ---------------------------------------------------------------------------

export interface SulcusPGliteOptions {
  /**
   * Storage backend specification.
   *
   * - `"memory"`       — in-process, no persistence (default)
   * - `"idb"`          — IndexedDB (browser / VS Code web extension)
   * - `"idb:<dbname>"` — IndexedDB with a custom database name
   * - `"fs:<dir>"`     — Node.js filesystem (OpenClaw / local models)
   */
  storage?: string;

  /**
   * Which schema to migrate.
   * - `"local"`  — vMMU + node graph (default, for sulcus-local)
   * - `"server"` — golden index + WAL (for sulcus-server running on PGlite)
   */
  schema?: MigrationTarget;

  /** TCP port for the PostgreSQL wire-protocol server. Default 5433. */
  port?: number;

  /** Host to bind to. Default "127.0.0.1". */
  host?: string;

  /**
   * Start the wire-protocol TCP server so Rust clients can connect.
   * Set to false if you only need the programmatic API (e.g., in tests).
   * Default: true.
   */
  serve?: boolean;
}

export interface SulcusPGliteHandle {
  /** Direct access to the PGlite instance for programmatic queries. */
  db: PGlite;

  /** Connection string for Rust / sqlx clients. */
  connectionString: string;

  /** Stop the TCP server (if started) and close the database. */
  close(): Promise<void>;
}

/**
 * Start a fully-configured Sulcus PGlite instance:
 *   1. Opens PGlite with the requested storage backend.
 *   2. Runs SQL migrations (idempotent).
 *   3. Optionally starts a PostgreSQL wire-protocol TCP server.
 *
 * @example
 * // OpenClaw — filesystem, server mode
 * const handle = await SulcusPGlite.start({ storage: 'fs:./data', schema: 'local' });
 * // env var for Rust: SULCUS_DATABASE_URL=handle.connectionString
 *
 * @example
 * // Browser — IndexedDB, no TCP server (in-process only)
 * const handle = await SulcusPGlite.start({ storage: 'idb', serve: false });
 */
export const SulcusPGlite = {
  async start(opts: SulcusPGliteOptions = {}): Promise<SulcusPGliteHandle> {
    const {
      storage = "memory",
      schema = "local",
      port = 5433,
      host = "127.0.0.1",
      serve = true,
    } = opts;

    // 1. Create the PGlite instance with the requested storage backend.
    const db = await createPGlite(storage);

    // 2. Run migrations (idempotent — safe to call on every startup).
    await runMigrations(db, schema);

    const connectionString = `postgres://sulcus@${host}:${port}/sulcus`;

    if (!serve) {
      return {
        db,
        connectionString: "(in-process only — TCP server not started)",
        async close() {
          await db.close();
        },
      };
    }

    // 3. Start the PostgreSQL wire-protocol TCP server.
    const server = await startServer(db, { port, host });

    return {
      db,
      connectionString,
      async close() {
        await server.close();
        await db.close();
      },
    };
  },
};
