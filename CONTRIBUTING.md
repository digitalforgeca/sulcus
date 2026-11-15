# Contributing to Sulcus

Thanks for your interest in contributing to Sulcus! Here is how to get involved.

## What's Open for Contributions

The following client-side components in this repository are open-source under the [MIT License](LICENSE):

- **SDKs** — `sdks/python/`, `sdks/node/`
- **Plugins** — `plugins/sulcus-*` (Antigravity, Claude Code, Cursor, Windsurf, Codex, Gemini CLI, VS Code, JetBrains, Junie, Cline, OpenCode, Hermes, Continue, Aider, Zed, Neovim, ChatGPT)
- **Integrations** — `integrations/` (LangChain, LlamaIndex, CrewAI, Deep Agents, Vercel AI SDK, CLI, OpenAI & Anthropic tool schemas)
- **Packages** — `packages/sulcus-core-tools/`, `packages/openclaw-sulcus/`, `packages/sulcusbench/`, `packages/google-memory-bench/`
- **Documentation & Tools** — `docs/`, `skills/`, `tools/`, `homebrew/`

The native `sulcus` runtime engine and managed cloud backend are maintained separately and are not part of this repository.

## How to Contribute

### Bug Reports

Open an issue on [GitHub](https://github.com/digitalforgeca/sulcus/issues) with:
- Expected behavior vs. actual behavior
- Minimal steps to reproduce
- Workstation OS, harness/plugin version, and `sulcus --version`

### Feature Requests

Open an issue tagged `enhancement` describing the concrete workflow or developer problem you want to solve.

### Pull Requests

1. Fork this repository
2. Create a feature branch from `master`
3. Make focused, atomic commits with passing tests
4. Open a pull request against `master`

## Code Style

- **Python:** Follow PEP 8; keep the core SDK zero-dependency.
- **TypeScript / JavaScript:** Match the package's existing `tsconfig.json` and test runner (`npm test`).
- **Markdown:** Prefer concise, runnable examples.

## Questions?

- Open a [Discussion](https://github.com/digitalforgeca/sulcus/discussions) on GitHub
- Website: [sulcus.ca](https://sulcus.ca)
- Email: [contact@sulcus.ca](mailto:contact@sulcus.ca)
