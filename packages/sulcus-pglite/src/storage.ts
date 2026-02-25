/**
 * sulcus-pglite — Storage backend abstraction
 *
 * PGlite supports three storage modes:
 *   memory   – in-process, no persistence (dev / tests)
 *   idb      – IndexedDB (browser / VS Code web extension)
 *   fs:<dir> – Node.js native filesystem (OpenClaw / local models)
 *
 * The storage string is the single source of truth: the server reads
 * SULCUS_STORAGE (or --storage flag) and passes it here.
 */

import { PGlite } from "@electric-sql/pglite";

export type StorageMode = "memory" | "idb" | `fs:${string}`;

/**
 * Parse the storage specification string into a PGlite data-directory URL.
 *
 *   "memory"         → undefined  (PGlite in-memory default)
 *   "idb"            → "idb://sulcus"
 *   "idb:myname"     → "idb://myname"
 *   "fs:/data/sulcus" → "nodefs:///data/sulcus"
 *   "fs:./data"      → "nodefs://./data"
 */
export function resolveDataDir(spec: string): string | undefined {
  if (!spec || spec === "memory") return undefined;

  if (spec.startsWith("idb")) {
    const name = spec.includes(":") ? spec.split(":")[1] : "sulcus";
    return `idb://${name}`;
  }

  if (spec.startsWith("fs:")) {
    const dir = spec.slice(3); // strip "fs:"
    return `nodefs://${dir}`;
  }

  // Already a fully-qualified URL (idb:// or nodefs://) — pass through.
  return spec;
}

/**
 * Create a PGlite instance for the given storage specification.
 *
 * @param spec  One of "memory", "idb", "idb:<name>", "fs:<dir>"
 * @returns     Ready-to-use PGlite instance (not yet migrated)
 */
export async function createPGlite(spec: string = "memory"): Promise<PGlite> {
  const dataDir = resolveDataDir(spec);

  if (dataDir?.startsWith("nodefs://")) {
    // Node.js filesystem storage: requires the nodefs plugin.
    // We dynamic-import so the browser bundle never pulls in Node.js APIs.
    const { NodeFS } = await import("@electric-sql/pglite/nodefs");
    const dir = dataDir.slice("nodefs://".length);
    return new PGlite({ dataDir: dir, fs: new NodeFS(dir) });
  }

  if (dataDir?.startsWith("idb://")) {
    // IndexedDB storage — works in browsers and VS Code web extension.
    const { IdbFs } = await import("@electric-sql/pglite/idb");
    const name = dataDir.slice("idb://".length);
    return new PGlite({ dataDir: `idb://${name}`, fs: new IdbFs(name) as any });
  }

  // In-memory: no persistence, fastest (tests / ephemeral agents).
  return new PGlite();
}
