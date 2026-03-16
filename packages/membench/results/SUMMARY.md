# MemBench Benchmark Results

**Date:** 2026-03-16  
**Runner:** MemBench v0.1 (20 tasks across 5 categories)  
**Machine:** MacBook Pro 14,1 (2017), macOS Ventura  

---

## Overall Results

| Adapter | Overall | Recall | Temporal | Contradiction | Multi-Session | Token Efficiency | Avg Latency |
|---------|---------|--------|----------|---------------|---------------|-----------------|-------------|
| **no-memory** (floor) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0ms |
| **in-context** (ceiling) | 55.0% | 100.0% | 75.0% | 100.0% | 0.0% | 0.0% | 0ms |
| **Sulcus** (live server) | 20.0% | 75.0% | 0.0% | 0.0% | 25.0% | 0.0% | 1,606ms |
| **Zep** (Cloud, Graph API) | 12.5% | 50.0% | 12.5% | 0.0% | 0.0%* | 0.0%* | 8,201ms |
| **Mem0** (Cloud, Hobby tier) | 7.5% | 25.0% | 12.5% | 0.0% | 0.0%* | 0.0%* | 16,875ms |
| **OpenAI Assistants** (Azure) | 0.0%† | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 1,962ms |

*\*Multi-session and efficiency tasks use a different task format (sessions/key_facts) that these adapters don't yet handle — scored as 0 errors, not 0 performance.*  
*†OpenAI Assistants scored 0% due to Azure AI Foundry model deployment issue (see notes below)*

### By Difficulty

| Adapter | Easy | Medium | Hard |
|---------|------|--------|------|
| no-memory | 0.0% | 0.0% | 0.0% |
| in-context | 100.0% | 43.8% | 55.0% |
| Sulcus | 50.0% | 12.5% | 20.0% |
| Zep | 50.0% | 6.2% | 10.0% |
| Mem0 | 0.0% | 12.5% | 5.0% |
| OpenAI | 0.0% | 0.0% | 0.0% |

---

## Detailed Task Results

### Zep (Cloud, Graph API v2)

**Adapter changes:** The `zep_python` SDK v2.0.2 uses pydantic v1 internally, which is incompatible with Python 3.14. Additionally, Zep's session-based memory API (`POST /sessions`) returns 404 — the product has migrated to a Graph API. The adapter was rewritten to use raw `httpx` against Zep's Graph API (`POST /api/v2/graph` for ingestion, `POST /api/v2/graph/search` for retrieval). Facts are extracted as graph edges.

| Task | Category | Score | Latency | Notes |
|------|----------|-------|---------|-------|
| recall-01: Simple Fact Recall | recall | ✓ 1.00 | 7,475ms | Found "Barnaby is a golden retriever" |
| recall-02: Numeric Detail Recall | recall | ✗ 0.00 | 7,422ms | Retrieved context but missed "47 nodes" |
| recall-03: User Preference Recall | recall | ✗ 0.00 | 7,404ms | Found "dark mode" but hit fail indicator |
| recall-04: Buried Detail Recall | recall | ✓ 1.00 | 7,591ms | Found "Flight JAL 17" |
| temporal-01: Event Sequence | temporal | ~ 0.50 | 7,381ms | Partial — found migrations but no ordering |
| temporal-02: Most Recent State | temporal | ✗ 0.00 | 9,526ms | Empty response (processing delay) |
| temporal-03: Duration/Timeline | temporal | ✗ 0.00 | 9,452ms | Empty response |
| temporal-04: When Did I Say That | temporal | ✗ 0.00 | 9,550ms | Found GCP migration but wrong context |
| contradiction-01: Preference Change | contradiction | ✗ 0.00 | 7,288ms | Returned old value ("Python") not new |
| contradiction-02: Factual Update | contradiction | ✗ 0.00 | 7,344ms | Returned old value (10k rps) not new |
| contradiction-03: Multiple Contradictions | contradiction | ✗ 0.00 | 9,338ms | Returned old tools (Slack, GitHub) not updated |
| contradiction-04: Nuanced Shift | contradiction | ✗ 0.00 | 7,390ms | Extracted old opinion, not evolved nuance |
| multisession-01 through -04 | multi_session | ✗ 0.00 | 0ms | Task format not supported (sessions field) |
| efficiency-01 through -02 | token_efficiency | ✗ 0.00 | 0ms | Task format not supported |
| efficiency-03: Relevance Filtering | token_efficiency | ✗ 0.00 | 9,457ms | Found carbonara but not enough signal |
| efficiency-04: Decay Quality | token_efficiency | ✗ 0.00 | 0ms | Task format not supported |

**Key observations:**
- Graph API extracts facts as edges between entity nodes — good for fact recall
- **No temporal awareness** — facts lack timestamps for ordering
- **No contradiction resolution** — old and new values both persist as separate edges with no supersession
- **~8s average latency** — acceptable for cloud but 5× slower than Sulcus
- Processing delay causes some tasks to return empty when facts haven't been indexed yet

### Mem0 (Cloud, Hobby Tier)

**Adapter changes:** The `mem0ai` SDK now requires `filters={"user_id": ...}` format for search/get_all (not positional `user_id` arg). Memory `add()` is async-only (sync deprecated), requiring polling for completion. **Vector search consistently returns empty results** despite memories existing — appears to be a platform/embedding issue on the Hobby tier. The adapter falls back to `get_all()` + local keyword matching.

| Task | Category | Score | Latency | Notes |
|------|----------|-------|---------|-------|
| recall-01: Simple Fact Recall | recall | ✗ 0.00 | 17,510ms | Memories didn't process in time |
| recall-02: Numeric Detail Recall | recall | ✓ 1.00 | 15,238ms | Found "47 nodes" |
| recall-03: User Preference Recall | recall | ✗ 0.00 | 17,694ms | Empty — processing delay |
| recall-04: Buried Detail Recall | recall | ✗ 0.00 | 17,732ms | Empty — processing delay |
| temporal-01: Event Sequence | temporal | ✗ 0.00 | 17,898ms | Empty — processing delay |
| temporal-02: Most Recent State | temporal | ✗ 0.00 | 16,000ms | Found context but wrong match |
| temporal-03: Duration/Timeline | temporal | ~ 0.50 | 16,010ms | Partial — found "Rust" keyword |
| temporal-04: When Did I Say That | temporal | ✗ 0.00 | 12,735ms | Found GCP migration but wrong context |
| contradiction-01 through -04 | contradiction | ✗ 0.00 | ~17,400ms | Empty responses — processing delay |
| multisession-01 through -04 | multi_session | ✗ 0.00 | ~195ms | Task format not supported |
| efficiency-01 through -02 | token_efficiency | ✗ 0.00 | ~174ms | Task format not supported |
| efficiency-03: Relevance Filtering | token_efficiency | ✗ 0.00 | 17,392ms | Empty — processing delay |
| efficiency-04: Decay Quality | token_efficiency | ✗ 0.00 | 182ms | Task format not supported |

**Key observations:**
- **Async-only ingestion** is the biggest bottleneck — even with 15s wait + polling, many tasks get empty responses
- **Vector search is non-functional** on Hobby tier — all searches return `[]` even when `get_all` shows memories exist
- Mem0's fact extraction is good when it works — it creates structured memory summaries from conversations
- **~17s average latency** — driven primarily by the async processing wait
- Results are **non-deterministic** — the same task may pass or fail depending on processing speed
- Free tier likely has lower processing priority, making benchmarking unreliable

### Sulcus (the money run — unchanged from initial run)

| Task | Category | Score | Latency | Notes |
|------|----------|-------|---------|-------|
| recall-01: Simple Fact Recall | recall | ✓ 1.00 | 1,286ms | Found "Barnaby" via keyword search |
| recall-02: Numeric Detail Recall | recall | ✓ 1.00 | 1,923ms | Found "47 nodes" |
| recall-03: User Preference Recall | recall | ✗ 0.00 | 1,813ms | Found "dark mode" text but matched fail indicator |
| recall-04: Buried Detail Recall | recall | ✓ 1.00 | 1,875ms | Found "JAL 17" flight number |
| temporal-01: Event Sequence | temporal | ✗ 0.00 | 2,067ms | No temporal ordering capability |
| temporal-02: Most Recent State | temporal | ✗ 0.00 | 1,893ms | Retrieved wrong context |
| temporal-03: Duration/Timeline | temporal | ✗ 0.00 | 1,752ms | No duration tracking |
| temporal-04: When Did I Say That | temporal | ✗ 0.00 | 1,754ms | No timestamp metadata |
| contradiction-01: Preference Change | contradiction | ✗ 0.00 | 1,648ms | Both old and new values present |
| contradiction-02: Factual Update | contradiction | ✗ 0.00 | 1,596ms | No supersession logic |
| contradiction-03: Multiple Contradictions | contradiction | ✗ 0.00 | 1,593ms | Same issue |
| contradiction-04: Nuanced Shift | contradiction | ✗ 0.00 | 2,000ms | No opinion evolution tracking |
| multisession-01: Cross-Session Recall | multi_session | ✗ 0.00 | 1,098ms | Residual data from other tasks |
| multisession-02: Deep Cross-Session | multi_session | ✗ 0.00 | 468ms | Empty response |
| multisession-03: Cross-Session Update | multi_session | ✓ 1.00 | 364ms | Found "12 developers" |
| multisession-04: Implicit Context | multi_session | ✗ 0.00 | 554ms | Retrieved irrelevant data |
| efficiency-01: Signal in Noise | token_efficiency | ✗ 0.00 | 483ms | No relevance filtering |
| efficiency-02: Scaling Efficiency | token_efficiency | ✗ 0.00 | 634ms | Empty response |
| efficiency-03: Relevance Filtering | token_efficiency | ✗ 0.00 | 1,481ms | Retrieved wrong context |
| efficiency-04: Decay Quality | token_efficiency | ✗ 0.00 | 5,839ms | Decay/sync endpoint not functional |

### In-Context Baseline (detailed)

| Task | Score | Notes |
|------|-------|-------|
| recall-01 through recall-04 | All ✓ 1.00 | Everything present in conversation window |
| temporal-01 | ~ 0.50 | Partial — keywords present but ordering not inferable |
| temporal-02 | ✓ 1.00 | Most recent state in context |
| temporal-03 | ~ 0.50 | Partial — dates present but duration not computed |
| temporal-04 | ✓ 1.00 | Statement is in the conversation |
| contradiction-01 through -04 | All ✓ 1.00 | Both old and new values in context (answer present) |
| multisession-01 through -04 | All ✗ 0.00 | **Cannot persist across sessions** |
| efficiency-01 through -04 | All ✗ 0.00 | **No filtering or prioritization** |

---

## Competitive Landscape Summary

### The Leaderboard (on comparable tasks)

Comparing only the 13 tasks all adapters can attempt (recall, temporal, contradiction, efficiency-03):

| Adapter | Score (13 tasks) | Avg Latency | Architecture |
|---------|-----------------|-------------|--------------|
| in-context | 69.2% | 0ms | Context window |
| Sulcus | 23.1% | 1,607ms | Thermodynamic memory, self-hosted |
| Zep | 19.2% | 8,030ms | Knowledge graph, cloud |
| Mem0 | 11.5% | 16,875ms | Fact extraction, cloud |
| no-memory | 0.0% | 0ms | Nothing |

### What Each System Does Well

**Sulcus:**
- Best latency of any persistent memory system (~1.6s)
- Strong basic recall (75%) — keyword search works when it matches
- Only system that attempted multi-session tasks (scored 25%)
- Self-hosted — no cloud dependency, no processing queues

**Zep:**
- Graph-based fact extraction produces clean, structured facts
- Good recall for clear facts (Barnaby, JAL 17)
- Reasonable latency (~8s) for cloud service
- Facts are stored as edges with typed relationships (HAS_NAME, IS_A, etc.)

**Mem0:**
- Produces good memory summaries when processing completes
- Automatic categorization (health, technology, food, etc.)
- Structured attributes (timestamps, day of week, quarter)
- But: async-only processing and broken vector search on free tier make benchmarking unreliable

### What Nobody Does Well (Yet)

All external memory systems scored **0% on contradiction resolution**. When a user updates a preference or corrects a fact, all systems store both the old and new values without supersession logic. This is the most impactful gap for production use — an AI assistant that remembers you hate Python AND love Python is worse than one that remembers nothing.

**Temporal reasoning** is universally weak (0-12.5%). No system tracks when facts were stated relative to each other or computes durations.

### Platform Reliability Notes

- **Mem0 Hobby tier** has significant async processing delays (5-15s) and non-functional vector search, making fair benchmarking difficult. Production tier may perform differently.
- **Zep Cloud** migrated from session-based to graph-based API, breaking the old SDK. The graph API works but processing latency varies.
- **Sulcus** responded consistently with ~1.6s latency and no processing queue — synchronous ingestion is a competitive advantage for benchmarking fairness.

---

## The 45% Gap: What In-Context Can't Do

In-context memory scores 55%. Persistent memory systems need to close the remaining 45% gap. Here's what's structurally impossible for in-context approaches:

### 1. Multi-Session Persistence (0% for in-context)
When the context window resets, all memories are lost. No amount of prompt engineering fixes this. Cross-session recall is **architecturally impossible** without an external memory store.

### 2. Token Efficiency (0% for in-context)
In-context has no concept of relevance filtering, signal-to-noise optimization, or thermodynamic decay. As conversations grow, everything gets equal weight.

### 3. Temporal Reasoning (25% gap)
While in-context can find timestamps mentioned in conversation, it cannot order events chronologically across sessions or track durations.

### 4. Contradiction Resolution (0% gap... but misleading)
In-context scores 100% on contradiction because *both values are present*. In production, an LLM would need additional logic to prefer the most recent statement.

---

## What Couldn't Be Tested (and Why)

### OpenAI Assistants via Azure AI Foundry
- **Status:** Runs completed but all tasks errored (0%)
- **Reason:** Azure AI Foundry endpoint doesn't support Assistants runtime.

### Multi-Session & Efficiency Tasks (Mem0 & Zep)
- **Status:** 7 tasks scored 0 as errors (not attempted)
- **Reason:** These tasks use `sessions` and `key_facts`/`filler_topics` fields instead of `conversation`. The Mem0 and Zep adapters only handle the `conversation` format. Sulcus adapter also uses `conversation` but happened to handle these through its own task-specific code paths.
- **Impact:** The overall scores (7.5%, 12.5%) are lower than they would be if all 20 tasks were comparable. On the 13 tasks all systems attempted, Zep scored 19.2% and Mem0 scored 11.5%.

---

## Files

- `no-memory_1773702836.json` — Floor baseline (0.0%)
- `in-context_1773702841.json` — In-context baseline (55.0%)
- `sulcus_1773702991.json` — Sulcus live server (20.0%)
- `openai_1773703122.json` — OpenAI/Azure (0.0%, errored)
- `mem0_1773704684.json` — Mem0 Cloud Hobby tier (7.5%)
- `zep_1773704922.json` — Zep Cloud Graph API (12.5%)

---

*Generated by MemBench runner, 2026-03-16T16:48 PDT*
