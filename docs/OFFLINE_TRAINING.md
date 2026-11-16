# Offline Training

Sulcus includes a pure-Rust self-improving loop: user interactions, folder corpora (`sulcus train classifier <folder>`), and curation actions generate training signals that specialize **System 1 VCR** locally on workstation CPUs with zero Python dependencies and zero remote LLM calls:

- **`V` (Value Gate)**: Pure-Rust Wide-and-Deep MLP deciding whether candidate text is worth storing (`should_store`) and calibrating initial utility.
- **`C` (Archetype Classifier)**: Pure-Rust Wide-and-Deep MLP routing memories into the 6 Golden Index archetypes (`episodic`, `semantic`, `preference`, `procedural`, `fact`, `synthesis`) or custom domain folder labels.
- **`R` (Retrieval Scorer)**: Feedback-tuned **7-signal linear scorer** (`similarity_weight`, `heat_weight`, `recency_weight`, `source_boost_semantic`, `source_boost_hot`, `source_boost_entity`, `source_boost_profile`).
- **Swappable Cartridges (`~/.sulcus/cartridges/`)**: Swap built-in 384-d ONNX (`~/.sulcus/models/fastembed`) or custom pure-Rust `Bert` and `NomicBert` `safetensors` embedders via `sulcus model use <cartridge-id>`, plus optional Edge SLM cartridges (deterministic heuristic extraction augmented with additive neural confidence scoring).

See [System 1 VCR API Reference](vcr-api.md) for HTTP and SDK endpoints.

---

## Signal Sources

Training data is generated from normal memory operations. Each signal captures a labeled example that teaches System 1 VCR what durable memory looks like and how to classify it.

| Source | Signal Type | Trigger |
|---|---|---|
| `store` with `train=true` | Positive value + archetype label | Developer explicitly marks a store as training data |
| `delete` with `train=true` | Negative value signal | Developer marks a deletion as noise to reject |
| `pin` | Positive value signal (auto) | Pinning implies high importance; auto-generates a positive signal |
| `boost` | Positive value signal (auto) | Boosting heat implies relevance; auto-generates a positive signal |
| `reclassify` with `train=true` | Archetype correction signal | Developer corrects a misclassified node |
| Curator `reclassify_pending` | Archetype correction signal (auto) | The [Curation Cycle](CURATION.md) flags and reclassifies stale nodes |

### Train Parameter

Memory lifecycle operations accept `train_on_this=True` (or `train=True` on delete). When enabled, the operation records a System 1 VCR training signal atomically alongside its normal effect:

```python
# Store a memory and record a positive training signal
client.remember("User prefers dark mode", memory_type="preference", train_on_this=True)

# Delete a low-value memory and teach the Value Gate to reject similar content
client.forget("abc-123", train_on_this=True)

# Correct a misclassified node and train the Archetype Classifier
client.update("def-456", memory_type="procedural", train_on_this=True)
```

---

## Trained Subsystems

### Value Gate

The System 1 VCR Value Gate decides whether incoming content is worth storing. Training signals teach it to:

- **Accept** high-signal, information-dense content (from `remember(..., train_on_this=True)`, `pin`, `boost`)
- **Reject** noise, duplicates, and transient chatter (from `forget(..., train_on_this=True)`)

### Archetype Classifier

The System 1 VCR Archetype Classifier assigns memory archetypes (`episodic`, `semantic`, `preference`, `procedural`, `fact`, `synthesis`). Training signals teach it to:

- **Classify** new memories accurately based on domain content patterns
- **Adapt** when archetypes are corrected (`update(..., memory_type=..., train_on_this=True)` and curator `reclassify_pending`)

### Retrieval Scorer

Recall feedback (`POST /api/v1/feedback` and `POST /api/v1/agent/recall-log`) tunes the 7-signal Retrieval Scorer weights for your workspace.

---

## Training Lifecycle

```
  User interactions & Curation
           │
           ▼
  ┌─────────────────┐
  │  Training Signal │  (stored in training_signals table)
  │  Generation      │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Export         │  Signals exported as labeled datasets
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Retrain        │  System 1 VCR heads retrained offline
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Serialize      │  Updated weights written to cartridge
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Hot-Swap       │  Running instance loads updated weights
  └─────────────────┘    without restart
```

1. **Signal generation**: Lifecycle operations record labeled training examples alongside memory operations.
2. **Export**: Accumulated signals are assembled into structured training batches.
3. **Retrain**: System 1 VCR Value Gate, Archetype Classifier, and Retrieval Scorer weights are retrained on the corpus (`POST /api/v1/vcr/retrain` or `sulcus train classifier <folder>`).
4. **Serialize**: Retrained weights are persisted cleanly on disk.
5. **Hot-swap**: The running Sulcus engine atomically swaps in the updated weights without requiring a restart.

---

## Self Improving Loop

Sulcus compounds accuracy the more you use it:

1. Agents and developers curate memories → training signals accumulate
2. Background curation maintains graph hygiene → additional training signals
3. System 1 VCR retrains on real workspace patterns → sharper value gating and archetype precision
4. Cleaner memories enter the graph → higher recall signal-to-noise ratio

A fresh Sulcus instance starts with general-purpose weights and adapts continuously to your specific codebase, vocabulary, and quality standards.

---

## Operational Notes

- Training signals are compact metadata records that do not duplicate full Territory payloads.
- Offline training runs off the hot recall path and never adds latency to agent turns.
- Weight hot-swapping is atomic: active requests complete against the prior snapshot while new turns use the updated model.
- All local training data stays on your workstation unless cloud sync is explicitly configured.
