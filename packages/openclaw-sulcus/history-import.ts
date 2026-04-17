/**
 * First-install history import for Sulcus plugin.
 * Reads OpenClaw workspace files (MEMORY.md, daily notes) and imports
 * them as episodic memories into Sulcus.
 * Isolated from network code — this file only reads local files.
 * The SulcusCloudClient is passed in as an interface to avoid importing
 * the HTTP client directly.
 */
import { resolve } from "node:path";

interface PluginLogger {
  debug?: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

interface MemoryClient {
  add_memory(content: string, memory_type: string): Promise<unknown>;
}

/**
 * Collects memory entries from OpenClaw workspace files.
 * Pure local file reads — no network calls.
 */
export function collectWorkspaceMemories(logger: PluginLogger): { memories: string[]; markerPath: string; alreadyImported: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, enc: string) => string;
    readdirSync: (p: string) => string[];
    statSync: (p: string) => { mtimeMs: number };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as { join: (...args: string[]) => string };

  const workspaceDir = process.env.OPENCLAW_WORKSPACE
    ? resolve(process.env.OPENCLAW_WORKSPACE)
    : resolve(process.env.HOME || "~", ".openclaw/workspace");
  const markerPath = path.join(workspaceDir, ".sulcus-imported");

  if (fs.existsSync(markerPath)) {
    return { memories: [], markerPath, alreadyImported: true };
  }

  logger.info("sulcus: collecting workspace memories for first-install import...");

  const memories: string[] = [];

  const memoryMdPath = path.join(workspaceDir, "MEMORY.md");
  if (fs.existsSync(memoryMdPath)) {
    try {
      const text = fs.readFileSync(memoryMdPath, "utf-8");
      const entries = text.split(/\n(?:---+|\s*\n\s*\n)/g).map((s) => s.trim()).filter((s) => s.length > 20);
      memories.push(...entries);
    } catch (_e) { /* best-effort */ }
  }

  const memDir = path.join(workspaceDir, "memory");
  if (fs.existsSync(memDir)) {
    try {
      const files = fs.readdirSync(memDir);
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      for (const file of files) {
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) continue;
        try {
          const stat = fs.statSync(path.join(memDir, file));
          if (now - stat.mtimeMs > thirtyDaysMs) continue;
          const text = fs.readFileSync(path.join(memDir, file), "utf-8");
          const entries = text.split(/\n---\n/g).map((s) => s.trim()).filter((s) => s.length > 20);
          memories.push(...entries);
        } catch (_e) { /* best-effort */ }
      }
    } catch (_e) { /* best-effort */ }
  }

  return { memories, markerPath, alreadyImported: false };
}

/**
 * Writes the import marker file after successful import.
 */
export function writeImportMarker(markerPath: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as { writeFileSync: (p: string, d: string, enc: string) => void };
  fs.writeFileSync(markerPath, new Date().toISOString(), "utf-8");
}

/**
 * Full import: collect workspace memories and store them via the client.
 */
export async function importOpenClawHistory(client: MemoryClient, logger: PluginLogger): Promise<void> {
  const { memories, markerPath, alreadyImported } = collectWorkspaceMemories(logger);
  if (alreadyImported) return;

  let stored = 0;
  for (const mem of memories) {
    try {
      await client.add_memory(mem, "episodic");
      stored++;
    } catch (_e) { /* best-effort */ }
  }

  try {
    writeImportMarker(markerPath);
    logger.info(`sulcus: history import complete — stored ${stored} memories from OpenClaw workspace`);
  } catch (_e) { /* best-effort */ }
}
