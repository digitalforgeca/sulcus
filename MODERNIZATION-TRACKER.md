# Sulcus Ecosystem Modernization Tracker

> Bringing all integrations, SDKs, plugins, and docs up to speed with
> sulcus-server v2.25.2 and openclaw-sulcus v7.2.1.

## Phases

Each phase is a bounded work unit for a single cron run (~30 min).
First run of each phase: **review SOA → plan approach → document plan below.**
Subsequent runs: **execute plan, verify, commit.**

---

### Phase 1: MCP Server Integration (Gemini, Claude, Cursor, OpenCode)
**Status:** done
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

**SOA Review (2026-06-11):**

Code reviewed: `integrations/mcp-server/` (Rust MCP server using `rmcp` 0.16), `plugins/claude-code-sulcus/`, `plugins/cursor-sulcus/`, `plugins/codex-sulcus/`.

Live server: `api.sulcus.ca` running v2.25.2. Endpoints verified via `/api/v1/status`.

**Issues found:**

1. **Missing `synthesis` memory type** — Live API shows 412 `synthesis` memories in production. The `types.rs` param docs and tool descriptions only list `episodic`, `semantic`, `preference`, `procedural`. Need to add `synthesis` to the documented types.

2. **Wrong build path in README** — `integrations/mcp-server/README.md` says `cd crates/sulcus-mcp` but the actual repo path is `integrations/mcp-server/`.

3. **Version stuck at 0.1.0** — `Cargo.toml` and `USER_AGENT` hardcode `0.1.0`. Should be bumped to `2.25.2` to reflect compatibility with the live server.

4. **No Gemini CLI config** — `config/` has `claude.json`, `cursor.json`, `vscode.json` but no `gemini.json`. Gemini CLI (`@google/gemini-cli`) supports MCP via `~/.gemini/settings.json`. A `config/gemini.json` template is needed.

5. **No OpenCode config** — `opencode-ai` supports MCP servers. A `config/opencode.json` template with correct format is needed.

6. **Plugin tool name inconsistency** — `cursor-sulcus/README.md` and `codex-sulcus/README.md` list tool names like `record_memory`, `search_memory`, `forget_memory` — these are old names. Current MCP server exposes `sulcus_remember`, `sulcus_search`, `sulcus_forget`, etc. READMEs must be corrected.

7. **`auto_recall` / `build_context` client-side only** — These are assembled client-side in `client.rs`, not actual API endpoints. This is intentional but the README implies a `/api/v1/agent/auto_recall` endpoint. Documentation should clarify.

8. **Traefik infra reference in README** — HTTP mode section mentions Traefik by name with example internal configs. Should be genericized to a reverse proxy example.

9. **`claude-code-sulcus` MCP tool count mismatch** — Plugin README claims "36 available" but the MCP server exposes 19 tools (the 36 count refers to the older OpenClaw plugin surface). Should reflect 19 for the MCP server.

**Execution Plan:**

1. Bump `Cargo.toml` version to `2.25.2`, update `USER_AGENT` constant.
2. Add `synthesis` to `RememberParams` and `UpdateParams` memory type doc comments.
3. Fix README build path (`crates/sulcus-mcp` → `integrations/mcp-server`).
4. Add `config/gemini.json` — Gemini CLI MCP config template.
5. Add `config/opencode.json` — OpenCode MCP config template.
6. Update `integrations/mcp-server/README.md`: fix build path, genericize reverse proxy section, clarify auto_recall is client-assembled, add Gemini CLI and OpenCode setup sections.
7. Fix `plugins/cursor-sulcus/README.md` — correct tool names to match MCP server.
8. Fix `plugins/codex-sulcus/README.md` — correct tool names to match MCP server.
9. Fix `plugins/claude-code-sulcus/README.md` — update MCP tool count from 36 to 19.

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
| 2026-06-11 | Phase 1 | SOA review + plan documented | 936f615 |
| 2026-06-11 | Phase 1 | Execute: version 2.25.2, synthesis type, Gemini/OpenCode configs, fix tool names | 9eff649 |

