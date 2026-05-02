/**
 * sulcus-pglite — Storage backend abstraction
 *
 * PGlite supports three storage modes:
 *   memory   – in-process, no persistence (dev / tests)
 *   idb      – IndexedDB (browser / VS Code web extension)
 *   fs:<dir> – Node.js native filesystem (OpenClaw / local models)
 */

import { PGlite } from "@electric-sql/pglite";

export type StorageMode = "memory" | "idb" | `fs:${string}`;

/**
 * Parse the storage specification string into a PGlite data-directory URL.
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

  return spec;
}

/**
 * Create a PGlite instance for the given storage specification.
 */
export async function createPGlite(spec: string = "memory"): Promise<PGlite> {
  const dataDir = resolveDataDir(spec);
  
  // REQUIRED: Enable native pgvector extension
  const { vector } = await import("@electric-sql/pglite/vector");
  
  const options = {
    extensions: {
      vector
    }
  };

  if (dataDir?.startsWith("nodefs://")) {
    const { NodeFS } = await import("@electric-sql/pglite/nodefs");
    const dir = dataDir.slice("nodefs://".length);
    return new PGlite({ 
        ...options,
        dataDir: dir, 
        fs: new NodeFS(dir) 
    });
  }

  if (dataDir?.startsWith("idb://")) {
    const { IdbFs } = await import("@electric-sql/pglite/idb");
    const name = dataDir.slice("idb://".length);
    return new PGlite({ 
        ...options,
        dataDir: `idb://${name}`, 
        fs: new IdbFs(name) as any 
    });
  }

  return new PGlite(options);
}
