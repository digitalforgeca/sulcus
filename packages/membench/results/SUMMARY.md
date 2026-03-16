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
| **OpenAI Assistants** (Azure) | 0.0%* | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 1,962ms |

*\*OpenAI Assistants scored 0% due to Azure AI Foundry model deployment issue (see notes below)*

### By Difficulty

| Adapter | Easy | Medium | Hard |
|---------|------|--------|------|
| no-memory | 0.0% | 0.0% | 0.0% |
| in-context | 100.0% | 43.8% | 55.0% |
| Sulcus | 50.0% | 12.5% | 20.0% |
| OpenAI | 0.0% | 0.0% | 0.0% |

---

## Detailed Task Results

### Sulcus (the money run)

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

## The 45% Gap: What In-Context Can't Do

In-context memory scores 55%. Persistent memory systems need to close the remaining 45% gap. Here's what's structurally impossible for in-context approaches:

### 1. Multi-Session Persistence (0% for in-context)
When the context window resets, all memories are lost. No amount of prompt engineering fixes this. Cross-session recall is **architecturally impossible** without an external memory store.

### 2. Token Efficiency (0% for in-context)
In-context has no concept of relevance filtering, signal-to-noise optimization, or thermodynamic decay. As conversations grow, everything gets equal weight. A system that can't distinguish "user is allergic to penicillin" from "user asked about Python syntax" will drown in noise.

### 3. Temporal Reasoning (25% gap)
While in-context can find timestamps mentioned in conversation, it cannot:
- Order events chronologically across sessions
- Track duration of states over time
- Know *when* something was said relative to the current moment

### 4. Contradiction Resolution (0% gap... but misleading)
In-context scores 100% on contradiction because *both the old and new values are present in the window*. A text-match scorer finds the answer. But in production, an LLM reading contradictory information in context would need additional logic to prefer the most recent statement — something in-context provides no mechanism for.

---

## What Couldn't Be Tested (and Why)

### OpenAI Assistants via Azure AI Foundry
- **Status:** Runs completed but all tasks errored (0%)
- **Reason:** Azure AI Foundry's model-as-a-service endpoints accept Assistants API calls (assistant creation, thread creation succeed), but `runs.create_and_poll` fails with `No connection matching model: gpt-4o-mini`. This is because the Azure endpoint requires a specifically deployed model connection for the Assistants runtime — the serverless inference catalog doesn't automatically provision this.
- **What would be needed:** Deploy a model specifically through Azure OpenAI Service (not AI Foundry) with Assistants API support enabled, OR use OpenAI's direct API with a real API key.

### Mem0
- **Status:** Not tested
- **Reason:** No API key available. Mem0 has a free "Hobby" tier (10,000 memories, 1,000 retrieval calls/month) which would be sufficient for benchmarking.
- **What would be needed:** Sign up at `https://app.mem0.ai`, get an API key, then run: `--adapter mem0 --api-key <key>`
- **Install:** `pip install mem0ai`

### Zep
- **Status:** Not tested
- **Reason:** No API key available. Zep offers 1,000 free credits/month on their Flex tier.
- **What would be needed:** Sign up at `https://app.getzep.com`, get an API key, then run: `--adapter zep --api-key <key>`
- **Install:** `pip install zep-python`

---

## Sulcus Analysis: Strengths and Growth Areas

### What's Working
- **Storage is solid.** Nodes are created reliably, with consistent ~800ms write latency per node.
- **Basic recall works.** When the keyword search matches, Sulcus finds the right memory (75% recall).
- **Cross-session persistence exists.** Unlike in-context, data survives across session boundaries (25% multi-session).

### What Needs Work
1. **Search endpoint (`/api/v1/agent/search`)** returns empty arrays — the benchmarks had to be run using the list endpoint's `?search=` parameter with keyword extraction. Semantic/vector search would dramatically improve results.
2. **No temporal metadata.** Memories are stored with `updated_at` but there's no way to query "what was the most recent X" or order events chronologically.
3. **No contradiction detection.** When a user updates a preference, both old and new values persist with equal weight. Need supersession logic.
4. **Decay engine not exercised.** The `/api/v1/agent/sync` endpoint didn't trigger observable decay. The thermodynamic engine may need more tick cycles or isn't wired to the benchmark's expectations.
5. **No relevance scoring on retrieval.** All results come back sorted by heat, but heat doesn't correlate with semantic relevance to the query.

### Path to Higher Scores
- **Implement vector search** → recall could hit 90%+
- **Add temporal indexing** → temporal could hit 50%+
- **Implement supersession/contradiction resolution** → contradiction could hit 75%+
- **Wire decay engine to retrieval ranking** → efficiency could hit 40%+
- **Combined:** A working Sulcus with these features should score 65-80%, crushing the in-context ceiling.

---

## Files

- `no-memory_1773702836.json` — Floor baseline (0.0%)
- `in-context_1773702841.json` — In-context baseline (55.0%)
- `sulcus_1773702991.json` — Sulcus live server (20.0%)
- `openai_1773703122.json` — OpenAI/Azure (0.0%, errored)

---

*Generated by MemBench runner, 2026-03-16T16:20 PDT*
