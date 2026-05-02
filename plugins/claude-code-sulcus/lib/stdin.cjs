/**
 * Read JSON from stdin (Claude Code passes hook context as JSON on stdin).
 */
'use strict';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    // If stdin is closed or empty, resolve quickly
    if (process.stdin.readableEnded) resolve({});
  });
}

function writeOutput(obj) {
  process.stdout.write(JSON.stringify(obj));
}

module.exports = { readStdin, writeOutput };
