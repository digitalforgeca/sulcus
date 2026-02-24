/**
 * build.mjs — esbuild bundler for SULCUS OpenClaw skills
 *
 * Invoked by `npm run build` (which is called by crates/sulcus-local/build.rs
 * during `cargo build`).  Produces self-contained ESM bundles in dist/ with
 * PGLite marked external (it ships its own WASM assets and must be resolved
 * at runtime from node_modules).
 *
 * Outputs
 * ───────
 *   dist/context-chunker-skill.mjs  — main skill (inlines pglite-backend)
 *   dist/pglite-backend.mjs         — standalone PGLite client (for testing)
 *   dist/openclaw-plugin.mjs        — plugin adapter shim
 */

import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, 'dist');
mkdirSync(dist, { recursive: true });

// Packages that ship WASM/native assets — must remain external so the
// runtime can find them in node_modules.
const EXTERNALS = ['@electric-sql/pglite', 'openclaw', 'http', 'https', 'crypto', 'fs', 'path', 'url'];

const sharedOpts = {
  bundle:    true,
  format:    'esm',
  platform:  'node',
  target:    'node18',
  external:  EXTERNALS,
  sourcemap: false,
  logLevel:  'info',
};

await Promise.all([
  // ── Primary skill bundle ─────────────────────────────────────────────────
  esbuild.build({
    ...sharedOpts,
    entryPoints: [resolve(__dirname, 'context-chunker-skill.mjs')],
    outfile:     resolve(dist, 'context-chunker-skill.mjs'),
    banner: { js: '// SULCUS context-chunker-skill — compiled by `cargo build` (do not edit)' },
  }),

  // ── PGLite backend (standalone, for tests and direct import) ────────────
  esbuild.build({
    ...sharedOpts,
    entryPoints: [resolve(__dirname, 'pglite-backend.mjs')],
    outfile:     resolve(dist, 'pglite-backend.mjs'),
    banner: { js: '// SULCUS pglite-backend — compiled by `cargo build` (do not edit)' },
  }),

  // ── OpenClaw plugin adapter ──────────────────────────────────────────────
  esbuild.build({
    ...sharedOpts,
    entryPoints: [resolve(__dirname, 'openclaw-plugin.mjs')],
    outfile:     resolve(dist, 'openclaw-plugin.mjs'),
    banner: { js: '// SULCUS openclaw-plugin — compiled by `cargo build` (do not edit)' },
  }),
]);

// Write a package.json into dist/ so the bundle is importable as a package.
writeFileSync(
  resolve(dist, 'package.json'),
  JSON.stringify(
    {
      name:    'sulcus-openclaw-skills',
      version: '0.1.0',
      type:    'module',
      main:    'context-chunker-skill.mjs',
      exports: {
        '.':                    './context-chunker-skill.mjs',
        './pglite-backend':     './pglite-backend.mjs',
        './openclaw-plugin':    './openclaw-plugin.mjs',
      },
    },
    null,
    2,
  ) + '\n',
);

console.log('✓  OpenClaw skills bundled → tools/openclaw-integration/dist/');
