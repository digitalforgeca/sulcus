# Sulcus Memory Type Classifier

**Author:** Digital Forge Studios  
**Purpose:** Lightweight on-device classifier for Sulcus memory types  
**Latency target:** < 50ms end-to-end on modern laptop CPU  
**Expected accuracy:** 90–95%

---

## Overview

Sulcus uses a reactive, thermodynamic memory model with five memory types. The current LLM-based classification produces inconsistent results (e.g., everything classified as "preference"). This classifier replaces that with a deterministic, fast, on-device ONNX model.

### Memory Types

| Label | Description | Examples |
|-------|-------------|---------|
| `episodic` | Time-bound events and experiences | "I deployed the server at 3pm", "The demo crashed during the call" |
| `semantic` | Timeless facts and knowledge | "PostgreSQL default port is 5432", "Rust uses ownership for memory safety" |
| `preference` | Personal preferences, settings, opinions | "I prefer dark mode", "Use tab width 4", "Always use BiSolid icons" |
| `procedural` | How-to steps, workflows, instructions | "To deploy: build, push to ACR, run az containerapp update" |
| `synthesis` | Analyses and conclusions from multiple sources | "After reviewing three approaches, CRDT is best because..." |

---

## Architecture

```
Input text
    │
    ▼
sentence-transformers/all-MiniLM-L6-v2
(384-dim L2-normalized embedding, ~80MB, <8ms on CPU)
    │
    ▼
StandardScaler
(zero mean, unit variance normalization)
    │
    ▼
LogisticRegression (liblinear, C=4.0, multinomial softmax)
(trained on 1000 examples, 200/class)
    │
    ▼
ONNX Runtime (CPU provider)
    │
    ▼
{label, confidence, probabilities, review_needed, latency_ms}
```

### Why sentence-transformers + logistic regression instead of fine-tuning?

- **Latency:** MiniLM + LogReg hits 8–12ms. Fine-tuned DistilBERT hits 40–80ms.  
- **Data:** 1000 training examples. Fine-tuning needs 10k+ for reliability.  
- **Portability:** ONNX runs on macOS, Linux, Windows without PyTorch.  
- **Accuracy:** Sentence embeddings capture semantic meaning well for 5 clearly-defined classes.

### Why MiniLM-L6-v2 specifically?

| Model | Accuracy | Latency | Size |
|-------|----------|---------|------|
| TF-IDF + LogReg | ~84% | 0.5ms | <1MB |
| **MiniLM-L6-v2 + LogReg** | **~93%** | **8ms** | **80MB** |
| DistilBERT + LogReg | ~95% | 40ms | 260MB |
| DistilBERT fine-tuned | ~97% | 80ms | 260MB |

MiniLM-L6-v2 hits the sweet spot for on-device inference.

---

## Training Data

**File:** `training_data.csv`  
**Format:** `text,label`  
**Size:** 1000 examples, exactly 200 per class  
**Domains:** Software engineering, business operations, personal/lifestyle, AI agents, infrastructure

### Quality considerations

- Examples reflect real AI agent memory contexts (OpenClaw, Claude, Sulcus agents)
- Varied length: single-line facts to multi-sentence analyses  
- Ambiguous edge cases included with best-fit labels:
  - `"I always deploy with --force when confident"` → **preference** (it's a personal rule, not a step-by-step)
  - `"To force-push: use git push --force-with-lease"` → **procedural** (it's a how-to)
  - `"We skipped staging and caused a 20-minute outage"` → **episodic** (time-bound event)
  - `"After reviewing three approaches, CRDT is best because..."` → **synthesis** (conclusion from multiple sources)

---

## Usage

### Prerequisites

```bash
cd /Users/dv00003-00/dev/sulcus/classifier
pip install -r requirements.txt
```

### Train

```bash
python train.py
```

Output:
```
Sulcus Memory Type Classifier — Training
Loading data: 1000 examples
Embedding 1000 texts... (takes ~30s on CPU, ~5s on GPU)
Training on 850 examples, testing on 150...
Test Accuracy: 0.9333 (93.33%)

Per-class metrics:
              precision    recall  f1-score   support
    episodic     0.96      0.93      0.95        30
    semantic     0.97      0.97      0.97        30
   preference    0.88      0.90      0.89        30
   procedural    0.90      0.87      0.88        30
   synthesis     0.97      1.00      0.98        30

ONNX model saved: model/memory_classifier.onnx (2.1 MB)
Label map saved: model/label_map.json
Tokenizer saved: model/tokenizer/
```

### Classify a single text

```bash
python classify.py "I deployed the server at 3pm today."
```
```
Label:      episodic
Confidence: 97.2%  (9.3ms)
```

```bash
python classify.py --verbose "PostgreSQL default port is 5432."
```
```
Label:      semantic
Confidence: 99.1%  (8.1ms)
Probabilities:
  semantic     99.1%  ████████████████████
  episodic      0.4%
  procedural    0.3%
  preference    0.1%
  synthesis     0.1%
```

```bash
python classify.py --json "I prefer dark mode in all editors."
```
```json
{
  "label": "preference",
  "confidence": 0.9734,
  "probabilities": {
    "episodic": 0.0042,
    "preference": 0.9734,
    "procedural": 0.0119,
    "semantic": 0.0061,
    "synthesis": 0.0044
  },
  "review_needed": false,
  "latency_ms": 8.7
}
```

### Interactive mode

```bash
python classify.py --interactive
```

### Batch classification

```bash
python classify.py --batch memories.txt --json
```

---

## Model Artifacts

After training, `model/` contains:

```
model/
├── memory_classifier.onnx    # Exported ONNX model (~2MB)
├── label_map.json            # {0: "episodic", 1: "preference", ...}
├── model_config.json         # Embedding model metadata
└── tokenizer/                # Saved HuggingFace tokenizer
    ├── config.json
    ├── tokenizer.json
    ├── vocab.txt
    └── ...
```

---

## Integration with Sulcus

The classifier is designed to run before a memory hits the server:

```python
from classify import SulcusClassifier

clf = SulcusClassifier()  # loads lazily on first call

# In the memory insert path:
result = clf.classify(memory_text)

if result["review_needed"]:
    # Confidence < 70% — queue for human review or fall back to LLM
    memory_type = await llm_classify(memory_text)
else:
    memory_type = result["label"]

# Store with the classified type
await sulcus.insert_memory(text=memory_text, memory_type=memory_type)
```

### Production deployment notes

1. **Pre-warm at startup:** Load the classifier once at service start. First inference triggers model loading (~2s). Subsequent inferences are 8–12ms.
2. **Thread safety:** `onnxruntime.InferenceSession` is thread-safe for concurrent reads.
3. **Memory budget:** MiniLM model loads to ~400MB RAM. Budget accordingly.
4. **Confidence threshold:** Default 0.70. Below this, fall back to LLM or human review. Tune per deployment.
5. **Retraining cadence:** Retrain quarterly with fresh production examples to prevent accuracy drift.

---

## Retraining

To improve accuracy:

1. Collect misclassified examples from production logs
2. Add to `training_data.csv` with correct labels
3. Re-run `python train.py`
4. Compare metrics against previous model
5. Deploy the new ONNX to production

### Known ambiguous cases (hardest to classify)

| Text pattern | Ambiguous between | Correct label |
|---|---|---|
| `"I always X"` | preference ↔ procedural | **preference** (personal rule, not a how-to) |
| `"We X yesterday"` | episodic ↔ procedural | **episodic** (past event) |
| `"X is best because Y"` | semantic ↔ synthesis | **synthesis** (conclusion drawn, not a fact) |
| `"X is defined as Y"` | semantic ↔ procedural | **semantic** (definition, not instructions) |
| `"After reviewing..."` | synthesis ↔ episodic | **synthesis** (meta-analysis, not an event) |

---

## License

Copyright © Digital Forge Studios. All rights reserved.
