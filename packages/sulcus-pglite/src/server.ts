/**
 * sulcus-pglite — PostgreSQL wire-protocol TCP server wrapper
 *
 * Wraps `@electric-sql/pglite-server` to expose a PGlite instance on a TCP
 * port.  Rust clients (sulcus-local, sulcus-server) connect via the standard
 * PostgreSQL wire protocol: `postgres://sulcus@127.0.0.1:5433/sulcus`
 *
 * No authentication is configured by default because the server is intended
 * to bind to 127.0.0.1 only — never exposed to the public internet.
 */

import type { PGlite } from "@electric-sql/pglite";

export interface ServerOptions {
  /** TCP port to listen on. Default 5433 (avoids clash with system Postgres). */
  port?: number;
  /** Host to bind to. Default "127.0.0.1" (loopback only). */
  host?: string;
}

export interface SulcusPGliteServer {
  /** The underlying PGlite instance. */
  db: PGlite;
  /** Gracefully stop the TCP server. */
  close(): Promise<void>;
}

/**
 * Start a PostgreSQL wire-protocol TCP server wrapping the given PGlite instance.
 *
 * @param db      An already-created (and migrated) PGlite instance.
 * @param opts    Port / host options.
 * @returns       A handle to close the server.
 */
export async function startServer(
  db: PGlite,
  opts: ServerOptions = {},
): Promise<SulcusPGliteServer> {
  const port = opts.port ?? 5433;
  const host = opts.host ?? "127.0.0.1";

  // Dynamic import so the module can be loaded in environments without the
  // pglite-server package (e.g., browser where the wiring is different).
  const { PGliteServer } = await import("@electric-sql/pglite-server");

  const server = new PGliteServer(db);
  await server.listen({ port, host });

  console.log(
    `[sulcus-pglite] PostgreSQL wire server listening on ${host}:${port}`,
  );
  console.log(
    `[sulcus-pglite] Connect via: postgres://sulcus@${host}:${port}/sulcus`,
  );

  return {
    db,
    async close() {
      await server.close();
    },
  };
}
