# Sulcus Ecosystem Modernization Tracker

> Bringing all integrations, SDKs, plugins, and docs up to speed with
> sulcus-server v2.25.2 and openclaw-sulcus v7.2.1.

## Phases

Each phase is a bounded work unit for a single cron run (~30 min).
First run of each phase: **review SOA → plan approach → document plan below.**
Subsequent runs: **execute plan, verify, commit.**

---

### Phase 1: MCP Server Integration (Gemini, Claude, Cursor, OpenCode)
**Status:** pending
**Target:** `integrations/mcp-server/`, `plugins/claude-code-sulcus/`, `plugins/codex-sulcus/`, `plugins/cursor-sulcus/`

The MCP server is the cross-platform integration (Claude Desktop, Claude Code, Cursor, Gemini, OpenCode, VS Code). The plugins/ directory has config-only wrappers. This is the highest-leverage update.

**Scope:**
- Review MCP server code against current server API (v2.25.2 endpoints)
- Ensure tool definitions match current `memory_store`, `memory_recall`, etc.
- Update README with current capabilities (Context Engine, triggers, multi-signal recall)
- Update all plugin READMEs (claude-code, codex, cursor) with current setup instructions
- Add Gemini CLI integration docs (not currently covered)
- Add OpenCode integration docs (not currently covered)
- Version bump MCP server to align with server release

---

### Phase 2: Python SDK + Python Integrations
**Status:** pending
**Target:** `sdks/python/`, `integrations/langchain/`, `integrations/llamaindex/`, `integrations/crewai/`, `integrations/deepagents/`

**Scope:**
- Review Python SDK against current API endpoints
- Ensure SDK covers new v2.25.x endpoints (if any)
- Update LangChain integration for current LangChain API
- Update LlamaIndex integration for current LlamaIndex API
- Update CrewAI integration for current CrewAI patterns
- Review DeepAgents integration relevance
- Update all READMEs with current features, examples
- Ensure pyproject.toml versions and deps are current

---

### Phase 3: Node SDK + TypeScript Integrations
**Status:** pending
**Target:** `sdks/node/`, `integrations/openai-tools/`, `integrations/anthropic-tools/`, `integrations/vercel-ai/`, `integrations/cli/`

**Scope:**
- Review Node SDK against current API endpoints
- Update OpenAI function-calling adapter for current OpenAI API
- Update Anthropic tools adapter for current Claude tools API
- Update Vercel AI SDK integration
- Update CLI tool
- Version bumps, README updates, dependency updates

---

### Phase 4: Documentation Overhaul
**Status:** pending
**Target:** `docs/`, `API_REFERENCE.md`, `ARCHITECTURE.md`, `CONCEPT.md`

**Scope:**
- Update API_REFERENCE.md with any new/changed v2.25.x endpoints
- Update CORE_MEMORY_API.md
- Update siu-v2-api.md with current pipeline details
- Update openclaw-plugin-setup.md for v7.2.x config
- Update claude-code-setup.md
- Review and update ARCHITECTURE.md
- Security audit: ensure no infra details leak
- Add Context Engine documentation
- Add triggers documentation

---

### Phase 5: Packages & Benchmarks
**Status:** pending
**Target:** `packages/sulcus-local/`, `packages/sulcus-core-tools/`, `packages/membench/`, `packages/mem0-benchmarks/`

**Scope:**
- Update sulcus-local wrapper
- Review sulcus-core-tools (1710 lines — what is this?)
- Update benchmark suites against current server
- Clean up any stale packages

---

### Phase 6: Final Review & Release
**Status:** pending

**Scope:**
- Full repo grep for stale version refs, broken links, infra leaks
- Ensure all package.json/pyproject.toml versions are coherent
- Tag release if appropriate
- Update GitHub releases page

---

## Progress Log

| Date | Phase | Action | Commit |
|---|---|---|---|
| — | — | — | — |

