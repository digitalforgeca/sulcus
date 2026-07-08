# Offline Training Pipeline

Sulcus includes a self-improving feedback loop: user interactions and autonomous curation generate training signals that retrain the SIU (Sulcus Intelligence Unit) models offline, producing better quality gates and classifiers over time.

---

## Training Signal Sources

Training data is generated from normal memory operations. Each signal captures a labeled example that teaches the SIU what good memory looks like and how to classify it.

| Source | Signal Type | Trigger |
|---|---|---|
| `store` with `train=true` | Positive quality + type label | Developer explicitly marks a store as training data |
| `delete` with `train=true` | Negative quality signal | Developer marks a deletion as "this should have been rejected" |
| `pin` | Positive quality signal (auto) | Pinning implies high importance — auto-generates a positive signal |
| `boost` | Positive quality signal (auto) | Boosting heat implies relevance — auto-generates a positive signal |
| `reclassify` with `train=true` | Type correction signal | Developer corrects a misclassified node |
| Curator `reclassify_pending` | Type correction signal (auto) | The [Curation Cycle](CURATION.md) flags and reclassifies stale nodes |

### The `train` Parameter

Several API operations accept an optional `train` parameter (boolean, default `false`). When set to `true`, the operation generates a training signal in addition to its normal effect:

```python
# Store a memory and generate a positive training signal
client.store("User prefers dark mode", memory_type="preference", train=True)

# Delete a low-quality memory and teach the quality gate to reject similar content
client.delete(node_id="abc-123", train=True)

# Correct a misclassified node and train the classifier
client.reclassify(node_id="def-456", new_type="procedural", train=True)
```

---

## What Gets Trained

### SIVU — Quality Gate

The SIVU (Sulcus Intelligence Validation Unit) decides whether incoming content is worth storing. Training signals teach it to:

- **Accept** high-quality, information-dense content (from `store train=true`, `pin`, `boost`)
- **Reject** noise, duplicates, and low-value content (from `delete train=true`)

### SICU — Type Classifier

The SICU (Sulcus Intelligence Classification Unit) assigns memory types (`episodic`, `semantic`, `preference`, `procedural`). Training signals teach it to:

- **Correctly classify** new memories based on content patterns (from `store train=true` with explicit type)
- **Correct mistakes** when types are reassigned (from `reclassify train=true`, curator `reclassify_pending`)

---

## The Training Lifecycle

```
  User interactions & Curation
           │
           ▼
  ┌─────────────────┐
  │  Training Signal │  (stored in training_signals table)
  │  Generation       │
  └────────┬──────────┘
           │
           ▼
  ┌─────────────────┐
  │  Export          │  Signals exported as labeled datasets
  └────────┬──────────┘
           │
           ▼
  ┌─────────────────┐
  │  Retrain         │  SIVU and SICU models retrained offline
  └────────┬──────────┘
           │
           ▼
  ┌─────────────────┐
  │  Deploy ONNX     │  New model weights exported as ONNX
  └────────┬──────────┘
           │
           ▼
  ┌─────────────────┐
  │  Hot-Swap        │  Running instance loads new models
  └─────────────────┘    without restart
```

1. **Signal generation** — Operations produce labeled training examples stored alongside memory data.
2. **Export** — Training signals are exported as structured datasets for offline processing.
3. **Retrain** — SIVU and SICU models are retrained on the accumulated signal corpus.
4. **Deploy** — Retrained models are exported as ONNX format for efficient inference.
5. **Hot-swap** — The running Sulcus instance detects new model files and loads them without requiring a restart. The transition is seamless.

---

## The Self-Improving Loop

The key insight is that Sulcus gets smarter the more you use it:

1. You store and organize memories → training signals accumulate
2. The curator autonomously maintains quality → more training signals
3. Models retrain on real usage patterns → better quality gates and classification
4. Better models produce fewer misclassifications → less curator work needed
5. The cycle continues, compounding improvement over time

This means a fresh Sulcus instance starts with general-purpose models, but after sustained use, the SIU adapts to your specific domain, terminology, and quality standards.

---

## Notes

- Training signals are lightweight metadata — they don't duplicate memory content.
- The offline training step runs outside the critical path and never impacts runtime performance.
- Model hot-swap is atomic: the old model serves requests until the new one is fully loaded.
- All training data stays local unless cloud sync is explicitly enabled.
