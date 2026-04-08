#!/usr/bin/env node
/**
 * postinstall script for @digitalforgestudios/sulcus
 *
 * Downloads the correct prebuilt sulcus binary for the current platform
 * from GitHub Releases and places it in ./bin/sulcus.
 */
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");
const zlib = require("zlib");

const VERSION = require("../package.json").version;
const REPO = "digitalforgeca/sulcus";
const BIN_DIR = path.join(__dirname, "..", "bin");
const BIN_PATH = path.join(BIN_DIR, "sulcus");

function getPlatform() {
  const platform = os.platform();
  const arch = os.arch();

  const map = {
    "darwin-x64": "darwin-x86_64",
    "darwin-arm64": "darwin-arm64",
    "linux-x64": "linux-x86_64",
    "linux-arm64": "linux-aarch64",
  };

  const key = `${platform}-${arch}`;
  const mapped = map[key];
  if (!mapped) {
    console.error(
      `Unsupported platform: ${key}. Supported: ${Object.keys(map).join(", ")}`
    );
    console.error(
      "You can build from source: cargo build --release -p sulcus"
    );
    process.exit(0); // Don't fail the install — user can build from source
  }
  return mapped;
}

function download(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "User-Agent": "sulcus-installer" } }, (res) => {
        // Follow redirects (GitHub sends 302 to S3)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return download(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  const platform = getPlatform();
  const assetName = `sulcus-${platform}.tar.gz`;

  // Try GitHub Releases first, fall back to the server
  const releaseUrl = `https://github.com/${REPO}/releases/download/v${VERSION}/${assetName}`;
  const fallbackUrl = `https://api.sulcus.ca/releases/v${VERSION}/${assetName}`;

  console.log(`sulcus: downloading ${platform} binary (v${VERSION})...`);

  let buffer;
  try {
    buffer = await download(releaseUrl);
  } catch (e) {
    console.log(`GitHub release not found, trying fallback...`);
    try {
      buffer = await download(fallbackUrl);
    } catch (e2) {
      console.error(`\nCould not download prebuilt binary for ${platform}.`);
      console.error(`Build from source instead:`);
      console.error(`  git clone https://github.com/${REPO}.git`);
      console.error(`  cd sulcus && cargo build --release -p sulcus`);
      console.error(`  cp target/release/sulcus ~/.local/bin/`);
      process.exit(0); // Don't fail the install
    }
  }

  // Extract tar.gz
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const tmpTar = path.join(os.tmpdir(), `sulcus-${Date.now()}.tar.gz`);
  fs.writeFileSync(tmpTar, buffer);

  try {
    execSync(`tar xzf "${tmpTar}" -C "${BIN_DIR}"`, { stdio: "pipe" });
  } catch (e) {
    console.error("Failed to extract binary:", e.message);
    process.exit(0);
  }

  fs.unlinkSync(tmpTar);

  // Ensure executable
  try {
    fs.chmodSync(BIN_PATH, 0o755);
  } catch (e) {
    // Windows doesn't have chmod — that's fine
  }

  console.log(`sulcus: installed ${platform} binary to ${BIN_PATH}`);
}

main().catch((e) => {
  console.error("sulcus postinstall error:", e.message);
  process.exit(0); // Never fail the npm install
});
