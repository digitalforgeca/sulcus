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
**Status:** done
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

**SOA Review (2026-06-11):**

Code reviewed: `sdks/python/` (full client + async client), `integrations/langchain/`, `integrations/llamaindex/`, `integrations/crewai/`, `integrations/deepagents/`.

Live server: `api.sulcus.ca` v2.25.2-36e8b00 confirmed via `/api/v1/status`.

Live memory types in production: `episodic` (12976), `fact` (789), `procedural` (780), `semantic` (433), `synthesis` (412), `preference` (127).

**Issues found:**

1. **Python SDK version mismatch** — `sdks/python/sulcus/__init__.py` exports `__version__ = "0.3.0"` and `pyproject.toml` has `version = "1.0.0"`. These are inconsistent. Should align both to `1.0.0` (pyproject.toml is the install-time version; __init__.py should match).

2. **Missing `synthesis` and `fact` memory types** — Live API has 789 `fact` nodes and 412 `synthesis` nodes. The SDK's `remember()` and `update()` docstrings list only `episodic`, `semantic`, `preference`, `procedural`, `moment` — missing `fact` and `synthesis`. All docstrings across sdk and integrations need updating.

3. **`User-Agent` strings hardcoded to old value** — Both `Sulcus` and `AsyncSulcus` send `User-Agent: sulcus-python/1.0.0`. Should match the actual installed version via `__version__`.

4. **`crewai/storage.py` bug** — `SulcusStorage.save()` calls `result.get(...)` on the return value of `client.remember()` but `client.remember()` returns a `Memory` object (dataclass), not a dict. Need to use `result.id`.

5. **`crewai/tools.py` bug** — `SulcusSearchTool._run()` and `SulcusContextTool._run()` call `self.client.search()` which returns `List[Memory]` objects but then call `.get("memory_type")` on them as if they were dicts. Need attribute access (`r.memory_type`, not `r.get("memory_type")`).

6. **`deepagents/tools.py` bug** — Same issue: `SulcusStoreTool._run()` calls `result.get(...)` on a `Memory` object. `SulcusSearchTool._run()` and `SulcusContextTool._run()` also treat `Memory` objects as dicts.

7. **`crewai/storage.py` bug** — `SulcusStorage.load()` and `list_recent()` return `List[Memory]` objects but the docstring says `List[Dict]`. The interface is correct (returning typed objects is better) but doc says dict. Should update docs to reflect `List[Memory]` or add a `.to_dict()` conversion.

8. **`langchain/pyproject.toml` wrong repo URL** — `Repository = "https://github.com/dforge/sulcus"` (wrong org). Should be `https://github.com/digitalforgeca/sulcus`.

9. **`llamaindex/pyproject.toml` wrong repo URL** — Same wrong org: `https://github.com/dforge/sulcus`.

10. **`langchain/sulcus_langchain/retriever.py` outdated docstring** — Says "currently substring match" in the description, but the server does multi-signal semantic recall. Should reflect real search behaviour.

11. **`langchain/sulcus_langchain/vector_store` missing** — llamaindex has a SulcusVectorStore; langchain does not have an equivalent (this is fine — LangChain uses `SulcusRetriever` for RAG, not a vector store). Not a bug but worth noting in README.

12. **`llamaindex/sulcus_llamaindex/vector_store.py` missing `fact` and `synthesis` in `_MEMORY_TYPES`** — `_MEMORY_TYPES = {"episodic", "semantic", "preference", "procedural"}` — missing `fact` and `synthesis`. Nodes with these types will be stored as `"semantic"` fallback.

13. **`deepagents` dependency on `deepagents>=0.1.0`** — `deepagents` is not a published PyPI package (LangChain Deep Agents is `langchain-agents` or similar experimental package). The `pyproject.toml` dependency is wrong and would fail to install. Either correct the package name or document it as a pre-release / manual install.

14. **`crewai` minimum version** — `crewai>=0.80.0` — CrewAI 1.x changed tool interfaces. Should verify `BaseTool` import path and bump minimum to `crewai>=1.0.0`.

15. **`langchain` minimum version** — `langchain-core>=0.3.0` is correct. LangChain Core 0.3.x is current stable.

16. **README decay class values inconsistency** — Python SDK README says `decay_class` values are `volatile | normal | stable | permanent` but `client.py` docstring says `fast | normal / slow / glacial`. Need to align everywhere.

**Execution Plan:**

1. **SDK fixes:**
   - Align `__version__` in `__init__.py` to `"1.0.0"` to match `pyproject.toml`.
   - Update `_headers()` in both `Sulcus` and `AsyncSulcus` to use `__version__` dynamically.
   - Add `fact` and `synthesis` to all docstring memory type lists in `client.py` (remember, update, AsyncSulcus.remember).
   - Fix `decay_class` valid values to match: `fast`, `normal`, `slow`, `glacial` consistently.

2. **LangChain fixes:**
   - Fix `pyproject.toml` repo URL.
   - Update `retriever.py` docstring: remove "substring" claim, say "multi-signal recall".
   - Add `synthesis` and `fact` to the retriever and memory docstring memory type lists.
   - Update `README.md` memory types table to include `fact` and `synthesis`.

3. **LlamaIndex fixes:**
   - Fix `pyproject.toml` repo URL.
   - Add `fact` and `synthesis` to `_MEMORY_TYPES` set in `vector_store.py`.
   - Update `README.md` memory types table.

4. **CrewAI fixes:**
   - Fix `storage.py` `save()` bug: `result.get("node_id")` → `result.id`.
   - Fix `storage.py` `load()` and `list_recent()` return type docs.
   - Fix `tools.py` `SulcusSearchTool._run()` and `SulcusContextTool._run()`: use attribute access on `Memory` objects.
   - Bump `crewai>=1.0.0` in `pyproject.toml`.
   - Add `fact` and `synthesis` to tool docstrings.
   - Update `README.md` memory types table.

5. **DeepAgents fixes:**
   - Fix `tools.py` `SulcusStoreTool._run()` bug: `result.get("node_id")` → `result.id`.
   - Fix `tools.py` `SulcusSearchTool._run()` and `SulcusContextTool._run()`: attribute access.
   - Fix `pyproject.toml` dependency: `deepagents>=0.1.0` → note the correct package name / installation.
   - Add `fact` and `synthesis` to tool memory type docs.
   - Update `README.md` memory types table.

---

### Phase 3: Node SDK + TypeScript Integrations
**Status:** done
**Target:** `sdks/node/`, `integrations/openai-tools/`, `integrations/anthropic-tools/`, `integrations/vercel-ai/`, `integrations/cli/`

**Scope:**
- Review Node SDK against current API endpoints
- Update OpenAI function-calling adapter for current OpenAI API
- Update Anthropic tools adapter for current Claude tools API
- Update Vercel AI SDK integration
- Update CLI tool
- Version bumps, README updates, dependency updates

**SOA Review (2026-06-11):**

Code reviewed: `sdks/node/src/index.ts`, `integrations/openai-tools/`, `integrations/anthropic-tools/`, `integrations/vercel-ai/`, `integrations/cli/`.

Live server: `api.sulcus.ca` v2.25.2-36e8b00. Live memory types: `episodic` (12979), `fact` (789), `procedural` (780), `semantic` (433), `synthesis` (412), `preference` (127).

**Issues found:**

**Node SDK (`sdks/node/`):**
1. **Missing `fact` and `synthesis` from `RememberOptions.memoryType` union** — The TypeScript type only includes `"episodic" | "semantic" | "preference" | "procedural" | "moment"`. Live API has `fact` (789 memories) and `synthesis` (412). `moment` is not in live data at all — should be removed.
2. **`User-Agent` hardcoded to `"sulcus-node/1.0.0"`** — Should be a constant that matches the package version. Hardcoded string will drift.
3. **README `Memory Lifecycle Control` section shows `decayClass: "permanent"`** — This is not a valid value. Valid values are `"fast" | "normal" | "slow" | "glacial"` (matches SDK interface). README example is wrong.
4. **README Memory Types table missing `synthesis`** — Lists `fact` but not `synthesis`. Both are live types.
5. **`RememberOptions` and Vercel AI enums use stale set** — Same `fact`/`synthesis` gap propagates to all TypeScript consumers.

**OpenAI Tools (`integrations/openai-tools/`):**
6. **`handler.py` uses wrong API endpoints** — `sulcus_remember()` POSTs to `/memories`, `sulcus_search()` POSTs to `/memories/search`, `sulcus_list()` GETs `/memories`, `sulcus_forget()` DELETEs `/memories/{id}`, `sulcus_update()` PATCHes `/memories/{id}`. All wrong. Current API: store → `POST /api/v1/agent/nodes`, search → `POST /api/v1/agent/search`, list → `GET /api/v1/agent/nodes`, delete → `DELETE /api/v1/agent/nodes/{id}`, update → `PATCH /api/v1/agent/nodes/{id}`.
7. **`handler.py` `sulcus_remember` sends `content` field** — Current API expects `label` not `content`. Also does not send `current_heat`; sends bare `heat` which the API may not understand.
8. **`tools.json` missing `fact` and `synthesis` from `memory_type` enums** — All five tools' type enum lists are incomplete.
9. **README memory types table missing `synthesis`**.

**Anthropic Tools (`integrations/anthropic-tools/`):**
10. **Same `/memories` endpoint bugs in `handler.py`** — Identical issue to OpenAI handler (both are standalone stdlib-only implementations).
11. **`tools.json` missing `fact` and `synthesis` from `memory_type` enums**.
12. **README example has an infra leak** — Anthropic README shows `"Deploy: az acr build + containerapp update"` as an example procedural memory. This leaks internal deploy process. Should use a generic example.
13. **README memory types table missing `synthesis`**.

**Vercel AI SDK (`integrations/vercel-ai/`):**
14. **Memory type enums missing `fact` and `synthesis`** — `sulcusTools()` in `src/index.ts` has hardcoded `z.enum(["episodic", "semantic", "preference", "procedural"])` in all five tools. Needs `"fact"` and `"synthesis"` added.
15. **`middleware.ts` imports from `"sulcus"` not `"@digitalforgestudios/sulcus"`** — Same for `src/index.ts`. The published npm package name is `@digitalforgestudios/sulcus`. The `sulcus` dependency in `package.json` uses `file:../../sdks/node` which is a local dev link — fine for local development but the npm-published name should be documented.
16. **`package.json` version `0.1.0`** — Should be bumped to `1.0.0` to signal stability.
17. **README says `LanguageModelV1Middleware`** — Code uses `LanguageModelV3Middleware` (which is correct for `@ai-sdk/provider` ^3.x). README doc is stale.
18. **Zod peer dependency `^4.3.6`** — Current Vercel AI SDK 6.0.201 supports `^3.25.76 || ^4.1.8`. The `^4.3.6` constraint is fine but narrow. Update to `^3.25.76 || ^4.1.8` to match the `ai` SDK's own constraint.

**CLI (`integrations/cli/`):**
19. **`cmdRemember` help text lists `episodic|semantic|preference|procedural`** — Missing `fact` and `synthesis`.
20. **CLI `remember` command doesn't accept `fact` or `synthesis` as `--type` values** — The `memoryType` cast in `cmdRemember` has the right shape (passes through as string) but the help text is wrong and users won't know valid values.

**Cross-cutting (not bugs, just gaps):**
- The Vercel AI `tool()` API correctly uses `inputSchema` (confirmed against current docs) — not a bug.
- `@ai-sdk/provider ^3.0.8` is current (`3.0.10` latest) — fine.

**Execution Plan:**

1. **Node SDK fixes (`sdks/node/src/index.ts`):**
   - Add `"fact"` and `"synthesis"` to `RememberOptions.memoryType` union; remove `"moment"` (not in live data).
   - Make `User-Agent` a named constant at file top: `const SDK_VERSION = "1.0.0";` used in `headers()`.
   - Update `SearchOptions.memoryType`, `ListOptions.memoryType`, `UpdateOptions.memoryType` type annotations to include `fact` and `synthesis` (currently typed as `string`, which is flexible — just update docstrings).

2. **Node SDK README fixes (`sdks/node/README.md`):**
   - Fix `Memory Lifecycle Control` example: `decayClass: "permanent"` → `decayClass: "glacial"`.
   - Add `synthesis` to Memory Types table.

3. **OpenAI tools handler fix (`integrations/openai-tools/handler.py`):**
   - Fix all endpoints: `/memories` → `/api/v1/agent/nodes`, `/memories/search` → `/api/v1/agent/search`, etc.
   - Fix `sulcus_remember`: send `label` not `content`.
   - Fix `sulcus_remember`: send `heat` as API expects (test: the Node SDK sends `heat` directly and it works — keep same field name but check if server uses `heat` or `current_heat` on input).

4. **OpenAI tools schema fix (`integrations/openai-tools/tools.json`):**
   - Add `"fact"` and `"synthesis"` to all `memory_type` enum arrays.

5. **OpenAI tools README fix (`integrations/openai-tools/README.md`):**
   - Add `synthesis` to memory types table.

6. **Anthropic tools handler fix (`integrations/anthropic-tools/handler.py`):**
   - Same endpoint fixes as OpenAI handler.

7. **Anthropic tools schema fix (`integrations/anthropic-tools/tools.json`):**
   - Add `"fact"` and `"synthesis"` to all `memory_type` enum arrays.

8. **Anthropic tools README fix (`integrations/anthropic-tools/README.md`):**
   - Remove infra-leaking example (`az acr build + containerapp update`). Replace with generic example.
   - Add `synthesis` to memory types table.

9. **Vercel AI fixes (`integrations/vercel-ai/src/index.ts`):**
   - Add `"fact"` and `"synthesis"` to all `z.enum()` calls.

10. **Vercel AI fixes (`integrations/vercel-ai/package.json`):**
    - Bump version to `1.0.0`.
    - Update zod peer dep to `"^3.25.76 || ^4.1.8"`.

11. **Vercel AI README fix (`integrations/vercel-ai/README.md`):**
    - Fix `LanguageModelV1Middleware` → `LanguageModelV3Middleware`.
    - Add `fact` and `synthesis` to memory types table.

12. **CLI fixes (`integrations/cli/src/index.ts`):**
    - Update `cmdRemember` help text to include `fact` and `synthesis`.
    - Update `printHelp()` to include `fact` and `synthesis` in the `--type` option.

---

### Phase 4: Documentation Overhaul
**Status:** in_progress
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

**SOA Review (2026-06-11):**

Docs directory: `docs/` (10 files), plus 20 root-level `.md` files. Key targets reviewed: `API_REFERENCE.md` (473 lines), `ARCHITECTURE.md` (65 lines), `CONCEPT.md` (539 lines), `docs/siu-v2-api.md` (501 lines), `docs/openclaw-plugin-setup.md` (249 lines), `docs/claude-code-setup.md` (131 lines).

Live server: `api.sulcus.ca` v2.25.2. Live memory types: `episodic`, `fact`, `procedural`, `semantic`, `synthesis`, `preference`.

**Issues found:**

1. **`API_REFERENCE.md` uses wrong auth header** — Says `X-API-Key: <your-api-key>` but the live API (and all working SDKs) use `Authorization: Bearer <key>`. The `X-API-Key` header does not exist in v2.25.2. The MCP section at the bottom also says `X-API-Key` — same bug.

2. **`API_REFERENCE.md` MCP tool names stale** — The bottom section lists old MCP tool names: `record_memory`, `recall_memories`, `update_memory`, `delete_memory`, `list_memories`. The live MCP server (confirmed in Phase 1) exposes: `sulcus_remember`, `sulcus_search`, `sulcus_update`, `sulcus_forget`, `sulcus_list`, `sulcus_relate`, `sulcus_fold`, `sulcus_context`, `sulcus_recall_auto`, `sulcus_hot_nodes`, `sulcus_status`, `sulcus_pin`, `sulcus_unpin`, `sulcus_feedback`, `sulcus_siu_label`, `sulcus_siu_status`, `sulcus_trigger_list`, `sulcus_trigger_create`, `sulcus_trigger_delete`.

3. **`API_REFERENCE.md` missing triggers section** — The live API has full trigger CRUD (`POST/GET/PATCH/DELETE /api/v1/triggers`, plus `/api/v1/triggers/history`, `/api/v1/triggers/feedback`). Not documented.

4. **`API_REFERENCE.md` missing SIU v2 section** — `/api/v2/siu/label`, `/api/v2/siu/status`, `/api/v2/siu/retrain`, `/api/v2/siu/signal`, `/api/v2/siu/signals` are all live but not referenced in `API_REFERENCE.md`. They live only in `docs/siu-v2-api.md`.

5. **`API_REFERENCE.md` SDK examples use wrong class name** — `SulcusClient` does not exist. The Node SDK exports `Sulcus`, the Python SDK exports `Sulcus`. `SulcusClient` is the old name.

6. **`API_REFERENCE.md` missing `fact` and `synthesis` from memory types** — The Node/create section lists type examples without `fact`/`synthesis`.

7. **`ARCHITECTURE.md` infra leak** — Line 52: `"Backend: Axum (Rust) running on Azure DS2 v2"` — specific cloud SKU is internal detail. Should just say "cloud-hosted Axum (Rust) server" or similar.

8. **`ARCHITECTURE.md` stale infra section** — The Production Infrastructure section describes a simpler architecture than what's running. The description is close enough to be acceptable but the specific VM SKU should go.

9. **`docs/siu-v2-api.md` missing `synthesis` from SICU classification types** — Line 20: `"Classifies into: episodic, semantic, preference, procedural, fact"` — missing `synthesis`. Live API classifies into all 6 types.

10. **`docs/openclaw-plugin-setup.md` references old npm package name** — Still references `@digitalforgestudios/memory-sulcus` in several places, but the current canonical npm package is `@digitalforgestudios/openclaw-sulcus` (v7.2.x). Also references plugin ID `memory-sulcus` — current canonical ID is `openclaw-sulcus`.

11. **`docs/openclaw-plugin-setup.md` missing v7.2.x features** — No mention of: namespace ACL, SILU per-agent config, trigger creation from the plugin, fold/consolidation, the Context Engine (auto_recall).

12. **`docs/claude-code-setup.md` references `npx @digitalforgestudios/sulcus`** — The MCP server package is `@digitalforgestudios/sulcus` (which wraps the Rust binary). This is likely still correct for npx usage but should be verified against what the live MCP server package name is on npm.

13. **`CONCEPT.md` is outdated** — References `OpenVMMU`, `CXL-Fabric-Manager`, `DistriPage`, `SkyPool` as competing products in the competitive landscape section (these appear to be illustrative invented products from an early draft). These are in the tail of the file and could confuse readers. The broader framing of Sulcus vs hardware-VMMU alternatives is fine but the named competitors should be either updated to real products (Mem0, MemGPT, Letta, Zep) or kept clearly labeled as fictional examples.

14. **No triggers documentation exists** — Triggers are a major feature (on_store, on_recall, on_decay, on_boost, on_relate, on_threshold) with 6 action types. No dedicated doc. Should add `docs/triggers.md`.

15. **No Context Engine documentation exists** — The auto_recall / context engine (assembles multi-signal context for agents) has no dedicated doc. Should add `docs/context-engine.md`.

**Execution Plan:**

1. **`API_REFERENCE.md` fixes:**
   - Change auth header to `Authorization: Bearer sk-...` throughout.
   - Update MCP tool names table to current 19 tools.
   - Add brief SIU v2 section (point to `docs/siu-v2-api.md` for detail).
   - Add brief Triggers section (point to `docs/triggers.md` for detail).
   - Fix SDK examples: `SulcusClient` → `Sulcus`.
   - Add `fact` and `synthesis` to memory type examples.

2. **`ARCHITECTURE.md` fix:**
   - Remove `Azure DS2 v2` VM SKU reference from the Production Infrastructure section. Replace with generic cloud reference.

3. **`docs/siu-v2-api.md` fix:**
   - Add `synthesis` to SICU classification types list.

4. **`docs/openclaw-plugin-setup.md` fix:**
   - Update npm package name: `@digitalforgestudios/memory-sulcus` → `@digitalforgestudios/openclaw-sulcus`.
   - Update plugin ID: `memory-sulcus` → `openclaw-sulcus`.
   - Update minimum version reference to v7.2.x.
   - Add section on new v7.x features (namespace ACL, SILU config, trigger creation).

5. **Create `docs/triggers.md`:**
   - Overview of reactive triggers.
   - All 6 event types (on_store, on_recall, on_decay, on_boost, on_relate, on_threshold).
   - All 6 action types (notify, boost, pin, tag, deprecate, webhook).
   - Example: auto-pin high-confidence memories, webhook on decay.
   - API endpoint reference.

6. **Create `docs/context-engine.md`:**
   - What the Context Engine is (multi-signal recall assembled client-side).
   - How `auto_recall` works: hot nodes + semantic search + graph neighbors.
   - How to use it via SDK and MCP.
   - Why it's not a server endpoint (no `/api/v1/agent/auto_recall` exists).

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
| 2026-06-11 | Phase 2 | SOA review + plan documented | 6e0b33c |
| 2026-06-11 | Phase 2 | Execute: fix Memory dict-access bugs, add fact/synthesis types, fix repo URLs, fix User-Agent, fix dependencies | 6d813ea |
| 2026-06-11 | Phase 3 | SOA review + plan documented | d5d3674 |
| 2026-06-11 | Phase 3 | Execute: fix endpoints, add fact/synthesis types, fix User-Agent, fix Vercel AI middleware type, fix CLI help | 0ecf5b8 |

