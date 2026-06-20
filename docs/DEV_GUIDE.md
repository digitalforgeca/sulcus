# Development Guide

> **Classification:** This guide covers contributing to the open-source components (SDKs, integrations, plugins). The server backend is proprietary and not available for local development. See [CLASSIFICATION.md](../CLASSIFICATION.md).

## Prerequisites

- **Node.js** 20+ (for TypeScript packages)
- **Python** 3.10+ (for Python SDK)
- Docker (optional, for running local integration tests)

## What You Can Work On

- **SDKs:** `sdks/python/`, `sdks/node/` — API client libraries
- **Integrations:** `integrations/` — LangChain, LlamaIndex, CrewAI, etc.
- **Plugins:** `plugins/` — Claude Code, Cursor, Codex
- **OpenClaw plugin:** `packages/openclaw-sulcus/`
- **Documentation:** `docs/`, root-level markdown

## SDK Development

### Python SDK

```bash
cd sdks/python
pip install -e ".[dev]"
pytest
```

### Node.js SDK

```bash
cd sdks/node
npm install
npm test
```

## Plugin Development

### OpenClaw Plugin

```bash
cd packages/openclaw-sulcus
npm install
npm run build
```

### Claude Code Plugin

```bash
cd plugins/claude-code-sulcus
npm install
npm run build
```

## Testing Against the API

All SDKs and integrations connect to `api.sulcus.ca`. Get a free API key at [sulcus.ca](https://sulcus.ca) → Dashboard → API Keys.

```bash
export SULCUS_API_KEY="sk-your-key"
export SULCUS_SERVER_URL="https://api.sulcus.ca"
```

## Code Style

- **Python:** PEP 8. Zero external dependencies for SDKs.
- **TypeScript:** Use the existing `tsup`/`esbuild` toolchain.
- **Markdown:** Clear prose, prefer examples over long descriptions.

---

*Last Updated: 2026-06-20*
