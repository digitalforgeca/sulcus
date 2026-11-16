# VCR API Reference

> **Canonical Reference**: System 1 VCR replaces legacy `SIU` endpoints with unified pure-Rust **System 1 VCR** routes under `/api/v1/vcr/*` and `/api/v1/settings/vcr*` (see [docs/vcr-api.md](vcr-api.md)). Existing `/api/v1/siu/*`, `/api/v2/siu/*`, and `/api/v1/settings/siu*` paths remain active as backward-compatible aliases so existing clients continue working without breaking changes.

**System 1 VCR** (Value, Classification, and Retrieval) is the classification, value-gating, and retrieval-scoring engine for Sulcus memory.

---

## Architecture

System 1 VCR unifies three subsystems alongside reactive trigger feedback:

### Value Gate

Determines **whether** candidate content should be stored (`should_store`).

- Filters out transient chatter, low-signal acknowledgments, and redundant noise
- Returns `should_store: true | false` with a calibrated confidence score
- Trained continuously on positive (`accept`) and negative (`reject`) examples

### Archetype Classifier

Determines **what type** of memory the content represents (`memory_type`).

- Classifies into `episodic`, `semantic`, `preference`, `procedural`, `fact`, or `synthesis`
- Shares representations with the Value Gate through a dedicated classification head

### Retrieval Scorer

Scores recall candidates with a feedback-tuned **7-signal linear model** (`similarity_weight`, `heat_weight`, `recency_weight`, `source_boost_semantic`, `source_boost_hot`, `source_boost_entity`, `source_boost_profile`).

### Trigger Feedback

Collects feedback (`positive`, `negative`, `false_positive`, `false_negative`, `correction`) on reactive trigger firings via `/api/v1/triggers/feedback`.

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

Cloud API endpoints require a valid API key via the `Authorization` header (optional on local `http://127.0.0.1:4203`):

```http
Authorization: Bearer sk-...
```

---

## Endpoints

### Classify Text

`POST /api/v1/vcr/classify` *(backward-compatible aliases: `POST /api/v1/siu/classify`, `POST /api/v2/siu/label`)*

Classify text content. Returns predicted `memory_type`, `confidence`, and `should_store` recommendation.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | The text content to classify. |
| `quality_only` | boolean | No | If `true`, only return `memory_type` classification and skip `should_store`. Default: `false`. |

**Response (200):**

```json
{
  "memory_type": "preference",
  "confidence": 0.94,
  "should_store": true,
  "reasoning": "Content expresses a user preference about UI theme.",
  "model": "system1-vcr-v3.1"
}
```

**Example (curl):**

```bash
curl -X POST https://api.sulcus.ca/api/v1/vcr/classify \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"text": "User prefers dark mode in all applications"}'
```

---

### Record Signal

`POST /api/v1/vcr/signal` *(backward-compatible aliases: `POST /api/v1/siu/signal`, `POST /api/v2/siu/signal`)*

Record a training signal (`correction`, `confirmation`, or `rejection`) for System 1 VCR.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `memory_id` | string (UUID) | Yes | The memory node this signal relates to. |
| `signal_type` | string | Yes | One of `correction`, `confirmation`, `rejection`. |
| `predicted_type` | string | No | Predicted memory type. |
| `predicted_store` | boolean | No | Predicted store/discard decision. |
| `predicted_conf` | number | No | Prediction confidence score (`0.0–1.0`). |
| `corrected_type` | string | No | Ground-truth memory type (for corrections). |
| `corrected_store` | boolean | No | Ground-truth store/discard decision (for corrections). |
| `content_snapshot` | string | No | Snapshot of the content at classification time. |
| `source` | string | No | Signal source identifier (`"sdk"`, `"dashboard"`, `"agent"`). Default: `"sdk"`. |
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

`GET /api/v1/vcr/signals` *(backward-compatible aliases: `GET /api/v1/siu/signals`, `GET /api/v2/siu/signals`)*

List training signals with pagination (`limit`, `offset`).

---

### Model Status

`GET /api/v1/vcr/status` *(backward-compatible aliases: `GET /api/v1/siu/status`, `GET /api/v2/siu/status`)*

Get current System 1 VCR model status, version, sample count, and evaluation accuracy.

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

`POST /api/v1/vcr/retrain` *(backward-compatible aliases: `POST /api/v1/siu/retrain`, `POST /api/v2/siu/retrain`)*

Queue a System 1 VCR retrain using accumulated training signals.

---

### Namespace Settings

`GET /api/v1/settings/vcr`, `GET /api/v1/settings/vcr/:namespace`, `PATCH /api/v1/settings/vcr/:namespace`, and `DELETE /api/v1/settings/vcr/:namespace` *(backward-compatible alias: `/api/v1/settings/siu*`)*.

---

### Submit Feedback

`POST /api/v1/triggers/feedback`

Submit feedback (`positive`, `negative`, `false_positive`, `false_negative`, `correction`) on a reactive trigger firing.

---

### List Feedback

`GET /api/v1/triggers/feedback?limit=50`

List trigger feedback entries.

---

## SDK Examples

### Node SDK

```ts
import { Sulcus } from "sulcus";

const client = new Sulcus({ apiKey: "sk-..." });

const verdict = await client.vcrClassify("Deploy requires running migrations before rollout");
if (verdict.should_store) {
  await client.remember("Deploy requires running migrations before rollout", {
    memoryType: verdict.memory_type,
  });
}

await client.vcrSignal({
  memoryId: "019d35ab-...",
  signalType: "correction",
  predictedType: "episodic",
  correctedType: "procedural",
});
```

### Python SDK

```python
from sulcus import Sulcus

client = Sulcus(api_key="sk-...")

verdict = client.vcr_classify("Deploy requires running migrations before rollout")
if verdict["should_store"]:
    client.remember(
        "Deploy requires running migrations before rollout",
        memory_type=verdict["memory_type"],
    )

client.vcr_signal(
    memory_id="019d35ab-...",
    signal_type="correction",
    predicted_type="episodic",
    corrected_type="procedural",
)
```

*(Existing `client.siuLabel(...)` / `client.siu_label(...)` and `client.siuSignal(...)` / `client.siu_signal(...)` calls delegate automatically to the canonical `/api/v1/vcr/*` endpoints.)*

---

## Inline Training

The `train_on_this` boolean lets agents record System 1 VCR training signals inline during standard memory lifecycle calls:

| Endpoint | Method | Parameter | Signal Recorded |
|---|---|---|---|
| `/api/v1/agent/nodes` | `POST` | `"train_on_this": true` | **accept**: Value Gate + Archetype Classifier positive example |
| `/api/v1/agent/nodes/:id` | `PATCH` | `"train_on_this": true` | **reclassify**: Archetype Classifier type correction |
| `/api/v1/agent/nodes/:id` | `DELETE` | `?train=true` | **reject**: Value Gate negative example |
| `/api/v1/triggers` | `POST` | `"train_on_this": true` | **correct**: Positive trigger feedback |

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
