# VCR API Reference

**System 1 VCR** (Value, Classification, and Retrieval) is the pure-Rust curation, value-gating, and retrieval-scoring engine for Sulcus memory (`https://api.sulcus.ca` and local `http://127.0.0.1:4203`). It evaluates candidate text before storage, classifies memories into Golden Index archetypes, tunes 7-signal retrieval weights from recall feedback, and adapts continuously via lifecycle training signals.

> **Backward Compatibility**: Canonical routes live under `/api/v1/vcr/*` and `/api/v1/settings/vcr*`. Legacy `/api/v1/siu/*`, `/api/v2/siu/*`, and `/api/v1/settings/siu*` routes remain active as backward-compatible aliases.

---

## Architecture

System 1 VCR combines three fast, deterministic-and-neural subsystems alongside reactive trigger feedback:

### Value Gate

Determines **whether** candidate content is worth storing (`should_store`).

- Filters out transient chatter, low-signal acknowledgments, and redundant noise via a pure-Rust Wide-and-Deep MLP head
- Returns `should_store: true | false` with calibrated confidence
- Learns continuously from `accept` and `reject` training signals

### Archetype Classifier

Determines **which memory archetype** candidate content belongs to (`memory_type`).

- Classifies into `episodic`, `semantic`, `preference`, `procedural`, `fact`, or `synthesis` (plus optional custom folder labels trained via `sulcus train classifier <folder>`)
- Shares feature representations with the Value Gate through a dedicated classification head
- Learns from explicit `reclassify` corrections and curator refinements

### Retrieval Scorer

Ranks candidate memories during recall using a feedback-tuned **7-signal linear scorer**:

- `similarity_weight`, `heat_weight`, and `recency_weight`
- `source_boost_semantic`, `source_boost_hot`, `source_boost_entity`, and `source_boost_profile`

### Trigger Feedback

Collects structured feedback (`positive`, `negative`, `false_positive`, `false_negative`, `correction`) on reactive trigger firings via `/api/v1/triggers/feedback` to refine trigger precision.

### Feedback Loop

```
Content -> System 1 VCR Classify -> Store & Tag -> Agent Recalls Memory
                     |                                      |
              Signal (if corrected)                  Trigger Fires
                     |                                      |
               Training Corpus                      Trigger Feedback
                     |                                      |
                  Retrain <---------------------------------+
```

---

## Authentication

Cloud API requests require a Bearer API key (`local` workstation requests to `http://127.0.0.1:4203` do not require an API key):

```http
Authorization: Bearer sk-...
```

---

## Endpoints

### Classify Text

`POST /api/v1/vcr/classify` *(aliases: `POST /api/v1/vcr/label`, `POST /api/v1/siu/classify`, `POST /api/v2/siu/label`)*

Classify text content and evaluate whether it should be stored.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Text content to classify. |
| `quality_only` | boolean | No | If `true`, return `memory_type` classification only and skip the `should_store` gate. Default: `false`. |

**Response (200):**

```json
{
  "memory_type": "preference",
  "confidence": 0.94,
  "should_store": true,
  "reasoning": "Content expresses a durable user workflow preference.",
  "model": "system1-vcr-v3.1"
}
```

**Example (curl):**

```bash
curl -X POST https://api.sulcus.ca/api/v1/vcr/classify \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"text": "User prefers dark mode in all editors"}'
```

---

### Record Signal

`POST /api/v1/vcr/signal` *(aliases: `POST /api/v1/siu/signal`, `POST /api/v2/siu/signal`)*

Record an explicit System 1 VCR training signal (`correction`, `confirmation`, or `rejection`).

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `memory_id` | string (UUID) | Yes | Memory node this signal relates to. |
| `signal_type` | string | Yes | One of `correction`, `confirmation`, `rejection`. |
| `predicted_type` | string | No | Memory type predicted by System 1 VCR. |
| `predicted_store` | boolean | No | Store/discard decision predicted by System 1 VCR. |
| `predicted_conf` | number | No | Confidence score (`0.0–1.0`) of the prediction. |
| `corrected_type` | string | No | Ground-truth memory type for corrections. |
| `corrected_store` | boolean | No | Ground-truth store/discard boolean for corrections. |
| `content_snapshot` | string | No | Snapshot of the classified text. |
| `source` | string | No | Signal origin (`"sdk"`, `"dashboard"`, `"agent"`). Default: `"sdk"`. |
| `namespace` | string | No | Namespace context for the signal. |

**Response (201):**

```json
{
  "id": "sig-019d3a...",
  "memory_id": "019d35...",
  "signal_type": "correction",
  "created_at": "2026-03-31T17:05:00Z"
}
```

---

### List Signals

`GET /api/v1/vcr/signals` *(aliases: `GET /api/v1/siu/signals`, `GET /api/v2/siu/signals`)*

List recorded System 1 VCR training signals with pagination (`?limit=50&offset=0`).

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

### Model Status

`GET /api/v1/vcr/status` *(aliases: `GET /api/v1/siu/status`, `GET /api/v2/siu/status`)*

Inspect active System 1 VCR model version, readiness, sample count, and evaluation accuracy.

**Response (200):**

```json
{
  "model": "system1-vcr-v3.1",
  "version": "3.1.0",
  "status": "ready",
  "last_trained": "2026-03-28T14:30:00Z",
  "training_samples": 6670,
  "accuracy": 0.91
}
```

---

### Retrain Model

`POST /api/v1/vcr/retrain` *(aliases: `POST /api/v1/siu/retrain`, `POST /api/v2/siu/retrain`)*

Queue a System 1 VCR retrain job over accumulated training signals.

**Response (202):**

```json
{
  "status": "queued",
  "job_id": "job-019d3b...",
  "model": "system1-vcr-v3.1",
  "estimated_duration_minutes": 5
}
```

---

### Model Weights

`GET /api/v1/vcr/models` *(alias: `GET /api/v1/siu/models`)*

Retrieve active System 1 VCR model metadata and serialized weights (`PUT /api/v1/vcr/models` updates custom weights).

---

### Namespace Settings

- `GET /api/v1/settings/vcr` — Inspect global System 1 VCR defaults
- `GET /api/v1/settings/vcr/:namespace` — Inspect effective per-namespace System 1 VCR settings
- `PATCH /api/v1/settings/vcr/:namespace` — Override thresholds, retrieval weights, or custom backend settings for a namespace
- `DELETE /api/v1/settings/vcr/:namespace` — Reset namespace overrides back to global defaults

*(Legacy `/api/v1/settings/siu` and `/api/v1/settings/siu/:namespace` routes remain supported as aliases.)*

---

### Submit Feedback

`POST /api/v1/triggers/feedback`

Submit feedback (`positive`, `negative`, `false_positive`, `false_negative`, `correction`) on a reactive trigger firing.

---

### List Feedback

`GET /api/v1/triggers/feedback?limit=50`

List recent reactive trigger feedback entries.

---

## SDK Examples

### Node SDK

```ts
import { Sulcus } from "sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

// Classify candidate text before storing
const verdict = await client.vcrClassify("Deploy requires running migrations before rollout");
if (verdict.should_store) {
  await client.remember("Deploy requires running migrations before rollout", {
    memoryType: verdict.memory_type,
  });
}

// Record a correction signal
await client.vcrSignal({
  memoryId: "019d35ab-...",
  signalType: "correction",
  predictedType: "episodic",
  correctedType: "procedural",
});

// Report a false-positive trigger firing
await client.triggerFeedback({
  feedbackType: "false_positive",
  triggerId: "trg-019d30...",
  notes: "Fired on a greeting rather than a deployment runbook",
});
```

### Python SDK

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Classify candidate text before storing
verdict = client.vcr_classify("Deploy requires running migrations before rollout")
if verdict["should_store"]:
    client.remember(
        "Deploy requires running migrations before rollout",
        memory_type=verdict["memory_type"],
    )

# Record a correction signal
client.vcr_signal(
    memory_id="019d35ab-...",
    signal_type="correction",
    predicted_type="episodic",
    corrected_type="procedural",
)

# Report a false-positive trigger firing
client.trigger_feedback(
    "false_positive",
    trigger_id="trg-019d30...",
    notes="Fired on a greeting rather than a deployment runbook",
)
```

---

## Inline Training

Passing `train_on_this` (or `?train=true` on delete) emits System 1 VCR training signals atomically alongside standard memory operations without a second HTTP call.

### Supported Endpoints

| Endpoint | Method | Parameter | Signal Recorded |
|---|---|---|---|
| `/api/v1/agent/nodes` | `POST` | `"train_on_this": true` | **accept**: Value Gate learns content is worth storing + Archetype Classifier learns `memory_type` |
| `/api/v1/agent/nodes/:id` | `PATCH` | `"train_on_this": true` | **reclassify**: Archetype Classifier learns the corrected `memory_type` |
| `/api/v1/agent/nodes/:id` | `DELETE` | `?train=true` | **reject**: Value Gate learns content should be discarded |
| `/api/v1/triggers` | `POST` | `"train_on_this": true` | **correct**: Records positive reactive trigger feedback |

### Training Rationale

Without inline signals, feedback requires separate `POST /api/v1/vcr/signal` requests after every edit. Recording signals inline turns normal agent curation (storing verified facts, reclassifying archetypes, deleting noise) directly into training examples.

### Python Inline

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

# Store and emit positive Value + Archetype signal
client.remember(
    "User prefers dark mode in all editors",
    memory_type="preference",
    train_on_this=True,
)

# Reclassify and train Archetype head
client.update("019d35ab-...", memory_type="procedural", train_on_this=True)

# Delete noise and train Value Gate to reject similar text
client.forget("019d35ab-...", train_on_this=True)
```

### Node Inline

```typescript
import { Sulcus } from "sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

await client.remember("User prefers dark mode in all editors", {
  memoryType: "preference",
  trainOnThis: true,
});

await client.update("019d35ab-...", {
  memoryType: "procedural",
  trainOnThis: true,
});

await client.forget("019d35ab-...", { trainOnThis: true });
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /api/v1/vcr/classify` | 100 req/min |
| `POST /api/v1/vcr/signal` | 60 req/min |
| `GET /api/v1/vcr/signals` | 30 req/min |
| `GET /api/v1/vcr/status` | 30 req/min |
| `POST /api/v1/vcr/retrain` | 1 req/hour |
| `POST /api/v1/triggers/feedback` | 60 req/min |
| `GET /api/v1/triggers/feedback` | 30 req/min |

Rate-limited responses return `429 Too Many Requests` with a `Retry-After` header.
