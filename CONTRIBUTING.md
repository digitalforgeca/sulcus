# Contributing to Sulcus

Thanks for your interest in contributing to Sulcus! Here's how to get involved.

## What's Open for Contributions

The following components are open-source under MIT:

- **SDKs** — `sdks/python/`, `sdks/node/`
- **Integrations** — `integrations/` (LangChain, LlamaIndex, CrewAI, etc.)
- **Plugins** — `plugins/` (Claude Code, Cursor, Codex)
- **OpenClaw Plugin** — `packages/openclaw-sulcus/`
- **Documentation** — `docs/`, root-level markdown files
- **Tools** — `tools/` (hooks, manifests, examples)

The core engine, server, and WASM modules are proprietary and are not available in this repository. See [LICENSE](LICENSE) and [CLASSIFICATION.md](CLASSIFICATION.md) for details.

## How to Contribute

### Bug Reports

Open an issue on [GitHub](https://github.com/digitalforgeca/sulcus/issues) with:
- What you expected vs. what happened
- Steps to reproduce
- Sulcus version (SDK version, server version if relevant)

### Feature Requests

Open an issue tagged `enhancement`. Describe the use case — we care more about *why* than *what*.

### Code Changes

1. Fork the repo
2. Create a feature branch from `master`
3. Make your changes with clear, atomic commits
4. Test your changes (run any relevant examples/tests)
5. Open a PR against `master`

### Documentation

Typo fixes, clarifications, and new examples are always welcome. No issue required — just open a PR.

## Code Style

- **Python:** Follow PEP 8. Zero external dependencies for SDKs.
- **TypeScript:** Use the existing `tsup`/`esbuild` toolchain.
- **Markdown:** Keep it clear. Prefer examples over long descriptions.

## Questions?

- Open a [Discussion](https://github.com/digitalforgeca/sulcus/discussions) on GitHub
- Email: contact@sulcus.ca

---

*Built by [Digital Forge Studios](https://dforge.ca)*
