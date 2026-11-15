# Memory Lifecycle Training Signals

Every memory lifecycle action in Sulcus can generate training data for the SIU (Semantic Inference Unit). This creates a continuous feedback loop where agent behavior improves the quality gate and type classifier over time.

## Signal Sources

| Action | Signal Type | Source Tag | Confidence | Requires |
|--------|------------|------------|------------|----------|
| **Store** with `train_on_this=true` | `accept` | `train_on_this` | Explicit | Plugin ≥ 3.9.0 |
| **Delete** with `train=true` | `reject` | `agent_delete` | High | Plugin ≥ 3.11.0 |
| **Reclassify** (PATCH `memory_type` + `train_on_this=true`) | `reclassify` | `train_on_this` | Explicit | Any version |
| **Pin** (PATCH `is_pinned=true`) | `accept` | `pin` | High | Server-side only |
| **Manual Boost** (PATCH `current_heat`) | `accept` | `boost` | Medium | Server-side only |
| **Update** without type change + `train_on_this=true` | `accept` | `train_on_this` | Reinforcement | Any version |

## How It Works

### SIVU (Store/Reject Quality Gate)
- `accept` signals teach SIVU that content like this **should** be stored
- `reject` signals teach SIVU that content like this **should not** be stored
- Higher confidence signals (pin, explicit delete) are weighted more heavily during model retraining

### SICU (Type Classifier)
- `reclassify` signals correct the type assignment (e.g., "this was labeled `episodic` but should be `procedural`")
- These are the highest-value signals for SICU because they represent explicit human/agent corrections

### Automatic vs Explicit Signals
- **Pin** and **Boost** generate signals automatically; no `train_on_this` flag needed
- **Store**, **Delete**, **Reclassify**, and **Update** require explicit opt-in via `train_on_this=true` or `train=true`
- **Auto recall boost** (heat increase on search hit) intentionally does NOT generate training signals; it would flood the table

## API Reference

### Store with Training
```http
POST /api/v1/agent/nodes
{
  "label": "Memory content here",
  "memory_type": "procedural",
  "train_on_this": true
}
```

### Delete with Training
```http
DELETE /api/v1/agent/nodes/:id?train=true
```
Snapshots the content before deletion, records a `reject` signal. The SIVU learns to reject similar content in future.

### Reclassify with Training
```http
PATCH /api/v1/agent/nodes/:id
{
  "memory_type": "procedural",
  "train_on_this": true
}
```

### Pin (auto-generates signal)
```http
PATCH /api/v1/agent/nodes/:id
{
  "is_pinned": true
}
```
No `train_on_this` needed; pinning always generates a high-confidence `accept` signal.

### Manual Boost (auto-generates signal)
```http
PATCH /api/v1/agent/nodes/:id
{
  "current_heat": 0.95
}
```
No `train_on_this` needed; manual heat changes always generate a medium-confidence `accept` signal.

## Plugin Tools (OpenClaw)

| Tool | Parameters | Training |
|------|-----------|----------|
| `memory_store` | `content`, `memory_type`, `train` | `train=true` → accept signal |
| `memory_delete` | `id`, `train` | `train=true` (default) → reject signal |
| `memory_recall` | `query`, `limit`, `namespace` | No training signal |
| `consolidate` | `min_heat` | No training signal (soft-delete/archive) |
| `evaluate_triggers` | `event`, `context_json` | No training signal |

## Retraining via API

Training signals accumulate automatically across your memory lifecycle operations. You can inspect signals and queue a model retrain via the SIU v2 API:

1. Inspect accumulated signals: `GET /api/v2/siu/signals`
2. Check current model accuracy and status: `GET /api/v2/siu/status`
3. Trigger an asynchronous retrain: `POST /api/v2/siu/retrain`

## Version History

- **3.9.0**: `train_on_this` on store/update/reclassify
- **3.10.0**: SIU junk filter, autoCapture quality gate
- **3.11.0**: `memory_delete` tool with SIVU reject training
- **Server (2026-04-02)**: Pin and boost auto-generate training signals (no plugin update needed)
