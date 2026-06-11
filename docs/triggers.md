# Sulcus Reactive Triggers

Reactive triggers let you automate memory operations in response to lifecycle events. When a matching event fires, Sulcus executes your configured action automatically — no polling, no extra agent logic.

## Concepts

A **trigger** has:
- An **event type** — what happened in the memory graph
- A **condition** — optional filter (e.g. heat > 0.9, memory_type == "fact")
- An **action** — what to do when the event + condition match

Triggers are tenant-scoped. They fire server-side, in real time.

---

## Event Types

| Event | When it fires |
|---|---|
| `on_store` | A new memory node is created |
| `on_recall` | A memory node is retrieved (search or auto-recall) |
| `on_decay` | A node's heat falls below a threshold |
| `on_boost` | A node's heat rises above a threshold |
| `on_relate` | A new edge is created between two nodes |
| `on_threshold` | A node's heat crosses a specific value (up or down) |

---

## Action Types

| Action | What it does |
|---|---|
| `boost` | Increase the node's heat by a specified amount |
| `pin` | Pin the node (prevent further decay) |
| `tag` | Add a tag to the node's metadata |
| `deprecate` | Mark the node as deprecated (soft delete) |
| `notify` | Send a notification to a webhook or system |
| `webhook` | POST a JSON payload to a configured URL |

---

## API Reference

Base URL: `https://api.sulcus.ca/api/v1`

All endpoints require `Authorization: Bearer <key>`.

### POST `/triggers`

Create a new trigger.

**Request Body:**
```json
{
  "name": "Pin high-confidence facts",
  "event": "on_store",
  "condition": {
    "memory_type": "fact",
    "confidence_gte": 0.9
  },
  "action": {
    "type": "pin"
  },
  "enabled": true
}
```

**Condition fields (all optional):**
| Field | Description |
|---|---|
| `memory_type` | Only match nodes of this memory type |
| `namespace` | Only match nodes in this namespace |
| `heat_gte` | Only match nodes with heat ≥ value |
| `heat_lte` | Only match nodes with heat ≤ value |
| `confidence_gte` | Only match when SIU confidence ≥ value (on_store only) |
| `tag` | Only match nodes that have this tag |

**Action fields:**
| Field | Description |
|---|---|
| `type` | One of: `boost`, `pin`, `tag`, `deprecate`, `notify`, `webhook` |
| `amount` | Heat delta for `boost` action (e.g. `0.2`) |
| `tag_name` | Tag string for `tag` action |
| `webhook_url` | URL for `webhook` action |
| `webhook_secret` | Optional HMAC secret for webhook verification |

**Response:**
```json
{
  "id": "uuid",
  "name": "Pin high-confidence facts",
  "event": "on_store",
  "condition": { "memory_type": "fact", "confidence_gte": 0.9 },
  "action": { "type": "pin" },
  "enabled": true,
  "created_at": "2026-06-11T00:00:00Z"
}
```

---

### GET `/triggers`

List all triggers for the authenticated tenant.

**Response:** Array of trigger objects.

---

### PATCH `/triggers/:id`

Update a trigger. All fields optional.

```json
{
  "enabled": false
}
```

---

### DELETE `/triggers/:id`

Delete a trigger permanently.

---

### GET `/triggers/history`

Paginated history of trigger firings.

**Query Parameters:**
| Param | Default | Description |
|---|---|---|
| `limit` | 50 | Max items (capped at 200) |
| `trigger_id` | — | Filter by specific trigger |
| `before` | — | ISO-8601 pagination cursor |

**Response:**
```json
{
  "items": [
    {
      "id": 123,
      "trigger_id": "uuid",
      "trigger_name": "Pin high-confidence facts",
      "event": "on_store",
      "node_id": "uuid",
      "node_label": "The Eiffel Tower is 330m tall",
      "action_taken": "pin",
      "fired_at": "2026-06-11T00:00:00Z"
    }
  ],
  "next_cursor": "2026-06-10T23:59:00Z"
}
```

---

### POST `/triggers/feedback`

Submit feedback on a trigger firing for SITU model training.

```json
{
  "firing_id": 123,
  "verdict": "correct",
  "note": "This was a valid pin"
}
```

**Verdict values:** `correct`, `incorrect`, `false_positive`

---

## Examples

### Auto-pin high-confidence facts

```json
{
  "name": "Auto-pin facts",
  "event": "on_store",
  "condition": {
    "memory_type": "fact",
    "confidence_gte": 0.85
  },
  "action": { "type": "pin" }
}
```

### Boost on recall (recency reinforcement)

```json
{
  "name": "Recall reinforcement",
  "event": "on_recall",
  "action": {
    "type": "boost",
    "amount": 0.1
  }
}
```

### Webhook on decay below threshold

```json
{
  "name": "Decay alert",
  "event": "on_threshold",
  "condition": {
    "heat_lte": 0.1
  },
  "action": {
    "type": "webhook",
    "webhook_url": "https://your-app.com/sulcus-webhook",
    "webhook_secret": "your-hmac-secret"
  }
}
```

The webhook payload is:
```json
{
  "event": "on_threshold",
  "trigger_id": "uuid",
  "trigger_name": "Decay alert",
  "node": {
    "id": "uuid",
    "label": "...",
    "memory_type": "episodic",
    "heat": 0.09
  },
  "fired_at": "2026-06-11T00:00:00Z"
}
```

### Deprecate memories when fully decayed

```json
{
  "name": "Retire cold memories",
  "event": "on_threshold",
  "condition": {
    "heat_lte": 0.05
  },
  "action": { "type": "deprecate" }
}
```

---

## SDK Usage

### Python
```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

trigger = client.triggers.create(
    name="Auto-pin facts",
    event="on_store",
    condition={"memory_type": "fact", "confidence_gte": 0.85},
    action={"type": "pin"}
)

triggers = client.triggers.list()
client.triggers.delete(trigger.id)
```

### Node.js
```typescript
import { Sulcus } from '@digitalforgestudios/sulcus';

const client = new Sulcus({ apiKey: 'sk-...' });

const trigger = await client.triggers.create({
  name: 'Auto-pin facts',
  event: 'on_store',
  condition: { memory_type: 'fact', confidence_gte: 0.85 },
  action: { type: 'pin' },
});

const triggers = await client.triggers.list();
await client.triggers.delete(trigger.id);
```

### MCP Tools
```
sulcus_trigger_list          — list all triggers
sulcus_trigger_create        — create a new trigger
sulcus_trigger_delete        — delete a trigger by id
```

---

*Digital Forge Studios — [sulcus.ca](https://sulcus.ca)*
