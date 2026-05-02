# SIU v2 API Reference

The **Sulcus Intelligence Unit (SIU) v2** is the server-side classification engine for Sulcus memory. It determines what type of memory content represents, how confident the classification is, and whether the content is worth storing at all.

## Architecture: SIVU / SICU / SITU

SIU v2 is built on three complementary subsystems:

### SIVU — SIU Value Unit
Determines **whether** content should be stored. Answers the question: _"Is this worth remembering?"_

- Filters out noise, transient chatter, and low-value content
- Returns `should_store: true/false` with a confidence score
- Trained on positive (stored) and negative (discarded) examples

### SICU — SIU Classification Unit
Determines **what type** of memory the content represents. Answers: _"What kind of memory is this?"_

- Classifies into: `episodic`, `semantic`, `preference`, `procedural`, `fact`
- Returns the predicted type with a confidence score
- Uses the same model as SIVU but with a different output head

### SITU — SIU Trigger Unit
Evaluates **reactive trigger** quality. Answers: _"Did this trigger fire correctly?"_

- Collects feedback on trigger firings (positive, negative, false positives)
- Feeds into trigger tuning and future SITU model training
- Accessible via the trigger feedback endpoints

### The Feedback Loop

```
Content → SIU Label → Store/Classify → Agent Uses Memory
                ↓                              ↓
         Signal (if wrong)              Trigger Fires
                ↓                              ↓
         Training Data                Trigger Feedback
                ↓                              ↓
            Retrain ←──────────────── Retrain
```

When SIU makes a wrong prediction, agents or users submit a **signal** (correction, confirmation, or rejection). These signals accumulate as training data. When enough signals are collected, a retrain produces an improved model. The same loop applies to trigger feedback via SITU.

---

## Authentication

All endpoints require a valid API key via the `Authorization` header:

```
Authorization: Bearer sk-...
```

---

## Endpoints

### POST `/api/v2/siu/label`

Classify text content. Returns memory type, confidence, and store recommendation.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | ✅ | The text content to classify. |
| `quality_only` | boolean | ❌ | If `true`, only return `memory_type` classification (skip `should_store` decision). Default: `false`. |

**Response (200):**

```json
{
  "memory_type": "preference",
  "confidence": 0.92,
  "should_store": true,
  "reasoning": "Content expresses a user preference about UI theme.",
  "model": "siu-v2.1-qwen-3b"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `memory_type` | string | Predicted type: `episodic`, `semantic`, `preference`, `procedural`, `fact`. |
| `confidence` | number | Classification confidence (0.0–1.0). |
| `should_store` | boolean | Whether the content is worth storing. Omitted if `quality_only` was set. |
| `reasoning` | string | Optional explanation of the classification. |
| `model` | string | Model version that produced the result. |

**Errors:**

| Status | Description |
|--------|-------------|
| 400 | Missing `text` field or empty content. |
| 401 | Invalid or missing API key. |
| 503 | SIU model unavailable (training in progress or not deployed). |

**Example (curl):**

```bash
curl -X POST https://api.sulcus.ca/api/v2/siu/label \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"text": "User prefers dark mode in all applications"}'
```

---

### POST `/api/v2/siu/signal`

Record a training signal for the SIU model. Use this when the SIU prediction was incorrect — corrections drive model improvement on the next retrain.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `memory_id` | string (UUID) | ✅ | The memory node this signal relates to. |
| `signal_type` | string | ✅ | One of: `correction`, `confirmation`, `rejection`. |
| `predicted_type` | string | ❌ | What SIU predicted as the memory type. |
| `predicted_store` | boolean | ❌ | What SIU predicted for store/discard. |
| `predicted_conf` | number | ❌ | SIU's confidence score for the prediction. |
| `corrected_type` | string | ❌ | The correct memory type (for corrections). |
| `corrected_store` | boolean | ❌ | The correct store/discard decision (for corrections). |
| `content_snapshot` | string | ❌ | Snapshot of the content at classification time. |
| `source` | string | ❌ | Signal source identifier (e.g., `"sdk"`, `"dashboard"`, `"agent"`). Default: `"sdk"`. |
| `namespace` | string | ❌ | Namespace context for the signal. |

**Response (201):**

```json
{
  "id": "sig-019d3a...",
  "memory_id": "019d35...",
  "signal_type": "correction",
  "created_at": "2026-03-31T17:05:00Z"
}
```

**Errors:**

| Status | Description |
|--------|-------------|
| 400 | Missing required fields or invalid signal_type. |
| 401 | Invalid or missing API key. |
| 404 | Memory ID not found. |

**Example (curl):**

```bash
curl -X POST https://api.sulcus.ca/api/v2/siu/signal \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "memory_id": "019d35ab-1234-7abc-def0-123456789abc",
    "signal_type": "correction",
    "predicted_type": "episodic",
    "corrected_type": "preference",
    "content_snapshot": "User prefers dark mode"
  }'
```

---

### GET `/api/v2/siu/signals`

List training signals with pagination.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 50 | Maximum entries to return (1–200). |
| `offset` | integer | 0 | Pagination offset. |

**Response (200):**

```json
{
  "items": [
    {
      "id": "sig-019d3a...",
      "memory_id": "019d35...",
      "signal_type": "correction",
      "predicted_type": "episodic",
      "corrected_type": "preference",
      "content_snapshot": "User prefers dark mode",
      "source": "sdk",
      "created_at": "2026-03-31T17:05:00Z"
    }
  ],
  "total": 142,
  "limit": 50,
  "offset": 0
}
```

---

### GET `/api/v2/siu/status`

Get the current SIU model status.

**Response (200):**

```json
{
  "model": "siu-v2.1-qwen-3b",
  "version": "2.1.0",
  "status": "ready",
  "last_trained": "2026-03-28T14:30:00Z",
  "training_samples": 6670,
  "accuracy": 0.87
}
```

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Model identifier. |
| `version` | string | Model version string. |
| `status` | string | One of: `ready`, `training`, `unavailable`. |
| `last_trained` | string | ISO 8601 timestamp of last successful training. |
| `training_samples` | integer | Number of samples used in last training. |
| `accuracy` | number | Model accuracy from last evaluation (0.0–1.0). |

---

### POST `/api/v2/siu/retrain`

Trigger a SIU model retrain using accumulated training signals.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | ❌ | Model identifier to retrain. Omit for the default model. |

**Response (202):**

```json
{
  "status": "queued",
  "job_id": "job-019d3b...",
  "model": "siu-v2.1-qwen-3b",
  "estimated_duration_minutes": 15
}
```

**Errors:**

| Status | Description |
|--------|-------------|
| 401 | Invalid or missing API key. |
| 403 | Insufficient permissions (admin required). |
| 409 | A retrain is already in progress. |
| 429 | Rate limited — retrain can only be triggered once per hour. |

---

### POST `/api/v1/triggers/feedback`

Submit feedback on a trigger firing for SITU training. Use this to report whether triggers are firing correctly or need adjustment.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `feedback_type` | string | ✅ | One of: `positive`, `negative`, `false_positive`, `false_negative`, `correction`. |
| `trigger_id` | string (UUID) | ❌ | The trigger this feedback is about. |
| `trigger_log_id` | string (UUID) | ❌ | The specific trigger log entry (from trigger history). |
| `event_type` | string | ❌ | The event type that fired (`on_store`, `on_recall`, etc.). |
| `memory_id` | string (UUID) | ❌ | The memory node involved in the trigger firing. |
| `expected_action` | string | ❌ | What action should have happened instead. |
| `notes` | string | ❌ | Free-text notes about the feedback. |
| `source` | string | ❌ | Feedback source identifier. Default: `"sdk"`. |

**Feedback types explained:**

| Type | Meaning |
|------|---------|
| `positive` | The trigger fired correctly — good result. |
| `negative` | The trigger fired but the result was wrong or unhelpful. |
| `false_positive` | The trigger fired when it shouldn't have. |
| `false_negative` | The trigger should have fired but didn't. |
| `correction` | The trigger fired but the action was wrong — include `expected_action`. |

**Response (201):**

```json
{
  "id": "fb-019d3c...",
  "feedback_type": "false_positive",
  "created_at": "2026-03-31T17:10:00Z"
}
```

**Errors:**

| Status | Description |
|--------|-------------|
| 400 | Missing `feedback_type` or invalid value. |
| 401 | Invalid or missing API key. |
| 404 | Referenced trigger or memory not found. |

---

### GET `/api/v1/triggers/feedback`

List trigger feedback entries.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 50 | Maximum entries to return (1–200). |

**Response (200):**

```json
{
  "items": [
    {
      "id": "fb-019d3c...",
      "feedback_type": "false_positive",
      "trigger_id": "trg-019d30...",
      "memory_id": "019d35...",
      "notes": "Trigger fired on irrelevant memory",
      "source": "sdk",
      "created_at": "2026-03-31T17:10:00Z"
    }
  ],
  "total": 23,
  "limit": 50
}
```

---

## SDK Examples

### Node.js

```ts
import { Sulcus } from "@digitalforgestudios/sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

// Classify before storing
const label = await client.siuLabel("Deploy requires docker build + push");
if (label.should_store) {
  await client.remember("Deploy requires docker build + push", {
    memoryType: label.memory_type,
  });
}

// Correct a wrong prediction
await client.siuSignal({
  memoryId: "019d35ab-...",
  signalType: "correction",
  predictedType: "episodic",
  correctedType: "procedural",
});

// Report a bad trigger firing
await client.triggerFeedback({
  feedbackType: "false_positive",
  triggerId: "trg-019d30...",
  notes: "Fired on a greeting, not a real memory event",
});
```

### Python

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Classify before storing
label = client.siu_label("Deploy requires docker build + push")
if label["should_store"]:
    client.remember("Deploy requires docker build + push",
                    memory_type=label["memory_type"])

# Correct a wrong prediction
client.siu_signal(
    memory_id="019d35ab-...",
    signal_type="correction",
    predicted_type="episodic",
    corrected_type="procedural",
)

# Report a bad trigger firing
client.trigger_feedback(
    "false_positive",
    trigger_id="trg-019d30...",
    notes="Fired on a greeting, not a real memory event",
)
```

---

---

## `train_on_this` — Inline Training

The `train_on_this` boolean lets agents generate SIU training signals automatically as part of normal memory operations — no separate API calls required. When an agent manually stores, reclassifies, or deletes a memory, that action *is* the ground truth. `train_on_this` captures it.

### Supported Endpoints

| Endpoint | Method | How to pass | Signal recorded |
|---|---|---|---|
| `/api/v1/agent/nodes` | POST | `"train_on_this": true` in body | **accept** — SIVU learns "this is worth storing" + SICU learns the provided `memory_type` |
| `/api/v1/agent/nodes/:id` | PATCH | `"train_on_this": true` in body | **reclassify** — SICU learns the corrected `memory_type` (only meaningful when `memory_type` is included) |
| `/api/v1/agent/nodes/:id` | DELETE | `?train=true` query param | **reject** — SIVU learns "this should NOT have been stored" |
| `/api/v1/triggers` | POST | `"train_on_this": true` in body | **correct** — SITU records positive feedback that this trigger configuration is correct |

### Why This Matters

Without `train_on_this`, SIU training requires separate `POST /api/v2/siu/signal` or `POST /api/v1/triggers/feedback` calls after every correction. Most agents won't bother — the feedback loop stays empty and the model never improves.

With `train_on_this`, the signal is recorded atomically alongside the action itself. The agent's manual corrections *are* the training data. Over time, SIU learns from every store, reclassify, and delete decision the agent makes.

### SDK Examples

#### Python

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Store a memory and tell SIU "yes, this is correct"
client.remember(
    "User prefers dark mode in all editors",
    memory_type="preference",
    train_on_this=True,
)

# Reclassify a memory — SIU learns from the correction
client.update(
    "019d35ab-...",
    memory_type="procedural",
    train_on_this=True,
)

# Delete junk — SIU learns "this shouldn't have been stored"
client.forget("019d35ab-...", train_on_this=True)

# Create a trigger and record it as correct for SITU
client.create_trigger(
    "on_store", "notify",
    name="Alert on procedures",
    filter_memory_type="procedural",
    train_on_this=True,
)
```

#### Node.js

```typescript
import { Sulcus } from "@digitalforgestudios/sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

// Store with inline training signal
await client.remember("User prefers dark mode in all editors", {
  memoryType: "preference",
  trainOnThis: true,
});

// Reclassify with training
await client.update("019d35ab-...", {
  memoryType: "procedural",
  trainOnThis: true,
});

// Delete with reject signal
await client.forget("019d35ab-...", { trainOnThis: true });

// Create trigger with SITU feedback
await client.createTrigger("on_store", "notify", {
  name: "Alert on procedures",
  filterMemoryType: "procedural",
  trainOnThis: true,
});
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /api/v2/siu/label` | 100 req/min |
| `POST /api/v2/siu/signal` | 60 req/min |
| `GET /api/v2/siu/signals` | 30 req/min |
| `GET /api/v2/siu/status` | 30 req/min |
| `POST /api/v2/siu/retrain` | 1 req/hour |
| `POST /api/v1/triggers/feedback` | 60 req/min |
| `GET /api/v1/triggers/feedback` | 30 req/min |

Rate-limited responses return `429 Too Many Requests` with a `Retry-After` header.
