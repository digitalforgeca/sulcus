# Changelog — @digitalforgestudios/openclaw-sulcus

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [7.3.0] — 2026-06-29

### MemPalace Phase 2 — Intelligent Recall Pipeline

This release lands the full MemPalace Phase 2 recall engine: a multi-stage client-side
ranking pipeline that runs on every recall — automatic, manual, and SDK-based.

#### New: BM25 Hybrid Scoring
- Recall results ranked by fused score: **60% vector similarity + 40% BM25 lexical match**
- BM25 with tuned parameters (k1=1.2, b=0.75) for short memory content
- IDF weighting computed over the local result set
- Normalized scores fused into a single `hybridScore` per item
- If server returns `fused_score`, that takes precedence (server-side BM25)

#### New: Cosine Deduplication Filter
- Near-duplicate memories removed before ranking
- Jaccard token overlap proxy (threshold: 0.85 — ≥6/7 shared topic tokens)
- Preserves the higher-ranked item; drops duplicate
- Replaces the former Dice/MMR-lite approach

#### New: Ebbinghaus Strength Blending (Hebbian)
- When the server returns `effective_strength` (Hebbian potentiation score), blends into ranking
- Formula: `blended_heat = hybridScore × 0.7 + (effective_strength / 5.0) × 0.3`
- Memories the agent actually uses surface above equally-similar but never-accessed ones
- Fully backward-compatible: skipped when server doesn't return the field

#### New: Proactive Credential Boost
- Memories containing credentials/API keys promoted when query matches service name
- Service gating: boost only fires when credential memory matches queried service
- Pinned memories boosted by `0.4`; unpinned by `0.2`
- Scoped to `fact` and `semantic` memory types

#### New: Heat-Based Staleness Detection
- Topic-shift detection using BM25 relevance (threshold: 0.20)
- Memories with `current_heat < 0.10` considered stale candidates
- Cache bypass when topic shift detected; fresh server fetch triggered

#### Pipeline Applied Uniformly
- All three recall paths now run through the same 4-stage pipeline:
  1. BM25 hybrid rank
  2. Cosine dedup filter
  3. Hebbian strength blend
  4. Credential boost
- Paths: auto-recall hook, SDK recall, manual `memory_recall` tool, and post-compaction rebuild

#### Ebbinghaus Fields in Context + Inspect
- `strength`, `stability`, `effective_strength` wired into recall XML context
- `<memory>` tags emit `strength="X.XX"` attribute when server provides it
- `memory_inspect` output shows Ebbinghaus fields per recalled item (when present)

#### MemPalace Config in `memory_status`
- `mempalace_config` block added to `memory_status` tool output
- Exposes all pipeline constants: BM25 k1/b/threshold, hybrid weights, dedup threshold,
  Hebbian blend weights, staleness threshold, credential boost values
- Live references to constants — reflects any tuning changes automatically

#### New: Hebbian Staleness Guard
- `isStaleMemory(heat, effectiveStrength?)` extended with optional Hebbian guard
- Low-heat memories (`< 0.10`) with active Hebbian reinforcement (`effective_strength >= 1.0`)
  are no longer flagged as `stale` in context XML
- Prevents dismissal of heavily-reinforced credential facts and core identity blocks
  whose heat has naturally decayed
- Guard threshold `1.0` = 20% of Hebbian ceiling (5.0) — conservative, protects only
  memories with meaningful usage history
- `memory_status` `mempalace_config` exposes `hebbian_strength_guard` for observability

#### New: Full Pipeline in Post-Compaction Rebuild
- Post-compaction rebuild path previously used only cosine dedup (deprecated `diversityFilter`)
- Now runs the complete 4-stage MemPalace pipeline using the current turn query
- Critical fix: compaction rebuild is the highest-stakes recall (agent just lost most context)
  — it now gets the best-ranked memories, not just deduplicated ones
- Dead `diversityFilter()` wrapper removed

#### New: Full Scoring Chain in `memory_inspect`
- Each recalled item now shows a 4-point scoring progression:
  - `score`: raw server fused_score (absolute, server scale)
  - `original_score`: normalized server score before BM25 blend (0–1)
  - `hybrid_score`: pure BM25+vector score (0.6·vector + 0.4·BM25), before Hebbian
  - `final_score`: post-full-pipeline score (hybrid + Hebbian blend)
- `credential_boosted: true` shown per item when it received a heat boost
- Pipeline stats block added: `candidates_before_dedup`, `dedup_dropped`,
  `hebbian_applied`, `credential_boosted` (count)

#### New: Session-Lifetime Pipeline Stats in `memory_status`
- `recall_quality.mempalace` block added to `memory_status` output:
  ```json
  "mempalace": {
    "dedup_dropped_total": 7,
    "hebbian_turns": 4,
    "hebbian_rate_pct": 40.0,
    "cred_boosted_total": 2,
    "temporal_turns": 3
  }
  ```
- Tracks all 5 pipeline stages: total dedup drops, turns where Hebbian data returned
  from server, Hebbian rate as a percentage of fresh recalls, total credential boosts,
  and turns where temporal reranking fired
- Useful for answering: "is MemPalace deduplicating? Is Hebbian data coming back?"

#### New: Stage 5 — Temporal Reranking
- When a query contains temporal keywords ("recent", "latest", "history", "when",
  "last week", etc.), results are re-sorted chronologically oldest-first after all
  other pipeline stages
- Applied uniformly across all 4 recall paths: hook, SDK, tool, rebuild
- `temporal_query: true` appears in `memory_inspect` pipeline block when it fires
- `temporal_turns` counter added to `memory_status` session-lifetime MemPalace stats
- `isTemporalQuery`, `temporalRerank`, `parseISOMs` exported from `src/recall-ranking.ts`
  for testability

#### New: SIRU Recall Logging for Post-Compaction Rebuild
- Post-compaction rebuild path now posts recall session metadata to SIRU for adaptive scoring
- Previously: hook and SDK paths both logged to SIRU; rebuild path ran the full pipeline
  but never contributed training signal to SIRU's adaptive weight learning
- Rebuild always logs (no topic-shift cache gate — rebuilds are always fresh fetches)
- Uses `REBUILD_TOKEN_BUDGET` constant (not `TOKEN_BUDGET`) — correct for post-compaction budget
- `hot_count=0` in rebuild SIRU log (pure semantic, no graph expansion step in rebuild)
- Manual `memory_recall` tool path intentionally excluded: explicit tool calls are not
  session turns, so SIRU training signal from them would be noisy and misleading
- All 3 auto-recall paths (hook, SDK, rebuild) now consistently post to SIRU

#### New: Hebbian Analytics in `memory_status`
- `hebbian_analytics` block added to `memory_status` output (requires server v2.27+)
- Sources from new `GET /api/v1/agent/compaction-stats` endpoint
- Exposes: Hebbian per-namespace stats, Ebbinghaus strength distribution, episodic memory
  count, memories active in last 24h, recall pattern telemetry, top-5 most-reinforced memories
- Graceful null fallback when server pre-endpoint or unavailable

#### Improved: `memory_inspect` Pipeline Observability
- All 5 pipeline stages now visible in the `pipeline` block:
  1. `candidates_before_dedup` — items entering the pipeline
  2. `dedup_dropped` — near-duplicates removed by cosine dedup
  3. `hebbian_applied` — whether Hebbian blending changed any ranking
  4. `credential_boosted` — count of credential-boosted items
  5. `temporal_query` — whether temporal reranking fired
- Added `topic_shift_relevance` + `cache_threshold` to pipeline block (hook/SDK paths)
  so you can see the BM25 score that drove the cache vs fresh decision
- `path` field now distinguishes all 4 recall paths: `"hook"`, `"sdk"`, `"rebuild"`, `"tool"`
- All 4 recall paths now write to `inspectBuffer.lastRecall` — previously rebuild and
  tool paths left stale hook/SDK snapshots after they fired

#### Fixed: Rebuild Path Consistency
- Post-compaction rebuild now uses `isStaleMemory()` with Hebbian guard (was: raw 30-day
  date check that bypassed the Step 10 guard)
- Rebuild XML now emits `strength=` attribute (was: missing; hook+SDK both emitted it)
- Rebuild path now increments all session-lifetime MemPalace counters (Stages 1–5)
- All 4 recall paths fully consistent: same pipeline stages, same staleness logic,
  same XML attribute set, same `recallQM` and `inspectBuffer` updates

### Testing
- Extracted pure ranking functions into `src/recall-ranking.ts` testable module
- **130 unit + integration tests** covering:
  - BM25 tokenizer, scoring, IDF weighting, normalization
  - Hybrid ranking, promotion, tie-breaking
  - Cosine dedup filter
  - Credential boost (service gating, pinned/unpinned, type filtering)
  - Topic-shift detection
  - Hebbian strength blending (formula, clamping, ranking flips, mixed sets)
  - Hebbian staleness guard (guard boundary, override behavior, backward compat)
  - `_hybridHeat` tracking in blendHebbianStrength (no-op path and Hebbian path)
  - Temporal query detection, ISO timestamp parsing, chronological reranking
  - Rebuild path temporal rerank integration + non-temporal skip
  - Rebuild path isStaleMemory Hebbian guard (5 tests)
  - `mempalaceTemporalTurns` counting across all 4 paths (3 tests)
  - Rebuild path `InspectRecallSnapshot` path field (4 tests)
  - Tool path `InspectRecallSnapshot` path + stale-cache guard (7 tests)
  - `topic_shift_relevance` capture, boundary, null paths, render logic (8 tests)
  - Rebuild path SIRU logging: no-cache-gate, budget constant, hot_count=0, candidates_total,
    semantic_count, entity_hints capping (6 tests)
  - Full pipeline integration (8+ end-to-end scenarios with mock server responses)
- `npm test` script added
- `npm run typecheck` script added

### Documentation
- `ARCHITECTURE.md`: Section 7 expanded (server retrieval, Ebbinghaus model, client MemPalace
  stages), Section 12 added (MemPalace end-to-end flow diagram + tuning reference table)
- `README.md`: MemPalace Recall Pipeline section, expanded Multi-Signal Recall, full tuning reference

---

## [7.2.1] — 2026-06 (prior)

- Context Engine Phase 1: removed all destructive trimming
- BM25 hybrid scoring (initial recovery)
- Cosine dedup, BM25 topic-shift, credential boost (initial)
- Platform-specific binary optional deps
- Local-only mode for auto-recall path
- Sync status in `memory_status`

## [7.2.0] — 2026-06 (prior)

- Context Engine multi-phase refactor
- Phase 1d: shutdown hook + autoLaunch init
- Tags system + no-delete policy
- API reference, architecture, README updates

---

*Older releases not documented here. See git log for full history.*
