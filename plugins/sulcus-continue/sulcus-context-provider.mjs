/**
 * Sulcus Custom Context Provider for Continue.dev (VS Code & JetBrains)
 *
 * Delegates directly to the compiled pure-Rust `sulcus hook --harness continue recall`
 * subcommand.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function resolveSulcusBin() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.sulcus', 'bin', 'sulcus'),
    path.join(home, '.cargo', 'bin', 'sulcus'),
    '/opt/homebrew/bin/sulcus',
    '/usr/local/bin/sulcus',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'sulcus';
}

export const SulcusContextProvider = {
  title: 'sulcus',
  displayTitle: 'Sulcus Memory',
  description: 'Recall project memories and AST PageRank anchors from Sulcus',
  type: 'normal',
  getContextItems: async (query, extras) => {
    const q = query || extras?.fullInput || 'project architecture preferences';
    try {
      const home = os.homedir();
      const output = execFileSync(
        resolveSulcusBin(),
        ['hook', '--harness', 'continue', 'recall', q],
        {
          encoding: 'utf8',
          timeout: 4500,
          stdio: ['ignore', 'pipe', 'ignore'],
          env: {
            ...process.env,
            SULCUS_MODEL_CACHE_DIR:
              process.env.SULCUS_MODEL_CACHE_DIR ||
              path.join(home, '.sulcus', 'models', 'fastembed'),
          },
        }
      );
      return [
        {
          name: 'Sulcus Memory',
          description: 'Recalled thermodynamic memories and code anchors',
          content: output.trim() || 'No matching Sulcus memories found.',
        },
      ];
    } catch {
      return [];
    }
  },
};
