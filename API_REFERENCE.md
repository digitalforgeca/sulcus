# Sulcus API Reference (v1)

Base URL: `https://server.sulcus.dforge.ca/api/v1`

## Authentication

All authenticated endpoints require the header:

```
X-API-Key: <your-api-key>
```

API keys are created from the dashboard at [sulcus.dforge.ca/dashboard/settings](https://sulcus.dforge.ca/dashboard/settings) or via the `/api/v1/keys` endpoint.

---

## Memory Operations

### POST `/agent/sync`

The primary synchronization endpoint. Synchronizes local WAL operations with the server's Golden Index.

**Request Body:**
```json
{
  "ops": [
    {
      "op": "Add",
      "payload": {
        "id": "uuid",
        "label": "Human-readable label",
        "pointer_summary": "Dense summary text",
        "base_utility": 0.8,
        "current_heat": 1.0,
        "is_pinned": false,
        "memory_type": "semantic",
        "modality": "text",
        "namespace": "default"
      },
      "timestamp": "2026-03-13T00:00:00Z",
      "raw_content": "Optional raw content for embedding",
      "vector": [0.1, 0.2, ...]
    }
  ],
  "last_cursor": "2026-03-12T12:00:00Z"
}
```

**Op Types:** `Add`, `Update`, `Delete`, `Patch`

**Response:**
```json
{
  "new_ops": [...],
  "new_cursor": "2026-03-13T00:01:00Z",
  "new_cursor_seq": 42
}
```

---

### GET `/agent/hot_nodes`

Returns the most relevant (hottest) memory nodes for the authenticated tenant.

**Query Parameters:**
| Param | Default | Description |
|---|---|---|
| `limit` | 20 | Number of nodes to return (max 100) |

**Response:** Array of `Node` objects sorted by heat descending.

---

### GET `/agent/nodes`

Paginated list of all memory nodes.

**Query Parameters:**
| Param | Default | Description |
|---|---|---|
| `page` | 1 | Page number |
| `page_size` | 20 | Items per page (max 100) |
| `memory_type` | — | Filter: `semantic`, `episodic`, `procedural`, `preference` |
| `namespace` | — | Filter by namespace |
| `pinned` | — | Filter: `true` or `false` |
| `search` | — | Text search on `pointer_summary` |
| `sort` | `updated_at` | Sort field |
| `order` | `desc` | `asc` or `desc` |

**Response:**
```json
{
  "items": [...],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

---

### POST `/agent/nodes`

Create a new memory node directly (bypasses sync).

**Request Body:**
```json
{
  "label": "Dooley prefers Docker for databases",
  "memory_type": "preference",
  "heat": 1.0,
  "namespace": "default"
}
```

**Response:**
```json
{
  "id": "uuid",
  "label": "...",
  "memory_type": "preference",
  "heat": 1.0
}
```

---

### PATCH `/agent/nodes/:id`

Update a memory node's fields.

**Request Body (all fields optional):**
```json
{
  "label": "Updated label",
  "heat": 0.9,
  "is_pinned": true,
  "memory_type": "semantic",
  "namespace": "work"
}
```

---

### DELETE `/agent/nodes/:id`

Delete a single memory node.

---

### POST `/agent/nodes/bulk`

Bulk delete memory nodes.

**Request Body:**
```json
{
  "ids": ["uuid1", "uuid2", "uuid3"]
}
```

---

### POST `/agent/search`

Semantic text search against the Golden Index.

**Request Body:**
```json
{
  "query": "What databases does the user prefer?",
  "limit": 10
}
```

**Response:** Array of `{ node, score }` objects sorted by relevance.

---

## Visualization

### GET `/admin/visualize/graph`

Returns a full graph snapshot (nodes + edges) for force-directed visualization.

**Response:**
```json
{
  "nodes": [
    { "id": "uuid", "label": "...", "heat": 0.8, "memory_type": "semantic" }
  ],
  "links": [
    { "source": "uuid1", "target": "uuid2", "weight": 0.95 }
  ]
}
```

---

## Admin & Usage

### GET `/admin/dashboard`

Dashboard statistics: node counts, edge counts, storage metrics.

---

### GET `/admin/usage`

Monthly usage statistics for the authenticated tenant.

**Response:**
```json
{
  "billing_period_start": "2026-03-01",
  "billing_period_end": "2026-03-31",
  "sync_requests": 2803,
  "nodes_added": 1213,
  "avg_latency_ms": 40.92,
  "max_latency_ms": 2164.30
}
```

---

### POST `/admin/invite`

Generate an invitation token for a new tenant to join your team.

---

### POST `/admin/join` *(public — no auth required)*

Consume an invitation token to create a new tenant.

---

## Activity Log

### GET `/activity`

Paginated activity log for the authenticated tenant.

**Query Parameters:**
| Param | Default | Description |
|---|---|---|
| `limit` | 50 | Max items (capped at 200) |
| `actor` | — | Filter by exact actor name |
| `action` | — | Filter by action prefix (e.g. `memory` matches `memory.add`) |
| `before` | — | ISO-8601 cursor for pagination |

**Response:**
```json
{
  "items": [
    {
      "id": 123,
      "actor": "Icarus (Opus)",
      "action": "memory.add",
      "target_id": "uuid",
      "target_label": "Dooley prefers Docker for databases",
      "metadata": {},
      "created_at": "2026-03-13T00:00:00Z"
    }
  ],
  "next_cursor": "2026-03-12T23:59:00Z"
}
```

**Action types:** `memory.add`, `memory.delete`, `memory.pin`, `memory.patch`, `sync`, `login`, `billing.upgrade`, `billing.downgrade`

---

### POST `/activity`

Record a new activity entry (primarily for internal use by other handlers).

**Request Body:**
```json
{
  "actor": "system",
  "action": "memory.add",
  "target_id": "uuid",
  "target_label": "Optional label snapshot",
  "metadata": { "before": {}, "after": {} }
}
```

---

## Gamification

### GET `/gamification/profile`

XP profile, level, badges, and recent XP events for the authenticated tenant.

**Response:**
```json
{
  "total_xp": 1234,
  "level": 3,
  "level_name": "Active",
  "level_title": "Active",
  "next_level_xp": 1500,
  "progress_pct": 73,
  "badges": ["First Memory", "100 Syncs"],
  "recent_xp": [
    { "reason": "memory.add", "xp": 10, "created_at": "2026-03-13T00:00:00Z" }
  ]
}
```

**Levels:**
| Level | XP | Name |
|---|---|---|
| 1 | 0 | Absolute Zero |
| 2 | 100 | Warm |
| 3 | 500 | Active |
| 4 | 1,500 | Hot |
| 5 | 5,000 | Plasma |
| 6 | 15,000 | Supernova |

**Badges:** First Memory, 100 Syncs, Graph Architect, Curator, Early Adopter

---

## API Keys

### GET `/keys`

List all API keys for the authenticated tenant.

**Response:** Array of key objects (key hash partially masked).

---

### POST `/keys`

Create a new API key. Returns the full key **once** — it cannot be retrieved again.

**Request Body:**
```json
{
  "label": "My Integration"
}
```

---

### DELETE `/keys/:id`

Revoke an API key.

---

## Organizations

### GET `/org`

Get organization details for the authenticated tenant.

### PATCH `/org`

Update organization details.

### POST `/org/invite`

Invite a member to the organization.

### DELETE `/org/members`

Remove a member from the organization.

---

## Billing

### POST `/billing/create-subscription`

Create a Stripe subscription for a plan upgrade. Returns a `client_secret` for Stripe Elements.

### POST `/billing/create-checkout-session`

Create a Stripe Checkout session (legacy).

### POST `/billing/create-portal-session`

Create a Stripe Customer Portal session for subscription management.

### GET `/billing/products` *(public — no auth required)*

List available Sulcus subscription products and prices.

### POST `/billing/stripe-webhook` *(public — Stripe signature verification)*

Stripe webhook handler for subscription lifecycle events.

---

## MCP (Model Context Protocol)

### SSE Transport (Legacy)

```
GET  /mcp/sse      — Server-Sent Events stream
POST /mcp/message  — Send JSON-RPC message
```

### Streamable HTTP Transport (MCP 2025-06-18 spec)

```
GET    /mcp  — Initialize connection
POST   /mcp  — Send JSON-RPC message
DELETE /mcp  — Terminate session
```

**Auth:** MCP endpoints require team-tier API key (`X-API-Key` header).

**MCP Tools Available:**
| Tool | Description |
|---|---|
| `record_memory` | Store a new memory |
| `recall_memories` | Semantic search for relevant memories |
| `update_memory` | Modify an existing memory node |
| `delete_memory` | Remove a memory |
| `list_memories` | Paginated memory listing |

---

## Metrics

### GET `/metrics`

Prometheus-compatible metrics: DB pool stats, request counts, latencies.

---

## SDKs

| Language | Package | Install |
|---|---|---|
| Python | `sulcus` | `pip install sulcus` |
| Node.js | `sulcus` | `npm install sulcus` |

Both SDKs default to `https://server.sulcus.dforge.ca` as the base URL.

```python
from sulcus import SulcusClient
client = SulcusClient(api_key="your-key")
client.remember("User prefers dark mode")
results = client.search("UI preferences")
```

```typescript
import { SulcusClient } from 'sulcus';
const client = new SulcusClient({ apiKey: 'your-key' });
await client.remember('User prefers dark mode');
const results = await client.search('UI preferences');
```

---

## Integrations

See [`INTEGRATIONS.md`](INTEGRATIONS.md) for framework-specific guides:
- LangChain (`sulcus-langchain`)
- LlamaIndex (`sulcus-llamaindex`)
- OpenAI function calling
- Anthropic tool use
- Vercel AI SDK (`sulcus-vercel-ai`)
- CLI (`sulcus-cli`)
- OpenClaw plugin (`openclaw-sulcus`)
