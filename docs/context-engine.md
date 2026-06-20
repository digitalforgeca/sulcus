# Sulcus Context Engine

The **Context Engine** assembles a rich, multi-signal memory context for your agent before each turn. Instead of running three separate queries, it combines hot nodes, semantic search, and graph neighbors into a single coherent context block — ranked and deduplicated.

---

## How It Works

When you call `auto_recall` (or have `autoRecall: true` in the OpenClaw plugin), the Context Engine runs three signals in parallel and merges the results:

```
Query / Task
     │
     ├─── Signal 1: Hot Nodes ────────────────── Top N highest-heat memories
     │                                           (always relevant — what the
     │                                            agent has been thinking about)
     │
     ├─── Signal 2: Semantic Search ─────────── Cosine similarity on embeddings
     │                                           (what matches this specific query)
     │
     └─── Signal 3: Graph Neighbors ──────────── Edges from top semantic hits
                                                 (related context the query
                                                  didn't directly surface)
          │
          └─── Merge + Deduplicate + Rank
                    │
                    └─── Context Block (formatted for injection)
```

### Signal Weights

Signals are weighted and combined using a learned scoring function:

| Signal | Default Weight | Notes |
|---|---|---|
| Semantic similarity | 0.6 | Highest weight — query relevance |
| Heat (recency/importance) | 0.3 | Favours active memories |
| Graph connectivity | 0.1 | Surfaced via edge traversal |

Weights adapt over time based on recall feedback (`sulcus_feedback`).

---

## Why It's Client-Side

There is **no `/api/v1/agent/auto_recall` endpoint** on the server.

The Context Engine is assembled **client-side** in the SDK and MCP server. This is intentional:
- The server handles hot nodes (`GET /api/v1/agent/hot_nodes`), semantic search (`POST /api/v1/agent/search`), and graph edges (embedded in node responses).
- The client merges, weights, and formats the results.
- This keeps the server stateless and the merge logic version-controllable in the SDK.

If you see references to an `auto_recall` endpoint in older docs, that was aspirational. The current implementation is client-assembled.

---

## Using the Context Engine

### Python SDK

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Build context for a specific query
context = client.build_context(
    query="What does the user prefer for database tooling?",
    limit=8,
    namespace="daedalus"
)

print(context.formatted)
# → "MEMORY CONTEXT:\n[heat: 0.92] User prefers Docker for databases\n..."

# Inject into your prompt
system_prompt = f"{base_system}\n\n{context.formatted}"
```

### Node.js SDK

```typescript
import { Sulcus } from '@digitalforgestudios/sulcus';

const client = new Sulcus({ apiKey: 'sk-...' });

const context = await client.buildContext({
  query: 'What does the user prefer for database tooling?',
  limit: 8,
  namespace: 'daedalus',
});

console.log(context.formatted);
// → "MEMORY CONTEXT:\n[heat: 0.92] User prefers Docker for databases\n..."
```

### MCP Tool

```
sulcus_context — assemble a context block for a given task description
sulcus_recall_auto — auto-recall: hot nodes + semantic + graph (returns raw nodes)
```

The `sulcus_context` tool formats the merged result as a ready-to-inject block.
The `sulcus_recall_auto` tool returns the raw merged node array for custom formatting.

### OpenClaw Plugin

With `autoRecall: true` in your plugin config, the Context Engine runs automatically before each agent turn. The resulting context block is injected into the agent's system prompt via the `allowPromptInjection` hook.

```jsonc
{
  "openclaw-sulcus": {
    "config": {
      "autoRecall": true,
      "maxRecallResults": 8,
      "minRecallScore": 0.3
    }
  }
}
```

`maxRecallResults` caps the total number of nodes returned across all signals.
`minRecallScore` filters out low-relevance semantic results (does not affect hot nodes).

---

## Context Block Format

The formatted context block looks like this:

```
MEMORY CONTEXT:
[heat: 0.94 | fact] Dooley's timezone is America/Vancouver (Pacific).
[heat: 0.87 | preference] User prefers Docker for databases.
[heat: 0.81 | procedural] Always use the official deployment pipeline.
[heat: 0.72 | semantic] Sulcus uses PostgreSQL + pgvector + Apache AGE for storage.
[heat: 0.61 | episodic] Last API update was 2026-06-10 — memory type filtering improved.
```

Format: `[heat: {heat} | {memory_type}] {label}`

Nodes are sorted by merged score (semantic × heat × graph weight), highest first.

---

## Tuning Recall Quality

### Feedback loop

Submit relevance feedback to improve future recall weights:

```python
client.recall_feedback(node_id="uuid", relevant=True)
```

```typescript
await client.recallFeedback({ nodeId: 'uuid', relevant: true });
```

Negative feedback (`relevant: false`) reduces the recalled node's effective weight for similar queries. Over time the scoring function adapts.

### Namespace scoping

Context Engine results respect the `namespace` filter. Set this to your agent name to keep context focused:

```python
context = client.build_context(query="...", namespace="daedalus")
```

Without a namespace filter, the Context Engine searches across all namespaces in the tenant — useful for shared/cross-agent knowledge but may surface noise.

### Pinned memories

Pinned nodes always appear in hot node results regardless of their current heat. Use pins for critical facts that should always be in context:

```python
client.pin(node_id="uuid")           # Always surfaces in hot nodes
```

```typescript
await client.pin({ nodeId: 'uuid' });
```

---

## Async SDK

The async Python client (`AsyncSulcus`) supports the same Context Engine interface:

```python
from sulcus import AsyncSulcus

async with AsyncSulcus(api_key="sk-...") as client:
    context = await client.build_context(
        query="What is the user's deployment process?",
        limit=5
    )
    print(context.formatted)
```

---

*Digital Forge Studios — [sulcus.ca](https://sulcus.ca)*
