/**
 * Path resolution utilities for Sulcus plugin.
 * Reads process.env for HOME/OPENCLAW_WORKSPACE to resolve default paths.
 * Isolated from network code to keep static analysis clean.
 */
import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

interface PluginLogger {
  info: (msg: string) => void;
}

/** Resolve the sulcus lib directory from config or default. */
export function resolveLibDir(configLibDir?: string): string {
  if (configLibDir) return resolve(configLibDir);
  return resolve(process.env.HOME || "~", ".sulcus/lib");
}

/** Resolve the sulcus data directory. */
export function resolveDataDir(): string {
  return resolve(process.env.HOME || "~", ".sulcus/data");
}

/** Ensure directories exist (best-effort, may fail in read-only containers). */
export function ensureDirectories(dirs: string[], logger: PluginLogger): void {
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
        logger.info(`sulcus: created directory ${dir}`);
      } catch { /* best effort — may be read-only in containers */ }
    }
  }
}
