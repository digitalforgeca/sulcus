# Lifecycle Training

Every memory lifecycle action in Sulcus can generate training data for **System 1 VCR** (pure-Rust Wide-and-Deep MLP Value Gate and Archetype Classifier heads plus the feedback-tuned 7-signal linear Retrieval Scorer). This creates a continuous feedback loop where agent behavior sharpens value gating, archetype classification, and retrieval weights over time.

## Signal Sources

| Action | Signal Type | Source Tag | Confidence | Requires |
|--------|------------|------------|------------|----------|
| **Store** with `train_on_this=true` | `accept` | `train_on_this` | Explicit | Plugin ≥ 3.9.0 |
| **Delete** with `train=true` | `reject` | `agent_delete` | High | Plugin ≥ 3.11.0 |
| **Reclassify** (`PATCH memory_type` + `train_on_this=true`) | `reclassify` | `train_on_this` | Explicit | Any version |
| **Pin** (`PATCH is_pinned=true`) | `accept` | `pin` | High | Server-side |
| **Manual Boost** (`PATCH current_heat`) | `accept` | `boost` | Medium | Server-side |
| **Update** without type change + `train_on_this=true` | `accept` | `train_on_this` | Reinforcement | Any version |

## Architecture

### Value Gate
- `accept` signals teach the System 1 VCR Value Gate that content like this **should** be stored
- `reject` signals teach the Value Gate that content like this **should not** be stored
- Higher-confidence signals (pin, explicit delete) receive stronger weight during retraining

### Archetype Classifier
- `reclassify` signals correct the archetype assignment (for example changing `episodic` to `procedural`)
- Explicit human and agent corrections provide the highest-value supervision for the Archetype Classifier

### Signal Modes
- **Pin** and **Boost** generate signals automatically with no `train_on_this` flag needed
- **Store**, **Delete**, **Reclassify**, and **Update** require explicit opt-in via `train_on_this=true` or `train=true`
- **Auto recall boost** (heat increase on search hit) intentionally does NOT generate training signals so recall traffic never floods the signal corpus

## API Reference

### Store Training
```http
POST /api/v1/agent/nodes
{
  "label": "Memory content here",
  "memory_type": "procedural",
  "train_on_this": true
}
```

### Delete Training
```http
DELETE /api/v1/agent/nodes/:id?train=true
```
Snapshots the content before deletion and records a `reject` signal so the System 1 VCR Value Gate rejects similar noise in the future.

### Reclassify Training
```http
PATCH /api/v1/agent/nodes/:id
{
  "memory_type": "procedural",
  "train_on_this": true
}
```

### Automatic Pin
```http
PATCH /api/v1/agent/nodes/:id
{
  "is_pinned": true
}
```
No `train_on_this` needed; pinning automatically records a high-confidence `accept` signal.

### Manual Boost
```http
PATCH /api/v1/agent/nodes/:id
{
  "current_heat": 0.95
}
```
No `train_on_this` needed; manual heat updates record a medium-confidence `accept` signal.

## Plugin Tools

| Tool | Parameters | Training |
|------|-----------|----------|
| `memory_store` | `content`, `memory_type`, `train` | `train=true` → `accept` signal |
| `memory_delete` | `id`, `train` | `train=true` (default) → `reject` signal |
| `memory_recall` | `query`, `limit`, `namespace` | No training signal |
| `consolidate` | `min_heat` | No training signal (soft-archive) |
| `evaluate_triggers` | `event`, `context_json` | No training signal |

## Model Retraining

Training signals accumulate automatically across memory lifecycle operations. Inspect signals and queue a model retrain via the [System 1 VCR API](vcr-api.md):

1. Inspect accumulated signals: `GET /api/v1/vcr/signals`
2. Check current model accuracy and status: `GET /api/v1/vcr/status`
3. Trigger an asynchronous retrain: `POST /api/v1/vcr/retrain`

## Version History

- **3.1.0**: Unified pure-Rust System 1 VCR (`/api/v1/vcr/*` & `/api/v1/settings/vcr*`)
- **3.9.0**: `train_on_this` inline signals on store, update, and reclassify
- **3.10.0**: Auto-capture value gate and noise filtering
- **3.11.0**: `memory_delete` reject signal capture and automatic pin/boost signals
