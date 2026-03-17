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
| **Mem0** (Hobby tier) | 35.0% | 75.0% | 25.0% | 0.0% | 75.0% | 0.0% | ~14,500ms |
| **Zep** (Flex tier) | 30.0% | 75.0% | 25.0% | 0.0% | 50.0% | 0.0% | 7,916ms |
| **OpenAI Assistants** (Azure) | 0.0%* | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 1,962ms |

*\*OpenAI Assistants scored 0% due to Azure AI Foundry model deployment issue (see notes below)*

### By Difficulty

| Adapter | Easy | Medium | Hard |
|---------|------|--------|------|
| no-memory | 0.0% | 0.0% | 0.0% |
| in-context | 100.0% | 43.8% | 55.0% |
| Sulcus | 50.0% | 12.5% | 20.0% |
| Mem0 | 50.0% | 31.2% | 35.0% |
| Zep | 50.0% | 31.2% | 25.0% |
| OpenAI | 0.0% | 0.0% | 0.0% |

---

## Detailed Task Results

### Mem0 (Hobby Tier)

> **Run file:** `mem0_1773705525.json` | **Total time:** 274.7s | **Avg latency:** ~14,500ms

| Task | Category | Score | Latency | Notes |
|------|----------|-------|---------|-------|
| recall-01: Simple Fact Recall | recall | ✓ 1.00 | 12,898ms | Found "Barnaby" |
| recall-02: Numeric Detail Recall | recall | ✓ 1.00 | 12,901ms | Found "47 nodes" |
| recall-03: User Preference Recall | recall | ✗ 0.00 | 12,907ms | Fail indicator: "light" in "dark mode prevents light headaches" |
| recall-04: Buried Detail Recall | recall | ✓ 1.00 | 16,250ms | Found "JAL 17" |
| temporal-01: Event Sequence | temporal | ~ 0.50 | 12,832ms | Partial: date found, not sequence |
| temporal-02: Most Recent State | temporal | ✗ 0.00 | 20,377ms | Both old and new job stored (no recency) |
| temporal-03: Duration/Timeline | temporal | ~ 0.50 | 12,860ms | Partial: start/end dates found, not duration |
| temporal-04: When Did I Say That | temporal | ✗ 0.00 | 22,766ms | No timestamp metadata |
| contradiction-01: Preference Change | contradiction | ✗ 0.00 | 21,867ms | Both old and new values stored |
| contradiction-02: Factual Update | contradiction | ✗ 0.00 | 12,899ms | Both states stored; old value triggers fail indicator |
| contradiction-03: Multiple Contradictions | contradiction | ✗ 0.00 | 20,378ms | All contradictions retained |
| contradiction-04: Nuanced Shift | contradiction | ✗ 0.00 | 15,398ms | Old opinion triggers fail indicator |
| multisession-01: Cross-Session Recall | multi_session | ✓ 1.00 | 8,426ms | Found "Mercury" and "5ms" |
| multisession-02: Deep Cross-Session | multi_session | ✓ 1.00 | 10,833ms | Found "March 22" and "Chez Laurent" |
| multisession-03: Cross-Session Update | multi_session | ✗ 0.00 | 17,627ms | Old team data triggers fail indicator |
| multisession-04: Implicit Context | multi_session | ✓ 1.00 | 11,285ms | Found "pnpm" and "TypeScript" |
| efficiency-01: Signal in Noise | token_efficiency | ✗ 0.00 | 5,910ms | Correct answer found but scoring uses `accuracy.exact` (different schema) |
| efficiency-02: Scaling Efficiency | token_efficiency | ✗ 0.00 | 169ms | No conversation data — meta-task |
| efficiency-03: Relevance Filtering | token_efficiency | ✗ 0.00 | 10,596ms | Irrelevant facts retrieved |
| efficiency-04: Thermodynamic Decay | token_efficiency | ✗ 0.00 | 15,543ms | No decay engine |

**Score: 35.0% (6 passed, 1 partial credit, 13 failed)**

#### Mem0 Notes
- Processing is fully async — memories take 8–22s to appear via `get_all()`
- Vector search (`search()`) returns empty on Hobby tier; fallback to `get_all()` + local keyword matching
- Mem0 condenses messages into abstract facts (e.g. "User has a golden retriever named Barnaby") — this improves keyword matching over raw conversation
- Contradiction scoring fails because Mem0 stores *both* old and new values without supersession
- Multi-session works by using separate user IDs per session-group, then ingesting all sessions together
- **Non-deterministic**: timing-sensitive on free tier; first run scored 17.5%, this run scored 35.0%

---

### Zep (Flex Tier — Graph API)

> **Run file:** `zep_1773705141.json` | **Total time:** 150.4s | **Avg latency:** 7,916ms

| Task | Category | Score | Latency | Notes |
|------|----------|-------|---------|-------|
| recall-01: Simple Fact Recall | recall | ✓ 1.00 | 7,698ms | Found "Barnaby" |
| recall-02: Numeric Detail Recall | recall | ✓ 1.00 | 9,547ms | Found "47 nodes" |
| recall-03: User Preference Recall | recall | ✗ 0.00 | 7,339ms | Fail indicator: "light" in "light themes cause headaches" |
| recall-04: Buried Detail Recall | recall | ✓ 1.00 | 7,444ms | Found "JAL 17" |
| temporal-01: Event Sequence | temporal | ~ 0.50 | 7,391ms | Partial: "January" found, not full sequence |
| temporal-02: Most Recent State | temporal | ✗ 0.00 | 7,417ms | Old job still in graph; fail indicator hit |
| temporal-03: Duration/Timeline | temporal | ~ 0.50 | 7,412ms | Partial: "September 2024" found |
| temporal-04: When Did I Say That | temporal | ✗ 0.00 | 7,401ms | No attribution metadata |
| contradiction-01: Preference Change | contradiction | ✗ 0.00 | 7,234ms | Old preference triggers fail indicator |
| contradiction-02: Factual Update | contradiction | ✗ 0.00 | 7,320ms | Old value "10,000" still in graph |
| contradiction-03: Multiple Contradictions | contradiction | ✗ 0.00 | 7,449ms | All old tools retained |
| contradiction-04: Nuanced Shift | contradiction | ✗ 0.00 | 7,218ms | Old opinion in graph |
| multisession-01: Cross-Session Recall | multi_session | ✓ 1.00 | 9,278ms | Found "Mercury" |
| multisession-02: Deep Cross-Session | multi_session | ✓ 1.00 | 7,603ms | Found "March 22" and "Chez Laurent" |
| multisession-03: Cross-Session Update | multi_session | ✗ 0.00 | 9,140ms | Empty response |
| multisession-04: Implicit Context | multi_session | ✗ 0.00 | 9,302ms | "JavaScript" triggers fail indicator |
| efficiency-01: Signal in Noise | token_efficiency | ✗ 0.00 | 7,072ms | Found "Meridian Systems" but not all 4 facts |
| efficiency-02: Scaling Efficiency | token_efficiency | ✗ 0.00 | 1ms | No conversation data — meta-task |
| efficiency-03: Relevance Filtering | token_efficiency | ✗ 0.00 | 7,341ms | Wrong facts retrieved |
| efficiency-04: Thermodynamic Decay | token_efficiency | ✗ 0.00 | 9,792ms | No decay engine |

**Score: 30.0% (5 passed, 2 partial credit, 13 failed)**

#### Zep Notes
- Uses Graph API (v2): ingests messages as episodic text nodes, extracts facts as graph edges
- Consistent ~7–10s latency per task — faster and more predictable than Mem0
- Graph extraction is reliable: entity relationships stored as edges with fact strings
- Contradiction scoring fails because graph stores all facts; no supersession of outdated edges
- Multi-session: Zep scored on 2/4 multi-session tasks — deeper context recall works well
- `recall-03` and `multisession-04` fail due to scoring false positives from fail indicators ("light", "JavaScript") present in correctly-recalled memories
- Session-based memory API (`/sessions`) no longer functional in v2 cloud; Graph API is the active path

---

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

### Sulcus (Live Server)

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

---

## Competitive Analysis

### Where Each System Wins

| Category | Winner | Why |
|----------|--------|-----|
| **Speed** | Sulcus | 1–2s per task vs 8–22s (Mem0) or 7–10s (Zep) |
| **Recall** | Tied: Sulcus / Mem0 / Zep | All at 75% — basic fact retrieval works for all |
| **Temporal** | Tied: Mem0 / Zep | Both at 25%; Sulcus 0% (no timestamp-based retrieval) |
| **Contradiction** | Nobody | All at 0% — none resolve contradictions via supersession |
| **Multi-Session** | Mem0 | 75% vs Zep 50% vs Sulcus 25% |
| **Predictability** | Zep | Consistent 7–10s; Mem0 is non-deterministic (free tier) |
| **Token Efficiency** | Nobody | All at 0% — scoring requires special evaluation not yet wired |

### The 45% Gap: What In-Context Can't Do

In-context memory scores 55%. Persistent memory systems need to close the remaining 45% gap. Here's what's structurally impossible for in-context approaches:

**1. Multi-Session Persistence (0% for in-context)**  
When the context window resets, all memories are lost. Cross-session recall is architecturally impossible without an external memory store.

**2. Token Efficiency (0% for in-context)**  
In-context has no concept of relevance filtering or thermodynamic decay. As conversations grow, everything gets equal weight.

**3. Temporal Reasoning (25% gap)**  
In-context can find timestamps mentioned in conversation, but cannot order events across sessions or compute durations.

**4. Contradiction Resolution (0% gap... misleading)**  
In-context scores 100% on contradiction because both old and new values are present in the window. In production, an LLM would need additional logic to prefer the most recent statement.

### Where Sulcus Needs to Grow

Sulcus matches competitors on recall speed but falls behind on temporal reasoning and multi-session consistency. Key gaps vs Mem0/Zep:

1. **Temporal indexing** — Mem0 and Zep both score 25% on temporal; Sulcus 0%. Need `updated_at`-aware retrieval for "most recent X" queries.
2. **Multi-session isolation** — Sulcus multi-session at 25% vs 50–75% for competitors. Cross-session contamination (residual data from prior tasks) hurt the score.
3. **Contradiction resolution** — All systems at 0%. This is an unsolved problem across the board — first to implement supersession logic wins.
4. **Speed advantage** — Sulcus at 1–2s is **5–15x faster** than competitors. This matters at scale.

### Path to Higher Scores (Sulcus)

| Feature | Current | With Fix | Expected Gain |
|---------|---------|----------|---------------|
| Vector/semantic search | Keyword only | Embedding search | +25% recall |
| Temporal indexing | None | `updated_at` sort | +25% temporal |
| Supersession logic | None | Contradiction detection | +50% contradiction |
| Decay → retrieval ranking | Wired but silent | Heat-based sort | +10% efficiency |
| Combined | **20%** | All above | **~65–75%** |

A fully-implemented Sulcus should **beat both Mem0 and Zep** on overall score while maintaining its speed advantage.

---

## Scoring Notes

### Known Scoring Artifacts

**recall-03 / multisession-04 (false fail indicators)**  
Both Mem0 and Zep correctly recall "dark mode" preferences and "pnpm" preferences, but the response text also contains the contrast ("light themes cause headaches", "not JavaScript") which triggers fail indicators. The scoring system penalizes correctly-recalled context that happens to mention the negative. This is a benchmark limitation — not a system failure.

**efficiency-01 (Mem0 had the right answer, scored 0)**  
Mem0 correctly retrieved "Meridian Systems, 230 employees, $42 million, CTO Sarah Chen" for efficiency-01, but the task's `scoring` field uses `accuracy.exact` (nested) instead of the flat `exact` format the scorer reads. This is a task schema inconsistency — efficiency tasks have a different scoring format not yet wired into `score_standard()`. The 0% for token_efficiency across all adapters reflects this structural gap, not adapter failure.

**efficiency-02 (meta-task)**  
This task describes a measurement protocol (run at 10, 50, 100, 500, 1000 message counts and plot curves) — it has no conversation data. All adapters skip it with an error. This task requires a dedicated benchmarking harness, not a single-pass adapter call.

**Mem0 non-determinism**  
Mem0 Hobby tier async processing timing varies run to run. First run (8s wait): 17.5%. Second run (20s wait): 35.0%. The result depends on whether memories have finished processing when the poll fires. Production tiers likely have tighter, more consistent SLAs.

---

## What Couldn't Be Tested (and Why)

### OpenAI Assistants via Azure AI Foundry
- **Status:** Runs completed but all tasks errored (0%)
- **Reason:** Azure AI Foundry's serverless endpoints don't provision Assistants API runtime; `runs.create_and_poll` fails with `No connection matching model: gpt-4o-mini`.
- **What would be needed:** Deploy via Azure OpenAI Service (not AI Foundry) with Assistants API support enabled.

### Token Efficiency (all adapters)
- **Status:** 0% across the board
- **Reason:** Efficiency tasks use a different scoring schema (`accuracy.exact` nested vs flat `exact`) and efficiency-02 is a meta-task. The benchmark correctly measures 0 — the scoring harness needs extension to support these task types.

---

## Files

| File | Adapter | Score | Date |
|------|---------|-------|------|
| `no-memory_1773702836.json` | no-memory (floor) | 0.0% | 2026-03-16 |
| `in-context_1773702841.json` | in-context (ceiling) | 55.0% | 2026-03-16 |
| `sulcus_1773702991.json` | Sulcus live server | 20.0% | 2026-03-16 |
| `openai_1773703122.json` | OpenAI/Azure | 0.0% (errored) | 2026-03-16 |
| `mem0_1773705525.json` | Mem0 Hobby tier | 35.0% | 2026-03-16 |
| `zep_1773705141.json` | Zep Flex tier | 30.0% | 2026-03-16 |

---

*Generated by MemBench runner, 2026-03-16 PDT*
