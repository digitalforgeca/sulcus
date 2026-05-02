# SIU Training Pipeline

Training data preparation for the Sulcus Semantic Intelligence Unit (SIU).

## Pipeline

```
1. export_memories.py    → raw_memories_full.jsonl     (API export)
2. label_memories.py     → labeled_memories.jsonl      (auto-label: store/reject + type)
3. anonymize.py          → anonymized_memories.jsonl   (PII scrubbing)
4. format_training_data.py → sivu_training_{train,test}.jsonl  (quality gate)
                           → sicu_training_{train,test}.jsonl  (classifier)
```

## Models

### SIVU — SI Value Unit (Quality Gate)
- Binary classification: `store` / `reject`
- scikit-learn SGDClassifier + TfidfVectorizer → ONNX
- Target: >95% precision on reject, >90% recall

### SICU — SI Classification Unit (Type Classifier)
- Multi-label: episodic / semantic / preference / procedural / fact
- scikit-learn OneVsRestClassifier(SGDClassifier) + TfidfVectorizer → ONNX
- **Uses `class_weight='balanced'`** to compensate for class imbalance
  (preference: 6%, semantic: 9% vs episodic: 32%, fact: 27%)
- Target: >90% accuracy, >85% per-class F1

## Data Format

### Pipeline intermediate files (raw → labeled → anonymized)
Field `content` holds the memory text. Field `label` is **not** used for content
(avoids collision with the ML training label).

### Final training files (sivu/sicu)
```json
{
  "text": "memory content (anonymized)",
  "label": "store|reject" or "episodic|semantic|preference|procedural|fact",
  "confidence": "low|medium|high",
  "namespace": "daedalus|icarus|ariadne|default",
  "original_id": "uuid"
}
```

## Quick Start

```bash
# Full pipeline
python export_memories.py --api-url https://api.sulcus.ca --api-key $KEY --output raw.jsonl
python label_memories.py --input raw.jsonl --output labeled.jsonl --stats
python anonymize.py --input labeled.jsonl --output anon.jsonl
python format_training_data.py --input anon.jsonl
```
